import { describe, expect, it } from "vitest";
import {
  addMemoryEntry,
  emptyMemory,
  MAX_MEMORY_ENTRIES,
  MAX_MEMORY_TEXT,
  memoryContextLines,
  memoryEntryId,
  parseMemory,
  removeMemoryEntry,
} from "../src";

/**
 * Memori preferensi lintas proyek (ADR-0029): murni, deterministik, dan
 * jujur saat menolak.
 */
const NOW = "2026-09-02T10:00:00.000Z";

describe("memori preferensi", () => {
  it("menambah dengan id deterministik, merapikan spasi, dan mencatat proyek asal", () => {
    const result = addMemoryEntry(emptyMemory(), {
      kind: "gaya",
      text: "  Selalu   pakai caption tegas untuk klip ",
      source: "user",
      projectId: "proj-a",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.text).toBe("Selalu pakai caption tegas untuk klip");
    expect(result.entry.id).toBe(
      memoryEntryId("selalu pakai caption tegas untuk klip", NOW),
    );
    expect(result.entry.projectId).toBe("proj-a");
    expect(result.duplicate).toBe(false);
    expect(result.memory.entries).toHaveLength(1);
  });

  it("teks yang sama (abaikan kapital/spasi) tidak digandakan: entri lama kembali sebagai duplikat", () => {
    const first = addMemoryEntry(emptyMemory(), {
      kind: "gaya",
      text: "Pakai rasio 9:16",
      source: "user",
      now: NOW,
    });
    if (!first.ok) throw new Error("gagal");
    const again = addMemoryEntry(first.memory, {
      kind: "format",
      text: "pakai   RASIO 9:16",
      source: "agent",
    });
    expect(again.ok && again.duplicate).toBe(true);
    if (again.ok) {
      expect(again.entry.id).toBe(first.entry.id);
      expect(again.memory.entries).toHaveLength(1);
    }
  });

  it("menolak teks terlalu pendek/panjang dan memori yang penuh — dengan alasan", () => {
    expect(
      addMemoryEntry(emptyMemory(), { kind: "catatan", text: "ab", source: "user" }),
    ).toMatchObject({ ok: false });
    expect(
      addMemoryEntry(emptyMemory(), {
        kind: "catatan",
        text: "x".repeat(MAX_MEMORY_TEXT + 1),
        source: "user",
      }),
    ).toMatchObject({ ok: false });
    let memory = emptyMemory();
    for (let i = 0; i < MAX_MEMORY_ENTRIES; i++) {
      const added = addMemoryEntry(memory, {
        kind: "catatan",
        text: `preferensi nomor ${i}`,
        source: "user",
        now: NOW,
      });
      if (!added.ok) throw new Error(added.reason);
      memory = added.memory;
    }
    const full = addMemoryEntry(memory, {
      kind: "catatan",
      text: "satu lagi",
      source: "user",
    });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toContain("penuh");
  });

  it("menghapus berdasarkan id; id yang tidak ada tidak mengubah apa pun", () => {
    const added = addMemoryEntry(emptyMemory(), {
      kind: "larangan",
      text: "Jangan pernah pakai musik dramatis",
      source: "agent",
      now: NOW,
    });
    if (!added.ok) throw new Error("gagal");
    const removed = removeMemoryEntry(added.memory, added.entry.id);
    expect(removed.removed?.text).toContain("dramatis");
    expect(removed.memory.entries).toHaveLength(0);
    expect(removeMemoryEntry(added.memory, "tidak-ada").removed).toBeNull();
  });

  it("baris konteks dikelompokkan per jenis dengan id-nya, dan kosong bila tidak ada", () => {
    expect(memoryContextLines(emptyMemory())).toEqual([]);
    let memory = emptyMemory();
    for (const [kind, text] of [
      ["catatan", "Sebut sumber di akhir"],
      ["gaya", "Caption tegas untuk klip"],
      ["gaya", "Font Anton hanya untuk judul"],
    ] as const) {
      const added = addMemoryEntry(memory, { kind, text, source: "user", now: NOW });
      if (!added.ok) throw new Error(added.reason);
      memory = added.memory;
    }
    const lines = memoryContextLines(memory);
    expect(lines[0]).toBe("Gaya visual & tipografi:");
    expect(lines[1]).toMatch(/^- \[m-[a-z0-9]+\] Caption tegas untuk klip$/);
    expect(lines[3]).toBe("Catatan lain:");
    expect(lines).toHaveLength(5);
  });

  it("parseMemory memberi bawaan dan menolak bentuk yang rusak", () => {
    expect(parseMemory({ version: 1 }).entries).toEqual([]);
    expect(() => parseMemory({ version: 2, entries: [] })).toThrow();
  });
});
