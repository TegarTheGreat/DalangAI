import type { AgentDeps, Guardrails, ResolvedModel } from "@dalang/agent";
import type { StockProvider, TtsProvider } from "@dalang/pipeline";
import type { ExportSettings, RenderVideoResult } from "@dalang/renderer";
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
    /** Pengaturan ekspor eksplisit (ADR-0014); tanpa ini profil jadi makro. */
    settings?: Partial<ExportSettings>;
  }) => Promise<RenderVideoResult>;
  /**
   * Baca metadata video lokal (ADR-0017): (planPath, path relatif) -> info.
   * Di-inject supaya paket studio tidak bergantung pada @dalang/renderer.
   */
  probeVideo: (
    planPath: string,
    fileRelativeToPlan: string,
  ) => Promise<{ durationSec: number; width: number; height: number } | null>;
  /** Cari jeda hening di rekaman (ADR-0017): (planPath, path relatif) -> jeda. */
  detectSilence: (
    planPath: string,
    fileRelativeToPlan: string,
  ) => Promise<{
    durationSec: number;
    silences: Array<{ startSec: number; endSec: number }>;
    audible: Array<{ startSec: number; endSec: number }>;
  } | null>;
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
