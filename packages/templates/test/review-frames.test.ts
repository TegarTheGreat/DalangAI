import { parseScenePlan, type ScenePlanInput } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { computeFrameLayout } from "../src/layout";
import { busiestFrac, pickReviewFrames, reviewPriority } from "../src/review-frames";

const text = (id: string, startFrac = 0, endFrac = 1) => ({
  id,
  content: `Teks ${id}`,
  startFrac,
  endFrac,
});

const graphic = (id: string, startFrac = 0, endFrac = 1) => ({
  id,
  ref: "iconify:mdi:star",
  startFrac,
  endFrac,
});

const planOf = (scenes: ScenePlanInput["scenes"]) =>
  parseScenePlan({
    version: 2,
    projectId: "p",
    meta: { title: "Uji" },
    scenes,
  });

describe("busiestFrac", () => {
  it("memilih momen saat paling banyak overlay tampil bersamaan", () => {
    // Teks A tampil 0–0,5; teks B 0,4–1; grafis 0,45–0,55. Tumpang tindih
    // ketiganya hanya di sekitar 0,45–0,5 — di situlah tabrakan terjadi.
    const plan = planOf([
      {
        id: "sc-1",
        clips: [{ id: "sc-1-k1", type: "solid" }],
        texts: [text("a", 0, 0.5), text("b", 0.4, 1)],
        graphics: [graphic("g", 0.45, 0.55)],
      },
    ]);
    const frac = busiestFrac(plan.scenes[0]!);
    expect(frac).toBeGreaterThanOrEqual(0.45);
    expect(frac).toBeLessThanOrEqual(0.5);
  });

  it("scene tanpa overlay memakai tengah — gerak kamera sudah settle di sana", () => {
    const plan = planOf([{ id: "sc-1", clips: [{ id: "sc-1-k1", type: "solid" }] }]);
    expect(busiestFrac(plan.scenes[0]!)).toBe(0.5);
  });

  it("seri dimenangkan yang paling dekat ke tengah", () => {
    // Satu teks sepanjang scene: semua fraksi berskor sama, jadi 0,5 menang.
    const plan = planOf([
      { id: "sc-1", clips: [{ id: "sc-1-k1", type: "solid" }], texts: [text("a", 0, 1)] },
    ]);
    expect(busiestFrac(plan.scenes[0]!)).toBe(0.5);
  });

  it("overlay yang hanya tampil di akhir menggeser pilihan ke akhir", () => {
    const plan = planOf([
      {
        id: "sc-1",
        clips: [{ id: "sc-1-k1", type: "solid" }],
        texts: [text("a", 0.8, 1), text("b", 0.85, 1)],
      },
    ]);
    expect(busiestFrac(plan.scenes[0]!)).toBeGreaterThanOrEqual(0.85);
  });
});

describe("reviewPriority", () => {
  it("scene pembuka selalu paling tinggi, apa pun isinya", () => {
    const plan = planOf([
      { id: "sc-1", clips: [{ id: "sc-1-k1", type: "solid" }] },
      {
        id: "sc-2",
        clips: [{ id: "sc-2-k1", type: "solid" }],
        texts: [text("a"), text("b"), text("c")],
      },
      { id: "sc-3", clips: [{ id: "sc-3-k1", type: "solid" }] },
    ]);
    const pembuka = reviewPriority(plan.scenes[0]!, 0, 3);
    const ramai = reviewPriority(plan.scenes[1]!, 1, 3);
    expect(pembuka.score).toBeGreaterThan(ramai.score);
    expect(pembuka.reason).toMatch(/pembuka/);
  });

  it("scene tengah diperingkat oleh banyaknya elemen yang bisa bertabrakan", () => {
    const plan = planOf([
      { id: "sc-1", clips: [{ id: "sc-1-k1", type: "solid" }] },
      { id: "sc-2", clips: [{ id: "sc-2-k1", type: "solid" }], texts: [text("a")] },
      {
        id: "sc-3",
        clips: [{ id: "sc-3-k1", type: "solid" }],
        texts: [text("a"), text("b")],
        graphics: [graphic("g")],
      },
      { id: "sc-4", clips: [{ id: "sc-4-k1", type: "solid" }] },
    ]);
    expect(reviewPriority(plan.scenes[2]!, 2, 4).score).toBeGreaterThan(
      reviewPriority(plan.scenes[1]!, 1, 4).score,
    );
    expect(reviewPriority(plan.scenes[2]!, 2, 4).reason).toMatch(/2 teks \+ 1 grafis/);
  });

  it("scene tunggal dihitung sebagai pembuka, bukan penutup", () => {
    const plan = planOf([{ id: "sc-1", clips: [{ id: "sc-1-k1", type: "solid" }] }]);
    expect(reviewPriority(plan.scenes[0]!, 0, 1).reason).toMatch(/pembuka/);
  });
});

describe("pickReviewFrames", () => {
  const manyScenes = () =>
    planOf(
      Array.from({ length: 10 }, (_, i) => ({
        id: `sc-${i + 1}`,
        narration: "Kalimat narasi untuk mengisi durasi scene ini.",
        clips: [{ id: `sc-${i + 1}-k1`, type: "solid" as const }],
        ...(i === 4 ? { texts: [text("a"), text("b")] } : {}),
      })),
    );

  it("menghormati batas jumlah frame", () => {
    expect(pickReviewFrames(manyScenes(), { max: 3 })).toHaveLength(3);
  });

  it("mengembalikan frame urut waktu walau peringkatnya tidak", () => {
    const frames = pickReviewFrames(manyScenes(), { max: 4 });
    const nomor = frames.map((f) => f.frame);
    expect([...nomor].sort((a, b) => a - b)).toEqual(nomor);
  });

  it("selalu memuat scene pembuka", () => {
    const frames = pickReviewFrames(manyScenes(), { max: 2 });
    expect(frames[0]?.sceneId).toBe("sc-1");
    expect(frames[0]?.reason).toMatch(/pembuka/);
  });

  it("mendahulukan scene beroverlay atas scene kosong", () => {
    const frames = pickReviewFrames(manyScenes(), { max: 3 });
    expect(frames.map((f) => f.sceneId)).toContain("sc-5");
  });

  it("frame selalu jatuh DI DALAM scene-nya sendiri", () => {
    // Kalau meleset ke frame tetangga, temuannya akan menuding scene yang
    // salah — dan itu jenis kesalahan yang sangat sulit dilacak balik.
    const plan = manyScenes();
    const layout = computeFrameLayout(plan);
    for (const item of pickReviewFrames(plan, { max: 10 })) {
      const index = plan.scenes.findIndex((scene) => scene.id === item.sceneId);
      const start = layout.sceneStarts[index] ?? 0;
      const length = layout.sceneFrames[index] ?? 0;
      expect(item.frame).toBeGreaterThanOrEqual(start);
      expect(item.frame).toBeLessThan(start + length);
    }
  });

  it("nomor scene 1-based supaya bisa disebut model dan dibaca manusia", () => {
    const frames = pickReviewFrames(manyScenes(), { max: 10 });
    expect(frames[0]?.sceneNumber).toBe(1);
    expect(frames.at(-1)?.sceneNumber).toBe(10);
  });

  it("max nol tetap mengembalikan satu frame, bukan kosong", () => {
    // Tinjauan tanpa satu pun frame adalah tinjauan yang berbohong: ia akan
    // melapor "tidak ada masalah" tanpa pernah melihat apa pun.
    expect(pickReviewFrames(manyScenes(), { max: 0 })).toHaveLength(1);
  });
});
