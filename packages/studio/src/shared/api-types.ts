import type { PatchOpInput, PublishPrivacy, ScenePlan } from "@dalang/core";

/**
 * Kontrak API studio — dipakai server (node) dan app (browser). Hanya tipe
 * (import type dari @dalang/core aman untuk browser: terhapus saat build).
 * Semua panel membaca state yang sama dari sini (PRD §8.1).
 */

// ---------------------------------------------------------------------------
// Snapshot proyek (GET /api/project)
// ---------------------------------------------------------------------------

export type BusyKind =
  | "chat"
  | "tts"
  | "assets"
  | "transcribe"
  | "review"
  | "pick"
  | "proxies"
  | "sources";

export interface BusyState {
  /** Job yang sedang memutasi plan (satu-per-satu), atau null. */
  mutation: BusyKind | null;
  /** Label ekspor yang sedang berjalan (mis. "1080p seimbang"), atau null. */
  render: string | null;
}

/**
 * Pekerjaan proxy DI LATAR (ADR-0028 §10). Bukan `BusyKind`: ia tidak
 * mengunci editor — patch, undo, dan render tetap jalan selagi proxy dibuat.
 */
export interface ProxyJobLite {
  running: boolean;
  /** Berkas yang sedang dikerjakan (path relatif plan), atau null. */
  file: string | null;
  label: string | null;
  /** Urutan berkas sekarang (mulai 1) dan jumlah seluruh antrean. */
  index: number;
  total: number;
  /** Kemajuan berkas sekarang, 0..1. */
  fraction: number;
  /** Berkas yang sudah selesai (dibuat, dari cache, atau tidak perlu). */
  done: number;
  failed: number;
  cancelled: boolean;
}

// ---------------------------------------------------------------------------
// Ekspor (ADR-0014) — union literal disalin dari @dalang/renderer supaya
// bundle browser tidak menyeret @remotion/renderer; server memvalidasi
// terhadap sumber kebenarannya.
// ---------------------------------------------------------------------------

export type ExportFormat = "mp4" | "hevc" | "webm" | "mov";
export type ExportResolution = 540 | 720 | 1080;
export type ExportQuality = "cepat" | "seimbang" | "terbaik";

export interface ExportSettingsLite {
  format: ExportFormat;
  resolution: ExportResolution;
  quality: ExportQuality;
}

export interface PatchLogEntryLite {
  seq: number;
  origin: "user" | "agent";
  at: string;
  summary: string;
  opsCount: number;
}

/**
 * Ringkasan transkrip yang ikut di muatan state (ADR-0021) — TANPA isinya.
 * Cukup untuk menyalakan panel dan menampilkan berapa kata/siapa saja yang
 * bicara; teks lengkapnya diambil terpisah lewat /api/transcript.
 */
export interface TranscriptSummary {
  /** Path berkas relatif-plan; ini kuncinya di renderState.transcripts. */
  file: string;
  words: number;
  durationSec: number;
  language: string;
  source: string;
  /** True = diturunkan dari word timestamp TTS Dalang, bukan dari mendengarkan. */
  fromNarration: boolean;
  speakers: string[];
}

export interface StageRunLite {
  sceneId: string;
  stage: "tts" | "assets" | "asr" | "loudness" | "proxy" | "publish";
  status: "running" | "done" | "error";
  provider: string | null;
  fallback: boolean;
  costUsd: number | null;
  error: string | null;
}

export interface RenderOutput {
  /** Nama berkas tanpa ekstensi, mis. "ekspor-1080p-seimbang" / "final". */
  label: string;
  /** Path web ke berkas video (relatif root server). */
  url: string;
  sizeBytes: number;
  finishedAt: string;
  /** Catatan publikasi terakhir berkas ini (ADR-0030), bila pernah diunggah. */
  published?: PublishedLite;
}

/** Tujuan publikasi yang tersedia (ADR-0030). */
export interface PublishTargetLite {
  id: string;
  label: string;
}

/** Unggahan yang sedang berjalan (ADR-0030); satu pada satu waktu. */
export interface PublishJobLite {
  file: string;
  target: string;
  fraction: number;
}

export interface PublishedLite {
  targetId: string;
  url: string;
  privacy: PublishPrivacy;
  at: string;
}

export interface PublishStateLite {
  targets: PublishTargetLite[];
  /** Petunjuk jujur bila tidak ada tujuan (token belum dipasang), atau null. */
  hint: string | null;
  job: PublishJobLite | null;
}

export interface PublishRequest {
  /** Nama berkas di riwayat render, atau URL web-nya (/.dalang/renders/...). */
  file: string;
  targetId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  privacy?: PublishPrivacy;
  /** Unggah lagi walau berkas yang sama sudah pernah terunggah. */
  force?: boolean;
  confirm?: boolean;
}

export interface ProjectStatePayload {
  planPath: string;
  projectId: string;
  plan: ScenePlan | null;
  busy: BusyState;
  /** Pekerjaan proxy di latar yang sedang berjalan, atau null (ADR-0028 §10). */
  proxyJob: ProxyJobLite | null;
  patchLog: {
    canUndo: boolean;
    canRedo: boolean;
    recent: PatchLogEntryLite[];
  };
  stageRuns: StageRunLite[];
  /** Ringkasan transkrip; isinya diambil lewat /api/transcript (ADR-0021). */
  transcripts: TranscriptSummary[];
  /** Total biaya tercatat proyek (ledger agent_events), USD. */
  totalCostUsd: number;
  models: {
    /** null = chat nonaktif (lihat chatDisabled). */
    orchestrator: string | null;
    volume: string | null;
    registrySource: string;
    /** Alasan chat nonaktif (mis. API key belum diset), atau null. */
    chatDisabled: string | null;
    /**
     * Autodeteksi multimodal dari registry: true = model menerima gambar,
     * false = tidak, null = metadata tak diketahui (boleh dicoba).
     */
    vision: boolean | null;
  };
  /** Estimasi TTS seluruh scene bernarasi (null = provider tanpa biaya diketahui). */
  ttsEstimate: { scenes: number; chars: number; usd: number | null } | null;
  renders: RenderOutput[];
  /** Publikasi langsung (ADR-0030): tujuan, petunjuk, unggahan berjalan. */
  publish: PublishStateLite;
}

// ---------------------------------------------------------------------------
// Workspace / lobi (GET /api/workspace)
// ---------------------------------------------------------------------------

export interface WorkspaceProjectLite {
  /** Nama folder — id-nya di API. */
  id: string;
  title: string;
  aspectRatio: string;
  stylePreset: string;
  format: string;
  scenes: number;
  durationSec: number;
  updatedAt: string;
  renders: number;
  /**
   * Warna aksen efektif proyek (token plan, atau bawaan preset). Sampul kartu
   * memakainya supaya lobi memperlihatkan rupa proyeknya, bukan kotak seragam.
   */
  accent: string;
  /** Ekspor terbaru untuk dipratinjau di kartu; null = belum pernah ekspor. */
  posterUrl: string | null;
  /** false = plan.json rusak/tak sah; proyeknya tetap didaftar apa adanya. */
  valid: boolean;
  error?: string;
}

export interface WorkspacePayload {
  root: string;
  projects: WorkspaceProjectLite[];
  /** Proyek yang sedang dibuka server ini; null = sedang di lobi. */
  open: { id: string; title: string; planPath: string } | null;
  /**
   * Server dibuka pada satu proyek lewat path eksplisit. Lobi tetap ada
   * (folder induknya), hanya saja tombol "tutup" tidak menutup apa pun
   * yang diminta pengguna di baris perintah.
   */
  pinned: boolean;
}

export interface NewProjectRequest {
  title: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  stylePreset: string;
  format: string;
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
  /** Makro default lama; boleh dihilangkan bila pengaturan eksplisit dikirim. */
  profile?: "draft" | "final";
  format?: ExportFormat;
  resolution?: ExportResolution;
  quality?: ExportQuality;
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
// Sumber rekaman & proxy (ADR-0028, §9.5)
// ---------------------------------------------------------------------------

export interface SourceLite {
  /** Path relatif-plan, mis. "assets/rekaman/podcast-3f2a9c1b.mp4". */
  file: string;
  kind: "video" | "audio";
  sizeBytes: number;
  modifiedAt: string;
  /** Fakta ffprobe; null bila tidak terbaca (atau tanpa transkoder untuk audio). */
  probe: {
    durationSec: number;
    width: number;
    height: number;
    fps: number | null;
    codec: string | null;
    hasAudio: boolean;
  } | null;
  usedBy: { sceneIds: string[]; layerIds: string[] };
  /** Proxy pratinjau yang sudah tercatat di plan; null = belum/tidak perlu. */
  proxy: { file: string; width: number; height: number; fps?: number } | null;
  /** Keputusan "perlu proxy" beserta alasannya, untuk video yang terbaca. */
  proxyDecision: { needed: boolean; reason: string } | null;
  transcript: boolean;
}

export interface SourcesResponse {
  ok: true;
  /** false = mesin tanpa transkoder: tanpa proxy, tanpa thumbnail, tanpa gelombang. */
  transcoder: boolean;
  maxUploadBytes: number;
  sources: SourceLite[];
}

/** ADR-0028 §11: sampai byte ke berapa potongan `id` sudah sampai di server. */
export interface UploadStatusResponse {
  ok: true;
  id: string;
  offset: number;
}

export type UploadChunkResponse =
  | { ok: true; done: false; id: string; offset: number }
  | {
      ok: true;
      done: true;
      id: string;
      offset: number;
      file: string;
      existed: boolean;
      source: SourceLite;
    };

export interface RegisterSourceRequest {
  file: string;
  sceneId: string;
  layerId?: string | null;
  trimStartSec?: number;
}

export interface RegisterSourceResponse {
  ok: true;
  file: string;
  summary: string;
  proxy: { file: string; width: number; height: number; fps?: number } | null;
  proxyNote: string;
  durationSec: number;
  codec: string | null;
}

export interface PeaksResponse {
  ok: true;
  file: string;
  durationSec: number;
  hasAudio: boolean;
  /** 0..1 per keranjang, dari kiri ke kanan sepanjang rekaman. */
  peaks: number[];
}

// ---------------------------------------------------------------------------
// Pustaka media (ADR-0018): ikon, stiker, efek suara
// ---------------------------------------------------------------------------

export interface IconCandidateLite {
  /** Id Iconify, mis. "mdi:home". */
  iconId: string;
  setName: string;
  license: string;
  /** Lisensi mewajibkan kredit (CC-BY/OFL/Apache-2.0). */
  needsAttribution: boolean;
}

export interface IconSearchResponse {
  ok: true;
  provider: string;
  query: string;
  icons: IconCandidateLite[];
}

export interface StickerCandidateLite {
  index: number;
  assetId: string;
  width: number;
  height: number;
  /** Apa adanya dari provider; memuat penanda bila hak pakainya perlu dicek. */
  license: string;
  thumbnailUrl: string | null;
}

export interface StickerSearchResponse {
  ok: true;
  provider: string;
  query: string;
  stickers: StickerCandidateLite[];
}

export interface SfxCandidateLite {
  assetId: string;
  title: string;
  durationSec: number | null;
  license: string;
  author: string | null;
}

export interface SfxSearchResponse {
  ok: true;
  provider: string;
  query: string;
  sounds: SfxCandidateLite[];
}

export interface AddGraphicResponse {
  ok: true;
  graphicId: string;
  file: string;
  summary: string;
}

export interface AddSfxResponse {
  ok: true;
  cueId: string;
  file: string;
  summary: string;
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
  /** Proyek ditutup server (pindah proyek / kembali ke lobi) — tutup SSE. */
  | { type: "project-closed" }
  | { type: "plan-updated"; reason: PlanUpdateReason; revision: number }
  | { type: "busy"; busy: BusyState }
  /** Kemajuan proxy di latar; `running: false` = selesai/dibatalkan. */
  | { type: "proxy-progress"; job: ProxyJobLite }
  /** Unggahan ke tujuan publikasi (ADR-0030); satu berkas pada satu waktu. */
  | {
      type: "publish";
      status: "started" | "progress" | "done" | "error";
      file: string;
      target: string;
      fraction?: number;
      url?: string;
      /** true = tautan lama dari ledger; berkas yang sama tidak diunggah lagi. */
      cached?: boolean;
      error?: string;
    }
  | {
      type: "stage-results";
      stage: "tts" | "assets" | "asr" | "loudness" | "proxy";
      results: { sceneId: string; status: string; detail: string }[];
    }
  | {
      type: "render";
      status: "started" | "done" | "error";
      /** Deskripsi ekspor, mis. "mp4 1080p seimbang". */
      label: string;
      url?: string;
      error?: string;
      /** Kenyaringan campuran akhir berkas hasil, LUFS (ADR-0028); null = tidak terukur. */
      mixLufs?: number | null;
      /** Berapa berkas video yang dirender dari proxy-nya (ADR-0028). */
      proxied?: number;
      /** Penguatan koreksi campuran akhir yang diterapkan, dB (ADR-0028 §9). */
      mixGainDb?: number;
      /** Kalimat keadaan koreksi campuran akhir. */
      mixNote?: string;
    };

// ---------------------------------------------------------------------------
// Chat (POST /api/chat → stream SSE per giliran)
// ---------------------------------------------------------------------------

export interface ChatRequest {
  text: string;
  /** Data URL gambar (maks 3, masing-masing <= 4MB) — butuh model vision. */
  images?: string[];
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
