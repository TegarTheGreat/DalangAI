import { join } from "node:path";
import { PatchError, patchOpSchema } from "@dalang/core";
import { materializeCandidate, runAssetStage, runTtsStage } from "@dalang/pipeline";
import { ELEVENLABS_ESTIMATED_USD_PER_CHAR } from "@dalang/providers";
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
const pipelineBody = z.object({
  sceneIds: z.array(z.string()).optional(),
  confirm: z.boolean().optional(),
});
const renderBody = z.object({
  profile: z.enum(["draft", "final"]),
  confirm: z.boolean().optional(),
});
const pickBody = z.object({
  sceneId: z.string(),
  query: z.string(),
  index: z.number().int().min(0),
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
      session.plan = outcome.plan;
      session.persist();
      logUiEvent(
        "resolveAssets",
        { sceneIds: body.data.sceneIds ?? null },
        { scenes: outcome.results.length },
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
      return c.json({ ok: true, results: outcome.results });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 500);
    }
  });

  app.post("/api/render", async (c) => {
    const body = renderBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "Body tidak valid: butuh { profile: draft|final }" }, 400);
    }
    if (!session.plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    const { profile } = body.data;
    if (profile === "final" && !body.data.confirm) {
      const payload: NeedsConfirmation = {
        needsConfirmation: true,
        detail: "Render final 1080p (beberapa menit CPU/GPU)",
        estimatedUsd: null,
      };
      return c.json(payload, 428);
    }

    try {
      store.beginRender(profile);
    } catch (error) {
      return c.json(errorPayload(error), 409);
    }

    session.persist();
    const fileName = profile === "final" ? "final.mp4" : "preview.mp4";
    const outputLocation = join(session.paths.dalangDir, "renders", fileName);
    store.bus.emit({ type: "render", status: "started", profile });
    const startedAt = Date.now();

    // Job berjalan di belakang; hasil disiarkan lewat /api/events.
    void deps
      .renderVideo({ planPath: session.paths.planPath, outputLocation, profile })
      .then((result) => {
        logUiEvent(
          "render",
          { profile },
          { file: result.outputLocation, sizeBytes: result.sizeBytes },
          0,
          Date.now() - startedAt,
        );
        store.bus.emit({
          type: "render",
          status: "done",
          profile,
          url: `/.dalang/renders/${fileName}`,
        });
      })
      .catch((error: unknown) => {
        store.bus.emit({
          type: "render",
          status: "error",
          profile,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        store.endRender();
      });

    return c.json({ ok: true, started: true, profile }, 202);
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
        { error: "Tidak ada provider stock — set PEXELS_API_KEY / PIXABAY_API_KEY" },
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
