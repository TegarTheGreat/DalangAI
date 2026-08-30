import { parseScenePlan } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { computeFrameLayout } from "../src/layout";
import { buildMusicVolume, resolveMusicFile } from "../src/music";

const planWithMusic = (opts?: { ducking?: boolean }) =>
  parseScenePlan({
    version: 1,
    projectId: "uji-musik",
    meta: { title: "Uji Musik" },
    audio: {
      music: {
        assetId: "pustaka:tenang",
        volume: 0.2,
        ducking: opts?.ducking ?? true,
      },
    },
    scenes: [
      { id: "sc-1", narration: "", visual: { type: "solid" }, duration: 4 },
      {
        id: "sc-2",
        narration: "Ada narasi di sini.",
        visual: { type: "solid" },
        duration: 6,
      },
      { id: "sc-3", narration: "", visual: { type: "solid" }, duration: 4 },
    ],
    renderState: {
      narrationAudio: {
        "sc-2": { file: "audio/sc-2.wav", durationSec: 6 },
      },
      resolvedAssets: {},
    },
  });

describe("resolveMusicFile", () => {
  it("pustaka dikenal -> file bundle; tidak dikenal -> null; path proyek apa adanya", () => {
    // ADR-0019: `bundled` membedakan aset SITUS (ikut bundle komposisi) dari
    // aset PLAN (milik proyek) — keduanya dialamatkan berbeda di render cloud.
    expect(resolveMusicFile("pustaka:tenang")).toEqual({
      file: "music/tenang.wav",
      bundled: true,
    });
    expect(resolveMusicFile("pustaka:cerah")).toEqual({
      file: "music/cerah.wav",
      bundled: true,
    });
    expect(resolveMusicFile("pustaka:tidak-ada")).toBeNull();
    expect(resolveMusicFile("assets/lagu.mp3")).toEqual({
      file: "assets/lagu.mp3",
      bundled: false,
    });
  });
});

describe("buildMusicVolume", () => {
  it("fade-in dari 0, stabil di volume dasar, fade-out ke 0", () => {
    const plan = planWithMusic({ ducking: false });
    const layout = computeFrameLayout(plan);
    const vol = buildMusicVolume(plan, layout);
    expect(vol(0)).toBe(0);
    expect(vol(15)).toBeGreaterThan(0);
    expect(vol(15)).toBeLessThan(0.2);
    expect(vol(60)).toBeCloseTo(0.2, 5);
    expect(vol(layout.totalFrames)).toBeCloseTo(0, 5);
  });

  it("duck di scene bernarasi (~35% volume), penuh di scene hening", () => {
    const plan = planWithMusic();
    const layout = computeFrameLayout(plan);
    const vol = buildMusicVolume(plan, layout);
    const midSilent = Math.round(
      (layout.sceneStarts[0] ?? 0) + (layout.sceneFrames[0] ?? 0) / 2,
    );
    const midNarrated = Math.round(
      (layout.sceneStarts[1] ?? 0) + (layout.sceneFrames[1] ?? 0) / 2,
    );
    expect(vol(midSilent)).toBeCloseTo(0.2, 3);
    expect(vol(midNarrated)).toBeCloseTo(0.2 * 0.35, 3);
  });

  it("tanpa audio narasi di renderState tidak ada duck (belum ada suara nyata)", () => {
    const plan = planWithMusic();
    plan.renderState.narrationAudio = {};
    const layout = computeFrameLayout(plan);
    const vol = buildMusicVolume(plan, layout);
    const midNarrated = Math.round(
      (layout.sceneStarts[1] ?? 0) + (layout.sceneFrames[1] ?? 0) / 2,
    );
    expect(vol(midNarrated)).toBeCloseTo(0.2, 3);
  });

  it("ramp duck mulus: tidak ada lompatan antar frame > 0.02", () => {
    const plan = planWithMusic();
    const layout = computeFrameLayout(plan);
    const vol = buildMusicVolume(plan, layout);
    for (let f = 1; f < layout.totalFrames; f++) {
      expect(Math.abs(vol(f) - vol(f - 1))).toBeLessThanOrEqual(0.02);
    }
  });

  it("plan tanpa musik -> selalu 0", () => {
    const plan = planWithMusic();
    plan.audio.music = undefined;
    const layout = computeFrameLayout(plan);
    expect(buildMusicVolume(plan, layout)(40)).toBe(0);
  });
});
