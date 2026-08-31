import type { PatchOpInput, Transcript, TranscriptSpan } from "@dalang/core";
import type {
  AddGraphicResponse,
  AddSfxResponse,
  ChatStreamEvent,
  IconSearchResponse,
  NewProjectRequest,
  ProjectStatePayload,
  RenderRequest,
  SfxSearchResponse,
  StickerSearchResponse,
  StockSearchResponse,
  StudioEvent,
  WorkspacePayload,
  WorkspaceProjectLite,
} from "../shared/api-types";
import { readSseBody } from "./sse";

/**
 * Klien API tipis. Konvensi error server: JSON { error } dengan status ≠ 2xx;
 * 428 = butuh konfirmasi (payload NeedsConfirmation) — dilempar sebagai
 * ConfirmationRequired agar UI menampilkan dialog estimasi biaya (§8.2).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ConfirmationRequired extends Error {
  constructor(
    readonly detail: string,
    readonly estimatedUsd: number | null,
  ) {
    super(detail);
    this.name = "ConfirmationRequired";
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    headers: init?.body ? { "content-type": "application/json" } : {},
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 428) {
    throw new ConfirmationRequired(
      typeof payload.detail === "string" ? payload.detail : "Aksi butuh konfirmasi",
      typeof payload.estimatedUsd === "number" ? payload.estimatedUsd : null,
    );
  }
  if (!response.ok) {
    const message =
      typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return payload as T;
};

/**
 * Hasil tinjauan render (ADR-0022). Dinamai supaya komponen bisa menyimpannya
 * di state tanpa mengulang bentuknya: `masalah` dan `saran` dipisah karena
 * keduanya ditampilkan berbeda — masalah tebal, saran sebagai tindak lanjut.
 */
export type ReviewResult = {
  ok: true;
  frames: Array<{ frame: number; sceneId: string; sceneNumber: number; reason: string }>;
  findings: Array<{
    level: "perhatian" | "saran";
    masalah: string;
    saran: string;
    scene?: number;
    sceneId?: string;
  }>;
  structural: Array<{
    code: string;
    level: "perhatian" | "saran";
    sceneId?: string;
    message: string;
  }>;
  warning?: string;
  dropped?: number;
  /** Model vision yang dipakai — supaya angka biaya di bawah punya konteks. */
  model: string;
  /** Biaya NYATA dari usage model; absen kalau harga modelnya tak diketahui. */
  costUsd?: number;
};

/** Hasil ekspor garis waktu ke format interchange (ADR-0023). */
export type TimelineExportResult = {
  ok: true;
  berkas: string;
  nama: string;
  trek: number;
  klip: number;
  detik: number;
  /** Apa yang tidak punya padanan di format tujuan. Wajib ditampilkan. */
  tidakIkut: string[];
};

export const api = {
  getProject: () => request<ProjectStatePayload>("/api/project"),

  // -- lobi (workspace) ------------------------------------------------------

  getWorkspace: () => request<WorkspacePayload>("/api/workspace"),

  openProject: (id: string) =>
    request<{ ok: true; workspace: WorkspacePayload }>("/api/workspace/open", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  closeProject: () =>
    request<{ ok: true; workspace: WorkspacePayload }>("/api/workspace/close", {
      method: "POST",
      body: "{}",
    }),

  createProject: (input: NewProjectRequest) =>
    request<{ ok: true; project: WorkspaceProjectLite; workspace: WorkspacePayload }>(
      "/api/workspace/create",
      { method: "POST", body: JSON.stringify(input) },
    ),

  renameProject: (id: string, title: string) =>
    request<{ ok: true; workspace: WorkspacePayload }>("/api/workspace/rename", {
      method: "POST",
      body: JSON.stringify({ id, title }),
    }),

  duplicateProject: (id: string) =>
    request<{ ok: true; project: WorkspaceProjectLite; workspace: WorkspacePayload }>(
      "/api/workspace/duplicate",
      { method: "POST", body: JSON.stringify({ id }) },
    ),

  trashProject: (id: string) =>
    request<{ ok: true; trashedTo: string; workspace: WorkspacePayload }>(
      "/api/workspace/trash",
      { method: "POST", body: JSON.stringify({ id }) },
    ),

  patch: (ops: PatchOpInput[]) =>
    request<{ ok: true; summary: string }>("/api/patch", {
      method: "POST",
      body: JSON.stringify({ ops }),
    }),

  undo: () =>
    request<{ ok: true; summary: string | null }>("/api/undo", { method: "POST" }),
  redo: () =>
    request<{ ok: true; summary: string | null }>("/api/redo", { method: "POST" }),

  // ADR-0021: isi transkrip TIDAK ikut muatan state (besarnya), jadi panel
  // mengambilnya sendiri saat dibuka.
  getTranscript: (file: string) =>
    request<{ file: string; transcript: Transcript; spans: TranscriptSpan[] }>(
      `/api/transcript?file=${encodeURIComponent(file)}`,
    ),

  runTranscribe: (sceneIds: string[] | undefined, diarize: boolean) =>
    request<{
      ok: true;
      results: Array<{ sceneId: string; status: string; detail?: string }>;
    }>("/api/pipeline/transcribe", {
      method: "POST",
      body: JSON.stringify({ ...(sceneIds ? { sceneIds } : {}), diarize }),
    }),

  // ADR-0022: tinjauan render dari UI. Isinya tidak disimpan di state — ia
  // hasil satu permintaan, dan dialognya yang memegangnya.
  runReview: (maxFrames: number, perhatian?: string) =>
    request<ReviewResult>("/api/review", {
      method: "POST",
      body: JSON.stringify({ maxFrames, ...(perhatian ? { perhatian } : {}) }),
    }),

  exportTimeline: (format: "otio" | "fcpxml") =>
    request<TimelineExportResult>("/api/timeline-export", {
      method: "POST",
      body: JSON.stringify({ format }),
    }),

  runTts: (sceneIds: string[] | undefined, confirm: boolean) =>
    request<{ ok: true }>("/api/pipeline/tts", {
      method: "POST",
      body: JSON.stringify({ sceneIds, confirm }),
    }),

  runAssets: (sceneIds: string[] | undefined, confirm: boolean) =>
    request<{ ok: true }>("/api/pipeline/assets", {
      method: "POST",
      body: JSON.stringify({ sceneIds, confirm }),
    }),

  render: (req: RenderRequest) =>
    request<{ ok: true; started: true }>("/api/render", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  splitScene: (sceneId: string, atSec: number) =>
    request<{ ok: true; newId: string; summary: string }>("/api/scene/split", {
      method: "POST",
      body: JSON.stringify({ sceneId, atSec }),
    }),

  stockSearch: (query: string, kind: "video" | "image") =>
    request<StockSearchResponse>(
      `/api/stock/search?query=${encodeURIComponent(query)}&kind=${kind}`,
    ),

  stockPick: (sceneId: string, query: string, index: number) =>
    request<{ ok: true; file: string; summary: string }>("/api/stock/pick", {
      method: "POST",
      body: JSON.stringify({ sceneId, query, index }),
    }),

  // --- Pustaka media (ADR-0018) -------------------------------------------

  iconSearch: (query: string) =>
    request<IconSearchResponse>(`/api/icons/search?query=${encodeURIComponent(query)}`),

  /** URL pratinjau ikon (dipakai langsung sebagai src <img>). */
  iconPreviewUrl: (iconId: string, color: string | null): string =>
    `/api/icons/svg?id=${encodeURIComponent(iconId)}${
      color ? `&color=${encodeURIComponent(color)}` : ""
    }`,

  addIcon: (input: {
    sceneId: string;
    iconId: string;
    anchor: string;
    size: number;
    color: string | null;
    anim: string;
  }) =>
    request<AddGraphicResponse>("/api/graphics/icon", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  stickerSearch: (query: string) =>
    request<StickerSearchResponse>(
      `/api/stickers/search?query=${encodeURIComponent(query)}`,
    ),

  addSticker: (input: {
    sceneId: string;
    query: string;
    index: number;
    anchor: string;
    size: number;
    anim: string;
  }) =>
    request<AddGraphicResponse>("/api/graphics/sticker", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  sfxSearch: (query: string) =>
    request<SfxSearchResponse>(`/api/sfx/search?query=${encodeURIComponent(query)}`),

  addSfx: (input: { sceneId: string; assetId: string; atSec: number; volume: number }) =>
    request<AddSfxResponse>("/api/sfx/add", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  answerApproval: (id: string, approved: boolean) =>
    request<{ ok: true }>(`/api/approvals/${id}`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),

  /** Satu giliran chat; event stream diteruskan ke onEvent. */
  chat: async (
    text: string,
    images: string[],
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void> => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...(images.length > 0 ? { images } : {}) }),
    });
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(response.status, payload.error ?? `HTTP ${response.status}`);
    }
    await readSseBody(response.body, (raw) => {
      if (raw.event === "ping") return;
      try {
        onEvent(JSON.parse(raw.data) as ChatStreamEvent);
      } catch {
        // data bukan JSON → abaikan
      }
    });
  },

  /** Langganan broadcast antar-panel; kembalikan fungsi stop. */
  uploadAsset: (sceneId: string, filename: string, dataUrl: string) =>
    request<{ ok: true; file: string; summary: string }>("/api/assets/upload", {
      method: "POST",
      body: JSON.stringify({ sceneId, filename, dataUrl }),
    }),

  /**
   * SSE liveness: EventSource menyambung ulang otomatis; `onStatus`
   * melaporkan putus/tersambung agar UI bisa menyegarkan state (event yang
   * terlewat saat putus) dan menunjukkan indikator koneksi.
   */
  subscribeEvents: (
    onEvent: (event: StudioEvent) => void,
    onStatus?: (connected: boolean) => void,
  ): (() => void) => {
    const source = new EventSource("/api/events");
    source.onopen = () => onStatus?.(true);
    source.onerror = () => onStatus?.(false);
    const names: StudioEvent["type"][] = [
      "hello",
      "plan-updated",
      "busy",
      "stage-results",
      "render",
      "project-closed",
    ];
    for (const name of names) {
      source.addEventListener(name, (message) => {
        try {
          onEvent(JSON.parse((message as MessageEvent).data) as StudioEvent);
        } catch {
          // abaikan frame rusak
        }
      });
    }
    return () => source.close();
  },
};
