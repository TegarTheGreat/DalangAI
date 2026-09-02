import { describe, expect, it } from "vitest";
import {
  addMemoryEntry,
  emptyMemory,
  MAX_MEMORY_ENTRIES,
  MAX_MEMORY_TEXT,
  memoryConflictLines,
  memoryConflicts,
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

  it("pertentangan: rasio mutlak, gaya caption mutlak, keharusan vs larangan — dan diam pada yang cuma mirip", () => {
    const seed = (texts: Array<[string, "gaya" | "format" | "larangan" | "suara"]>) =>
      texts.reduce((memory, [text, kind], index) => {
        const added = addMemoryEntry(memory, {
          kind,
          text,
          source: "user",
          now: `2026-09-02T10:00:0${index}.000Z`,
        });
        if (!added.ok) throw new Error(added.reason);
        return added.memory;
      }, emptyMemory());

    const ratio = seed([
      ["Selalu 9:16 untuk semua video saya", "format"],
      ["Setiap video wajib 16:9", "format"],
    ]);
    expect(memoryConflicts(ratio)).toHaveLength(1);
    expect(memoryConflicts(ratio)[0]?.reason).toContain("9:16");
    expect(memoryConflicts(ratio)[0]?.reason).toContain("16:9");

    const caption = seed([
      ["Selalu pakai caption tegas untuk klip", "gaya"],
      ["Caption selalu halus", "gaya"],
    ]);
    expect(memoryConflicts(caption)[0]?.reason).toContain('"tegas"');

    const mustNever = seed([
      ["Selalu pakai musik dramatis", "suara"],
      ["Jangan pernah pakai musik dramatis", "larangan"],
    ]);
    const lines = memoryConflictLines(mustNever);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("PERTENTANGAN");
    expect(lines[0]).toContain("musik dramatis");
    expect(lines[0]).toContain("tanyakan user");

    // Mirip tapi bukan pertentangan: rasio yang sama, larangan atas hal lain,
    // dan preferensi tanpa kata mutlak.
    const calm = seed([
      ["Selalu 9:16 untuk klip", "format"],
      ["Untuk YouTube pakai 16:9", "format"],
      ["Jangan pernah pakai musik dramatis", "larangan"],
      ["Selalu pakai musik tenang", "suara"],
      ["Caption tegas untuk klip", "gaya"],
      ["Caption halus untuk dokumenter", "gaya"],
    ]);
    expect(memoryConflicts(calm)).toEqual([]);
    expect(memoryConflictLines(emptyMemory())).toEqual([]);
  });

  it("parseMemory memberi bawaan dan menolak bentuk yang rusak", () => {
    expect(parseMemory({ version: 1 }).entries).toEqual([]);
    expect(() => parseMemory({ version: 2, entries: [] })).toThrow();
  });
});
