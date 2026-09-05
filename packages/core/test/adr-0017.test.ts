import { describe, expect, it } from "vitest";
import {
  applyPatch,
  CONTENT_FORMATS,
  critiquePlan,
  formatBriefLines,
  parseScenePlan,
  recipeFor,
} from "../src";

const scene = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  narration: "Narasi contoh dengan panjang sedang untuk uji resep format ini.",
  visual: { type: "stock", query: "x" },
  duration: 6,
  ...over,
});

const card = (id: string, variant: string) => ({
  id,
  narration: "",
  visual: { type: "template-anim", variant },
  duration: 4,
});

const plan = (format: string, scenes: unknown[]) =>
  parseScenePlan({
    version: 1,
    projectId: "uji-0017",
    meta: { title: "Uji Format", format },
    scenes,
  });

const codes = (p: ReturnType<typeof plan>) => critiquePlan(p).map((n) => n.code);

describe("resep format (ADR-0017)", () => {
  it("format tak dikenal & 'bebas' tidak memaksakan struktur apa pun", () => {
    expect(recipeFor("entah").format).toBe("bebas");
    expect(recipeFor(undefined).format).toBe("bebas");
    const bebas = plan("bebas", [scene("a"), scene("b")]);
    expect(codes(bebas).filter((c) => c.startsWith("format-"))).toEqual([]);
  });

  it("default meta.format = bebas, jadi plan lama tidak tiba-tiba dikritik", () => {
    const old = parseScenePlan({
      version: 1,
      projectId: "p",
      meta: { title: "T" },
      scenes: [scene("a")],
    });
    expect(old.meta.format).toBe("bebas");
    expect(codes(old).filter((c) => c.startsWith("format-"))).toEqual([]);
  });

  it("edukasi: terlalu sedikit scene + hook tanpa teks tertangkap", () => {
    const found = codes(plan("edukasi", [card("t", "title"), scene("a")]));
    expect(found).toContain("format-jumlah-scene");
    expect(found).toContain("format-hook-tanpa-teks");
  });

  it("klip: kartu judul di depan ditolak (tak ada waktu basa-basi)", () => {
    const found = codes(plan("klip", [card("t", "title"), scene("a"), scene("b")]));
    expect(found).toContain("format-klip-basa-basi");
  });

  it("klip: durasi kepanjangan tertangkap", () => {
    const long = Array.from({ length: 6 }, (_, i) => scene(`s${i}`, { duration: 30 }));
    expect(codes(plan("klip", long))).toContain("format-durasi");
  });

  it("tutorial: langkah tanpa kata kerja perintah ditegur", () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      scene(`s${i}`, { narration: "Ini penjelasan panjang yang tidak imperatif." }),
    );
    const found = codes(
      plan("tutorial", [card("t", "title"), ...steps, card("o", "outro")]),
    );
    expect(found).toContain("format-langkah-tidak-imperatif");
  });

  it("tutorial: langkah imperatif TIDAK ditegur", () => {
    const steps = [
      scene("s0", { narration: "Buka menu pengaturan di pojok kanan atas layar." }),
      scene("s1", { narration: "Klik tombol tambah lalu pilih sumber datanya." }),
      scene("s2", { narration: "Simpan perubahan dan tunggu proses selesai." }),
      scene("s3", { narration: "Pilih format ekspor yang kamu mau dari daftar." }),
    ];
    const found = codes(
      plan("tutorial", [card("t", "title"), ...steps, card("o", "outro")]),
    );
    expect(found).not.toContain("format-langkah-tidak-imperatif");
  });

  it("outro hanya dituntut oleh format yang memakainya", () => {
    // klip tidak butuh outro
    expect(codes(plan("klip", [scene("a"), scene("b")]))).not.toContain("outro-hilang");
  });

  it("ringkasan format untuk prompt mencakup semua format non-bebas", () => {
    const lines = formatBriefLines();
    expect(lines).toHaveLength(CONTENT_FORMATS.length - 1);
    expect(lines.join(" ")).toContain("tutorial");
  });
});

describe("trimStartSec (klip dari video sumber)", () => {
  it("default 0; nilai negatif ditolak; patch + inverse utuh", () => {
    const p = plan("bebas", [scene("a")]);
    expect(p.scenes[0]?.clips[0]?.trimStartSec).toBe(0);
    expect(() =>
      plan("bebas", [scene("b", { visual: { type: "stock", trimStartSec: -2 } })]),
    ).toThrow();

    const { plan: after, applied } = applyPatch(
      p,
      [{ op: "updateScene", id: "a", patch: { clip: { trimStartSec: 42.5 } } }],
      { origin: "agent" },
    );
    expect(after.scenes[0]?.clips[0]?.trimStartSec).toBe(42.5);
    const { plan: back } = applyPatch(after, applied.inverse, { origin: "agent" });
    expect(back).toEqual(p);
  });
});
