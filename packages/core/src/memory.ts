import { z } from "zod";

/**
 * Memori preferensi LINTAS PROYEK (ADR-0029, roadmap §10.1).
 *
 * Preferensi adalah kalimat pendek milik USER — "selalu pakai caption tegas
 * untuk klip", "jangan pernah pakai musik dramatis" — yang berlaku di semua
 * proyek, bukan keadaan satu plan. Karena itu ia TIDAK hidup di scene-plan:
 * plan adalah dokumen satu video, memori adalah kebiasaan orangnya.
 *
 * Modul ini MURNI: skema, penambahan dengan dedup, penghapusan, dan bentuk
 * teks untuk konteks agent. Penyimpanannya (berkas di folder rumah Dalang)
 * ada di paket agent; Studio dan CLI hanya memanggil fungsi-fungsi ini.
 */

export const MEMORY_KINDS = ["gaya", "suara", "format", "larangan", "catatan"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Label manusia per jenis — dipakai lobi Studio, CLI, dan blok konteks agent. */
export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  gaya: "Gaya visual & tipografi",
  suara: "Suara & musik",
  format: "Format & struktur",
  larangan: "Jangan pernah",
  catatan: "Catatan lain",
};

/** Batas jumlah: memori yang panjang berhenti dibaca, oleh agent maupun orang. */
export const MAX_MEMORY_ENTRIES = 40;
export const MAX_MEMORY_TEXT = 240;

export const memoryEntrySchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(MEMORY_KINDS),
  text: z.string().min(3).max(MAX_MEMORY_TEXT),
  /** Siapa yang menuliskannya: user lewat lobi/CLI, atau agent lewat tool. */
  source: z.enum(["user", "agent"]),
  /** ISO 8601. */
  createdAt: z.string().min(1),
  /** Proyek tempat preferensi ini pertama dinyatakan; null = tidak dicatat. */
  projectId: z.string().nullable().default(null),
});
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export const memorySchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(memoryEntrySchema).max(MAX_MEMORY_ENTRIES).default([]),
});
export type Memory = z.infer<typeof memorySchema>;

export const emptyMemory = (): Memory => ({ version: 1, entries: [] });
export const parseMemory = (input: unknown): Memory => memorySchema.parse(input);

const cleanText = (text: string): string => text.trim().replace(/\s+/g, " ");
const normalize = (text: string): string => cleanText(text).toLowerCase();

/** FNV-1a 32-bit — cukup untuk id pendek yang deterministik dari teks + waktu. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** Id deterministik dari teks dan waktu: tes bisa meramalkannya. */
export const memoryEntryId = (text: string, createdAt: string): string =>
  `m-${fnv1a(`${normalize(text)}|${createdAt}`).toString(36)}`;

export type AddMemoryResult =
  | { ok: true; memory: Memory; entry: MemoryEntry; duplicate: boolean }
  | { ok: false; reason: string };

/**
 * Tambah satu preferensi. Teks yang sama (abaikan kapital dan spasi) tidak
 * digandakan — entri lamanya dikembalikan dengan `duplicate: true` — dan
 * memori yang penuh menolak dengan alasan, bukan membuang yang lama diam-diam.
 */
export const addMemoryEntry = (
  memory: Memory,
  input: {
    kind: MemoryKind;
    text: string;
    source: MemoryEntry["source"];
    projectId?: string | null;
    now?: string;
  },
): AddMemoryResult => {
  const text = cleanText(input.text);
  if (text.length < 3) return { ok: false, reason: "teks preferensi terlalu pendek" };
  if (text.length > MAX_MEMORY_TEXT) {
    return {
      ok: false,
      reason: `teks preferensi lebih dari ${MAX_MEMORY_TEXT} karakter`,
    };
  }
  const existing = memory.entries.find(
    (entry) => normalize(entry.text) === normalize(text),
  );
  if (existing) return { ok: true, memory, entry: existing, duplicate: true };
  if (memory.entries.length >= MAX_MEMORY_ENTRIES) {
    return {
      ok: false,
      reason: `memori penuh (${MAX_MEMORY_ENTRIES} preferensi) — hapus yang tidak lagi berlaku`,
    };
  }
  const createdAt = input.now ?? new Date().toISOString();
  const entry: MemoryEntry = {
    id: memoryEntryId(text, createdAt),
    kind: input.kind,
    text,
    source: input.source,
    createdAt,
    projectId: input.projectId ?? null,
  };
  return {
    ok: true,
    memory: { ...memory, entries: [...memory.entries, entry] },
    entry,
    duplicate: false,
  };
};

export const removeMemoryEntry = (
  memory: Memory,
  id: string,
): { memory: Memory; removed: MemoryEntry | null } => {
  const removed = memory.entries.find((entry) => entry.id === id) ?? null;
  if (!removed) return { memory, removed: null };
  return {
    memory: { ...memory, entries: memory.entries.filter((entry) => entry.id !== id) },
    removed,
  };
};

/**
 * Baris-baris untuk blok konteks agent, dikelompokkan per jenis dengan
 * id-nya — agent memakai id itu untuk `forgetPreference`. Kosong bila tidak
 * ada preferensi, supaya blok konteksnya tidak dicetak sia-sia.
 */
export const memoryContextLines = (memory: Memory): string[] => {
  const lines: string[] = [];
  for (const kind of MEMORY_KINDS) {
    const entries = memory.entries.filter((entry) => entry.kind === kind);
    if (entries.length === 0) continue;
    lines.push(`${MEMORY_KIND_LABEL[kind]}:`);
    for (const entry of entries) lines.push(`- [${entry.id}] ${entry.text}`);
  }
  return lines;
};

// ---------------------------------------------------------------------------
// Pertentangan antar preferensi (batas ADR-0029 dicabut sebagian)
// ---------------------------------------------------------------------------

export interface MemoryConflict {
  a: MemoryEntry;
  b: MemoryEntry;
  reason: string;
}

const ABSOLUTE = /\b(selalu|setiap|semua|wajib)\b/;
const FORBID = /\b(jangan(?: pernah)?|tidak pernah|hindari)\b/;
const RATIOS = ["16:9", "9:16", "1:1"] as const;
const CAPTION_STYLES = ["klasik", "tegas", "chip", "halus"] as const;

const valuesOf = <T extends string>(text: string, family: readonly T[]): T[] =>
  family.filter((value) => new RegExp(`(^|[^\\w:])${value}($|[^\\w:])`).test(text));

/** Sisa kalimat setelah kata kunci keharusan/larangan dibuang, dirapikan. */
const stripped = (text: string, pattern: RegExp): string =>
  cleanText(text.replace(pattern, " "))
    .replace(/^(untuk|pakai|memakai|gunakan|menggunakan)\s+/, "")
    .trim();

/**
 * Dua preferensi yang tidak bisa berlaku bersamaan. Heuristiknya SENGAJA
 * sempit — lebih baik diam daripada menuduh — dan hanya mengenali tiga
 * bentuk yang pasti:
 *  1. rasio mutlak yang berbeda: "selalu 9:16" vs "selalu 16:9";
 *  2. gaya caption mutlak yang berbeda: "selalu caption tegas" vs "… halus";
 *  3. keharusan vs larangan atas hal yang SAMA: "selalu pakai musik dramatis"
 *     vs "jangan pernah pakai musik dramatis".
 * Pertentangan yang lebih halus dari itu tetap tidak terdeteksi, dan itu
 * disebut di Batas ADR-0029.
 */
export const memoryConflicts = (memory: Memory): MemoryConflict[] => {
  const conflicts: MemoryConflict[] = [];
  const entries = memory.entries;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i] as MemoryEntry;
      const b = entries[j] as MemoryEntry;
      const ta = normalize(a.text);
      const tb = normalize(b.text);
      const reason = conflictReason(ta, tb);
      if (reason) conflicts.push({ a, b, reason });
    }
  }
  return conflicts;
};

const conflictReason = (ta: string, tb: string): string | null => {
  const absoluteA = ABSOLUTE.test(ta) && !FORBID.test(ta);
  const absoluteB = ABSOLUTE.test(tb) && !FORBID.test(tb);
  if (absoluteA && absoluteB) {
    const ratioA = valuesOf(ta, RATIOS);
    const ratioB = valuesOf(tb, RATIOS);
    if (ratioA.length === 1 && ratioB.length === 1 && ratioA[0] !== ratioB[0]) {
      return `rasio ${ratioA[0]} dan ${ratioB[0]} sama-sama dinyatakan mutlak`;
    }
    if (ta.includes("caption") && tb.includes("caption")) {
      const styleA = valuesOf(ta, CAPTION_STYLES);
      const styleB = valuesOf(tb, CAPTION_STYLES);
      if (styleA.length === 1 && styleB.length === 1 && styleA[0] !== styleB[0]) {
        return `gaya caption "${styleA[0]}" dan "${styleB[0]}" sama-sama dinyatakan mutlak`;
      }
    }
  }
  const forbidA = FORBID.test(ta);
  const forbidB = FORBID.test(tb);
  if (absoluteA && forbidB)
    return sameSubject(stripped(ta, ABSOLUTE), stripped(tb, FORBID));
  if (absoluteB && forbidA)
    return sameSubject(stripped(tb, ABSOLUTE), stripped(ta, FORBID));
  return null;
};

const sameSubject = (must: string, never: string): string | null =>
  must.length >= 4 && must === never
    ? `"${must}" diharuskan di satu preferensi dan dilarang di preferensi lain`
    : null;

/**
 * Baris peringatan untuk blok konteks agent (dan CLI): agent diminta
 * BERTANYA, bukan memilih sendiri — dua kalimat mutlak yang bertabrakan
 * adalah keputusan orangnya.
 */
export const memoryConflictLines = (memory: Memory): string[] =>
  memoryConflicts(memory).map(
    (conflict) =>
      `PERTENTANGAN: [${conflict.a.id}] "${conflict.a.text}" vs [${conflict.b.id}] "${conflict.b.text}" — ${conflict.reason}; tanyakan user mana yang berlaku, jangan memilih sendiri`,
  );
