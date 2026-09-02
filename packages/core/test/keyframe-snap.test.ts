import type { KeyframeTrack } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { KEYFRAME_SNAP, snapKeyframeTime } from "../src";

/** Penempelan berlian ke keyframe track lain (batas ADR-0027 dicabut). */
const tracks: KeyframeTrack[] = [
  {
    property: "opacity",
    points: [
      { at: 0.5, value: 0.3, easing: "settle" },
      { at: 0.69, value: 1, easing: "settle" },
    ],
  },
  {
    property: "offsetX",
    points: [
      { at: 0.1, value: 0, easing: "settle" },
      { at: 0.6, value: 0.2, easing: "settle" },
    ],
  },
];

describe("snapKeyframeTime", () => {
  it("menempel ke keyframe track lain di dalam ambang, dan memberi tahu ke mana", () => {
    expect(snapKeyframeTime(tracks, "opacity", 0.69, 0.615)).toEqual({
      at: 0.6,
      snappedTo: { property: "offsetX", at: 0.6 },
    });
    expect(snapKeyframeTime(tracks, "opacity", 0.69, 0.6 + KEYFRAME_SNAP)).toEqual({
      at: 0.6,
      snappedTo: { property: "offsetX", at: 0.6 },
    });
  });

  it("di luar ambang tidak menempel; titik track sendiri bukan sasaran", () => {
    expect(snapKeyframeTime(tracks, "opacity", 0.69, 0.64)).toEqual({
      at: 0.64,
      snappedTo: null,
    });
    // 0.5 adalah titik opacity sendiri, bukan milik track lain.
    expect(snapKeyframeTime(tracks, "opacity", 0.69, 0.505)).toEqual({
      at: 0.505,
      snappedTo: null,
    });
  });

  it("kandidat yang bertabrakan dengan titik track sendiri dilewati; yang terdekat menang", () => {
    const crowded: KeyframeTrack[] = [
      {
        property: "opacity",
        points: [
          { at: 0.6, value: 0.3, easing: "settle" },
          { at: 0.9, value: 1, easing: "settle" },
        ],
      },
      {
        property: "offsetX",
        points: [
          { at: 0.6, value: 0, easing: "settle" },
          { at: 0.62, value: 0.2, easing: "settle" },
        ],
      },
      {
        property: "offsetY",
        points: [
          { at: 0.58, value: 0, easing: "settle" },
          { at: 0.95, value: 0.1, easing: "settle" },
        ],
      },
    ];
    // Menggeser titik 0.9 ke 0.605: offsetX@0.6 bertabrakan dengan opacity@0.6
    // (dilewati); offsetY@0.58 berjarak 0.025 (di luar); offsetX@0.62 menang.
    expect(snapKeyframeTime(crowded, "opacity", 0.9, 0.605)).toEqual({
      at: 0.62,
      snappedTo: { property: "offsetX", at: 0.62 },
    });
    // Menggeser titik 0.6 sendiri ke 0.601: offsetX@0.6 boleh — yang di 0.6
    // adalah titik yang sedang digeser, bukan titik lain.
    expect(snapKeyframeTime(crowded, "opacity", 0.6, 0.601).at).toBe(0.6);
  });
});
