import {
  type AgentDeps,
  type ApprovalFn,
  type GuardrailConfig,
  Guardrails,
  ProjectSession,
} from "@dalang/agent";
import { templatesPublicDir } from "@dalang/templates/paths";
import { Hono } from "hono";
import { ApprovalBroker } from "./approvals";
import { EventBus } from "./bus";
import { registerChatRoutes } from "./chat";
import type { ChatBridge, StudioContext, StudioDeps } from "./context";
import { registerMedia } from "./media";
import { registerMediaLibraryRoutes } from "./media-library";
import { registerJobRoutes, registerProjectRoutes } from "./routes";
import { StudioStore } from "./store";

/**
 * Composition root SATU proyek: satu ProjectSession — yang sama persis dengan
 * `dalang chat` — dibungkus HTTP + SSE. UI hanyalah panel di atas state ini;
 * tidak ada logika produk baru di sisi browser.
 *
 * App ini memegang sesinya seumur hidup. Berpindah proyek dikerjakan
 * StudioHost dengan membuang app ini dan membangun yang baru (lihat host.ts),
 * supaya tidak ada satu pun rute di sini yang perlu tahu bahwa proyek bisa
 * berganti di tengah jalan.
 */

export interface CreateStudioOptions {
  planPath: string;
  deps: StudioDeps;
  guardrails?: Partial<GuardrailConfig>;
  /** Timeout jawaban approval dari UI (default 10 menit → tolak). */
  approvalTimeoutMs?: number;
  /** Folder hasil `vite build` app — disajikan StudioHost, bukan app ini. */
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
    asrChain: () => options.deps.asrChain(),
    renderStills: (stills) => options.deps.renderStills(stills),
    stickerChain: options.deps.stickerChain,
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
  registerMediaLibraryRoutes(app, context);
  registerMedia(app, {
    templatesPublicDir,
    planDir: session.paths.planDir,
  });

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

export type { ChatBridge, StudioContext, StudioDeps } from "./context";
