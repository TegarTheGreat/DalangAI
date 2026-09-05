import { parseScenePlan, type Scene, type ScenePlanInput } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { clipFrameSpans } from "../src/layout";

/**
 * Kuantisasi klip ke bingkai (ADR-0033).
 *
 * Yang diuji bukan "angkanya masuk akal" melainkan dua sifat yang kalau rusak
 * menghasilkan kedipan hitam yang tidak akan pernah dilacak kembali ke
 * pembulatan: petaknya menutup rapat, dan jumlahnya persis panjang scene.
 */

const sceneWith = (durations: number[], transitions: (number | null)[] = []): Scene => {
  const input: ScenePlanInput = {
    version: 2,
    projectId: "p",
    meta: { title: "T", aspectRatio: "16:9", language: "id", stylePreset: "documentary-01" },
    audio: {},
    scenes: [
      {
        id: "sc-1",
        narration: "",
        clips: durations.map((durationSec, index) => ({
          id: `k${index + 1}`,
          type: "stock" as const,
          durationSec,
          ...(transitions[index]
            ? {
                transition: {
                  type: "cross-fade" as const,
                  durationFrames: transitions[index] as number,
                },
              }
            : {}),
        })),
      },
    ],
  };
  return parseScenePlan(input).scenes[0] as Scene;
};

const rapat = (spans: { startFrame: number; frames: number }[], total: number) => {
  spans.forEach((span, index) => {
    const previous = spans[index - 1];
    expect(span.startFrame).toBe(previous ? previous.startFrame + previous.frames : 0);
    expect(span.frames).toBeGreaterThan(0);
  });
  const last = spans[spans.length - 1] as { startFrame: number; frames: number };
  expect(last.startFrame + last.frames).toBe(total);
};

describe("clipFrameSpans", () => {
  it("klip tunggal mengisi seluruh scene tanpa dihitung ulang", () => {
    expect(clipFrameSpans(sceneWith([9999]), 120)).toEqual([
      {
        id: "k1",
        index: 0,
        startFrame: 0,
        frames: 120,
        transitionFrames: 0,
        transitionType: null,
      },
    ]);
  });

  it("menutup rapat walau tiap durasi jatuh di tengah bingkai", () => {
    // 1.01 + 1.01 + 1.01 = 3.03 dtk; membulatkan satu per satu memberi 30+30+30
    // = 90 bingkai sementara scene-nya 91.
    const spans = clipFrameSpans(sceneWith([1.01, 1.01, 1.01]), 91);
    rapat(spans, 91);
    expect(spans.map((span) => span.frames)).toEqual([30, 31, 30]);
  });

  it("menskalakan proporsional saat scene dinaikkan ke lantai bingkai", () => {
    const spans = clipFrameSpans(sceneWith([0.3, 0.3]), 54);
    rapat(spans, 54);
    expect(spans.map((span) => span.frames)).toEqual([27, 27]);
  });

  it("menyisakan minimal satu bingkai per klip di batas terpadatnya", () => {
    // Sepadat yang mungkin terjadi: sebanyak klip, sebanyak bingkai. Lebih
    // padat dari ini mustahil — lantai `computeFrameLayout` 54 bingkai dan
    // MAX_CLIPS 24, jadi bingkainya selalu lebih banyak daripada klipnya.
    const spans = clipFrameSpans(sceneWith([1, 1, 1, 1]), 4);
    rapat(spans, 4);
    expect(spans.map((span) => span.frames)).toEqual([1, 1, 1, 1]);
  });

  it("membawa transisi klip dan menjepitnya ke petak yang ditumpanginya", () => {
    const spans = clipFrameSpans(sceneWith([2, 2], [15, null]), 120);
    expect(spans[0]?.transitionFrames).toBe(15);
    expect(spans[0]?.transitionType).toBe("cross-fade");
    // Transisi klip TERAKHIR diabaikan: batas itu milik scene.
    expect(spans[1]?.transitionFrames).toBe(0);

    const sempit = clipFrameSpans(sceneWith([0.2, 4], [24, null]), 42);
    expect(sempit[0]?.transitionFrames).toBe((sempit[0]?.frames ?? 0) - 1);
  });
});
