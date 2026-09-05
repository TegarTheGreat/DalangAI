import { parseScenePlan } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { computeFrameLayout, FPS } from "../src/layout";
import { buildMusicVolume, resolveMusicFile } from "../src/music";

const planWithMusic = (opts?: { ducking?: boolean }) =>
  parseScenePlan({
    version: 2,
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
      {
        id: "sc-1",
        narration: "",
        clips: [{ id: "sc-1-k1", type: "solid" }],
        duration: 4,
      },
      {
        id: "sc-2",
        narration: "Ada narasi di sini.",
        clips: [{ id: "sc-2-k1", type: "solid" }],
        duration: 6,
      },
      {
        id: "sc-3",
        narration: "",
        clips: [{ id: "sc-3-k1", type: "solid" }],
        duration: 4,
      },
    ],
    renderState: {
      narrationAudio: {
        "sc-2": { file: "audio/sc-2.wav", durationSec: 6 },
      },
      clipAssets: {},
    },
  });

describe("resolveMusicFile", () => {
  it("pustaka dikenal -> file bundle; tidak dikenal -> null; path proyek apa adanya", () => {
    // ADR-0019: `bundled` membedakan aset SITUS (ikut bundle komposisi) dari
    // aset PLAN (milik proyek) — keduanya dialamatkan berbeda di render cloud.
    // `lufs` ikut (ADR-0026): bed pustaka membawa hasil ukurnya sendiri, jadi
    // ia tidak perlu melewati tahap ukur sama sekali.
    // `channels` ikut (ADR-0026): bed pustaka MONO, dan di campuran stereo ia
    // terdengar 3,01 LU lebih keras daripada angka ukurnya. Tanpa keterangan
    // ini setiap bed dinormalisasi 3 dB terlalu keras.
    expect(resolveMusicFile("pustaka:tenang")).toEqual({
      file: "music/tenang.wav",
      bundled: true,
      lufs: -18.71,
      channels: 1,
    });
    expect(resolveMusicFile("pustaka:cerah")).toEqual({
      lufs: -18.55,
      file: "music/cerah.wav",
      bundled: true,
      channels: 1,
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
    const vol = buildMusicVolume(plan, layout, FPS);
    expect(vol(0)).toBe(0);
    expect(vol(15)).toBeGreaterThan(0);
    expect(vol(15)).toBeLessThan(0.2);
    expect(vol(60)).toBeCloseTo(0.2, 5);
    expect(vol(layout.totalFrames)).toBeCloseTo(0, 5);
  });

  it("duck di scene bernarasi (~35% volume), penuh di scene hening", () => {
    const plan = planWithMusic();
    const layout = computeFrameLayout(plan);
    const vol = buildMusicVolume(plan, layout, FPS);
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
    const vol = buildMusicVolume(plan, layout, FPS);
    const midNarrated = Math.round(
      (layout.sceneStarts[1] ?? 0) + (layout.sceneFrames[1] ?? 0) / 2,
    );
    expect(vol(midNarrated)).toBeCloseTo(0.2, 3);
  });

  it("ramp duck mulus: tidak ada lompatan antar frame > 0.02", () => {
    const plan = planWithMusic();
    const layout = computeFrameLayout(plan);
    const vol = buildMusicVolume(plan, layout, FPS);
    for (let f = 1; f < layout.totalFrames; f++) {
      expect(Math.abs(vol(f) - vol(f - 1))).toBeLessThanOrEqual(0.02);
    }
  });

  it("plan tanpa musik -> selalu 0", () => {
    const plan = planWithMusic();
    plan.audio.music = undefined;
    const layout = computeFrameLayout(plan);
    expect(buildMusicVolume(plan, layout, FPS)(40)).toBe(0);
  });
});
