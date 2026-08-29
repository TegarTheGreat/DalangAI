import { createHash } from "node:crypto";

/**
 * Content hashing for stage cache keys (PRD §7.2): same input ⇒ same hash ⇒
 * no re-work, no re-cost. Keys are derived from *creative inputs* only (text,
 * voice config, query) — never from which provider happened to succeed.
 */

/** Deterministic JSON: object keys sorted recursively, arrays kept in order. */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
};

export const sha256Hex = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

/** 16-hex content hash used for cache keys and content-addressed filenames. */
export const contentHash = (value: unknown): string =>
  sha256Hex(stableStringify(value)).slice(0, 16);
