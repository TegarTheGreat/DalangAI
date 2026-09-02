import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  estimateLlmCostUsd,
  NO_VISION_MODEL,
  runRenderReview,
  UNPARSED_WARNING,
} from "@dalang/agent";
import {
  PatchError,
  patchOpSchema,
  resolveSceneDurationSec,
  setResolvedAsset,
  speechSpans,
} from "@dalang/core";
import { buildEditTimeline, otioToJson, toFcpxml } from "@dalang/interop";
import {
  atomicWriteFile,
  contentHash,
  imageDims,
  materializeCandidate,
  runAsrStage,
  runAssetStage,
  runLoudnessStage,
  runTtsStage,
} from "@dalang/pipeline";
import { ELEVENLABS_ESTIMATED_USD_PER_CHAR } from "@dalang/providers";
import {
  ENCODE_QUALITIES,
  extensionFor,
  resolveExportSettings,
  VIDEO_FORMATS,
} from "@dalang/renderer";
import { templatesPublicDir } from "@dalang/templates/paths";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type {
  NeedsConfirmation,
  StockCandidateLite,
  StudioEvent,
} from "../shared/api-types";
import type { StudioContext } from "./context";
import { StudioBusyError } from "./store";

/**
 * Rute state & job (di luar chat). Aksi mahal dari UI tidak lewat approval
 * gate agent — klik tombolnya SENDIRI adalah persetujuan; ambang §6.3 tetap
 * ditegakkan dengan pola 428: server menjawab `needsConfirmation` + estimasi
 * biaya, UI menampilkan dialog, lalu mengirim ulang dengan `confirm: true`.
 */

const patchBody = z.object({ ops: z.array(patchOpSchema).min(1) });
const reviewBody = z.object({
  maxFrames: z.number().int().min(1).max(8).optional(),
  perhatian: z.string().optional(),
});

const timelineExportBody = z.object({
  format: z.enum(["otio", "fcpxml"]).default("otio"),
});

const transcribeBody = z.object({
  sceneIds: z.array(z.string().min(1)).optional(),
  diarize: z.boolean().optional(),
});

const pipelineBody = z.object({
  sceneIds: z.array(z.string()).optional(),
  confirm: z.boolean().optional(),
});
const renderBody = z.object({
  profile: z.enum(["draft", "final"]).optional(),
  format: z.enum(VIDEO_FORMATS).optional(),
  resolution: z.union([z.literal(540), z.literal(720), z.literal(1080)]).optional(),
  quality: z.enum(ENCODE_QUALITIES).optional(),
  confirm: z.boolean().optional(),
});
const pickBody = z.object({
  sceneId: z.string(),
  query: z.string(),
  index: z.number().int().min(0),
  /** Menyasar satu lapisan video di dalam scene (ADR-0025); kosong = visual dasar. */
  layerId: z.string().nullish(),
});

const errorPayload = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  ...(error instanceof PatchError ? { code: error.code } : {}),
});

export const registerProjectRoutes = (app: Hono, ctx: StudioContext): void => {
  const { store, deps } = ctx;

  app.get("/api/project", (c) =>
    c.json(
      store.snapshot({
        orchestrator: deps.orchestrator?.key ?? null,
        volume: deps.volumeModel?.key ?? null,
        registrySource: deps.registrySource,
        chatDisabled: deps.orchestrator
          ? null
          : (deps.chatDisabledReason ?? "model orkestrator tidak tersedia"),
        vision: deps.orchestrator?.info ? deps.orchestrator.info.imageInput : null,
      }),
    ),
  );

  app.post("/api/patch", async (c) => {
    const body = patchBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "Body tidak valid: butuh { ops: PatchOp[] }" }, 400);
    }
    try {
      const summary = store.applyUserPatch(body.data.ops);
      return c.json({ ok: true, summary });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 400);
    }
  });

  app.post("/api/undo", (c) => {
    try {
      return c.json({ ok: true, summary: store.undo() });
    } catch (error) {
      return c.json(errorPayload(error), 409);
    }
  });

  app.post("/api/redo", (c) => {
    try {
      return c.json({ ok: true, summary: store.redo() });
    } catch (error) {
      return c.json(errorPayload(error), 409);
    }
  });

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (event: StudioEvent) =>
        stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      await send({ type: "hello", revision: store.revision });
      const unsubscribe = store.bus.subscribe((event) => {
        void send(event);
      });
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "{}" });
      }, 25_000);
      heartbeat.unref?.();
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
      clearInterval(heartbeat);
      unsubscribe();
    }),
  );
};

export const registerJobRoutes = (app: Hono, ctx: StudioContext): void => {
  const { store, deps } = ctx;
  const { session } = store;

  const logUiEvent = (
    name: string,
    input: unknown,
    output: unknown,
    costUsd: number,
    durationMs: number,
  ) => {
    session.events.record({
      turn: session.turn,
      kind: "tool",
      name: `ui:${name}`,
      input,
      output,
      costUsd,
      durationMs,
    });
  };

  app.post("/api/pipeline/tts", async (c) => {
    const body = pipelineBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    const voice = plan.audio.voice;
    if (!voice) {
      return c.json(
        { error: "audio.voice belum diset — atur suara dulu (mis. lewat chat)" },
        400,
      );
    }

    const targets = plan.scenes.filter(
      (scene) =>
        scene.narration.trim() !== "" &&
        (!body.data.sceneIds || body.data.sceneIds.includes(scene.id)),
    );
    const chars = targets.reduce((sum, scene) => sum + scene.narration.length, 0);
    const estimatedUsd =
      voice.provider === "elevenlabs" ? chars * ELEVENLABS_ESTIMATED_USD_PER_CHAR : 0;
    const gates = ctx.guards.config;
    if (
      !body.data.confirm &&
      (targets.length > gates.ttsSceneGate || estimatedUsd > gates.approvalGateUsd)
    ) {
      const payload: NeedsConfirmation = {
        needsConfirmation: true,
        detail: `TTS ${targets.length} scene (${chars} karakter, ${voice.provider})`,
        estimatedUsd: estimatedUsd > 0 ? Number(estimatedUsd.toFixed(4)) : null,
      };
      return c.json(payload, 428);
    }

    try {
      const startedAt = Date.now();
      const outcome = await store.runExclusive("tts", () =>
        runTtsStage({
          paths: session.paths,
          plan,
          providers: deps.ttsChainFor(voice.provider),
          db: session.db,
          ...(body.data.sceneIds ? { sceneIds: body.data.sceneIds } : {}),
          log: { info: () => {}, warn: () => {} },
        }),
      );
      session.plan = outcome.plan;
      session.persist();
      const costUsd = outcome.results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      logUiEvent(
        "generateVoiceover",
        { sceneIds: body.data.sceneIds ?? null },
        { scenes: outcome.results.length },
        costUsd,
        Date.now() - startedAt,
      );
      store.notifyPlan("pipeline");
      store.bus.emit({
        type: "stage-results",
        stage: "tts",
        results: outcome.results.map((r) => ({
          sceneId: r.sceneId,
          status: r.status,
          detail: r.detail,
        })),
      });
      return c.json({ ok: true, results: outcome.results });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 500);
    }
  });

  app.post("/api/pipeline/assets", async (c) => {
    const body = pipelineBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);

    try {
      const startedAt = Date.now();
      const outcome = await store.runExclusive("assets", () =>
        runAssetStage({
          paths: session.paths,
          plan,
          providers: deps.stockChain(),
          db: session.db,
          ...(body.data.sceneIds ? { sceneIds: body.data.sceneIds } : {}),
          log: { info: () => {}, warn: () => {} },
        }),
      );
      // ADR-0026: ukur SETELAH aset ter-resolve, di panggilan yang sama.
      // Tombol terpisah "ukur kenyaringan" hanya menciptakan satu langkah lagi
      // yang bisa dilupakan orang — dan klip yang belum diukur tidak
      // dinormalisasi tanpa ada yang tahu kenapa.
      const loudness = await store.runExclusive("assets", () =>
        runLoudnessStage({
          paths: session.paths,
          plan: outcome.plan,
          db: session.db,
          ...(deps.audioProbe ? { probe: deps.audioProbe() } : {}),
          log: { info: () => {}, warn: () => {} },
        }),
      );
      session.plan = loudness.plan;
      session.persist();
      logUiEvent(
        "resolveAssets",
        { sceneIds: body.data.sceneIds ?? null },
        { scenes: outcome.results.length, berkasDiukur: loudness.results.length },
        0,
        Date.now() - startedAt,
      );
      store.notifyPlan("pipeline");
      store.bus.emit({
        type: "stage-results",
        stage: "assets",
        results: outcome.results.map((r) => ({
          sceneId: r.sceneId,
          status: r.status,
          detail: r.detail,
        })),
      });
      return c.json({ ok: true, results: outcome.results, loudness: loudness.results });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 500);
    }
  });

  // ADR-0021: transkrip DIBUANG dari muatan state karena besarnya; ini
  // pintu tunggal untuk mengambil isinya, dan hanya saat panelnya dibuka.
  app.get("/api/transcript", (c) => {
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    const file = c.req.query("file");
    if (!file) return c.json({ error: "Parameter ?file= wajib diisi" }, 400);

    const transcript = plan.renderState.transcripts[file];
    if (!transcript) {
      return c.json({ error: `Belum ada transkrip untuk ${file}` }, 404);
    }
    return c.json({
      file,
      transcript,
      // Kalimat siap pakai untuk panel: memecahnya di server berarti UI tidak
      // perlu mengulang aturan celah antar kata yang sudah teruji di core.
      spans: speechSpans(transcript),
    });
  });

  app.post("/api/pipeline/transcribe", async (c) => {
    const body = transcribeBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);

    const providers = deps.asrChain();
    if (providers.length === 0) {
      // 501, bukan 500: bukan kerusakan, melainkan kemampuan yang memang belum
      // dipasang — dan pesannya menyebut persis apa yang kurang, supaya UI
      // bisa menampilkannya apa adanya tanpa menebak (PRD §10).
      return c.json(
        {
          error:
            "Tidak ada jalur transkripsi di mesin ini. Pasang whisper.cpp untuk jalur offline, atau set DEEPGRAM_API_KEY / ELEVENLABS_API_KEY.",
          code: "asr-unavailable",
        },
        501,
      );
    }

    try {
      const startedAt = Date.now();
      const outcome = await store.runExclusive("transcribe", () =>
        runAsrStage({
          paths: session.paths,
          plan,
          providers,
          db: session.db,
          ...(body.data.sceneIds ? { sceneIds: body.data.sceneIds } : {}),
          ...(body.data.diarize !== undefined ? { diarize: body.data.diarize } : {}),
          log: { info: () => {}, warn: () => {} },
        }),
      );
      session.plan = outcome.plan;
      session.persist();
      const costUsd = outcome.results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      logUiEvent(
        "transcribeVideo",
        { sceneIds: body.data.sceneIds ?? null },
        { rekaman: outcome.results.length },
        costUsd,
        Date.now() - startedAt,
      );
      store.notifyPlan("pipeline");
      store.bus.emit({
        type: "stage-results",
        stage: "asr",
        results: outcome.results.map((r) => ({
          sceneId: r.sceneId,
          status: r.status,
          detail: r.detail,
        })),
      });
      return c.json({ ok: true, results: outcome.results });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 500);
    }
  });

  // ADR-0022: tinjauan render dari UI, bukan hanya lewat chat agent. Memakai
  // fungsi bersama yang sama dengan tool agent dan perintah CLI.
  /**
   * Ekspor garis waktu ke OTIO/FCPXML (ADR-0023).
   *
   * Berkasnya ditulis di SAMPING plan.json, bukan diunduh lewat browser: aset
   * dirujuk dengan path absolut, jadi berkasnya hanya berguna di mesin yang
   * memuat proyeknya. Unduhan ke folder Downloads justru menghasilkan berkas
   * yang tautannya putus semua.
   */
  app.post("/api/timeline-export", async (c) => {
    const body = timelineExportBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);

    try {
      const startedAt = Date.now();
      const timeline = buildEditTimeline(plan, {
        planPath: session.paths.planPath,
        siteAssetDir: templatesPublicDir,
      });
      const format = body.data.format;
      const name = format === "otio" ? "timeline.otio" : "timeline.fcpxml";
      const target = join(dirname(session.paths.planPath), name);
      atomicWriteFile(
        target,
        format === "otio" ? otioToJson(timeline) : toFcpxml(timeline),
      );

      const clips = timeline.tracks.reduce(
        (sum, track) => sum + track.items.filter((item) => item.kind === "clip").length,
        0,
      );
      logUiEvent(
        "timelineExport",
        { format },
        { berkas: name, klip: clips },
        0,
        Date.now() - startedAt,
      );
      return c.json({
        ok: true,
        berkas: target,
        nama: name,
        trek: timeline.tracks.length,
        klip: clips,
        detik: Number((timeline.totalFrames / timeline.fps).toFixed(1)),
        // Wajib ikut ke UI: ekspor yang diam soal caption dan gerak membuat
        // orang mengira Dalang yang rusak saat membuka hasilnya di Resolve.
        tidakIkut: timeline.notes.map((note) => note.detail),
      });
    } catch (error) {
      return c.json(errorPayload(error), 500);
    }
  });

  app.post("/api/review", async (c) => {
    const body = reviewBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);

    const volume = deps.volumeModel;
    if (!volume || (volume.info && !volume.info.imageInput)) {
      // 501, bukan 500: kemampuan yang belum dikonfigurasi, bukan kerusakan.
      return c.json(
        {
          error: volume
            ? `Model ${volume.key} tidak menerima input gambar — pilih model vision untuk tier volume.`
            : `${NO_VISION_MODEL} Set model tier-volume yang menerima gambar.`,
          code: "vision-unavailable",
        },
        501,
      );
    }

    try {
      const startedAt = Date.now();
      const review = await store.runExclusive("review", () =>
        runRenderReview({
          plan,
          planPath: session.paths.planPath,
          outDir: join(session.paths.dalangDir, "review"),
          model: volume,
          renderStills: (stills) => deps.renderStills(stills),
          ...(body.data.maxFrames !== undefined
            ? { maxFrames: body.data.maxFrames }
            : {}),
          ...(body.data.perhatian ? { extra: body.data.perhatian } : {}),
        }),
      );
      // Biaya NYATA dari usage yang dikembalikan model, bukan perkiraan pra-
      // panggil: tinjauan lewat Studio memanggil model berbayar, dan mencatatnya
      // 0 membuat chip biaya di topbar serta anggaran proyek berbohong.
      const costUsd = estimateLlmCostUsd(volume.info, review.usage) ?? 0;
      logUiEvent(
        "reviewRender",
        { frames: review.frames.length },
        { temuan: review.findings.length },
        costUsd,
        Date.now() - startedAt,
      );
      return c.json({
        ok: true,
        frames: review.frames,
        findings: review.findings,
        structural: review.structural.map((note) => ({
          code: note.code,
          level: note.level,
          ...(note.sceneId ? { sceneId: note.sceneId } : {}),
          message: note.message,
        })),
        // Dibedakan dengan tegas dari "tidak ada temuan": UI menampilkannya
        // sebagai peringatan, bukan sebagai kabar baik.
        ...(review.unparsed ? { warning: UNPARSED_WARNING } : {}),
        ...(review.dropped > 0 ? { dropped: review.dropped } : {}),
        model: volume.key,
        ...(costUsd > 0 ? { costUsd: Number(costUsd.toFixed(4)) } : {}),
      });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 500);
    }
  });

  app.post("/api/render", async (c) => {
    const body = renderBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(
        { error: "Body tidak valid: { profile? , format?, resolution?, quality? }" },
        400,
      );
    }
    if (!session.plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);

    // ADR-0014: profil = makro default; pengaturan eksplisit menimpanya.
    const { format, resolution, quality } = body.data;
    const explicit =
      format !== undefined || resolution !== undefined || quality !== undefined;
    const profile = body.data.profile ?? (explicit ? "final" : "draft");
    const settings = resolveExportSettings(
      profile,
      explicit ? { format, resolution, quality } : undefined,
    );
    const label = `${settings.format} ${settings.resolution}p ${settings.quality}`;

    // Konfirmasi utk pekerjaan berat (menit-menit CPU), pola 428 yang sama.
    const heavy =
      settings.resolution === 1080 ||
      settings.quality === "terbaik" ||
      settings.format === "mov";
    if (heavy && !body.data.confirm) {
      const payload: NeedsConfirmation = {
        needsConfirmation: true,
        detail: `Ekspor ${label} (beberapa menit CPU)`,
        estimatedUsd: null,
      };
      return c.json(payload, 428);
    }

    try {
      store.beginRender(label);
    } catch (error) {
      return c.json(errorPayload(error), 409);
    }

    session.persist();
    const fileName = explicit
      ? `ekspor-${settings.format}-${settings.resolution}p-${settings.quality}.${extensionFor(settings.format)}`
      : profile === "final"
        ? "final.mp4"
        : "preview.mp4";
    const outputLocation = join(session.paths.dalangDir, "renders", fileName);
    store.bus.emit({ type: "render", status: "started", label });
    const startedAt = Date.now();

    // Job berjalan di belakang; hasil disiarkan lewat /api/events.
    void deps
      .renderVideo({
        planPath: session.paths.planPath,
        outputLocation,
        profile,
        ...(explicit ? { settings: { format, resolution, quality } } : {}),
        // ADR-0028: draf dari proxy; ekspor final/eksplisit dari berkas asli.
        useProxies: profile === "draft" && !explicit,
      })
      .then((result) => {
        logUiEvent(
          "render",
          { profile, settings: result.settings },
          {
            file: result.outputLocation,
            sizeBytes: result.sizeBytes,
            mixLufs: result.mixLufs ?? null,
            proxied: result.proxied ?? 0,
          },
          0,
          Date.now() - startedAt,
        );
        store.bus.emit({
          type: "render",
          status: "done",
          label,
          url: `/.dalang/renders/${fileName}`,
          mixLufs: result.mixLufs ?? null,
          ...(result.proxied ? { proxied: result.proxied } : {}),
        });
      })
      .catch((error: unknown) => {
        store.bus.emit({
          type: "render",
          status: "error",
          label,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        store.endRender();
      });

    return c.json({ ok: true, started: true, label }, 202);
  });

  app.get("/api/stock/search", async (c) => {
    const query = c.req.query("query")?.trim() ?? "";
    const kind =
      c.req.query("kind") === "image" ? ("image" as const) : ("video" as const);
    if (query.length < 2) return c.json({ error: "query terlalu pendek" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    const chain = deps.stockChain();
    if (chain.length === 0) {
      return c.json(
        {
          error:
            "Tidak ada provider stock — set PEXELS_API_KEY / PIXABAY_API_KEY (foto & video berlisensi jelas), atau GIPHY_API_KEY / TENOR_API_KEY (GIF & stiker, hak pakainya perlu diperiksa)",
        },
        400,
      );
    }
    const orientation =
      plan.meta.aspectRatio === "9:16"
        ? ("portrait" as const)
        : plan.meta.aspectRatio === "16:9"
          ? ("landscape" as const)
          : ("square" as const);
    for (const provider of chain) {
      try {
        const candidates = await provider.search({
          query,
          kind,
          orientation,
          perPage: 8,
        });
        if (candidates.length === 0) continue;
        session.lastSearches.set(query, candidates);
        const lite: StockCandidateLite[] = candidates.map((candidate, index) => ({
          index,
          assetId: candidate.assetId,
          kind: candidate.kind,
          width: candidate.width,
          height: candidate.height,
          durationSec: candidate.durationSec ?? null,
          author: candidate.author ?? null,
          license: candidate.license,
          thumbnailUrl: candidate.thumbnailUrl ?? null,
        }));
        return c.json({ ok: true, provider: provider.id, query, candidates: lite });
      } catch {
        // provider gagal → coba berikutnya (pola chain yang sama dengan stage)
      }
    }
    return c.json({ error: `Tidak ada kandidat untuk "${query}"` }, 404);
  });

  // Upload gambar/screenshot lokal dari UI (ADR-0013): file ditulis ke
  // assets/, renderState diisi langsung (source "local"), lalu patch USER
  // replaceAsset + (bila perlu) alih tipe visual — satu batch, bisa di-undo.
  const uploadBody = z.object({
    sceneId: z.string().min(1),
    filename: z.string().min(1).max(120),
    dataUrl: z.string().max(12_000_000),
  });
  const UPLOAD_RE = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/;

  app.post("/api/assets/upload", async (c) => {
    const body = uploadBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    const scene = plan.scenes.find((s) => s.id === body.data.sceneId);
    if (!scene) return c.json({ error: `Scene ${body.data.sceneId} tidak ada` }, 400);
    if (scene.locked) return c.json({ error: "Scene terkunci" }, 400);
    const match = body.data.dataUrl.match(UPLOAD_RE);
    if (!match) {
      return c.json({ error: "Hanya PNG/JPEG (data URL base64) yang diterima" }, 400);
    }
    const bytes = Buffer.from(match[2] ?? "", "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) {
      return c.json({ error: "Ukuran file harus > 0 dan <= 8MB" }, 400);
    }
    const ext = match[1] === "png" ? "png" : "jpg";
    const safeBase =
      body.data.filename
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/, "")
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "gambar";
    const hash = contentHash({ kind: "upload", bytes: bytes.byteLength, safeBase }).slice(
      0,
      8,
    );
    const relPath = `assets/unggah-${hash}-${safeBase}.${ext}`;

    try {
      const startedAt = Date.now();
      const result = await store.runExclusive("pick", async () => {
        mkdirSync(join(session.paths.planDir, "assets"), { recursive: true });
        writeFileSync(join(session.paths.planDir, relPath), bytes);
        const dims = imageDims(bytes);
        const current = session.plan;
        if (!current) throw new Error("Plan hilang di tengah upload");
        session.plan = setResolvedAsset(current, body.data.sceneId, {
          file: relPath,
          kind: "image",
          source: "local",
          license: "milik user (unggahan studio)",
          ...(dims ? { width: dims.width, height: dims.height } : {}),
        });
        const ops: Parameters<typeof session.applyUserPatch>[0] = [
          {
            op: "replaceAsset",
            sceneId: body.data.sceneId,
            assetId: relPath,
            pinned: true,
          },
        ];
        if (scene.visual.type !== "image" && scene.visual.type !== "screenshot") {
          ops.push({
            op: "updateScene",
            id: body.data.sceneId,
            patch: { visual: { type: "image" } },
          });
        }
        const { summary } = session.applyUserPatch(ops);
        return { summary };
      });
      logUiEvent(
        "uploadAsset",
        { sceneId: body.data.sceneId, filename: body.data.filename },
        { file: relPath, bytes: bytes.byteLength },
        0,
        Date.now() - startedAt,
      );
      store.notifyPlan("pick");
      return c.json({ ok: true, file: relPath, summary: result.summary });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 400);
    }
  });

  // ADR-0015: belah scene di titik waktu — durasi terbagi, bagian kedua
  // mewarisi visual + aset resolved (disalin di renderState) tanpa narasi.
  app.post("/api/scene/split", async (c) => {
    const body = z
      .object({ sceneId: z.string(), atSec: z.number().positive().finite() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    const scene = plan.scenes.find((s) => s.id === body.data.sceneId);
    if (!scene) return c.json({ error: `Scene ${body.data.sceneId} tidak ada` }, 400);
    if (scene.locked) return c.json({ error: "Scene terkunci" }, 400);
    const total = resolveSceneDurationSec(scene, plan);
    const d1 = Math.round(body.data.atSec * 10) / 10;
    const d2 = Math.round((total - d1) * 10) / 10;
    if (d1 < 1 || d2 < 1) {
      return c.json({ error: "Kedua bagian minimal 1 detik" }, 400);
    }

    const newId = `${scene.id.slice(0, 16)}-p${Date.now().toString(36).slice(-4)}`;
    try {
      const startedAt = Date.now();
      const result = await store.runExclusive("pick", async () => {
        const current = session.plan;
        if (!current) throw new Error("Plan hilang di tengah split");
        const asset = current.renderState.resolvedAssets[scene.id];
        if (asset) {
          session.plan = setResolvedAsset(current, newId, asset);
        }
        const { summary } = session.applyUserPatch([
          { op: "updateScene", id: scene.id, patch: { duration: d1 } },
          {
            op: "addScene",
            afterId: scene.id,
            scene: {
              id: newId,
              narration: "",
              duration: d2,
              visual: { ...scene.visual },
              caption: { ...scene.caption },
              transition: { ...scene.transition },
              texts: [],
              annotations: [],
            } as never,
          },
        ]);
        return { summary };
      });
      logUiEvent(
        "splitScene",
        { sceneId: scene.id, atSec: d1 },
        { newId, d1, d2 },
        0,
        Date.now() - startedAt,
      );
      store.notifyPlan("patch-user");
      return c.json({ ok: true, newId, summary: result.summary });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 400);
    }
  });

  app.post("/api/stock/pick", async (c) => {
    const body = pickBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    const candidates = session.lastSearches.get(body.data.query);
    const candidate = candidates?.[body.data.index];
    if (!candidate) {
      return c.json(
        {
          error: `Kandidat #${body.data.index} untuk "${body.data.query}" tidak dikenal — cari ulang`,
        },
        400,
      );
    }
    const provider = deps.stockChain().find((p) => p.id === candidate.providerId);
    if (!provider) {
      return c.json(
        { error: `Provider ${candidate.providerId} tidak tersedia lagi` },
        400,
      );
    }

    try {
      const startedAt = Date.now();
      const result = await store.runExclusive("pick", async () => {
        const { plan: next, asset } = await materializeCandidate({
          paths: session.paths,
          plan,
          db: session.db,
          sceneId: body.data.sceneId,
          ...(body.data.layerId ? { layerId: body.data.layerId } : {}),
          provider,
          candidate,
          allowPinned: true,
        });
        session.plan = next;
        // Pilihan manual = patch USER + pin (PRD §8.2) — tercatat di log & bisa di-undo.
        const { summary } = session.applyUserPatch([
          {
            op: "replaceAsset",
            sceneId: body.data.sceneId,
            ...(body.data.layerId ? { layerId: body.data.layerId } : {}),
            assetId: candidate.assetId,
            pinned: true,
          },
        ]);
        return { asset, summary };
      });
      logUiEvent(
        "pickAsset",
        { sceneId: body.data.sceneId, assetId: candidate.assetId },
        { file: result.asset.file },
        0,
        Date.now() - startedAt,
      );
      store.notifyPlan("pick");
      return c.json({ ok: true, file: result.asset.file, summary: result.summary });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 400);
    }
  });
};
