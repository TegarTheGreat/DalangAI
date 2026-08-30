import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentDeps,
  type ApprovalFn,
  type GuardrailConfig,
  Guardrails,
  ProjectSession,
} from "@dalang/agent";
import { templatesPublicDir } from "@dalang/templates/paths";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { ApprovalBroker } from "./approvals";
import { EventBus } from "./bus";
import { registerChatRoutes } from "./chat";
import type { ChatBridge, StudioContext, StudioDeps } from "./context";
import { registerMedia } from "./media";
import { registerJobRoutes, registerProjectRoutes } from "./routes";
import { StudioStore } from "./store";

/**
 * Composition root server studio (Fase 3): satu ProjectSession — yang sama
 * persis dengan `dalang chat` — dibungkus HTTP + SSE. UI hanyalah panel di
 * atas state ini; tidak ada logika produk baru di sisi browser.
 */

/** Folder hasil `vite build` app milik paket ini (untuk CLI `dalang studio`). */
export const studioAppDistDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dist",
);

export interface CreateStudioOptions {
  planPath: string;
  deps: StudioDeps;
  guardrails?: Partial<GuardrailConfig>;
  /** Timeout jawaban approval dari UI (default 10 menit → tolak). */
  approvalTimeoutMs?: number;
  /** Folder hasil `vite build` app — disajikan di "/" bila ada. */
  appDistDir?: string;
}

export interface Studio {
  app: Hono;
  store: StudioStore;
  context: StudioContext;
  close: () => void;
}

export const createStudioApp = (options: CreateStudioOptions): Studio => {
  const session = ProjectSession.open(options.planPath);
  const bus = new EventBus();
  const store = new StudioStore(session, bus);
  const approvals = new ApprovalBroker(options.approvalTimeoutMs);

  let bridge: ChatBridge | null = null;
  const approve: ApprovalFn = (request) => {
    if (!bridge) return Promise.resolve(false); // di luar giliran chat = tolak
    return bridge.onApproval(request);
  };
  const guards = new Guardrails(options.guardrails ?? {}, approve);

  const agentDeps: AgentDeps = {
    guards,
    ttsChainFor: options.deps.ttsChainFor,
    stockChain: options.deps.stockChain,
    renderVideo: options.deps.renderVideo,
    // ADR-0017: agent membaca durasi rekaman sumber lewat probe milik CLI,
    // dengan planPath sesi ini — paket studio tidak mengimpor renderer.
    videoMetadata: (file) => options.deps.probeVideo(session.paths.planPath, file),
    detectSilence: (file) => options.deps.detectSilence(session.paths.planPath, file),
    iconProvider: options.deps.iconProvider,
    sfxChain: options.deps.sfxChain,
    saveMedia: (media) => options.deps.saveMedia(session.paths.planPath, media),
    ...(options.deps.volumeModel ? { volumeModel: options.deps.volumeModel } : {}),
    onToolActivity: (line) => bridge?.onActivity(line),
  };

  const context: StudioContext = {
    store,
    deps: options.deps,
    guards,
    approvals,
    agentDeps,
    setChatBridge: (next) => {
      bridge = next;
    },
  };

  const app = new Hono();
  registerProjectRoutes(app, context);
  registerJobRoutes(app, context);
  registerChatRoutes(app, context);
  registerMedia(app, {
    templatesPublicDir,
    planDir: session.paths.planDir,
  });

  if (options.appDistDir && existsSync(join(options.appDistDir, "index.html"))) {
    const root = options.appDistDir;
    app.use("/app/*", serveStatic({ root }));
    app.get("/", serveStatic({ root, path: "index.html" }));
  } else {
    app.get("/", (c) =>
      c.text(
        "Dalang Studio API aktif, tapi app UI belum ter-build.\n" +
          "Jalankan: pnpm --filter @dalang/studio build\n" +
          "(atau mode dev: pnpm --filter @dalang/studio dev)\n",
        200,
      ),
    );
  }

  return {
    app,
    store,
    context,
    close: () => {
      approvals.denyAll();
      store.close();
    },
  };
};

export interface StartedStudio extends Studio {
  server: ServerType;
  port: number;
  url: string;
}

export const startStudioServer = (
  options: CreateStudioOptions & { port?: number; hostname?: string },
): Promise<StartedStudio> => {
  const studio = createStudioApp(options);
  return new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: studio.app.fetch,
        port: options.port ?? 4646,
        hostname: options.hostname ?? "127.0.0.1",
      },
      (info) => {
        resolve({
          ...studio,
          server,
          port: info.port,
          url: `http://${options.hostname ?? "127.0.0.1"}:${info.port}`,
        });
      },
    );
    server.on("error", reject);
    const close = studio.close;
    studio.close = () => {
      close();
      server.close();
    };
  });
};

export type { ChatBridge, StudioContext, StudioDeps } from "./context";
export { StudioBusyError, StudioStore } from "./store";
