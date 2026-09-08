import {
  NARRATION_LEAD_IN_SEC,
  parseScenePlan,
  type Scene,
  type ScenePlan,
  setClipAsset,
  setTranscript,
} from "@dalang/core";
import { describe, expect, it } from "vitest";
import { buildCaptionPages } from "../src/captions-model";
import { FPS } from "../src/layout";

const planWith = (overrides: {
  narration?: string;
  captionEnabled?: boolean;
  wordTimestamps?: Array<{ word: string; startSec: number; endSec: number }>;
}): ScenePlan =>
  parseScenePlan({
    version: 2,
    projectId: "p",
    meta: { title: "T" },
    scenes: [
      {
        id: "sc-001",
        narration:
          overrides.narration ??
          "Dua juta balok batu andesit disusun tanpa semen sedikit pun",
        caption: { enabled: overrides.captionEnabled ?? true },
        clips: [{ id: "sc-001-k1", type: "solid" }],
        duration: 7,
      },
    ],
    renderState: overrides.wordTimestamps
      ? {
          narrationAudio: {
            "sc-001": {
              file: "audio/sc-001.mp3",
              durationSec: 5,
              wordTimestamps: overrides.wordTimestamps,
            },
          },
          clipAssets: {},
        }
      : undefined,
  });

const build = (plan: ScenePlan, sceneDurationFrames = 7 * FPS) =>
  buildCaptionPages({
    scene: plan.scenes[0]!,
    plan,
    sceneDurationFrames,
    fps: FPS,
  });

describe("buildCaptionPages", () => {
  it("returns nothing for disabled captions or empty narration", () => {
    expect(build(planWith({ captionEnabled: false }))).toEqual([]);
    expect(build(planWith({ narration: "   " }))).toEqual([]);
  });

  it("pages are sequential, non-overlapping, and inside the scene", () => {
    const pages = build(planWith({}));
    expect(pages.length).toBeGreaterThan(1);
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      expect(page.durationInFrames).toBeGreaterThan(0);
      expect(page.startFrame + page.durationInFrames).toBeLessThanOrEqual(7 * FPS);
      if (i > 0) {
        const prev = pages[i - 1]!;
        expect(page.startFrame).toBeGreaterThanOrEqual(
          prev.startFrame + prev.durationInFrames,
        );
      }
    }
  });

  it("estimated captions start after the narration lead-in", () => {
    const pages = build(planWith({}));
    expect(pages[0]!.startFrame).toBe(Math.round(NARRATION_LEAD_IN_SEC * FPS));
  });

  it("real TTS timestamps (audio-relative) get the same lead-in offset", () => {
    const pages = build(
      planWith({
        narration: "Halo dunia",
        wordTimestamps: [
          { word: "Halo", startSec: 0, endSec: 0.4 },
          { word: "dunia", startSec: 0.4, endSec: 0.9 },
        ],
      }),
    );
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.startMs).toBeCloseTo(NARRATION_LEAD_IN_SEC * 1000, 3);
    expect(page.tokens[0]!.fromMs).toBeCloseTo(NARRATION_LEAD_IN_SEC * 1000, 3);
    expect(page.tokens[1]!.toMs).toBeCloseTo(900 + NARRATION_LEAD_IN_SEC * 1000, 3);
    // Token text keeps the leading-space convention for whiteSpace: pre-wrap.
    expect(page.tokens.map((token) => token.text).join("")).toBe("Halo dunia");
  });

  it("every narration word survives pagination, in order", () => {
    const narration =
      "Sembilan tingkatnya melambangkan perjalanan menuju pencerahan dihiasi panel relief dan arca Buddha";
    const pages = build(planWith({ narration }));
    const words = pages
      .flatMap((page) => page.tokens.map((token) => token.text.trim()))
      .filter(Boolean);
    expect(words).toEqual(narration.split(/\s+/));
  });
});

describe("caption dari transkrip rekaman (ADR-0021)", () => {
  const withRecording = (
    overrides: {
      trimStartSec?: number;
      speed?: number;
      narration?: string;
      captionEnabled?: boolean;
    } = {},
  ): ScenePlan => {
    let plan = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        {
          id: "sc-1",
          narration: overrides.narration ?? "",
          caption: {
            enabled: overrides.captionEnabled ?? true,
            style: "klasik",
            size: "m",
            position: "bottom",
          },
          clips: [
            {
              id: "sc-1-k1",
              type: "stock",
              trimStartSec: overrides.trimStartSec ?? 0,
              speed: overrides.speed ?? 1,
            },
          ],
        },
      ],
    });
    plan = setClipAsset(plan, "sc-1-k1", {
      file: "media/talk.mp4",
      kind: "video",
      source: "local",
    });
    plan = setTranscript(plan, "media/talk.mp4", {
      source: "uji",
      language: "id",
      durationSec: 30,
      words: [
        { word: "Halo", startSec: 10, endSec: 10.4 },
        { word: "semua", startSec: 10.5, endSec: 11 },
        { word: "apa", startSec: 11.1, endSec: 11.4 },
        { word: "kabar", startSec: 11.5, endSec: 12 },
      ],
      segments: [],
    });
    return plan;
  };

  const words = (plan: ScenePlan, frames = 90) =>
    buildCaptionPages({
      scene: plan.scenes[0] as Scene,
      plan,
      sceneDurationFrames: frames,
      fps: 30,
    }).flatMap((page) => page.tokens.map((token) => token.text.trim()));

  it("scene tanpa narasi tapi punya rekaman TETAP dapat caption", () => {
    // Sebelum ADR-0021 ini mengembalikan nol halaman: caption hanya lahir dari
    // teks narasi, jadi footage orang bicara selalu tanpa teks.
    const plan = withRecording({ trimStartSec: 10 });
    expect(words(plan)).toEqual(["Halo", "semua", "apa", "kabar"]);
  });

  it("mengambil hanya kata di dalam potongan scene", () => {
    // Scene 1 detik dari detik 10: hanya dua kata pertama yang terdengar.
    const plan = withRecording({ trimStartSec: 10 });
    expect(words(plan, 30)).toEqual(["Halo", "semua"]);
  });

  it("caption rekaman TIDAK digeser jeda pembuka narasi", () => {
    // Rekaman sudah berbunyi sejak frame pertama; memberinya geseran narasi
    // membuat teks tertinggal dari bibir orangnya.
    const plan = withRecording({ trimStartSec: 10 });
    const pages = buildCaptionPages({
      scene: plan.scenes[0] as Scene,
      plan,
      sceneDurationFrames: 90,
      fps: 30,
    });
    expect(pages[0]?.startMs).toBe(0);
  });

  it("narasi tulis tetap menang atas transkrip", () => {
    const plan = withRecording({ narration: "Teks narasi menang", trimStartSec: 10 });
    expect(words(plan).join(" ")).toContain("narasi");
  });

  it("caption dimatikan tetap dihormati", () => {
    expect(words(withRecording({ captionEnabled: false }))).toEqual([]);
  });

  it("scene tanpa narasi DAN tanpa transkrip menghasilkan nol halaman", () => {
    const plan = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [{ id: "sc-1", narration: "", clips: [{ id: "sc-1-k1", type: "solid" }] }],
    });
    expect(
      buildCaptionPages({
        scene: plan.scenes[0] as Scene,
        plan,
        sceneDurationFrames: 90,
        fps: 30,
      }),
    ).toEqual([]);
  });
});

/**
 * Caption untuk scene BERKLIP BANYAK (ADR-0033).
 *
 * Sebelum ini `captionWords` membaca titik masuk klip pertama lalu menarik kata
 * sepanjang durasi scene — mengandaikan scene itu satu rentang utuh di rekaman.
 * Wawancara yang dibelah jadi beberapa potongan justru menampilkan rentang yang
 * TERPISAH, jadi captionnya benar hanya untuk potongan pertama dan memuat
 * kata-kata yang tadi sengaja dibuang. Cacat itu mendarat di video jadi.
 */
describe("buildCaptionPages · potongan di dalam satu scene", () => {
  const KATA = [
    { word: "Halo", startSec: 10, endSec: 10.4 },
    { word: "semua", startSec: 10.5, endSec: 11 },
    // Rentang yang DIBUANG editor — tidak boleh muncul di caption.
    { word: "anu", startSec: 11.1, endSec: 11.4 },
    { word: "gimana", startSec: 11.5, endSec: 12 },
    { word: "Sampai", startSec: 20, endSec: 20.4 },
    { word: "jumpa", startSec: 20.5, endSec: 21 },
  ];

  /** Satu rekaman, dua potongan dari dua rentang yang berjauhan. */
  const duaPotongan = (kedua = { file: "media/talk.mp4", trimStartSec: 20 }) => {
    let plan = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        {
          id: "sc-1",
          narration: "",
          duration: "auto",
          caption: { enabled: true, style: "klasik", size: "m", position: "bottom" },
          clips: [
            { id: "k1", type: "stock", trimStartSec: 10, durationSec: 1 },
            { id: "k2", type: "stock", trimStartSec: kedua.trimStartSec, durationSec: 1 },
          ],
        },
      ],
    });
    plan = setClipAsset(plan, "k1", {
      file: "media/talk.mp4",
      kind: "video",
      source: "local",
    });
    plan = setClipAsset(plan, "k2", { file: kedua.file, kind: "video", source: "local" });
    plan = setTranscript(plan, "media/talk.mp4", {
      source: "uji",
      language: "id",
      durationSec: 30,
      words: KATA,
      segments: [],
    });
    return plan;
  };

  const pages = (plan: ScenePlan) =>
    buildCaptionPages({
      scene: plan.scenes[0] as Scene,
      plan,
      sceneDurationFrames: 60,
      fps: 30,
    });
  const kataDari = (plan: ScenePlan) =>
    pages(plan).flatMap((page) => page.tokens.map((token) => token.text.trim()));

  it("tiap potongan menyumbang kata dari rentangnya SENDIRI", () => {
    // Perilaku lama menarik [10, 12] utuh: "Halo semua anu gimana" — benar
    // untuk potongan pertama, salah untuk yang kedua, dan memuat justru yang
    // dibuang.
    expect(kataDari(duaPotongan())).toEqual(["Halo", "semua", "Sampai", "jumpa"]);
  });

  it("kata potongan kedua berbunyi di paruh kedua scene, bukan di awal", () => {
    // Diperiksa pada TOKEN, bukan pada halaman: penggabungan halaman memang
    // menyatukan kata yang berdekatan, jadi startMs halaman tidak mengatakan
    // apa pun tentang kapan sebuah kata muncul. Geserannya sendiri diambil
    // dari petak `clipFrameSpans` — fungsi yang sama yang memutuskan potongan
    // mana yang tampil di bingkai mana.
    const token = pages(duaPotongan())
      .flatMap((page) => page.tokens)
      .find((item) => item.text.trim() === "Sampai");
    // Potongan pertama 1 detik, jadi kata potongan kedua tidak boleh mulai
    // sebelum detik ke-1. Perilaku lama menaruhnya di 0 ms (atau tidak
    // menampilkannya sama sekali).
    expect(token?.fromMs).toBeGreaterThanOrEqual(1000);
    expect(token?.toMs).toBeLessThanOrEqual(2000);
  });

  it("potongan tanpa transkrip dilewati, bukan menghapus caption potongan lain", () => {
    // Potongan kedua menunjuk rekaman yang belum ditranskrip sama sekali.
    expect(kataDari(duaPotongan({ file: "media/lain.mp4", trimStartSec: 3 }))).toEqual([
      "Halo",
      "semua",
    ]);
  });
});
