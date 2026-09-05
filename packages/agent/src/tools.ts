import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  addMemoryEntry,
  allClips,
  type Clip,
  clipAsset,
  critiquePlan,
  cutClipOps,
  defaultPublishMetadata,
  findFillerSpans,
  findPhraseSpans,
  GRAPHIC_ANCHORS,
  GRAPHIC_ANIMS,
  idSlug,
  LAYER_ENTRANCES,
  LAYER_SHAPES,
  MAX_LAYERS,
  MAX_MEMORY_TEXT,
  MEMORY_KINDS,
  type ProxyMedia,
  PUBLISH_DESCRIPTION_MAX,
  PUBLISH_PRIVACIES,
  PUBLISH_PRIVACY_LABEL,
  PUBLISH_TITLE_MAX,
  type PublishMetadata,
  patchOpSchema,
  primaryClip,
  primaryClipId,
  recipeFor,
  removeMemoryEntry,
  type Scene,
  type ScenePlan,
  type ScenePlanInput,
  scenePlanSchema,
  setClipAsset,
  setGraphicAsset,
  setSfxAsset,
  speechSpans,
  type Transcript,
  textInSpan,
  transcriptForClip,
  uniqueGraphicId,
  uniqueLayerId,
  uniqueSfxCueId,
  uniqueTrackId,
} from "@dalang/core";
import type {
  IconProvider,
  MediaTranscoder,
  PublishTarget,
  SfxProvider,
} from "@dalang/pipeline";
import {
  type AsrProvider,
  latestRenderFile,
  materializeCandidate,
  publishRender,
  recordingsInPlan,
  runAsrStage,
  runAssetStage,
  runProxyStage,
  runTtsStage,
  type SceneStageResult,
  type StockProvider,
  type TtsProvider,
} from "@dalang/pipeline";
import { ELEVENLABS_ESTIMATED_USD_PER_CHAR, PUBLISH_SETUP_HINT } from "@dalang/providers";
import type { RenderVideoResult } from "@dalang/renderer";
import { generateText, type ToolSet, tool } from "ai";
import { z } from "zod";
import type { ResolvedModel } from "./models/resolve";
import type { Guardrails } from "./runtime/guardrails";
import type { MemoryStore } from "./runtime/memory-store";
import type { ProjectSession } from "./runtime/session";
import {
  cropImage,
  locatePrompt,
  parseBbox,
  parseVerification,
  verifyPrompt,
} from "./vision/grounding";
import {
  estimateReviewUsd,
  NO_VISION_MODEL,
  runRenderReview,
  UNPARSED_WARNING,
} from "./vision/review-run";

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
  /**
   * Pustaka stiker (GIF berlatar tembus pandang) — GIPHY/Tenor (ADR-0018).
   * Terpisah dari `stockChain` karena stiker adalah endpoint yang berbeda,
   * bukan sekadar hasil pencarian lain.
   */
  stickerChain: () => StockProvider[];
  /** Pustaka ikon terbuka (ADR-0018) — tanpa kunci, selalu tersedia. */
  iconProvider: () => IconProvider;
  /** Pustaka efek suara berlisensi terbuka (ADR-0018). */
  sfxChain: () => SfxProvider[];
  /**
   * Unduh berkas dari URL ke folder proyek dan kembalikan path relatifnya.
   * Di-inject supaya paket agent tidak perlu tahu tata letak folder proyek,
   * dan supaya test bisa memberi fake tanpa jaringan.
   */
  saveMedia: (options: {
    url: string;
    /** Sub-folder di proyek, mis. "icons" atau "sfx". */
    folder: string;
    /** Nama berkas tanpa ekstensi. */
    name: string;
    fileExt: string;
  }) => Promise<string>;
  renderVideo: (options: {
    planPath: string;
    outputLocation: string;
    profile: "draft" | "final";
    /** Render dari proxy pratinjau (ADR-0028) — hanya untuk draf. */
    useProxies?: boolean;
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
  /**
   * Render beberapa FRAME komposisi jadi berkas gambar (ADR-0022).
   * Di-inject seperti renderVideo supaya paket agent tidak bergantung pada
   * renderer, dan tes bisa memberi fake tanpa membuka browser.
   */
  renderStills: (options: {
    planPath: string;
    frames: number[];
    outDir: string;
    scale: number;
  }) => Promise<string[]>;
  /**
   * Rantai ASR (ADR-0021). Rantai KOSONG adalah keadaan sah dan sering —
   * mesin tanpa whisper.cpp dan tanpa kunci API — dan harus dikabarkan apa
   * adanya, bukan disamarkan jadi "tidak ada rekaman".
   */
  asrChain: () => AsrProvider[];
  /**
   * Transkoder media (ADR-0028): proxy pratinjau, bingkai video untuk
   * analisis, dan fakta kodek. Boleh kosong — ingestVideo tetap bekerja tanpa
   * proxy, dan analyzeImage pada video mengatakan kenapa ia tidak bisa.
   */
  transcoder?: () => MediaTranscoder;
  /**
   * Memori preferensi lintas proyek (ADR-0029). Boleh kosong: tool
   * rememberPreference lalu mengatakan memori tidak tersedia, dan blok
   * konteksnya tidak dicetak.
   */
  memory?: MemoryStore;
  /**
   * Tujuan publikasi (ADR-0030). Boleh kosong: publishVideo lalu mengatakan
   * tidak tersedia beserta petunjuk tokennya — bukan pura-pura mengunggah.
   */
  publishTargets?: () => PublishTarget[];
  onToolActivity?: (line: string) => void;
}

type ToolOutput = Record<string, unknown>;

const compactResults = (results: SceneStageResult[]) =>
  results.map((result) => ({
    scene: result.sceneId,
    status: result.status,
    detail: result.detail,
  }));

/**
 * Kunci ingatan pencarian stiker. Diberi awalan supaya query yang sama untuk
 * stock biasa dan untuk stiker tidak saling menimpa — "smile" sebagai footage
 * dan "smile" sebagai stiker adalah dua daftar kandidat yang berbeda.
 */
export const stickerKey = (query: string): string => `stiker:${query}`;

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

  /**
   * Potongan yang disasar sebuah tool: yang disebut `clipId`, atau potongan
   * PERTAMA bila tidak disebut (ADR-0033).
   *
   * Semua tool rekaman dulu membaca klip pertama diam-diam. Wawancara yang
   * sudah dibelah jadi dua belas potongan cuma bisa disunting di potongan
   * pertamanya, dan tidak ada satu pun pesan yang mengatakan begitu — persis
   * kebalikan dari alasan ADR-0033 ada.
   *
   * Klip yang DISEBUT tapi tidak ada ditolak, bukan jatuh diam-diam ke klip
   * pertama: memotong potongan yang salah adalah kerusakan yang jauh lebih
   * sulit dilihat daripada galat, dan daftar id yang tersedia ikut dikirim
   * supaya pemanggilnya bisa memperbaiki sendiri tanpa menebak.
   */
  const klipDi = (
    plan: ScenePlan,
    sceneId: string,
    clipId?: string,
  ): { scene: Scene; clip: Clip } | { error: string } => {
    const scene = plan.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) return { error: `Scene ${sceneId} tidak ada` };
    if (clipId === undefined || clipId === "") {
      return { scene, clip: primaryClip(scene) };
    }
    const clip = scene.clips.find((candidate) => candidate.id === clipId);
    if (!clip) {
      return {
        error:
          `Klip ${clipId} tidak ada di scene ${sceneId} — potongan yang ada: ` +
          scene.clips.map((candidate) => candidate.id).join(", "),
      };
    }
    return { scene, clip };
  };

  /** Deskripsi seragam untuk parameter clipId di tool rekaman. */
  const CLIP_ID_DESC =
    "Potongan yang disasar di scene berklip banyak (ADR-0033). Kosongkan untuk potongan pertama.";

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

    // ADR-0029: memori preferensi lintas proyek — hanya yang user nyatakan
    // eksplisit sebagai kebiasaan tetap; terlihat dan bisa dihapus di lobi.
    rememberPreference: tool({
      description:
        "Simpan PREFERENSI user yang berlaku LINTAS PROYEK — hanya yang user nyatakan EKSPLISIT sebagai kebiasaan tetap ('selalu', 'jangan pernah', 'setiap video saya'), bukan simpulanmu dari satu pilihan, dan bukan data pribadi. Setelah menyimpan, katakan dalam satu kalimat apa yang kamu ingat.",
      inputSchema: z.object({
        jenis: z
          .enum(MEMORY_KINDS)
          .describe(
            "gaya (visual/tipografi) | suara (voice/musik) | format (struktur/durasi/rasio) | larangan (hal yang tidak boleh) | catatan",
          ),
        teks: z
          .string()
          .min(3)
          .max(MAX_MEMORY_TEXT)
          .describe(
            "Satu kalimat dalam bahasa user, mis. 'Selalu pakai caption tegas untuk klip'",
          ),
      }),
      execute: (input) =>
        run("rememberPreference", input, async () => {
          const store = deps.memory;
          if (!store) {
            return {
              ok: false,
              pesan: "Memori preferensi tidak tersedia di lingkungan ini",
            };
          }
          const result = addMemoryEntry(store.read(), {
            kind: input.jenis,
            text: input.teks,
            source: "agent",
            projectId: session.projectId,
          });
          if (!result.ok) return { ok: false, pesan: result.reason };
          if (!result.duplicate) store.write(result.memory);
          return {
            ok: true,
            id: result.entry.id,
            duplikat: result.duplicate,
            jumlah: result.memory.entries.length,
          };
        }),
    }),

    forgetPreference: tool({
      description:
        "Hapus satu preferensi lintas proyek berdasarkan id-nya (lihat blok [PREFERENSI USER LINTAS PROYEK]). Pakai bila user bilang preferensinya berubah atau minta dilupakan.",
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: (input) =>
        run("forgetPreference", input, async () => {
          const store = deps.memory;
          if (!store) {
            return {
              ok: false,
              pesan: "Memori preferensi tidak tersedia di lingkungan ini",
            };
          }
          const { memory, removed } = removeMemoryEntry(store.read(), input.id);
          if (!removed)
            return { ok: false, pesan: `Tidak ada preferensi ber-id ${input.id}` };
          store.write(memory);
          return { ok: true, dihapus: removed.text, sisa: memory.entries.length };
        }),
    }),

    // ADR-0017: pintu masuk kemampuan MENGKLIP — daftarkan rekaman panjang
    // sebagai aset, lalu tiap scene memotongnya lewat visual.trimStartSec.
    ingestVideo: tool({
      description:
        "Daftarkan file VIDEO lokal di folder proyek (mis. 'assets/podcast.mp4') sebagai aset sebuah POTONGAN, dan baca durasi + dimensinya. Dipakai untuk MENGKLIP rekaman panjang: daftarkan sekali, lalu pilih potongannya lewat cutByWords (atau clip.trimStartSec + trimClip). Rekaman yang sama boleh didaftarkan ke beberapa potongan di satu scene — isi clipId untuk masing-masing. Aset ini ter-pin.",
      inputSchema: z.object({
        sceneId: z.string().min(1),
        file: z
          .string()
          .min(1)
          .describe("Path relatif terhadap folder plan, mis. 'assets/podcast.mp4'"),
        clipId: z.string().min(1).optional().describe(CLIP_ID_DESC),
      }),
      execute: (input) =>
        run("ingestVideo", input, async () => {
          const plan = requirePlan();
          const target = klipDi(plan, input.sceneId, input.clipId);
          if ("error" in target) return { ok: false, error: target.error };
          const meta = await deps.videoMetadata(input.file);
          if (!meta) {
            return {
              ok: false,
              error: `Tidak bisa membaca video "${input.file}" — pastikan path relatif terhadap folder plan dan formatnya didukung`,
            };
          }
          // ADR-0028: fakta kodek/laju bingkai dari ffprobe, kalau transkodernya
          // ada. Tanpa itu aset tetap terdaftar — hanya tanpa dua bidang ini.
          const transcoder = deps.transcoder?.();
          const info = transcoder
            ? await transcoder.probe(join(session.paths.planDir, input.file))
            : null;
          session.plan = setClipAsset(plan, target.clip.id, {
            file: input.file,
            kind: "video",
            source: "local",
            license: "milik user (rekaman sumber)",
            width: meta.width,
            height: meta.height,
            durationSec: meta.durationSec,
            ...(info?.codec ? { codec: info.codec } : {}),
            ...(info?.fps ? { fps: info.fps } : {}),
          });
          const { summary } = session.applyAgentPatch([
            {
              op: "replaceAsset",
              sceneId: input.sceneId,
              ...(input.clipId ? { clipId: input.clipId } : {}),
              assetId: input.file,
              pinned: true,
            },
            {
              op: "updateScene",
              id: input.sceneId,
              ...(input.clipId ? { clipId: input.clipId } : {}),
              patch: { clip: { type: "image" } },
            },
          ]);

          // Proxy pratinjau (ADR-0028) dibuat DI SINI, bukan menunggu
          // resolveAssets: rekaman panjang yang baru didaftarkan adalah persis
          // berkas yang paling berat dimainkan preview, dan agent yang
          // mendaftarkannya adalah yang paling tahu ia akan segera dipotong.
          let proxy: ProxyMedia | undefined;
          let catatanProxy = "tidak ada transkoder — preview memakai berkas aslinya";
          if (transcoder) {
            const outcome = await runProxyStage({
              paths: session.paths,
              plan: requirePlan(),
              db: session.db,
              transcoder,
              files: [input.file],
              log: { info: activity, warn: activity },
            });
            session.plan = outcome.plan;
            session.persist();
            const row = outcome.results[0];
            catatanProxy = row ? `${row.status}: ${row.detail}` : "tidak diproses";
            proxy = clipAsset(outcome.plan, target.clip.id)?.proxy;
          }

          return {
            ok: true,
            file: input.file,
            klip: target.clip.id,
            durasiDetik: Number(meta.durationSec.toFixed(2)),
            lebar: meta.width,
            tinggi: meta.height,
            kodek: info?.codec ?? null,
            fps: info?.fps ?? null,
            proxy: proxy
              ? { file: proxy.file, lebar: proxy.width, tinggi: proxy.height }
              : null,
            catatanProxy,
            ringkasanPerubahan: summary,
            catatan:
              target.scene.clips.length > 1
                ? `Pilih potongannya lewat cutByWords { sceneId, clipId: "${target.clip.id}", dariDetik, sampaiDetik } — di scene berklip banyak yang berubah durasi KLIP, bukan durasi scene.`
                : "Pilih potongan lewat cutByWords, atau applyPatch: clip.trimStartSec = detik mulai dan duration scene = panjang potongan.",
          };
        }),
    }),

    // ------------------------------------------------------------------
    // ADR-0021: sampai fase ini agent BUTA terhadap isi rekaman — ia bisa
    // tahu di mana orang berhenti bicara, tapi tidak tahu apa yang dikatakan.
    // Empat tool berikut menutup celah itu. Semuanya bekerja di atas patch op
    // yang SUDAH ADA (updateScene): tidak ada op baru, jadi undo/redo untuk
    // potongan berbasis kata gratis sejak hari pertama.
    // ------------------------------------------------------------------

    transcribeVideo: tool({
      description:
        "Transkripsi rekaman (video/audio) milik scene menjadi teks berwaktu. Jalankan SEKALI per rekaman — hasilnya di-cache dan dipakai ulang oleh semua scene yang memakai berkas itu. Setelah ini, pakai getTranscript untuk membaca isinya dan cutByWords untuk memotong berdasarkan kata. Rekaman yang sama tidak akan ditranskrip dua kali.",
      inputSchema: z.object({
        sceneIds: z
          .array(z.string().min(1))
          .optional()
          .describe("Kosongkan untuk menranskrip semua rekaman di plan."),
        pisahkanPembicara: z
          .boolean()
          .optional()
          .describe("Minta label pembicara (A/B) untuk wawancara atau podcast."),
      }),
      execute: (input) =>
        run("transcribeVideo", input, async () => {
          const plan = requirePlan();
          const providers = deps.asrChain();
          if (providers.length === 0) {
            // Dikabarkan apa adanya: tidak ada jalur ASR sama sekali bukan
            // hal yang boleh disamarkan jadi "tidak ada rekaman".
            return {
              ok: false,
              error:
                "Tidak ada jalur transkripsi di mesin ini. Pasang whisper.cpp untuk jalur offline, atau set DEEPGRAM_API_KEY / ELEVENLABS_API_KEY. Sampaikan ini ke user — jangan mengarang isi rekaman.",
            };
          }

          const recordings = recordingsInPlan(plan, input.sceneIds);
          if (recordings.size === 0) {
            return {
              ok: true,
              hasil: [],
              catatan:
                "Tidak ada scene yang memakai rekaman video/audio — tidak ada yang perlu ditranskrip.",
            };
          }

          // Gerbang biaya (§6.3). Menranskrip rekaman panjang di provider
          // berbayar adalah pengeluaran nyata, dan panjangnya baru diketahui
          // dari aset — bukan dari jumlah scene.
          // Dicari di SELURUH klip (ADR-0033), bukan cuma klip pertama tiap
          // scene: rekaman yang hanya dipakai potongan kedua terhitung nol
          // detik, dan gerbang biaya yang menghitung nol tidak menjaga apa pun.
          const semuaAset = allClips(plan).map(({ clip }) => clipAsset(plan, clip.id));
          const totalSec = [...recordings.keys()].reduce((sum, file) => {
            const asset = semuaAset.find((candidate) => candidate?.file === file);
            return sum + (asset?.durationSec ?? 0);
          }, 0);
          const berbayar = providers[0]?.offline !== true;
          if (berbayar && totalSec > 0) {
            const estimatedUsd = (totalSec / 60) * 0.006;
            if (estimatedUsd > guards.config.approvalGateUsd) {
              const approved = await guards.approve({
                action: "transkripsi",
                detail: `Transkripsi ${recordings.size} rekaman (${Math.round(totalSec / 60)} menit, ${providers[0]?.label})`,
                estimatedUsd,
              });
              if (!approved) {
                throw new Error(
                  "User menolak transkripsi — tawarkan menranskrip sebagian rekaman saja",
                );
              }
            }
            const withinBudget = await guards.ensureProjectBudget(
              session.events.totalCostUsd(),
              estimatedUsd,
              "transkripsi",
            );
            if (!withinBudget) {
              throw new Error("Budget proyek terlampaui dan user tidak menyetujui");
            }
          }

          const outcome = await runAsrStage({
            paths: session.paths,
            plan,
            providers,
            db: session.db,
            ...(input.sceneIds ? { sceneIds: input.sceneIds } : {}),
            ...(input.pisahkanPembicara !== undefined
              ? { diarize: input.pisahkanPembicara }
              : {}),
            log: { info: activity, warn: activity },
          });
          session.plan = outcome.plan;
          session.persist();
          const costUsd = sumCost(outcome.results);
          guards.addToolCost(costUsd);

          return {
            ok: true,
            hasil: compactResults(outcome.results),
            biayaUsd: Number(costUsd.toFixed(4)),
            transkripTersedia: Object.entries(outcome.plan.renderState.transcripts).map(
              ([file, transcript]) => ({
                file,
                kata: transcript.words.length,
                durasiDetik: Number(transcript.durationSec.toFixed(1)),
                bahasa: transcript.language,
                dariNarasi: transcript.fromNarration === true,
              }),
            ),
          };
        }),
    }),

    getTranscript: tool({
      description:
        "Baca transkrip rekaman sebuah scene sebagai teks berwaktu. Pakai ini SEBELUM memutuskan potongan: kamu yang menilai bagian mana yang menarik, tool ini hanya menyediakan kata beserta detiknya. Rekaman panjang dibaca per jendela lewat dariDetik/sampaiDetik.",
      inputSchema: z.object({
        sceneId: z.string().min(1),
        clipId: z.string().min(1).optional().describe(CLIP_ID_DESC),
        dariDetik: z.number().min(0).optional(),
        sampaiDetik: z.number().min(0).optional(),
      }),
      execute: (input) =>
        run("getTranscript", input, async () => {
          const plan = requirePlan();
          const target = klipDi(plan, input.sceneId, input.clipId);
          if ("error" in target) return { ok: false, error: target.error };
          const transcript = transcriptForClip(plan, target.clip.id);
          if (!transcript) {
            return {
              ok: false,
              error: `Klip ${target.clip.id} (scene ${input.sceneId}) belum punya transkrip — jalankan transcribeVideo dulu (atau potongan ini memang bukan rekaman).`,
            };
          }
          const from = input.dariDetik ?? 0;
          const to = input.sampaiDetik ?? transcript.durationSec;
          const spans = speechSpans(transcript).filter(
            (span) => span.endSec > from && span.startSec < to,
          );
          return {
            ok: true,
            file: clipAsset(plan, target.clip.id)?.file,
            klip: target.clip.id,
            bahasa: transcript.language,
            durasiDetik: Number(transcript.durationSec.toFixed(1)),
            dariNarasi: transcript.fromNarration === true,
            // Per giliran bicara, bukan per kata: ribuan kata akan menenggelamkan
            // konteks, sedangkan kalimat berwaktu sudah cukup untuk memilih.
            kalimat: spans.slice(0, 120).map((span) => ({
              mulai: Number(span.startSec.toFixed(2)),
              selesai: Number(span.endSec.toFixed(2)),
              teks: span.text,
            })),
            adaLanjutan: spans.length > 120,
            teksRingkas: textInSpan(transcript, from, to).slice(0, 4000),
          };
        }),
    }),

    findMoments: tool({
      description:
        "Cari FRASA di dalam transkrip rekaman dan dapatkan detik kemunculannya. Untuk menemukan potongan tertentu yang sudah kamu tahu kata-katanya (mis. 'harga emas'). Untuk menemukan kata pengisi dan pengulangan yang perlu dibuang, isi jenis='pengisi'.",
      inputSchema: z.object({
        sceneId: z.string().min(1),
        clipId: z.string().min(1).optional().describe(CLIP_ID_DESC),
        frasa: z
          .string()
          .optional()
          .describe("Frasa yang dicari; wajib kecuali jenis='pengisi'."),
        jenis: z.enum(["frasa", "pengisi"]).optional(),
        bantalanDetik: z
          .number()
          .min(0)
          .max(10)
          .optional()
          .describe("Lebarkan tiap rentang sekian detik supaya potongan tidak mepet."),
      }),
      execute: (input) =>
        run("findMoments", input, async () => {
          const plan = requirePlan();
          const target = klipDi(plan, input.sceneId, input.clipId);
          if ("error" in target) return { ok: false, error: target.error };
          const transcript = transcriptForClip(plan, target.clip.id);
          if (!transcript) {
            return {
              ok: false,
              error: `Klip ${target.clip.id} (scene ${input.sceneId}) belum punya transkrip — jalankan transcribeVideo dulu.`,
            };
          }
          if ((input.jenis ?? "frasa") === "pengisi") {
            const spans = findFillerSpans(transcript);
            return {
              ok: true,
              jenis: "pengisi",
              jumlah: spans.length,
              rentang: spans.slice(0, 80).map((span) => ({
                mulai: Number(span.startSec.toFixed(2)),
                selesai: Number(span.endSec.toFixed(2)),
                teks: span.text,
              })),
              catatan:
                "Daftar ini sengaja konservatif: hanya bunyi ragu dan kata yang langsung terulang. Kata seperti 'kayak', 'terus', 'jadi' TIDAK ikut karena sering membawa arti.",
            };
          }
          if (!input.frasa || input.frasa.trim() === "") {
            return { ok: false, error: "Isi 'frasa' untuk jenis pencarian frasa." };
          }
          const spans = findPhraseSpans(transcript, input.frasa, {
            ...(input.bantalanDetik !== undefined ? { padSec: input.bantalanDetik } : {}),
          });
          return {
            ok: true,
            jenis: "frasa",
            frasa: input.frasa,
            jumlah: spans.length,
            rentang: spans.map((span) => ({
              mulai: Number(span.startSec.toFixed(2)),
              selesai: Number(span.endSec.toFixed(2)),
              teks: span.text,
            })),
            ...(spans.length === 0
              ? {
                  catatan:
                    "Tidak ketemu. Pencocokannya beruntun dan harfiah — coba frasa yang lebih pendek, atau baca getTranscript dulu untuk melihat kata yang benar-benar terucap.",
                }
              : {}),
          };
        }),
    }),

    cutByWords: tool({
      description:
        "Potong sebuah POTONGAN supaya menampilkan PERSIS rentang rekaman yang kamu pilih (dari transkrip). Menyetel titik masuk dan panjangnya sekaligus. Di scene berklip satu yang berubah durasi SCENE; di scene berklip banyak yang berubah durasi KLIP itu dan potongan sesudahnya bergeser (ripple). Dapatkan detiknya dari getTranscript atau findMoments lebih dulu — jangan menebak.",
      inputSchema: z.object({
        sceneId: z.string().min(1),
        clipId: z.string().min(1).optional().describe(CLIP_ID_DESC),
        dariDetik: z.number().min(0),
        sampaiDetik: z.number().min(0),
      }),
      execute: (input) =>
        run("cutByWords", input, async () => {
          const plan = requirePlan();
          const target = klipDi(plan, input.sceneId, input.clipId);
          if ("error" in target) return { ok: false, error: target.error };
          const { scene, clip } = target;
          if (input.sampaiDetik <= input.dariDetik) {
            return {
              ok: false,
              error: `Rentang tidak sah: sampaiDetik (${input.sampaiDetik}) harus lebih besar dari dariDetik (${input.dariDetik}).`,
            };
          }

          const asset = clipAsset(plan, clip.id);
          const sourceDuration = asset?.durationSec;
          if (sourceDuration !== undefined && input.dariDetik >= sourceDuration) {
            return {
              ok: false,
              error: `dariDetik (${input.dariDetik}) melewati akhir rekaman (${sourceDuration.toFixed(1)} detik).`,
            };
          }
          // Dijepit ke panjang rekaman, bukan ditolak: minta 3 detik terakhir
          // dari rekaman yang tersisa 2,4 detik adalah maksud yang jelas.
          const end =
            sourceDuration === undefined
              ? input.sampaiDetik
              : Math.min(input.sampaiDetik, sourceDuration);
          const speed = clip.speed > 0 ? clip.speed : 1;
          const durationSec = Number(((end - input.dariDetik) / speed).toFixed(3));

          const transcript = transcriptForClip(plan, clip.id) as Transcript | undefined;

          // "Panjang potongan" disimpan di tempat yang berbeda tergantung
          // jumlah klip scene (ADR-0033 §2); aturannya milik core, bukan tool
          // ini — tab Transkrip Studio memakai fungsi yang sama.
          const { summary } = session.applyAgentPatch(
            cutClipOps(scene, clip, { fromSec: input.dariDetik, toSec: end }),
          );
          return {
            ok: true,
            sceneId: input.sceneId,
            klip: clip.id,
            mulaiDiRekamanDetik: input.dariDetik,
            ...(scene.clips.length > 1
              ? { durasiKlipDetik: durationSec }
              : { durasiSceneDetik: durationSec }),
            ...(end !== input.sampaiDetik ? { dijepitKeAkhirRekaman: end } : {}),
            ...(transcript
              ? {
                  teksTerpakai: textInSpan(transcript, input.dariDetik, end).slice(
                    0,
                    600,
                  ),
                }
              : {}),
            ringkasanPerubahan: summary,
          };
        }),
    }),

    // ADR-0017: agent tidak bisa MENDENGAR isi rekaman, tapi bisa tahu di mana
    // orang berhenti bicara. Itu cukup untuk menempatkan batas potong pada
    // jeda alami alih-alih di tengah napas.
    findCutPoints: tool({
      description:
        "Cari jeda hening di rekaman lokal untuk dipakai sebagai titik potong ALAMI (batas kalimat penutur). Kembalikan daftar jeda + rentang bersuara. PENTING: ini mengukur suara/hening, BUKAN isi — ia tidak tahu apa yang dibicarakan. Untuk memilih momen BERDASARKAN ISI, pakai transcribeVideo lalu getTranscript/findMoments.",
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
                : "Pakai titik potong ini untuk clip.trimStartSec dan akhir potongan, supaya potongan tidak jatuh di tengah kata. Isi potongan tetap perlu transkrip dari user.",
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
        "Buat draft scene-plan awal untuk proyek KOSONG (satu kali). Susun 6–10 scene: pembuka template-anim variant 'title', badan bernarasi 12–20 kata per scene dengan clips[0].query bahasa Inggris yang spesifik, penutup variant 'outro'. Proyek yang sudah punya plan harus diubah lewat applyPatch.",
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
        "Resolve otomatis aset stock untuk SETIAP klip bertipe 'stock' yang belum punya aset (kandidat pertama; video diutamakan). Klip kedua dan seterusnya wajib punya clip.query sendiri — kueri klip tidak diturunkan dari narasi. Klip pinned dan scene terkunci dilewati. Untuk kontrol penuh pakai searchAssets + pickAsset.",
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

    // ADR-0018: pustaka ikon terbuka. Tanpa kunci API, jadi selalu ada.
    searchIcons: tool({
      description:
        "Cari ikon di pustaka terbuka Iconify (tanpa kunci API). Hasilnya SUDAH disaring hanya lisensi yang aman untuk video komersial. Pakai untuk aksen visual: penanda langkah, simbol topik, tanda centang. Query bahasa Inggris lebih kaya hasilnya.",
      inputSchema: z.object({
        query: z.string().min(2),
        limit: z.number().int().min(1).max(24).default(12),
      }),
      execute: (input) =>
        run("searchIcons", input, async () => {
          requirePlan();
          const found = await deps.iconProvider().search(input.query, input.limit);
          return {
            ok: true,
            jumlah: found.length,
            ikon: found.map((icon) => ({
              ref: `iconify:${icon.iconId}`,
              set: icon.setName,
              lisensi: icon.license,
              perluKredit: icon.needsAttribution,
            })),
            catatan:
              found.length === 0
                ? "Tidak ada hasil. Coba kata kunci Inggris yang lebih umum."
                : "Pasang dengan addIcon(sceneId, ref, …).",
          };
        }),
    }),

    // Memasang ikon = mengunduh SVG-nya ke proyek + menambah entri graphics.
    // Dua langkah itu digabung karena memisahkannya hanya menciptakan keadaan
    // setengah jadi yang membingungkan model.
    addIcon: tool({
      description:
        "Pasang satu ikon dari hasil searchIcons ke sebuah scene sebagai grafis tempelan. SVG-nya diunduh ke folder proyek sehingga render tetap bisa jalan tanpa jaringan.",
      inputSchema: z.object({
        sceneId: z.string().min(1),
        ref: z
          .string()
          .min(3)
          .describe('Rujukan dari searchIcons, mis. "iconify:mdi:home"'),
        anchor: z.enum(GRAPHIC_ANCHORS).default("kanan-bawah"),
        size: z.number().min(0.02).max(0.6).default(0.12),
        color: z.string().nullable().default(null),
        anim: z.enum(GRAPHIC_ANIMS).default("pop"),
        startFrac: z.number().min(0).max(1).default(0),
        endFrac: z.number().min(0).max(1).default(1),
      }),
      execute: (input) =>
        run("addIcon", input, async () => {
          const plan = requirePlan();
          const scene = plan.scenes.find((s) => s.id === input.sceneId);
          if (!scene) return { ok: false, error: `Scene ${input.sceneId} tidak ada` };
          if (scene.graphics.length >= 4) {
            return {
              ok: false,
              error: `Scene ${input.sceneId} sudah punya 4 grafis (batas maksimum)`,
            };
          }
          if (!input.ref.startsWith("iconify:")) {
            return {
              ok: false,
              error: `Rujukan "${input.ref}" bukan ikon Iconify — pakai hasil searchIcons`,
            };
          }

          const iconId = input.ref.slice("iconify:".length);
          let file: string;
          try {
            const svg = await deps
              .iconProvider()
              .fetchSvg(iconId, { ...(input.color ? { color: input.color } : {}) });
            file = await deps.saveMedia({
              url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
              folder: "icons",
              // Warna ikut nama berkas: SVG yang diwarnai server berbeda ISI-nya
              // per warna, jadi satu nama untuk semua warna membuat pemakaian
              // kedua menimpa berkas milik yang pertama.
              name: idSlug(`${iconId}${input.color ? `-${input.color}` : ""}`),
              fileExt: "svg",
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, error: `Gagal mengambil ikon ${iconId}: ${message}` };
          }

          const graphicId = uniqueGraphicId(plan, `ikon-${iconId}`);
          session.plan = setGraphicAsset(plan, graphicId, {
            file,
            kind: "image",
            source: "iconify",
            license: "pustaka ikon terbuka (disaring aman-komersial)",
          });
          const { summary } = session.applyAgentPatch([
            {
              op: "updateScene",
              id: input.sceneId,
              patch: {
                graphics: [
                  ...scene.graphics,
                  {
                    id: graphicId,
                    ref: input.ref,
                    anchor: input.anchor,
                    size: input.size,
                    offsetX: 0,
                    offsetY: 0,
                    rotate: 0,
                    opacity: 1,
                    color: input.color,
                    anim: input.anim,
                    startFrac: input.startFrac,
                    endFrac: input.endFrac,
                  },
                ],
              },
            },
          ]);
          return { ok: true, graphicId, berkas: file, ringkasanPerubahan: summary };
        }),
    }),

    // ADR-0018: stiker = GIF berlatar tembus pandang dari GIPHY/Tenor. Endpoint
    // stiker terpisah dari pencarian GIF biasa, jadi rantainya juga terpisah.
    searchStickers: tool({
      description:
        "Cari stiker (GIF berlatar tembus pandang) di GIPHY/Tenor. Butuh GIPHY_API_KEY atau TENOR_API_KEY. PERHATIAN HAK PAKAI: isinya unggahan pihak ketiga — punya API resmi berarti boleh mencari dan menampilkan, BUKAN otomatis boleh menyiarkan ulang di video. Sebutkan itu ke user bila memakainya.",
      inputSchema: z.object({
        query: z.string().min(2),
        limit: z.number().int().min(1).max(12).default(8),
      }),
      execute: (input) =>
        run("searchStickers", input, async () => {
          requirePlan();
          const chain = deps.stickerChain();
          if (chain.length === 0) {
            return {
              ok: false,
              error:
                "Tidak ada provider stiker — set GIPHY_API_KEY atau TENOR_API_KEY. Alternatif tanpa kunci dan berlisensi jelas: searchIcons (Iconify).",
            };
          }
          for (const provider of chain) {
            const candidates = await provider.search({
              query: input.query,
              kind: "image",
              orientation: "square",
              perPage: input.limit,
            });
            if (candidates.length === 0) continue;
            session.lastSearches.set(stickerKey(input.query), candidates);
            return {
              ok: true,
              provider: provider.id,
              stiker: candidates.slice(0, input.limit).map((candidate, index) => ({
                index,
                assetId: candidate.assetId,
                ukuran: `${candidate.width}x${candidate.height}`,
                lisensi: candidate.license,
              })),
              catatan: "Pasang dengan addSticker(sceneId, query, index).",
            };
          }
          return { ok: false, error: `Tidak ada stiker untuk "${input.query}"` };
        }),
    }),

    addSticker: tool({
      description:
        "Pasang satu stiker hasil searchStickers ke sebuah scene sebagai grafis tempelan. Berkasnya diunduh ke folder proyek. Lisensinya ikut tercatat apa adanya, termasuk penanda perlu-diperiksa.",
      inputSchema: z.object({
        sceneId: z.string().min(1),
        query: z.string().min(2).describe("Query yang sama dengan searchStickers"),
        index: z.number().int().min(0).default(0),
        anchor: z.enum(GRAPHIC_ANCHORS).default("kanan-bawah"),
        size: z.number().min(0.02).max(0.6).default(0.18),
        anim: z.enum(GRAPHIC_ANIMS).default("pop"),
        startFrac: z.number().min(0).max(1).default(0),
        endFrac: z.number().min(0).max(1).default(1),
      }),
      execute: (input) =>
        run("addSticker", input, async () => {
          const plan = requirePlan();
          const scene = plan.scenes.find((s) => s.id === input.sceneId);
          if (!scene) return { ok: false, error: `Scene ${input.sceneId} tidak ada` };
          if (scene.graphics.length >= 4) {
            return {
              ok: false,
              error: `Scene ${input.sceneId} sudah punya 4 grafis (batas maksimum)`,
            };
          }
          const candidates = session.lastSearches.get(stickerKey(input.query));
          if (!candidates) {
            return {
              ok: false,
              error: `Belum ada hasil searchStickers untuk "${input.query}"`,
            };
          }
          const candidate = candidates[input.index];
          if (!candidate) {
            return {
              ok: false,
              error: `Index ${input.index} di luar jangkauan (${candidates.length} stiker)`,
            };
          }

          const graphicId = uniqueGraphicId(plan, `stiker-${scene.id}`);
          let file: string;
          try {
            file = await deps.saveMedia({
              url: candidate.downloadUrl,
              folder: "stickers",
              name: graphicId,
              fileExt: candidate.fileExt,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, error: `Gagal mengunduh stiker: ${message}` };
          }

          session.plan = setGraphicAsset(plan, graphicId, {
            file,
            kind: "image",
            source: candidate.providerId,
            license: candidate.license,
            ...(candidate.author ? { author: candidate.author } : {}),
            ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
          });
          const { summary } = session.applyAgentPatch([
            {
              op: "updateScene",
              id: input.sceneId,
              patch: {
                graphics: [
                  ...scene.graphics,
                  {
                    id: graphicId,
                    ref: candidate.assetId,
                    anchor: input.anchor,
                    size: input.size,
                    offsetX: 0,
                    offsetY: 0,
                    rotate: 0,
                    opacity: 1,
                    color: null,
                    anim: input.anim,
                    startFrac: input.startFrac,
                    endFrac: input.endFrac,
                  },
                ],
              },
            },
          ]);
          return {
            ok: true,
            graphicId,
            berkas: file,
            lisensi: candidate.license,
            ringkasanPerubahan: summary,
          };
        }),
    }),

    // ADR-0018: efek suara berlisensi terbuka.
    searchSfx: tool({
      description:
        "Cari efek suara berlisensi terbuka (CC0/domain publik) di Openverse. Hasil SUDAH disaring hanya yang bebas dipakai komersial. Pakai untuk aksen: whoosh transisi, klik, deringan penanda.",
      inputSchema: z.object({
        query: z.string().min(2),
        limit: z.number().int().min(1).max(12).default(8),
      }),
      execute: (input) =>
        run("searchSfx", input, async () => {
          requirePlan();
          const chain = deps.sfxChain();
          if (chain.length === 0)
            return { ok: false, error: "Tidak ada provider efek suara" };
          const found = await (chain[0] as SfxProvider).search(input.query, input.limit);
          // assetId Openverse adalah UUID: mencarinya ulang sebagai kata kunci
          // selalu nihil, jadi kandidatnya HARUS diingat di sini agar addSfx
          // punya URL unduhannya.
          for (const sfx of found) session.lastSfxCandidates.set(sfx.assetId, sfx);
          return {
            ok: true,
            jumlah: found.length,
            suara: found.map((sfx) => ({
              assetId: sfx.assetId,
              judul: sfx.title,
              durasiDetik: sfx.durationSec ?? null,
              lisensi: sfx.license,
            })),
            catatan:
              found.length === 0
                ? 'Tidak ada hasil. Coba kata kunci Inggris yang lebih umum (mis. "whoosh", "click").'
                : "Pasang dengan addSfx(sceneId, assetId, atSec).",
          };
        }),
    }),

    addSfx: tool({
      description:
        "Pasang satu efek suara dari hasil searchSfx ke sebuah scene. Waktunya relatif terhadap AWAL SCENE, jadi bunyinya ikut bergeser bila susunan scene berubah.",
      inputSchema: z.object({
        sceneId: z.string().min(1),
        assetId: z.string().min(1).describe("assetId dari hasil searchSfx"),
        atSec: z.number().min(0).default(0),
        volume: z.number().min(0).max(1).default(0.6),
      }),
      execute: (input) =>
        run("addSfx", input, async () => {
          const plan = requirePlan();
          if (!plan.scenes.some((s) => s.id === input.sceneId)) {
            return { ok: false, error: `Scene ${input.sceneId} tidak ada` };
          }
          const candidate = session.lastSfxCandidates.get(input.assetId);
          if (!candidate) {
            return {
              ok: false,
              error: `Efek suara ${input.assetId} tidak ada di hasil pencarian sesi ini — jalankan searchSfx lalu pakai assetId dari hasilnya`,
            };
          }

          const cueId = uniqueSfxCueId(plan, `sfx-${input.sceneId}`);
          let file: string;
          try {
            file = await deps.saveMedia({
              url: candidate.downloadUrl,
              folder: "sfx",
              name: cueId,
              fileExt: candidate.fileExt,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, error: `Gagal mengunduh efek suara: ${message}` };
          }

          session.plan = setSfxAsset(plan, cueId, {
            file,
            kind: "audio",
            source: candidate.providerId,
            license: candidate.license,
            ...(candidate.author ? { author: candidate.author } : {}),
            ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
          });
          const { summary } = session.applyAgentPatch([
            {
              op: "setAudio",
              patch: {
                sfx: [
                  ...plan.audio.sfx,
                  {
                    id: cueId,
                    assetId: candidate.assetId,
                    sceneId: input.sceneId,
                    atSec: input.atSec,
                    volume: input.volume,
                  },
                ],
              },
            },
          ]);
          return {
            ok: true,
            cueId,
            berkas: file,
            lisensi: candidate.license,
            ringkasanPerubahan: summary,
          };
        }),
    }),

    /**
     * Lapisan video (ADR-0025). Sengaja TIDAK ikut mencari asetnya sendiri:
     * lapisan yang dibuat lalu di-resolve lewat `resolveAssets` (kalau
     * `query`-nya diisi) atau `pickAsset` dengan `layerId` (kalau agent mau
     * memilih kandidat) memakai jalur pemilihan aset yang SAMA dengan visual
     * dasar — dan jalur kedua yang khusus lapisan pasti menyimpang dari yang
     * pertama cepat atau lambat.
     */
    addLayer: tool({
      description:
        "Tambah satu lapisan video (B-roll/PiP/sisipan) di atas visual scene. Maks 2 per scene. Isi `query` (bahasa Inggris, konkret) supaya resolveAssets bisa mencarikan asetnya; atau kosongkan lalu pasang aset lewat pickAsset dengan layerId. Letaknya jangkar + geseran fraksional, jendela tampilnya fraksi durasi scene.",
      inputSchema: z.object({
        sceneId: z.string().min(1),
        query: z
          .string()
          .nullable()
          .default(null)
          .describe(
            "Kueri stock untuk lapisan. WAJIB diisi kalau mau di-resolve otomatis — kueri lapisan tidak diturunkan dari narasi, karena itu akan memberi gambar yang sama dengan latarnya.",
          ),
        anchor: z.enum(GRAPHIC_ANCHORS).default("kanan-bawah"),
        width: z.number().min(0.08).max(1).default(0.34),
        height: z.number().min(0.08).max(1).default(0.34),
        shape: z.enum(LAYER_SHAPES).default("persegi"),
        entrance: z.enum(LAYER_ENTRANCES).default("fade"),
        volume: z
          .number()
          .min(0)
          .max(1)
          .default(0)
          .describe(
            "Gain audio lapisan; 0 = bisu. Naikkan hanya untuk suara alami B-roll.",
          ),
        startFrac: z.number().min(0).max(1).default(0),
        endFrac: z.number().min(0).max(1).default(1),
      }),
      execute: (input) =>
        run("addLayer", input, async () => {
          const plan = requirePlan();
          const scene = plan.scenes.find((s) => s.id === input.sceneId);
          if (!scene) return { ok: false, error: `Scene ${input.sceneId} tidak ada` };
          if (scene.layers.length >= MAX_LAYERS) {
            return {
              ok: false,
              error: `Scene ${input.sceneId} sudah punya ${MAX_LAYERS} lapisan (batas maksimum)`,
            };
          }
          if (input.endFrac <= input.startFrac) {
            return {
              ok: false,
              error: "endFrac harus lebih besar dari startFrac — jendela tampil kosong",
            };
          }
          const layerId = uniqueLayerId(
            plan,
            `lap-${input.query ? idSlug(input.query) : input.sceneId}`,
          );
          const { summary } = session.applyAgentPatch([
            {
              op: "updateScene",
              id: input.sceneId,
              patch: {
                layers: [
                  ...scene.layers,
                  {
                    id: layerId,
                    visual: {
                      type: "stock",
                      ...(input.query ? { query: input.query } : {}),
                      // ADR-0026: suara klip kini amplop, bukan satu angka.
                      audio: {
                        volume: input.volume,
                        fadeInSec: input.volume > 0 ? 0.3 : 0,
                        fadeOutSec: input.volume > 0 ? 0.5 : 0,
                        ducking: true,
                        normalize: true,
                      },
                    },
                    anchor: input.anchor,
                    width: input.width,
                    height: input.height,
                    shape: input.shape,
                    entrance: input.entrance,
                    startFrac: input.startFrac,
                    endFrac: input.endFrac,
                  },
                ],
              },
            },
          ]);
          return {
            ok: true,
            layerId,
            langkahBerikutnya: input.query
              ? "panggil resolveAssets supaya berkasnya diunduh"
              : "panggil searchAssets lalu pickAsset dengan layerId ini",
            ringkasanPerubahan: summary,
          };
        }),
    }),

    removeLayer: tool({
      description: "Hapus satu lapisan video dari sebuah scene.",
      inputSchema: z.object({ sceneId: z.string().min(1), layerId: z.string().min(1) }),
      execute: (input) =>
        run("removeLayer", input, async () => {
          const plan = requirePlan();
          const scene = plan.scenes.find((s) => s.id === input.sceneId);
          if (!scene) return { ok: false, error: `Scene ${input.sceneId} tidak ada` };
          if (!scene.layers.some((layer) => layer.id === input.layerId)) {
            return {
              ok: false,
              error: `Lapisan ${input.layerId} tidak ada di scene ${input.sceneId}`,
            };
          }
          const { summary } = session.applyAgentPatch([
            {
              op: "updateScene",
              id: input.sceneId,
              patch: {
                layers: scene.layers.filter((layer) => layer.id !== input.layerId),
              },
            },
          ]);
          // Entri berkasnya SENGAJA ditinggal di renderState: undo yang
          // mengembalikan lapisan ini harus mengembalikannya utuh, dan
          // `orphanMediaAssetIds` sudah menjaganya tidak ikut dipentaskan.
          return { ok: true, ringkasanPerubahan: summary };
        }),
    }),

    /**
     * Trek audio tambahan (ADR-0026). Berkasnya harus SUDAH ada di folder
     * proyek — tool ini menambatkannya ke garis waktu, bukan mengunduhnya:
     * mengambil audio dari internet punya urusan hak pakainya sendiri, dan
     * mencampurnya ke sini akan menyembunyikan keputusan itu.
     */
    addAudioTrack: tool({
      description:
        "Tambatkan berkas audio yang SUDAH ada di folder proyek ke garis waktu sebagai trek tambahan (ambience, rekaman, lagu). Maks 8. Berkasnya perlu di-resolve lewat resolveAssets supaya panjang dan kenyaringannya terukur — tanpa itu trek tidak berbunyi.",
      inputSchema: z.object({
        file: z
          .string()
          .min(1)
          .describe("Path relatif di folder proyek, mis. assets/ambience.wav"),
        sceneId: z
          .string()
          .nullable()
          .default(null)
          .describe("Scene tambatan; null = dihitung dari awal video."),
        atSec: z.number().min(0).default(0),
        loop: z.boolean().default(false),
        volume: z.number().min(0).max(1).default(0.5),
        fadeInSec: z.number().min(0).max(10).default(0.5),
        fadeOutSec: z.number().min(0).max(10).default(1),
        ducking: z
          .boolean()
          .default(true)
          .describe("Mengecil di bawah narasi. Matikan hanya kalau memang disengaja."),
      }),
      execute: (input) =>
        run("addAudioTrack", input, async () => {
          const plan = requirePlan();
          if (plan.audio.tracks.length >= 8) {
            return { ok: false, error: "Sudah ada 8 trek audio (batas maksimum)" };
          }
          if (input.sceneId && !plan.scenes.some((s) => s.id === input.sceneId)) {
            return { ok: false, error: `Scene ${input.sceneId} tidak ada` };
          }
          const absolute = join(session.paths.planDir, input.file);
          if (!existsSync(absolute)) {
            return {
              ok: false,
              error: `Berkas ${input.file} tidak ada di folder proyek — unggah dulu, jangan tambatkan berkas hantu`,
            };
          }
          const trackId = uniqueTrackId(plan, `trek-${idSlug(input.file)}`);
          const { summary } = session.applyAgentPatch([
            {
              op: "setAudio",
              patch: {
                tracks: [
                  ...plan.audio.tracks,
                  {
                    id: trackId,
                    assetId: input.file,
                    sceneId: input.sceneId,
                    atSec: input.atSec,
                    loop: input.loop,
                    audio: {
                      volume: input.volume,
                      fadeInSec: input.fadeInSec,
                      fadeOutSec: input.fadeOutSec,
                      ducking: input.ducking,
                      normalize: true,
                    },
                  },
                ],
              },
            },
          ]);
          return {
            ok: true,
            trackId,
            langkahBerikutnya:
              "panggil resolveAssets supaya panjang dan kenyaringan berkasnya terukur",
            ringkasanPerubahan: summary,
          };
        }),
    }),

    removeAudioTrack: tool({
      description: "Hapus satu trek audio tambahan dari garis waktu.",
      inputSchema: z.object({ trackId: z.string().min(1) }),
      execute: (input) =>
        run("removeAudioTrack", input, async () => {
          const plan = requirePlan();
          if (!plan.audio.tracks.some((track) => track.id === input.trackId)) {
            return { ok: false, error: `Trek ${input.trackId} tidak ada` };
          }
          const { summary } = session.applyAgentPatch([
            {
              op: "setAudio",
              patch: {
                tracks: plan.audio.tracks.filter((track) => track.id !== input.trackId),
              },
            },
          ]);
          return { ok: true, ringkasanPerubahan: summary };
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
              "Tidak ada provider stock — set PEXELS_API_KEY dan/atau PIXABAY_API_KEY (foto/video berlisensi jelas), atau GIPHY_API_KEY / TENOR_API_KEY (GIF/stiker, hak pakainya perlu diperiksa)",
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
        "Unduh & pasang kandidat hasil searchAssets ke sebuah scene (berdasarkan query + index kandidat). Isi layerId untuk memasangnya ke lapisan video, atau clipId untuk memasangnya ke satu potongan tertentu di scene berklip banyak. Scene terkunci/klip pinned ditolak.",
      inputSchema: z.object({
        sceneId: z.string(),
        query: z.string(),
        index: z.number().int().min(0),
        layerId: z
          .string()
          .nullable()
          .default(null)
          .describe("Id lapisan dari addLayer; null = visual dasar scene."),
        clipId: z
          .string()
          .nullable()
          .default(null)
          .describe(
            "Id klip di dalam scene (ADR-0033); null = klip pertama. Diabaikan bila layerId diisi.",
          ),
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
            ...(input.layerId ? { layerId: input.layerId } : {}),
            ...(input.clipId ? { clipId: input.clipId } : {}),
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
            // ADR-0028: draf dirender dari proxy — 540p persis skala draf.
            useProxies: true,
          });
          return {
            ok: true,
            file: result.outputLocation,
            durasiSec: result.durationSec,
            ukuranMB: Number((result.sizeBytes / 1024 / 1024).toFixed(1)),
            ...(result.proxied ? { dariProxy: result.proxied } : {}),
            ...(typeof result.mixLufs === "number"
              ? { campuranAkhirLufs: Number(result.mixLufs.toFixed(1)) }
              : {}),
          };
        }),
    }),

    // ADR-0022: sampai fase ini agent menilai plan-nya lewat STRUKTUR saja —
    // critiqueDraft membaca JSON, analyzeImage melihat aset SUMBER. Tak satu
    // pun pernah melihat frame jadi: teks yang tertimpa, caption yang hilang
    // di atas footage terang, grafis yang keluar bingkai. Tool ini yang
    // menutup loop itu.
    reviewRender: tool({
      description:
        "LIHAT hasil render sendiri: render beberapa frame kunci lalu nilai dengan model vision, digabung dengan kritik struktur. Panggil SETELAH plan cukup lengkap (aset ter-resolve), untuk menemukan masalah yang tidak terbaca dari JSON — teks tertimpa/terpotong, kontras caption, komposisi. Jumlah tinjauan per giliran dibatasi; pakai temuannya untuk applyPatch, jangan meninjau berulang tanpa memperbaiki apa pun.",
      inputSchema: z.object({
        maxFrame: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe("Berapa frame ditinjau (bawaan 4). Tiap frame berbiaya."),
        perhatian: z
          .string()
          .optional()
          .describe("Hal khusus yang diminta user untuk diperiksa."),
      }),
      execute: (input) =>
        run("reviewRender", input, async () => {
          const plan = requirePlan();
          const volume = deps.volumeModel;
          if (!volume) {
            return {
              ok: false,
              error: `${NO_VISION_MODEL} Sampaikan ini ke user; JANGAN mengarang penilaian atas frame yang tidak pernah kamu lihat.`,
            };
          }
          if (volume.info && !volume.info.imageInput) {
            return {
              ok: false,
              error: `Model ${volume.key} tidak menerima input gambar — pilih model vision untuk tier volume.`,
            };
          }
          if (!guards.claimReviewRender()) {
            // Jatah habis: berhenti, bukan mencoba lagi. Inilah yang membuat
            // loop "render -> lihat -> perbaiki" berhingga.
            return {
              ok: false,
              error: `Jatah tinjauan render giliran ini habis (${guards.config.reviewRenderCap}x). Terapkan dulu temuan sebelumnya lewat applyPatch, lalu tinjau lagi di giliran berikutnya.`,
            };
          }

          // Gerbang BIAYA (§6.3), bukan hanya gerbang iterasi. Tiap frame
          // adalah gambar yang dikirim ke model berbayar, dan tiga tinjauan
          // berturut-turut pada delapan frame bukan pengeluaran sepele.
          const maxFrame = input.maxFrame ?? 4;
          const estimatedUsd = estimateReviewUsd(volume, maxFrame);
          if (estimatedUsd !== null && estimatedUsd > guards.config.approvalGateUsd) {
            const approved = await guards.approve({
              action: "tinjauan-render",
              detail: `Tinjauan render ${maxFrame} frame lewat ${volume.key}`,
              estimatedUsd,
            });
            if (!approved) {
              throw new Error(
                "User menolak tinjauan render — tawarkan meninjau lebih sedikit frame",
              );
            }
          }
          if (estimatedUsd !== null && estimatedUsd > 0) {
            const withinBudget = await guards.ensureProjectBudget(
              session.events.totalCostUsd(),
              estimatedUsd,
              "tinjauan render",
            );
            if (!withinBudget) {
              throw new Error("Budget proyek terlampaui dan user tidak menyetujui");
            }
          }

          session.persist();
          let review: Awaited<ReturnType<typeof runRenderReview>>;
          try {
            review = await runRenderReview({
              plan,
              planPath: session.paths.planPath,
              outDir: join(session.paths.dalangDir, "review"),
              model: volume,
              renderStills: deps.renderStills,
              maxFrames: maxFrame,
              ...(input.perhatian ? { extra: input.perhatian } : {}),
            });
          } catch (error) {
            return {
              ok: false,
              error: `Tinjauan render gagal: ${error instanceof Error ? error.message : String(error)}`,
            };
          }

          guards.addLlmUsage(volume.info, review.usage);
          session.events.record({
            turn: session.turn,
            kind: "llm",
            name: `review:${volume.key}`,
            input: { frames: review.frames.length },
            output: { temuan: review.findings.length },
            costUsd: null,
          });

          const temuanGambar = review.findings.map((finding) => ({
            level: finding.level,
            masalah: finding.masalah,
            ...(finding.saran !== "" ? { saran: finding.saran } : {}),
            ...(finding.sceneId
              ? { sceneId: finding.sceneId, scene: finding.scene }
              : {}),
          }));
          const struktur = review.structural.map((note) => ({
            kode: note.code,
            level: note.level,
            ...(note.sceneId ? { sceneId: note.sceneId } : {}),
            pesan: note.message,
          }));

          return {
            ok: true,
            frameDitinjau: review.frames.map((item) => ({
              scene: item.sceneNumber,
              sceneId: item.sceneId,
              frame: item.frame,
              alasanDipilih: item.reason,
            })),
            temuanGambar,
            temuanStruktur: struktur,
            bersih: temuanGambar.length === 0 && struktur.length === 0,
            sisaJatahTinjauan: guards.reviewRendersLeft,
            ...(review.unparsed ? { peringatan: UNPARSED_WARNING } : {}),
            ...(review.dropped > 0 ? { temuanDibuang: review.dropped } : {}),
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

    // ADR-0030: unggah berkas render ke tujuan publikasi. TIDAK BISA
    // DIURUNGKAN, jadi selalu lewat gerbang persetujuan, dan bawaannya privat.
    publishVideo: tool({
      description:
        "Unggah berkas render ke tujuan publikasi (YouTube) — HANYA bila user memintanya secara eksplisit. SELALU meminta persetujuan user; bawaannya PRIVAT. Tanpa `file`, berkas render terbaru di .dalang/renders yang dipakai. Judul/deskripsi/tag bawaan diturunkan dari plan. Sebutkan tautannya ke user setelah selesai.",
      inputSchema: z.object({
        file: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Nama berkas di .dalang/renders, mis. final.mp4; kosong = render terbaru",
          ),
        judul: z.string().min(1).max(PUBLISH_TITLE_MAX).optional(),
        deskripsi: z.string().max(PUBLISH_DESCRIPTION_MAX).optional(),
        tag: z.array(z.string().min(1)).max(30).optional(),
        privasi: z
          .enum(PUBLISH_PRIVACIES)
          .default("private")
          .describe(
            "private (bawaan) | unlisted | public — publik hanya bila user memintanya",
          ),
        force: z
          .boolean()
          .optional()
          .describe("Unggah lagi walau berkas yang sama sudah pernah terunggah"),
      }),
      execute: (input) =>
        run("publishVideo", input, async () => {
          const plan = requirePlan();
          const [target] = deps.publishTargets?.() ?? [];
          if (!target) return { ok: false, pesan: PUBLISH_SETUP_HINT };
          const rendersDir = join(session.paths.dalangDir, "renders");
          const name = input.file ? basename(input.file) : latestRenderFile(rendersDir);
          if (!name) {
            return {
              ok: false,
              pesan:
                "Belum ada berkas render — jalankan renderFinal (atau renderPreview) lebih dulu",
            };
          }
          const filePath = join(rendersDir, name);
          if (!existsSync(filePath)) {
            return { ok: false, pesan: `Berkas render tidak ditemukan: ${name}` };
          }
          const metadata: PublishMetadata = {
            ...defaultPublishMetadata(plan),
            ...(input.judul ? { title: input.judul } : {}),
            ...(input.deskripsi !== undefined ? { description: input.deskripsi } : {}),
            ...(input.tag ? { tags: input.tag } : {}),
            privacy: input.privasi,
          };
          const approved = await guards.approve({
            action: "publishVideo",
            detail: `Unggah ${name} ke ${target.label} sebagai ${PUBLISH_PRIVACY_LABEL[metadata.privacy]}: "${metadata.title}"`,
          });
          if (!approved) throw new Error("User belum menyetujui unggahan");
          const outcome = await publishRender({
            paths: session.paths,
            db: session.db,
            projectId: session.projectId,
            target,
            filePath,
            metadata,
            force: input.force ?? false,
          });
          if (outcome.status === "error") return { ok: false, pesan: outcome.reason };
          return {
            ok: true,
            berkas: name,
            tujuan: target.label,
            url: outcome.record.url,
            videoId: outcome.record.videoId,
            privasi: outcome.record.privacy,
            dariCache: outcome.status === "cached",
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
        "Analisis visual aset sebuah POTONGAN dengan model vision tier-volume (deskripsi/OCR/kecocokan dengan narasi). Untuk aset VIDEO, satu BINGKAI diambil dari potongan itu (detikKe dihitung dari trimStartSec-nya; bawaan 0) — pakai untuk memeriksa apakah potongan benar-benar menunjukkan yang dibicarakan.",
      inputSchema: z.object({
        sceneId: z.string(),
        clipId: z.string().min(1).optional().describe(CLIP_ID_DESC),
        question: z.string().min(3),
        detikKe: z
          .number()
          .min(0)
          .optional()
          .describe(
            "Hanya aset VIDEO: detik di dalam potongan scene (0 = bingkai pertama potongan).",
          ),
      }),
      execute: (input) =>
        run("analyzeImage", input, async () => {
          const plan = requirePlan();
          const target = klipDi(plan, input.sceneId, input.clipId);
          if ("error" in target) throw new Error(target.error);
          const asset = clipAsset(plan, target.clip.id);
          if (!asset) {
            throw new Error(
              `Klip ${target.clip.id} (scene ${input.sceneId}) belum punya aset ter-resolve`,
            );
          }
          if (asset.kind === "audio") {
            throw new Error("Aset audio tidak punya gambar untuk dianalisis");
          }
          // Prasyarat bingkai diperiksa SEBELUM prasyarat model: "tidak ada
          // transkoder" adalah keadaan yang bisa diperbaiki pemasang, dan pesan
          // yang menyebut model padahal masalahnya ffmpeg menyesatkan.
          const transcoderForFrame = asset.kind === "video" ? deps.transcoder?.() : null;
          if (asset.kind === "video" && !transcoderForFrame) {
            throw new Error(
              "Analisis bingkai video butuh transkoder ffmpeg, dan sesi ini tidak punya — sampaikan ke user; jangan menebak isi videonya",
            );
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
          let bytes: Uint8Array;
          let mediaType: string;
          if (asset.kind === "video" && transcoderForFrame) {
            // ADR-0028: bingkai diambil lewat transkoder pada detik yang diminta
            // DI DALAM potongan — bukan dari awal rekaman satu jam.
            const transcoder = transcoderForFrame;
            const atSec = target.clip.trimStartSec + (input.detikKe ?? 0);
            const scratch = mkdtempSync(join(tmpdir(), "dalang-frame-"));
            try {
              const framePath = join(scratch, "frame.jpg");
              const frame = await transcoder.extractFrame(
                join(session.paths.planDir, asset.file),
                atSec,
                framePath,
                { height: 720 },
              );
              if (!frame.ok) {
                throw new Error(
                  `Tidak bisa mengambil bingkai pada detik ${atSec.toFixed(1)}: ${frame.reason}`,
                );
              }
              bytes = readFileSync(framePath);
            } finally {
              rmSync(scratch, { recursive: true, force: true });
            }
            mediaType = "image/jpeg";
          } else {
            bytes = readFileSync(join(session.paths.planDir, asset.file));
            const extension = asset.file.split(".").at(-1)?.toLowerCase();
            mediaType =
              extension === "svg"
                ? "image/svg+xml"
                : extension === "png"
                  ? "image/png"
                  : "image/jpeg";
          }
          const result = await generateText({
            model: volume.model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "file", data: bytes, mediaType },
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
            input: {
              sceneId: input.sceneId,
              clipId: target.clip.id,
              question: input.question,
            },
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
          const asset = clipAsset(plan, primaryClipId(plan, input.sceneId));
          if (!asset) {
            throw new Error(
              `Scene ${input.sceneId} belum punya aset ter-resolve — jalankan stage assets dulu (aset lokal butuh assetId path file di klipnya)`,
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
                  { type: "file", data: bytes, mediaType: "image/png" },
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
                  { type: "file", data: crop.png, mediaType: "image/png" },
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
