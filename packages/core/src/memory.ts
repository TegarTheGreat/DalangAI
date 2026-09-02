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
