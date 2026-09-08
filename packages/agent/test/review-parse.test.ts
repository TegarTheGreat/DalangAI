import { describe, expect, it } from "vitest";
import { parseReviewFindings, reviewPrompt } from "../src/vision/review";

describe("parseReviewFindings", () => {
  it("mengurai array JSON polos", () => {
    const out = parseReviewFindings(
      '[{"scene":2,"level":"perhatian","masalah":"Teks terpotong","saran":"Perkecil"}]',
    );
    expect(out.unparsed).toBe(false);
    expect(out.findings).toEqual([
      { scene: 2, level: "perhatian", masalah: "Teks terpotong", saran: "Perkecil" },
    ]);
  });

  it("memaafkan pagar kode dan prosa di sekitarnya", () => {
    // Ini keadaan NORMAL, bukan pengecualian: banyak model menambahkan
    // kalimat pembuka walau diminta menjawab JSON saja.
    const out = parseReviewFindings(
      'Berikut temuan saya:\n```json\n[{"masalah":"Kontras rendah"}]\n```\nSemoga membantu.',
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.masalah).toBe("Kontras rendah");
  });

  it("memaafkan trailing comma — kesalahan model paling sering", () => {
    const out = parseReviewFindings('[{"masalah":"A"},{"masalah":"B"},]');
    expect(out.findings.map((f) => f.masalah)).toEqual(["A", "B"]);
  });

  it("tidak tertipu tanda kurung siku di dalam string", () => {
    const out = parseReviewFindings('[{"masalah":"teks \\"[judul]\\" terpotong"}]');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.masalah).toContain("[judul]");
  });

  it("MEMBUANG entri tanpa field wajib dan melaporkannya", () => {
    // Meloloskannya dengan nilai karangan akan menuding scene yang salah —
    // kesalahan yang jauh lebih mahal daripada satu temuan yang hilang.
    const out = parseReviewFindings('[{"masalah":"Sah"},{"scene":3},{"masalah":""}]');
    expect(out.findings).toHaveLength(1);
    expect(out.dropped).toBe(2);
  });

  it("level default 'saran' saat model tidak menyebutnya", () => {
    expect(parseReviewFindings('[{"masalah":"X"}]').findings[0]?.level).toBe("saran");
  });

  it("level di luar daftar membuat entrinya dibuang, bukan dipaksakan", () => {
    const out = parseReviewFindings('[{"masalah":"X","level":"gawat"}]');
    expect(out.findings).toHaveLength(0);
    expect(out.dropped).toBe(1);
  });

  it("jawaban tanpa JSON ditandai unparsed, bukan dianggap bersih", () => {
    // Bedanya penting: "tidak ada temuan" dan "jawabannya tidak terbaca"
    // adalah dua hal yang sangat berbeda bagi agent yang membacanya.
    const out = parseReviewFindings("Semua gambar terlihat baik menurut saya.");
    expect(out.unparsed).toBe(true);
    expect(out.findings).toEqual([]);
  });

  it("array kosong = bersih, dan itu BUKAN unparsed", () => {
    const out = parseReviewFindings("[]");
    expect(out.unparsed).toBe(false);
    expect(out.findings).toEqual([]);
  });

  it("JSON rusak yang tidak bisa diperbaiki ditandai unparsed", () => {
    expect(parseReviewFindings('[{"masalah": }]').unparsed).toBe(true);
  });
});

describe("reviewPrompt", () => {
  const frames = [
    { sceneNumber: 1, sceneId: "sc-judul", reason: "scene pembuka" },
    { sceneNumber: 4, sceneId: "sc-004", reason: "paling ramai: 2 teks" },
  ];

  it("memetakan tiap gambar ke scene-nya supaya temuan bisa ditindaklanjuti", () => {
    const prompt = reviewPrompt(frames);
    expect(prompt).toContain("gambar 1 = scene 1 (sc-judul)");
    expect(prompt).toContain("gambar 2 = scene 4 (sc-004)");
  });

  it("melarang melaporkan hal yang tidak bisa dilihat dari frame diam", () => {
    // Tanpa larangan ini model vision rutin "menemukan" masalah audio dan
    // transisi yang mustahil ia lihat.
    const prompt = reviewPrompt(frames);
    expect(prompt).toMatch(/JANGAN melaporkan/);
    expect(prompt).toMatch(/audio/);
  });

  it("menyisipkan perhatian khusus user kalau ada", () => {
    expect(reviewPrompt(frames, "cek keterbacaan caption")).toContain(
      "cek keterbacaan caption",
    );
    expect(reviewPrompt(frames)).not.toContain("Perhatian khusus");
  });
});
