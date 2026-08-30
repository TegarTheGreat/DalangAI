import type { ExportSettings, RenderProfile, RenderVideoResult } from "./render";

/**
 * `RenderTarget` — tujuan render sebagai PORT (PRD §7.3, ADR-0019).
 *
 * PRD sudah menyebut abstraksi ini sejak awal, tetapi selama Fase 0-4 ia hanya
 * hidup sebagai komentar: cuma ada satu implementasi. Fase 5 menambahkan yang
 * kedua, dan sebuah interface baru layak disebut interface ketika ada dua
 * pemakai yang harus benar-benar bisa saling menggantikan.
 *
 * Yang SENGAJA tidak ada di sini: bundling, staging berkas, dan pemilihan
 * Chromium. Ketiganya adalah cara sebuah target bekerja, bukan kontraknya —
 * dan target cloud tidak melakukan satu pun dari ketiganya di mesin ini.
 */

export interface RenderRequest {
  /** Path scene-plan di disk; folder induknya adalah akar aset plan. */
  planPath: string;
  /** Ke mana hasilnya ditulis, di mesin pemanggil. */
  outputLocation: string;
  profile: RenderProfile;
  settings?: Partial<ExportSettings>;
  onProgress?: (event: RenderTargetProgress) => void;
  /** Batalkan render yang sedang berjalan. */
  signal?: AbortSignal;
}

export interface RenderTargetProgress {
  /**
   * Tahap yang sedang berjalan. Target cloud memakai nama yang sama supaya UI
   * tidak perlu tahu render berjalan di mana.
   */
  stage: "bundling" | "uploading" | "rendering" | "encoding" | "downloading";
  /** 0..1 */
  progress: number;
}

/**
 * Estimasi biaya SEBELUM render dijalankan (PRD §6.3).
 *
 * Wajib ada di kontrak, bukan opsional: gerbang persetujuan §6.3 memutuskan
 * berdasarkan angka ini, dan target yang tidak bisa menyebut harganya akan
 * membuat gerbang itu diam-diam berhenti bekerja. Target lokal menjawab 0 —
 * itu jawaban yang benar, bukan ketiadaan jawaban.
 */
export interface RenderCostEstimate {
  usd: number;
  /** Penjelasan singkat untuk ditampilkan apa adanya ke user. */
  detail: string;
}

export interface RenderTarget {
  /** Id stabil, mis. "local" | "lambda". */
  readonly id: string;
  readonly label: string;
  estimateCost(request: RenderRequest): Promise<RenderCostEstimate>;
  render(request: RenderRequest): Promise<RenderVideoResult>;
}
