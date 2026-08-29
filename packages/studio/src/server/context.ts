import type { AgentDeps, Guardrails, ResolvedModel } from "@dalang/agent";
import type { StockProvider, TtsProvider } from "@dalang/pipeline";
import type { RenderVideoResult } from "@dalang/renderer";
import type { ApprovalBroker } from "./approvals";
import type { StudioStore } from "./store";

/**
 * Dependensi server studio — SEMUA efek eksternal di-inject (pola composition
 * root yang sama dengan `dalang chat`): tes memberi fake, CLI memberi yang
 * nyata. Server tidak pernah meng-impor provider konkret.
 */
export interface StudioDeps {
  ttsChainFor: (provider: string) => TtsProvider[];
  stockChain: () => StockProvider[];
  renderVideo: (options: {
    planPath: string;
    outputLocation: string;
    profile: "draft" | "final";
  }) => Promise<RenderVideoResult>;
  /**
   * Model orkestrator chat. Boleh kosong (mis. API key belum diset): panel
   * manual tetap berfungsi penuh; endpoint chat menjawab 503 dengan
   * `chatDisabledReason` dan UI menampilkannya apa adanya.
   */
  orchestrator?: ResolvedModel;
  chatDisabledReason?: string;
  volumeModel?: ResolvedModel;
  registrySource: string;
}

/**
 * Jembatan per-giliran chat: Guardrails & AgentDeps dibuat SEKALI (akumulasi
 * biaya sesi berlanjut lintas giliran, sama seperti CLI), tapi aktivitas tool
 * dan permintaan approval harus mengalir ke stream chat yang sedang aktif.
 * Di luar giliran aktif, approval = tolak (deny-by-default §6.3).
 */
export interface ChatBridge {
  onActivity: (line: string) => void;
  onApproval: (request: {
    action: "renderFinal" | "tts-massal" | "budget-proyek";
    detail: string;
    estimatedUsd?: number;
  }) => Promise<boolean>;
}

export interface StudioContext {
  store: StudioStore;
  deps: StudioDeps;
  guards: Guardrails;
  approvals: ApprovalBroker;
  /** AgentDeps stabil yang mendelegasikan aktivitas/approval ke bridge aktif. */
  agentDeps: AgentDeps;
  setChatBridge: (bridge: ChatBridge | null) => void;
}
