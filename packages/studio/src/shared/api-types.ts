import type { PatchOpInput, ScenePlan } from "@dalang/core";

/**
 * Kontrak API studio — dipakai server (node) dan app (browser). Hanya tipe
 * (import type dari @dalang/core aman untuk browser: terhapus saat build).
 * Semua panel membaca state yang sama dari sini (PRD §8.1).
 */

// ---------------------------------------------------------------------------
// Snapshot proyek (GET /api/project)
// ---------------------------------------------------------------------------

export type BusyKind = "chat" | "tts" | "assets" | "pick";

export interface BusyState {
  /** Job yang sedang memutasi plan (satu-per-satu), atau null. */
  mutation: BusyKind | null;
  /** Profil render yang sedang berjalan, atau null. */
  render: "draft" | "final" | null;
}

export interface PatchLogEntryLite {
  seq: number;
  origin: "user" | "agent";
  at: string;
  summary: string;
  opsCount: number;
}

export interface StageRunLite {
  sceneId: string;
  stage: "tts" | "assets";
  status: "running" | "done" | "error";
  provider: string | null;
  fallback: boolean;
  costUsd: number | null;
  error: string | null;
}

export interface RenderOutput {
  profile: "draft" | "final";
  /** Path web ke MP4 (relatif root server), mis. "/.dalang/renders/preview.mp4". */
  url: string;
  sizeBytes: number;
  finishedAt: string;
}

export interface ProjectStatePayload {
  planPath: string;
  projectId: string;
  plan: ScenePlan | null;
  busy: BusyState;
  patchLog: {
    canUndo: boolean;
    canRedo: boolean;
    recent: PatchLogEntryLite[];
  };
  stageRuns: StageRunLite[];
  /** Total biaya tercatat proyek (ledger agent_events), USD. */
  totalCostUsd: number;
  models: {
    /** null = chat nonaktif (lihat chatDisabled). */
    orchestrator: string | null;
    volume: string | null;
    registrySource: string;
    /** Alasan chat nonaktif (mis. API key belum diset), atau null. */
    chatDisabled: string | null;
  };
  /** Estimasi TTS seluruh scene bernarasi (null = provider tanpa biaya diketahui). */
  ttsEstimate: { scenes: number; chars: number; usd: number | null } | null;
  renders: RenderOutput[];
}

// ---------------------------------------------------------------------------
// Mutasi
// ---------------------------------------------------------------------------

export interface PatchRequest {
  ops: PatchOpInput[];
}

export interface PatchResponse {
  ok: true;
  summary: string;
}

export interface UndoRedoResponse {
  ok: true;
  summary: string | null;
}

/** Aksi mahal butuh konfirmasi eksplisit: 428 + payload ini, kirim ulang dengan confirm. */
export interface NeedsConfirmation {
  needsConfirmation: true;
  detail: string;
  estimatedUsd: number | null;
}

export interface PipelineRunRequest {
  sceneIds?: string[];
  confirm?: boolean;
}

export interface RenderRequest {
  profile: "draft" | "final";
  confirm?: boolean;
}

// ---------------------------------------------------------------------------
// Stock (grid kandidat → pilih = patch user ter-pin, PRD §8.2)
// ---------------------------------------------------------------------------

export interface StockCandidateLite {
  index: number;
  assetId: string;
  kind: "video" | "image";
  width: number;
  height: number;
  durationSec: number | null;
  author: string | null;
  license: string;
  thumbnailUrl: string | null;
}

export interface StockSearchResponse {
  ok: true;
  provider: string;
  query: string;
  candidates: StockCandidateLite[];
}

export interface StockPickRequest {
  sceneId: string;
  query: string;
  index: number;
}

// ---------------------------------------------------------------------------
// SSE broadcast (GET /api/events) — sinkronisasi antar panel
// ---------------------------------------------------------------------------

export type PlanUpdateReason =
  | "patch-user"
  | "patch-agent"
  | "undo"
  | "redo"
  | "pipeline"
  | "pick"
  | "external";

export type StudioEvent =
  | { type: "hello"; revision: number }
  | { type: "plan-updated"; reason: PlanUpdateReason; revision: number }
  | { type: "busy"; busy: BusyState }
  | {
      type: "stage-results";
      stage: "tts" | "assets";
      results: { sceneId: string; status: string; detail: string }[];
    }
  | {
      type: "render";
      status: "started" | "done" | "error";
      profile: "draft" | "final";
      url?: string;
      error?: string;
    };

// ---------------------------------------------------------------------------
// Chat (POST /api/chat → stream SSE per giliran)
// ---------------------------------------------------------------------------

export interface ChatRequest {
  text: string;
}

export interface ChatTurnResultLite {
  text: string;
  stop: string;
  steps: number;
  llmCostUsd: number | null;
  toolCostUsd: number;
  costIsPartial: boolean;
  /** Ringkasan patch giliran ini (untuk kartu diff, PRD §8.2). */
  patches: PatchLogEntryLite[];
}

export type ChatStreamEvent =
  | { type: "activity"; line: string }
  | {
      type: "approval-request";
      id: string;
      action: string;
      detail: string;
      estimatedUsd: number | null;
    }
  | { type: "approval-resolved"; id: string; approved: boolean }
  | { type: "done"; result: ChatTurnResultLite }
  | { type: "error"; message: string };

export interface ApprovalAnswerRequest {
  approved: boolean;
}
