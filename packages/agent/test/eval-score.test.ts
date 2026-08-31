import { parseScenePlan, type ScenePlanInput } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { formatScoreLine, scorePlan } from "../src/eval/score";

/**
 * Plan yang BENAR-BENAR rapi menurut resep formatnya.
 *
 * Versi pertama fixture ini hanya punya 4 scene dan langsung membuat penilai
 * memberi 72 — bukan karena penilainya salah, tapi karena format "edukasi"
 * menuntut 6-14 scene. Itu justru bukti kecil bahwa penilaiannya bekerja:
 * fixture yang "kelihatan bagus" tidak otomatis lulus.
 */
const goodPlan = (overrides: Partial<ScenePlanInput["meta"]> = {}) =>
  parseScenePlan({
    version: 1,
    projectId: "eval",
    meta: {
      title: "Sejarah Borobudur",
      aspectRatio: "9:16",
      language: "id",
      format: "edukasi",
      ...overrides,
    },
    audio: { music: { assetId: "music/ambient.mp3", volume: 0.2, ducking: true } },
    scenes: [
      {
        id: "sc-judul",
        narration: "",
        visual: { type: "template-anim", variant: "title" },
        texts: [{ id: "t1", content: "Borobudur", size: "l", emphasis: "box" }],
      },
      {
        id: "sc-1",
        narration:
          "Borobudur berdiri sejak abad kesembilan. Wangsa Syailendra menyusunnya dari dua juta balok batu andesit tanpa satu pun perekat semen.",
        visual: { type: "stock", query: "temple sunrise", motion: "kenburns-in" },
        transition: { type: "cross-fade", durationFrames: 12 },
        texts: [{ id: "t2", content: "Abad ke-9", size: "m", emphasis: "underline" }],
      },
      {
        id: "sc-2",
        narration:
          "Dindingnya bercerita. Lebih dari dua ribu panel relief mengurutkan kisah perjalanan menuju pencerahan, dibaca sambil berjalan searah jarum jam.",
        visual: { type: "stock", query: "stone relief", motion: "pan-left" },
        transition: { type: "cross-fade", durationFrames: 20 },
      },
      {
        id: "sc-3",
        narration:
          "Lalu Merapi meletus. Abu vulkanik menimbun candinya, hutan tropis menutup sisanya, dan namanya menghilang dari ingatan selama berabad-abad.",
        visual: { type: "stock", query: "volcanic ash forest", motion: "drift" },
        transition: { type: "cross-fade", durationFrames: 18 },
      },
      {
        id: "sc-4",
        narration:
          "Tahun delapan belas empat belas, Raffles mendengar kabar tentang bukit berukir dan mengirim tim untuk membersihkannya. Butuh empat puluh lima hari.",
        visual: { type: "stock", query: "colonial expedition map", motion: "pan-right" },
        transition: { type: "cross-fade", durationFrames: 10 },
      },
      {
        id: "sc-5",
        narration:
          "Pemugaran terbesarnya berjalan sepanjang tahun tujuh puluhan. UNESCO ikut turun tangan. Satu juta batu dibongkar, dibersihkan, lalu dipasang kembali.",
        visual: {
          type: "stock",
          query: "restoration scaffolding",
          motion: "kenburns-out",
        },
        transition: { type: "cross-fade", durationFrames: 22 },
      },
      {
        id: "sc-6",
        narration:
          "Kini stupanya berdiri lagi menghadap matahari terbit di jantung Jawa, dan setiap pagi ribuan orang mendaki untuk melihatnya. Candinya bertahan.",
        visual: { type: "stock", query: "stupa dawn aerial", motion: "kenburns-in" },
        transition: { type: "cross-fade", durationFrames: 14 },
      },
      {
        id: "sc-outro",
        narration: "",
        visual: { type: "template-anim", variant: "outro" },
      },
    ],
  });

describe("scorePlan · kepatuhan brief", () => {
  it("plan rapi yang mematuhi brief mendapat skor tinggi", () => {
    const score = scorePlan(goodPlan(), {
      aspectRatio: "9:16",
      language: "id",
      format: "edukasi",
      mustMention: ["Borobudur"],
    });
    expect(score.score).toBeGreaterThan(85);
    expect(score.perhatian).toBe(0);
  });

  it("rasio yang salah menurunkan skor dan disebutkan alasannya", () => {
    const salah = scorePlan(goodPlan({ aspectRatio: "16:9" }), { aspectRatio: "9:16" });
    const benar = scorePlan(goodPlan(), { aspectRatio: "9:16" });
    expect(salah.score).toBeLessThan(benar.score);
    const check = salah.checks.find((item) => item.name === "rasio sesuai brief");
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain("diminta 9:16");
  });

  it("kata kunci brief yang tidak tersentuh terdeteksi dan disebutkan", () => {
    const score = scorePlan(goodPlan(), { mustMention: ["Borobudur", "Majapahit"] });
    const check = score.checks.find((item) => item.name === "topik brief tersentuh");
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain("Majapahit");
    expect(check?.detail).not.toContain("Borobudur");
  });

  it("pencocokan kata kunci mengabaikan huruf besar-kecil", () => {
    expect(
      scorePlan(goodPlan(), { mustMention: ["borobudur", "SYAILENDRA"] }).checks.find(
        (c) => c.name === "topik brief tersentuh",
      )?.passed,
    ).toBe(true);
  });

  it("harapan yang tidak disebut tidak ikut dinilai", () => {
    // Brief yang tidak menyebut rasio tidak boleh menghukum plan apa pun
    // rasionya — eval harus mengukur yang diminta, bukan selera penilainya.
    const score = scorePlan(goodPlan({ aspectRatio: "1:1" }), {});
    expect(score.checks.map((c) => c.name)).not.toContain("rasio sesuai brief");
  });

  it("durasi dinilai dengan toleransi, bukan ketepatan detik", () => {
    // Durasi "auto" ditentukan panjang narasi; menuntut ketepatan detik akan
    // menghukum plan yang sebetulnya benar.
    const score = scorePlan(goodPlan(), { targetSec: 60 });
    const check = score.checks.find((item) => item.name === "durasi mendekati target");
    expect(check).toBeDefined();
    expect(check?.detail).toMatch(/target ~60s/);
  });
});

describe("scorePlan · struktur & kerajinan", () => {
  it("scene isi tanpa narasi menggagalkan pemeriksaannya", () => {
    const plan = parseScenePlan({
      version: 1,
      projectId: "eval",
      meta: { title: "T", format: "edukasi" },
      scenes: [
        { id: "sc-1", narration: "", visual: { type: "stock", query: "x" } },
        { id: "sc-2", narration: "Ada narasi di sini.", visual: { type: "stock" } },
      ],
    });
    const check = scorePlan(plan).checks.find((c) => c.name === "scene isi bernarasi");
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain("1 scene isi kosong");
  });

  it("catatan sutradara memotong poin kerajinan tapi tidak membuat skor negatif", () => {
    // Plan seburuk apa pun harus tetap menghasilkan angka yang bisa dibaca.
    const buruk = parseScenePlan({
      version: 1,
      projectId: "eval",
      meta: {
        title: "Judul yang sangat panjang sekali sampai melewati batas wajar",
        format: "edukasi",
      },
      scenes: [
        {
          id: "sc-1",
          narration:
            "Di era digital yang serba cepat ini, tak dapat dipungkiri bahwa pada dasarnya secara umum penting untuk dicatat bahwa hal ini cenderung menjadi sesuatu yang sangat penting bagi kita semua sebagai manusia modern.",
          visual: { type: "stock", query: "x", motion: "none" },
        },
        {
          id: "sc-2",
          narration: "Nah kayak gitu ya.",
          visual: { type: "stock", motion: "none" },
        },
      ],
    });
    const score = scorePlan(buruk);
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.perhatian).toBeGreaterThan(0);
    expect(score.score).toBeLessThan(scorePlan(goodPlan()).score);
  });

  it("skor selalu di rentang 0-100", () => {
    for (const plan of [goodPlan(), goodPlan({ aspectRatio: "16:9" })]) {
      const score = scorePlan(plan, {
        aspectRatio: "9:16",
        format: "klip",
        targetSec: 300,
        mustMention: ["tidak ada"],
      });
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("formatScoreLine", () => {
  it("menyebut pemeriksaan yang gagal supaya papan skor bisa ditindaklanjuti", () => {
    const line = formatScoreLine(
      "brief-1",
      scorePlan(goodPlan({ aspectRatio: "16:9" }), { aspectRatio: "9:16" }),
    );
    expect(line).toContain("brief-1");
    expect(line).toContain("gagal: rasio sesuai brief");
  });

  it("tidak menyebut bagian gagal saat semuanya lulus", () => {
    expect(
      formatScoreLine("bersih", scorePlan(goodPlan(), { language: "id" })),
    ).not.toContain("gagal:");
  });
});
