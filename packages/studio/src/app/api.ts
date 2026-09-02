import type {
  Memory,
  MemoryEntry,
  MemoryKind,
  PatchOpInput,
  Transcript,
  TranscriptSpan,
} from "@dalang/core";
import type {
  AddGraphicResponse,
  AddSfxResponse,
  ChatStreamEvent,
  IconSearchResponse,
  NewProjectRequest,
  PeaksResponse,
  ProjectStatePayload,
  ProxyJobLite,
  PublishRequest,
  PublishTargetLite,
  RegisterSourceRequest,
  RegisterSourceResponse,
  RenderRequest,
  SettingsPayload,
  SettingsSaveResponse,
  SettingTestResponse,
  SfxSearchResponse,
  SourcesResponse,
  StickerSearchResponse,
  StockSearchResponse,
  StudioEvent,
  UploadChunkResponse,
  UploadStatusResponse,
  WorkspacePayload,
  WorkspaceProjectLite,
} from "../shared/api-types";
import {
  nextChunk,
  retryDelayMs,
  UPLOAD_MAX_RETRIES,
  uploadFraction,
  uploadId,
} from "./model/resumable-upload";
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

type ChunkOutcome =
  | { kind: "ok"; body: UploadChunkResponse }
  | { kind: "offset"; offset: number }
  | { kind: "network" };

/**
 * Satu potongan lewat XMLHttpRequest — `fetch` tidak punya kemajuan unggah,
 * dan rekaman satu jam tanpa bilah kemajuan terasa seperti macet. Putus
 * jaringan dan 409 (offset tidak cocok) dikembalikan sebagai DATA supaya
 * pemanggil bisa melanjutkan; galat HTTP lain dilempar.
 */
const sendChunk = (
  url: string,
  blob: Blob,
  onLoaded: (loaded: number) => void,
): Promise<ChunkOutcome> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onLoaded(event.loaded);
    };
    xhr.onerror = () => resolve({ kind: "network" });
    xhr.ontimeout = () => resolve({ kind: "network" });
    xhr.onload = () => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        // badan bukan JSON — jatuh ke pesan status
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ kind: "ok", body: payload as unknown as UploadChunkResponse });
        return;
      }
      if (xhr.status === 409 && typeof payload.offset === "number") {
        resolve({ kind: "offset", offset: payload.offset });
        return;
      }
      reject(
        new ApiError(
          xhr.status,
          typeof payload.error === "string" ? payload.error : `HTTP ${xhr.status}`,
        ),
      );
    };
    xhr.send(blob);
  });

const uploadStatus = (id: string, size: number) =>
  request<UploadStatusResponse>(`/api/sources/upload/status?id=${id}&size=${size}`);

export const api = {
  getProject: () => request<ProjectStatePayload>("/api/project"),

  // -- lobi (workspace) ------------------------------------------------------

  getWorkspace: () => request<WorkspacePayload>("/api/workspace"),
  // -- memori preferensi lintas proyek (ADR-0029) ---------------------------
  getMemory: () => request<{ ok: true; memory: Memory }>("/api/workspace/memory"),
  addMemory: (jenis: MemoryKind, teks: string) =>
    request<{ ok: true; entry: MemoryEntry; duplicate: boolean; memory: Memory }>(
      "/api/workspace/memory",
      { method: "POST", body: JSON.stringify({ jenis, teks }) },
    ),
  removeMemory: (id: string) =>
    request<{ ok: true; memory: Memory }>(
      `/api/workspace/memory/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    ),

  // -- panel Pengaturan (ADR-0032) -------------------------------------------
  // Nilai rahasia sudah disamarkan di server; tidak ada satu pun jawaban di
  // bawah ini yang memuat isi kunci.
  getSettings: () =>
    request<{ ok: true; settings: SettingsPayload }>("/api/workspace/settings"),
  saveSettings: (updates: Record<string, string>) =>
    request<SettingsSaveResponse>("/api/workspace/settings", {
      method: "POST",
      body: JSON.stringify({ updates }),
    }),
  testSetting: (key: string, value?: string) =>
    request<SettingTestResponse>("/api/workspace/settings/test", {
      method: "POST",
      body: JSON.stringify(value === undefined ? { key } : { key, value }),
    }),

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

  importTimeline: (isi: string, judul?: string) =>
    request<{
      ok: true;
      project: WorkspaceProjectLite;
      workspace: WorkspacePayload;
      catatan: string[];
    }>("/api/workspace/import", {
      method: "POST",
      body: JSON.stringify({ isi, ...(judul ? { judul } : {}) }),
    }),

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

  // --- Publikasi langsung (ADR-0030) ---------------------------------------
  publishTargets: () =>
    request<{ ok: true; targets: PublishTargetLite[]; hint: string | null }>(
      "/api/publish/targets",
    ),
  /** 202 = unggahan berjalan di latar; kemajuan dan tautan lewat SSE `publish`. */
  publish: (req: PublishRequest) =>
    request<{ ok: true; started: true; file: string; target: string }>("/api/publish", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  cancelPublish: () =>
    request<{ ok: true; cancelled: boolean }>("/api/publish/cancel", { method: "POST" }),

  splitScene: (sceneId: string, atSec: number) =>
    request<{ ok: true; newId: string; summary: string }>("/api/scene/split", {
      method: "POST",
      body: JSON.stringify({ sceneId, atSec }),
    }),

  stockSearch: (query: string, kind: "video" | "image") =>
    request<StockSearchResponse>(
      `/api/stock/search?query=${encodeURIComponent(query)}&kind=${kind}`,
    ),

  /** `layerId` memasang aset ke satu lapisan video, bukan ke visual dasar (ADR-0025). */
  stockPick: (sceneId: string, query: string, index: number, layerId?: string) =>
    request<{ ok: true; file: string; summary: string }>("/api/stock/pick", {
      method: "POST",
      body: JSON.stringify({ sceneId, query, index, ...(layerId ? { layerId } : {}) }),
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

  // --- Sumber rekaman & proxy (ADR-0028) -------------------------------------
  listSources: () => request<SourcesResponse>("/api/sources"),
  registerSource: (req: RegisterSourceRequest) =>
    request<RegisterSourceResponse>("/api/sources/register", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  /** Mulai proxy DI LATAR (ADR-0028 §10); 202 = berjalan/antre, kemajuan lewat SSE. */
  runProxies: (files?: string[], force?: boolean) =>
    request<{
      ok: true;
      started: boolean;
      queued: boolean;
      reason?: string;
      job: ProxyJobLite;
    }>("/api/pipeline/proxies", {
      method: "POST",
      body: JSON.stringify({ files, force }),
    }),
  cancelProxies: () =>
    request<{ ok: true; cancelled: boolean }>("/api/pipeline/proxies/cancel", {
      method: "POST",
    }),
  sourcePeaks: (file: string, buckets: number) =>
    request<PeaksResponse>(
      `/api/sources/peaks?file=${encodeURIComponent(file)}&buckets=${buckets}`,
    ),
  /** URL bingkai rekaman pada detik `t`; server men-cache-nya di disk. */
  sourceThumbUrl: (file: string, t: number, h: number): string =>
    `/api/sources/thumb?file=${encodeURIComponent(file)}&t=${t.toFixed(1)}&h=${h}`,
  /**
   * Unggah rekaman yang BISA DILANJUTKAN (ADR-0028 §11): per potongan 8 MiB.
   * Putus di tengah → tanya server sampai mana byte-nya sampai, lanjut dari
   * sana, coba ulang dengan jeda membesar. Identitasnya dari nama+ukuran+mtime,
   * jadi muat ulang tab pun tidak mengirim ulang byte yang sudah sampai.
   * `resumedFrom` = byte yang sudah ada di server saat mulai (0 = dari awal).
   */
  uploadSource: async (
    file: File,
    onProgress: (fraction: number, resumedFrom: number) => void,
  ): Promise<{ ok: true; file: string; existed: boolean }> => {
    if (file.size === 0) throw new ApiError(400, "Berkas kosong");
    const id = uploadId(file.name, file.size, file.lastModified);
    let offset = (await uploadStatus(id, file.size)).offset;
    const resumedFrom = offset;
    let attempt = 0;
    for (;;) {
      const chunk = nextChunk(offset, file.size);
      if (!chunk)
        throw new ApiError(500, "Unggahan berakhir tanpa jawaban selesai dari server");
      const url = `/api/sources/upload?name=${encodeURIComponent(file.name)}&id=${id}&offset=${chunk.start}&total=${file.size}`;
      const outcome = await sendChunk(url, file.slice(chunk.start, chunk.end), (loaded) =>
        onProgress(uploadFraction(offset, loaded, file.size), resumedFrom),
      );
      if (outcome.kind === "network") {
        if (attempt >= UPLOAD_MAX_RETRIES) {
          throw new ApiError(
            0,
            "Koneksi terputus saat mengunggah dan sudah dicoba ulang beberapa kali. Coba lagi nanti: unggahan akan dilanjutkan dari byte terakhir yang sampai.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
        attempt += 1;
        // Server yang tahu sampai mana; kalau ia pun tak terjangkau, coba
        // offset yang sama — 409 akan mengoreksinya begitu tersambung.
        const again = await uploadStatus(id, file.size).catch(() => null);
        if (again) offset = again.offset;
        continue;
      }
      attempt = 0;
      if (outcome.kind === "offset") {
        offset = outcome.offset;
        continue;
      }
      if (outcome.body.done) {
        onProgress(1, resumedFrom);
        return { ok: true, file: outcome.body.file, existed: outcome.body.existed };
      }
      offset = outcome.body.offset;
    }
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
      // Tanpa dua ini, browser tidak pernah menerima kemajuan proxy (ADR-0028)
      // maupun unggahan (ADR-0030): EventSource hanya mendengar nama yang didaftar.
      "proxy-progress",
      "publish",
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
