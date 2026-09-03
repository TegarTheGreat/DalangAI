import { describe, expect, it } from "vitest";
import {
  computeTimeline,
  countSyllables,
  countWords,
  estimateNarrationSeconds,
  estimateWordTimestamps,
  MIN_SCENE_SEC,
  NARRATION_LEAD_IN_SEC,
  narrationWindowSec,
  resolveSceneDurationSec,
  SCENE_PADDING_SEC,
  SILENT_SCENE_SEC,
  SYLLABLES_PER_SECOND,
} from "../src/index";
import { makePlan } from "./fixtures";

describe("duration resolution (deterministic)", () => {
  it("fixed numeric durations pass through", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.duration = 7.5;
    });
    expect(resolveSceneDurationSec(plan.scenes[0]!, plan)).toBe(7.5);
  });

  it("auto uses TTS audio duration when available", () => {
    const plan = makePlan((input) => {
      input.renderState = {
        narrationAudio: {
          "sc-001": { file: "audio/sc-001.mp3", durationSec: 6 },
        },
        clipAssets: {},
      };
    });
    expect(resolveSceneDurationSec(plan.scenes[0]!, plan)).toBe(
      NARRATION_LEAD_IN_SEC + 6 + SCENE_PADDING_SEC,
    );
  });

  // ADR-0017: estimasi pindah dari jumlah KATA ke jumlah SUKU KATA, karena
  // panjang kata Bahasa Indonesia sangat bervariasi lewat afiksasi.
  it("auto estimates from syllable count before TTS exists", () => {
    const plan = makePlan();
    const scene = plan.scenes[0]!;
    const estimated = estimateNarrationSeconds(scene.narration);
    expect(estimated).toBeCloseTo(
      countSyllables(scene.narration) / SYLLABLES_PER_SECOND,
      5,
    );
    expect(resolveSceneDurationSec(scene, plan)).toBeCloseTo(
      Math.max(MIN_SCENE_SEC, NARRATION_LEAD_IN_SEC + estimated + SCENE_PADDING_SEC),
      5,
    );
  });

  it("narasi berafiks berat diberi waktu lebih daripada narasi berkata pendek", () => {
    // Jumlah KATA sama persis (6); jumlah suku kata jauh berbeda. Estimasi
    // lama memberi durasi identik — itulah yang diperbaiki ADR-0017.
    const pendek = "Ia tahu ada dua hal.";
    const panjang =
      "Pertanggungjawaban keberlanjutan memerlukan pengawasan berkesinambungan.";
    expect(countWords(pendek)).toBe(countWords(panjang));
    expect(estimateNarrationSeconds(panjang)).toBeGreaterThan(
      estimateNarrationSeconds(pendek) * 1.8,
    );
  });

  it("angka dihitung sebagai kata terucap, bukan diabaikan", () => {
    // "2024" dibacakan "dua ribu dua puluh empat" — 8 suku kata.
    expect(countSyllables("2024")).toBe(8);
    expect(estimateNarrationSeconds("Tahun 2024.")).toBeGreaterThan(
      estimateNarrationSeconds("Tahun."),
    );
  });

  it("clamps very short narrations to the minimum scene duration", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.narration = "Ya.";
    });
    expect(resolveSceneDurationSec(plan.scenes[0]!, plan)).toBe(MIN_SCENE_SEC);
  });

  it("narration-less scenes get the silent default", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.narration = "";
    });
    expect(resolveSceneDurationSec(plan.scenes[0]!, plan)).toBe(SILENT_SCENE_SEC);
  });

  it("voice speed shortens the estimate", () => {
    const plan = makePlan((input) => {
      input.audio = {
        voice: { provider: "elevenlabs", voiceId: "v", speed: 1.2 },
      };
    });
    const scene = plan.scenes[0]!;
    const expected =
      NARRATION_LEAD_IN_SEC +
      estimateNarrationSeconds(scene.narration, 1.2) +
      SCENE_PADDING_SEC;
    expect(resolveSceneDurationSec(scene, plan)).toBeCloseTo(
      Math.max(MIN_SCENE_SEC, expected),
      5,
    );
  });

  it("computeTimeline lays scenes out sequentially", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.duration = 3;
      input.scenes[1]!.duration = 4;
      input.scenes[2]!.duration = 5;
    });
    const { timings, totalSec } = computeTimeline(plan);
    expect(totalSec).toBe(12);
    expect(timings.map((timing) => timing.startSec)).toEqual([0, 3, 7]);
  });
});

describe("estimateWordTimestamps (audio-relative contract)", () => {
  it("returns empty for empty narration", () => {
    expect(estimateWordTimestamps("", 5)).toEqual([]);
  });

  it("starts at 0 and covers the available window monotonically", () => {
    const words = estimateWordTimestamps(
      "Borobudur dibangun pada abad ke-9 oleh dinasti Syailendra",
      6,
    );
    expect(words[0]?.startSec).toBe(0);
    expect(words.at(-1)?.endSec).toBeCloseTo(6, 3);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.startSec).toBeGreaterThanOrEqual(words[i - 1]!.endSec - 1e-9);
    }
    // Longer words get more time.
    const borobudur = words.find((w) => w.word === "Borobudur")!;
    const pada = words.find((w) => w.word === "pada")!;
    expect(borobudur.endSec - borobudur.startSec).toBeGreaterThan(
      pada.endSec - pada.startSec,
    );
  });

  it("clamps degenerate windows to a sane minimum", () => {
    const words = estimateWordTimestamps("Satu dua", 0.1);
    expect(words.at(-1)?.endSec).toBeCloseTo(0.5, 3);
  });

  it("narrationWindowSec removes lead-in and half the padding", () => {
    expect(narrationWindowSec(6)).toBeCloseTo(
      6 - NARRATION_LEAD_IN_SEC - SCENE_PADDING_SEC * 0.5,
      6,
    );
    expect(narrationWindowSec(0.2)).toBe(0.5); // floor
  });
});
