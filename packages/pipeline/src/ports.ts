import type { WordTimestamp } from "@dalang/core";

/**
 * Provider ports (hexagonal boundary, ADR-0001): the pipeline declares what it
 * needs; @dalang/providers implements; the CLI (later: agent runtime) wires
 * them together. Stages receive providers by injection — the pipeline package
 * never imports a concrete provider.
 */

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

export interface TtsRequest {
  text: string;
  voiceId: string;
  /** 1 = natural speed. */
  speed: number;
  /** BCP-47-ish language hint, e.g. "id". */
  language: string;
}

export interface TtsResult {
  audio: Uint8Array;
  format: "mp3" | "wav";
  durationSec: number;
  /** Audio-relative (0-based) — the core contract. */
  wordTimestamps: WordTimestamp[];
  /** "native" from the provider, or "estimated" (deterministic fallback). */
  timestampsSource: "native" | "estimated";
  /** Rough cost estimate for observability; 0 for free/local providers. */
  costUsd: number;
}

export interface TtsProvider {
  id: string;
  label: string;
  /**
   * True when output is placeholder-grade (e.g. the offline silence
   * provider): the scene is always marked `fallbackQuality`, even when this
   * provider was requested as primary.
   */
  placeholderQuality: boolean;
  synthesize(request: TtsRequest): Promise<TtsResult>;
}

// ---------------------------------------------------------------------------
// Stock assets
// ---------------------------------------------------------------------------

export type StockKind = "video" | "image";
export type StockOrientation = "portrait" | "landscape" | "square";

export interface StockSearchRequest {
  query: string;
  kind: StockKind;
  orientation: StockOrientation;
  perPage: number;
}

export interface StockCandidate {
  providerId: string;
  /** Stable id, e.g. "pexels:video:857195". */
  assetId: string;
  kind: StockKind;
  downloadUrl: string;
  /** Lowercase file extension without dot, e.g. "mp4", "jpg". */
  fileExt: string;
  width: number;
  height: number;
  durationSec?: number;
  author?: string;
  sourceUrl?: string;
  /** Verbatim license label, stored for audit (PRD §10 / R-10). */
  license: string;
  thumbnailUrl?: string;
}

export interface StockProvider {
  id: string;
  label: string;
  search(request: StockSearchRequest): Promise<StockCandidate[]>;
  /** Fetch the asset bytes for a candidate this provider returned. */
  download(candidate: StockCandidate): Promise<Uint8Array>;
}
