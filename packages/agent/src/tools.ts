import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  critiquePlan,
  patchOpSchema,
  recipeFor,
  type ScenePlanInput,
  scenePlanSchema,
  setResolvedAsset,
} from "@dalang/core";
import {
  materializeCandidate,
  runAssetStage,
  runTtsStage,
  type SceneStageResult,
  type StockProvider,
  type TtsProvider,
} from "@dalang/pipeline";
import { ELEVENLABS_ESTIMATED_USD_PER_CHAR } from "@dalang/providers";
import type { RenderVideoResult } from "@dalang/renderer";
import { generateText, type ToolSet, tool } from "ai";
import { z } from "zod";
import type { ResolvedModel } from "./models/resolve";
import type { Guardrails } from "./runtime/guardrails";
import type { ProjectSession } from "./runtime/session";
import {
  cropImage,
  locatePrompt,
  parseBbox,
  parseVerification,
  verifyPrompt,
} from "./vision/grounding";

/**
 * Tools §6.2 — jendela agent ke sistem. Setiap tool:
 *  - input divalidasi zod (applyPatch memakai patchOpSchema §5.2 apa adanya),
 *  - dieksekusi lewat wrapper yang mencatat input/output/durasi/biaya ke
 *    agent_events (PRD §6.3) dan melaporkan aktivitas live ke UI/CLI,
 *  - mengembalikan objek {ok, …} — error dikembalikan sebagai data agar model
 *    bisa mengoreksi arah, bukan exception yang memutus giliran.
 * Semua dependensi eksternal (TTS/stock/render/model volume) di-inject.
 */

export interface AgentDeps {
  guards: Guardrails;
  ttsChainFor: (provider: string) => TtsProvider[];
  stockChain: () => StockProvider[];
  renderVideo: (options: {
    planPath: string;
    outputLocation: string;
    profile: "draft" | "final";
  }) => Promise<RenderVideoResult>;
  /** Model tier-2 (murah/multimodal) untuk researchTopic & analyzeImage. */
  volumeModel?: ResolvedModel;
  /**
   * Baca metadata video lokal (ADR-0017) — path relatif folder plan.
   * null = tidak terbaca/tidak didukung. Di-inject supaya paket agent tidak
   * bergantung pada renderer (dan tes bisa memberi fake).
   */
  videoMetadata: (
    fileRelativeToPlan: string,
  ) => Promise<{ durationSec: number; width: number; height: number } | null>;
  /**
   * Cari jeda hening di rekaman (ADR-0017) — path relatif folder plan.
   * Mengukur amplitudo, BUKAN makna: memberi titik potong alami, bukan
   * pilihan momen. null = tidak terbaca.
   */
  detectSilence: (fileRelativeToPlan: string) => Promise<{
    durationSec: number;
    silences: Array<{ startSec: number; endSec: number }>;
    audible: Array<{ startSec: number; endSec: number }>;
  } | null>;
  onToolActivity?: (line: string) => void;
}

type ToolOutput = Record<string, unknown>;

const compactResults = (results: SceneStageResult[]) =>
  results.map((result) => ({
    scene: result.sceneId,
    status: result.status,
    detail: result.detail,
  }));

const sumCost = (results: SceneStageResult[]): number =>
  results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);

export const buildAgentTools = (session: ProjectSession, deps: AgentDeps): ToolSet => {
  const { guards } = deps;
  const activity = deps.onToolActivity ?? (() => {});

  /** Wrapper logging + aktivitas untuk semua tool. */
  const run = async (
    name: string,
    input: unknown,
    fn: () => Promise<ToolOutput>,
  ): Promise<ToolOutput> => {
    const startedAt = Date.now();
    try {
      const output = await fn();
      const costUsd = typeof output.costUsd === "number" ? output.costUsd : 0;
      session.events.record({
        turn: session.turn,
        kind: "tool",
        name,
        input,
        output,
        durationMs: Date.now() - startedAt,
        costUsd,
      });
      activity(`  · ${name} — ok${costUsd > 0 ? ` (~$${costUsd.toFixed(4)})` : ""}`);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.events.record({
        turn: session.turn,
        kind: "tool",
        name,
        input,
        error: message,
        durationMs: Date.now() - startedAt,
      });
      activity(`  · ${name} — gagal: ${message}`);
      return { ok: false, error: message };
    }
  };

  const requirePlan = () => {
    if (!session.plan) {
      throw new Error("Belum ada scene-plan — buat draft dulu lewat writeScenePlan");
    }
    return session.plan;
  };

  return {
    // ADR-0017: kritik-diri DELIBERAT. Catatan sutradara memang sudah
    // disuntikkan pasif ke konteks, tapi memanggilnya sebagai tool memaksa
    // model berhenti dan membaca kelemahan rencananya sendiri sebelum lanjut.
    critiqueDraft: tool({
      description:
        "Periksa scene-plan saat ini terhadap kaidah sutradara DAN resep format (meta.format). Panggil SETELAH menyusun/merevisi draft, sebelum lanjut ke suara/aset/render. Kembalikan daftar catatan; perbaiki yang 'perhatian' dulu, atau jelaskan singkat kenapa sengaja diabaikan.",
      inputSchema: z.object({}),
      execute: (input) =>
        run("critiqueDraft", input, async () => {
          const plan = requirePlan();
          const recipe = recipeFor(plan.meta.format);
          const notes = critiquePlan(plan);
          return {
            ok: true,
            format: recipe.format,
            kerangkaFormat: recipe.kerangka,
            jumlahCatatan: notes.length,
            catatan: notes.map((note) => ({
              kode: note.code,
              level: note.level,
              sceneId: note.sceneId ?? null,
              pesan: note.message,
            })),
            bersih: notes.length === 0,
          };
        }),
    }),

    // ADR-0017: pintu masuk kemampuan MENGKLIP — daftarkan rekaman panjang
    // sebagai aset, lalu tiap scene memotongnya lewat visual.trimStartSec.
    ingestVideo: tool({
      description:
        "Daftarkan file VIDEO lokal di folder proyek (mis. 'assets/podcast.mp4') sebagai aset scene, dan baca durasi + dimensinya. Dipakai untuk MENGKLIP rekaman panjang: panggil sekali per scene, lalu set visual.trimStartSec (detik) dan duration scene lewat applyPatch untuk memilih potongan. Aset ini ter-pin.",
      inputSchema: z.object({
        sceneId: z.string().min(1),
        file: z
          .string()
          .min(1)
          .describe("Path relatif terhadap folder plan, mis. 'assets/podcast.mp4'"),
      }),
      execute: (input) =>
        run("ingestVideo", input, async () => {
          const plan = requirePlan();
          if (!plan.scenes.some((scene) => scene.id === input.sceneId)) {
            return { ok: false, error: `Scene ${input.sceneId} tidak ada` };
          }
          const meta = await deps.videoMetadata(input.file);
          if (!meta) {
            return {
              ok: false,
              error: `Tidak bisa membaca video "${input.file}" — pastikan path relatif terhadap folder plan dan formatnya didukung`,
            };
          }
          session.plan = setResolvedAsset(plan, input.sceneId, {
            file: input.file,
            kind: "video",
            source: "local",
            license: "milik user (rekaman sumber)",
            width: meta.width,
            height: meta.height,
            durationSec: meta.durationSec,
          });
          const { summary } = session.applyAgentPatch([
            {
              op: "replaceAsset",
              sceneId: input.sceneId,
              assetId: input.file,
              pinned: true,
            },
            {
              op: "updateScene",
              id: input.sceneId,
              patch: { visual: { type: "image" } },
            },
          ]);
          return {
            ok: true,
            file: input.file,
            durasiDetik: Number(meta.durationSec.toFixed(2)),
            lebar: meta.width,
            tinggi: meta.height,
            ringkasanPerubahan: summary,
            catatan:
              "Pilih potongan lewat applyPatch: visual.trimStartSec = detik mulai, dan duration scene = panjang potongan.",
          };
        }),
    }),

    // ADR-0017: agent tidak bisa MENDENGAR isi rekaman, tapi bisa tahu di mana
    // orang berhenti bicara. Itu cukup untuk menempatkan batas potong pada
    // jeda alami alih-alih di tengah napas.
    findCutPoints: tool({
      description:
        "Cari jeda hening di rekaman lokal untuk dipakai sebagai titik potong ALAMI (batas kalimat penutur). Kembalikan daftar jeda + rentang bersuara. PENTING: ini mengukur suara/hening, BUKAN isi — ia tidak tahu apa yang dibicarakan, jadi jangan memakainya untuk menebak momen menarik. Untuk memilih momen, minta transkrip atau penanda waktu ke user.",
      inputSchema: z.object({
        file: z
          .string()
          .min(1)
          .describe("Path relatif terhadap folder plan, mis. 'assets/podcast.mp4'"),
        sekitarDetik: z
          .number()
          .min(0)
          .optional()
          .describe(
            "Bila diisi, kembalikan hanya jeda terdekat di sekitar detik ini (untuk merapikan satu batas potong).",
          ),
      }),
      execute: (input) =>
        run("findCutPoints", input, async () => {
          requirePlan();
          const report = await deps.detectSilence(input.file);
          if (!report) {
            return {
              ok: false,
              error: `Tidak bisa membaca audio "${input.file}" — pastikan path relatif terhadap folder plan dan berkasnya punya jalur audio`,
            };
          }
          // Titik potong = tengah tiap jeda; di situlah pemotongan paling
          // tidak terdengar.
          const cuts = report.silences.map((span) =>
            Number(((span.startSec + span.endSec) / 2).toFixed(2)),
          );
          const near =
            input.sekitarDetik === undefined
              ? null
              : [...cuts].sort(
                  (a, b) =>
                    Math.abs(a - (input.sekitarDetik as number)) -
                    Math.abs(b - (input.sekitarDetik as number)),
                )[0];

          return {
            ok: true,
            file: input.file,
            durasiDetik: Number(report.durationSec.toFixed(2)),
            jumlahJeda: report.silences.length,
            // Batasi supaya rekaman panjang tidak membanjiri konteks.
            titikPotongDetik: cuts.slice(0, 60),
            rentangBersuara: report.audible.slice(0, 40),
            ...(near === undefined || near === null
              ? {}
              : { titikTerdekat: near, geserDari: input.sekitarDetik }),
            catatan:
              report.silences.length === 0
                ? "Tidak ada jeda terdeteksi — rekaman mungkin bermusik/berdesir terus. Potongan harus ditentukan dari transkrip."
                : "Pakai titik potong ini untuk visual.trimStartSec dan akhir potongan, supaya potongan tidak jatuh di tengah kata. Isi potongan tetap perlu transkrip dari user.",
          };
        }),
    }),

    getProjectState: tool({
      description:
        "Baca keadaan proyek terkini: ringkasan scene-plan, perubahan terakhir (patch log), status suara/aset per scene, dan total biaya. Panggil ini bila ragu dengan keadaan.",
      inputSchema: z.object({}),
      execute: (input) =>
        run("getProjectState", input, async () => ({
          ok: true,
          ringkasan: session.summary(),
          totalBiayaTercatatUsd: Number(session.events.totalCostUsd().toFixed(4)),
        })),
    }),

    applyPatch: tool({
      description:
        "SATU-SATUNYA cara memodifikasi scene-plan. Kirim daftar operasi kecil (addScene/updateScene/removeScene/reorderScenes/setMeta/setAudio/replaceAsset). Batch atomik; scene terkunci akan DITOLAK; lockScene bukan wewenangmu. Setelah patch, ringkas perubahannya ke user.",
      inputSchema: z.object({ ops: z.array(patchOpSchema).min(1) }),
      execute: (input) =>
        run("applyPatch", input, async () => {
          const { summary } = session.applyAgentPatch(input.ops);
          return { ok: true, ringkasanPerubahan: summary };
        }),
    }),

    writeScenePlan: tool({
      description:
        "Buat draft scene-plan awal untuk proyek KOSONG (satu kali). Susun 6–10 scene: pembuka template-anim variant 'title', badan bernarasi 12–20 kata per scene dengan visual.query bahasa Inggris yang spesifik, penutup variant 'outro'. Proyek yang sudah punya plan harus diubah lewat applyPatch.",
      inputSchema: z.object({ plan: scenePlanSchema }),
      execute: (input) =>
        run("writeScenePlan", input, async () => {
          const plan = session.initializePlan(input.plan as ScenePlanInput);
          return {
            ok: true,
            judul: plan.meta.title,
            jumlahScene: plan.scenes.length,
          };
        }),
    }),

    generateVoiceover: tool({
      description:
        "Sintesis TTS untuk scene tertentu (atau semua bila sceneIds kosong). Butuh audio.voice terpasang di plan (set lewat applyPatch setAudio; provider: elevenlabs | edge | silence). Hasil di-cache per scene — aman dipanggil ulang.",
      inputSchema: z.object({
        sceneIds: z
          .array(z.string())
          .optional()
          .describe("Kosongkan untuk semua scene bernarasi"),
      }),
      execute: (input) =>
        run("generateVoiceover", input, async () => {
          const plan = requirePlan();
          const voice = plan.audio.voice;
          if (!voice) {
            throw new Error(
              "audio.voice belum diset — pasang dulu lewat applyPatch setAudio (provider: elevenlabs | edge | silence)",
            );
          }
          const providers = deps.ttsChainFor(voice.provider);
          const targetScenes = plan.scenes.filter(
            (scene) =>
              scene.narration.trim() !== "" &&
              (!input.sceneIds || input.sceneIds.includes(scene.id)),
          );
          const totalChars = targetScenes.reduce(
            (sum, scene) => sum + scene.narration.length,
            0,
          );
          const estimatedUsd =
            voice.provider === "elevenlabs"
              ? totalChars * ELEVENLABS_ESTIMATED_USD_PER_CHAR
              : 0;

          if (
            targetScenes.length > guards.config.ttsSceneGate ||
            estimatedUsd > guards.config.approvalGateUsd
          ) {
            const approved = await guards.approve({
              action: "tts-massal",
              detail: `TTS ${targetScenes.length} scene (${totalChars} karakter, ${voice.provider})`,
              estimatedUsd,
            });
            if (!approved) {
              throw new Error(
                "User menolak TTS massal — tawarkan menjalankan per beberapa scene atau tanya dulu",
              );
            }
          }
          if (estimatedUsd > 0) {
            const withinBudget = await guards.ensureProjectBudget(
              session.events.totalCostUsd(),
              estimatedUsd,
              "TTS",
            );
            if (!withinBudget) {
              throw new Error("Budget proyek terlampaui dan user tidak menyetujui");
            }
          }

          const outcome = await runTtsStage({
            paths: session.paths,
            plan,
            providers,
            db: session.db,
            sceneIds: input.sceneIds,
            log: { info: activity, warn: activity },
          });
          session.plan = outcome.plan;
          session.persist();
          const costUsd = sumCost(outcome.results);
          guards.addToolCost(costUsd);
          return { ok: true, hasil: compactResults(outcome.results), costUsd };
        }),
    }),

    resolveAssets: tool({
      description:
        "Resolve otomatis aset stock untuk scene bertipe 'stock' yang belum punya aset (kandidat pertama; video diutamakan). Scene pinned/terkunci dilewati. Untuk kontrol penuh pakai searchAssets + pickAsset.",
      inputSchema: z.object({ sceneIds: z.array(z.string()).optional() }),
      execute: (input) =>
        run("resolveAssets", input, async () => {
          const plan = requirePlan();
          const outcome = await runAssetStage({
            paths: session.paths,
            plan,
            providers: deps.stockChain(),
            db: session.db,
            sceneIds: input.sceneIds,
            log: { info: activity, warn: activity },
          });
          session.plan = outcome.plan;
          session.persist();
          return { ok: true, hasil: compactResults(outcome.results), costUsd: 0 };
        }),
    }),

    searchAssets: tool({
      description:
        "Cari kandidat stock footage/gambar (tanpa mengunduh). Hasil disimpan per query; pilih dengan pickAsset. Query bahasa Inggris, konkret dan visual.",
      inputSchema: z.object({
        query: z.string().min(2),
        kind: z.enum(["video", "image"]).default("video"),
      }),
      execute: (input) =>
        run("searchAssets", input, async () => {
          const plan = requirePlan();
          const chain = deps.stockChain();
          if (chain.length === 0) {
            throw new Error(
              "Tidak ada provider stock — set PEXELS_API_KEY dan/atau PIXABAY_API_KEY",
            );
          }
          const orientation =
            plan.meta.aspectRatio === "9:16"
              ? ("portrait" as const)
              : plan.meta.aspectRatio === "16:9"
                ? ("landscape" as const)
                : ("square" as const);
          for (const provider of chain) {
            const candidates = await provider.search({
              query: input.query,
              kind: input.kind,
              orientation,
              perPage: 8,
            });
            if (candidates.length === 0) continue;
            session.lastSearches.set(input.query, candidates);
            return {
              ok: true,
              provider: provider.id,
              kandidat: candidates.slice(0, 5).map((candidate, index) => ({
                index,
                assetId: candidate.assetId,
                ukuran: `${candidate.width}×${candidate.height}`,
                durasiSec: candidate.durationSec,
                author: candidate.author,
                license: candidate.license,
              })),
            };
          }
          throw new Error(`Tidak ada kandidat untuk "${input.query}"`);
        }),
    }),

    pickAsset: tool({
      description:
        "Unduh & pasang kandidat hasil searchAssets ke sebuah scene (berdasarkan query + index kandidat). Scene terkunci/pinned ditolak.",
      inputSchema: z.object({
        sceneId: z.string(),
        query: z.string(),
        index: z.number().int().min(0),
      }),
      execute: (input) =>
        run("pickAsset", input, async () => {
          const plan = requirePlan();
          const candidates = session.lastSearches.get(input.query);
          if (!candidates) {
            throw new Error(
              `Belum ada hasil pencarian untuk "${input.query}" — panggil searchAssets dulu`,
            );
          }
          const candidate = candidates[input.index];
          if (!candidate) {
            throw new Error(
              `Index ${input.index} di luar jangkauan (${candidates.length} kandidat)`,
            );
          }
          const provider = deps
            .stockChain()
            .find((entry) => entry.id === candidate.providerId);
          if (!provider) {
            throw new Error(`Provider ${candidate.providerId} tidak tersedia lagi`);
          }
          const { plan: next, asset } = await materializeCandidate({
            paths: session.paths,
            plan,
            db: session.db,
            sceneId: input.sceneId,
            provider,
            candidate,
          });
          session.plan = next;
          session.persist();
          return { ok: true, file: asset.file, license: asset.license };
        }),
    }),

    renderPreview: tool({
      description:
        "Render video draft (540p, cepat) ke folder proyek untuk dicek user. Jalankan setelah perubahan berarti; sebutkan path hasilnya ke user.",
      inputSchema: z.object({}),
      execute: (input) =>
        run("renderPreview", input, async () => {
          requirePlan();
          session.persist();
          const outputLocation = join(session.paths.dalangDir, "renders", "preview.mp4");
          const result = await deps.renderVideo({
            planPath: session.paths.planPath,
            outputLocation,
            profile: "draft",
          });
          return {
            ok: true,
            file: result.outputLocation,
            durasiSec: result.durationSec,
            ukuranMB: Number((result.sizeBytes / 1024 / 1024).toFixed(1)),
          };
        }),
    }),

    renderFinal: tool({
      description:
        "Render final 1080p — SELALU meminta konfirmasi user (memakan waktu beberapa menit). Panggil hanya bila user sudah puas dengan draft.",
      inputSchema: z.object({}),
      execute: (input) =>
        run("renderFinal", input, async () => {
          requirePlan();
          const approved = await guards.approve({
            action: "renderFinal",
            detail: "Render final 1080p (beberapa menit CPU/GPU)",
          });
          if (!approved) {
            throw new Error("User belum menyetujui render final");
          }
          session.persist();
          const outputLocation = join(session.paths.dalangDir, "renders", "final.mp4");
          const result = await deps.renderVideo({
            planPath: session.paths.planPath,
            outputLocation,
            profile: "final",
          });
          return {
            ok: true,
            file: result.outputLocation,
            durasiSec: result.durationSec,
            ukuranMB: Number((result.sizeBytes / 1024 / 1024).toFixed(1)),
          };
        }),
    }),

    researchTopic: tool({
      description:
        "Riset ringkas berbasis pengetahuan model tier-volume untuk bahan naskah: fakta kunci, angka/tahun, sudut cerita. Tandai ketidakpastian; fakta krusial tetap perlu verifikasi user.",
      inputSchema: z.object({ query: z.string().min(3) }),
      execute: (input) =>
        run("researchTopic", input, async () => {
          const volume = deps.volumeModel;
          if (!volume) {
            throw new Error(
              "Model tier-volume tidak tersedia — set env/flag model volume",
            );
          }
          const result = await generateText({
            model: volume.model,
            system:
              "Kamu periset naskah video dokumenter berbahasa Indonesia. Jawab ringkas dan terstruktur: FAKTA (dengan angka/tahun), TIDAK PASTI (hal yang kamu ragu), SUDUT CERITA (3 angle menarik). Jangan mengarang angka.",
            prompt: input.query,
          });
          guards.addLlmUsage(volume.info, result.totalUsage);
          session.events.record({
            turn: session.turn,
            kind: "llm",
            name: `research:${volume.key}`,
            input: { query: input.query },
            output: { chars: result.text.length },
            costUsd: null,
          });
          return { ok: true, catatan: result.text };
        }),
    }),

    analyzeImage: tool({
      description:
        "Analisis visual aset gambar sebuah scene dengan model vision tier-volume (deskripsi/OCR/kecocokan dengan narasi).",
      inputSchema: z.object({
        sceneId: z.string(),
        question: z.string().min(3),
      }),
      execute: (input) =>
        run("analyzeImage", input, async () => {
          const plan = requirePlan();
          const asset = plan.renderState.resolvedAssets[input.sceneId];
          if (!asset) {
            throw new Error(`Scene ${input.sceneId} belum punya aset ter-resolve`);
          }
          if (asset.kind !== "image") {
            throw new Error("Analisis frame video belum didukung — hanya aset gambar");
          }
          const volume = deps.volumeModel;
          if (!volume) {
            throw new Error("Model tier-volume tidak tersedia");
          }
          if (volume.info && !volume.info.imageInput) {
            throw new Error(
              `Model ${volume.key} tidak mendukung input gambar — pilih model vision`,
            );
          }
          const bytes = readFileSync(join(session.paths.planDir, asset.file));
          const extension = asset.file.split(".").at(-1)?.toLowerCase();
          const mediaType =
            extension === "svg"
              ? "image/svg+xml"
              : extension === "png"
                ? "image/png"
                : "image/jpeg";
          const result = await generateText({
            model: volume.model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", image: bytes, mediaType },
                  { type: "text", text: input.question },
                ],
              },
            ],
          });
          guards.addLlmUsage(volume.info, result.totalUsage);
          session.events.record({
            turn: session.turn,
            kind: "llm",
            name: `vision:${volume.key}`,
            input: { sceneId: input.sceneId, question: input.question },
            output: { chars: result.text.length },
            costUsd: null,
          });
          return { ok: true, analisis: result.text };
        }),
    }),

    locateUiElement: tool({
      description:
        "MODE TUTORIAL (§9): temukan bounding box elemen UI pada aset screenshot sebuah scene, LENGKAP dengan verifikasi grounding (crop hasil deteksi dikonfirmasi balik ke model vision). Pakai target-nya untuk annotations zoom/highlight/arrow via applyPatch. verified=false berarti model ragu — perbaiki deskripsi atau tentukan target manual, jangan dipakai buta.",
      inputSchema: z.object({
        sceneId: z.string(),
        /** Deskripsi elemen dalam bahasa apa pun, sespesifik mungkin. */
        description: z.string().min(3),
      }),
      execute: (input) =>
        run("locateUiElement", input, async () => {
          const plan = requirePlan();
          const asset = plan.renderState.resolvedAssets[input.sceneId];
          if (!asset) {
            throw new Error(
              `Scene ${input.sceneId} belum punya aset ter-resolve — jalankan stage assets dulu (aset lokal butuh visual.assetId path file)`,
            );
          }
          if (asset.kind !== "image") {
            throw new Error("Grounding hanya untuk aset gambar/screenshot");
          }
          const volume = deps.volumeModel;
          if (!volume) {
            throw new Error("Model tier-volume tidak tersedia");
          }
          if (volume.info && !volume.info.imageInput) {
            throw new Error(
              `Model ${volume.key} tidak mendukung input gambar — pilih model vision`,
            );
          }
          const bytes = readFileSync(join(session.paths.planDir, asset.file));

          const located = await generateText({
            model: volume.model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", image: bytes, mediaType: "image/png" },
                  { type: "text", text: locatePrompt(input.description) },
                ],
              },
            ],
          });
          guards.addLlmUsage(volume.info, located.totalUsage);
          const target = parseBbox(located.text);
          if (!target) {
            throw new Error(
              `Model tidak mengembalikan bounding box valid (jawaban: ${located.text.slice(0, 120)})`,
            );
          }

          // Verifikasi grounding: crop area terdeteksi -> konfirmasi.
          const crop = await cropImage(bytes, target);
          const verifiedResult = await generateText({
            model: volume.model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", image: crop.png, mediaType: "image/png" },
                  { type: "text", text: verifyPrompt(input.description) },
                ],
              },
            ],
          });
          guards.addLlmUsage(volume.info, verifiedResult.totalUsage);
          const verified = parseVerification(verifiedResult.text);

          session.events.record({
            turn: session.turn,
            kind: "llm",
            name: `grounding:${volume.key}`,
            input: { sceneId: input.sceneId, description: input.description },
            output: { target, verified },
            costUsd: null,
          });

          return {
            ok: true,
            target,
            verified,
            catatan: verified
              ? "Terkonfirmasi oleh verifikasi crop — aman dipakai untuk anotasi."
              : "Verifikasi crop MENOLAK deteksi ini. Coba deskripsi lebih spesifik, atau minta user menentukan target lewat tab Anotasi.",
          };
        }),
    }),
  };
};
