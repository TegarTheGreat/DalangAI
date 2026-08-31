import type { ScenePlanInput } from "@dalang/core";
import { computeFrameLayout, FPS } from "@dalang/templates/layout";
import { describe, expect, it } from "vitest";
import { buildEditTimeline, type EditClip } from "../src/timeline";
import { makePlan, tempProject } from "./helpers";

/**
 * ADR-0026: trek audio tambahan di jalur ekspor.
 *
 * Harapannya dihitung dari PLAN dan `computeFrameLayout`, tidak sekali pun
 * dibaca dari `buildEditTimeline`. Pelajaran §9.2: gate yang mengambil
 * harapannya dari modul yang diujinya sendiri akan tetap hijau saat modul itu
 * berhenti mengekspor apa pun.
 */

const trackLane = (plan: ReturnType<typeof makePlan>) => {
  const project = tempProject(plan);
  const timeline = buildEditTimeline(plan, { planPath: project.planPath });
  return {
    timeline,
    clips: timeline.tracks
      .filter((track) => track.name.startsWith("Trek"))
      .flatMap((track) => track.items)
      .filter((item): item is EditClip => item.kind === "clip"),
  };
};

const withTracks = (mutate?: (input: ScenePlanInput) => void) =>
  makePlan((input) => {
    input.audio = {
      ...input.audio,
      tracks: [
        {
          id: "trek-ambience",
          assetId: "assets/ambience.wav",
          sceneId: "sc-batu",
          atSec: 1.5,
          loop: false,
          audio: {
            volume: 0.4,
            fadeInSec: 1,
            fadeOutSec: 2,
            ducking: true,
            normalize: true,
          },
        },
      ],
    };
    input.renderState = {
      ...input.renderState,
      trackAssets: {
        "trek-ambience": {
          file: "assets/ambience.wav",
          kind: "audio",
          source: "unggahan",
          durationSec: 8,
        },
      },
    } as ScenePlanInput["renderState"];
    mutate?.(input);
  });

describe("ekspor trek audio", () => {
  it("trek tertambat mendarat di awal scene-nya plus atSec", () => {
    const plan = withTracks();
    const layout = computeFrameLayout(plan);
    const sceneIndex = plan.scenes.findIndex((scene) => scene.id === "sc-batu");
    // Dihitung dari plan, bukan dari hasil ekspor.
    const expected = (layout.sceneStarts[sceneIndex] ?? 0) + Math.round(1.5 * FPS);

    const { clips } = trackLane(plan);
    expect(clips).toHaveLength(1);
    expect(clips[0]?.startFrame).toBe(expected);
    expect(clips[0]?.durationFrames).toBe(Math.round(8 * FPS));
    expect(clips[0]?.name).toBe("trek-ambience");
  });

  /**
   * Trek TIDAK tertambat hidup di waktu video, bukan waktu scene. Kalau
   * keduanya diperlakukan sama, ambience yang dimaksudkan menutupi seluruh
   * video akan bergeser setiap kali scene pertama dipanjangkan.
   */
  it("trek tanpa tambatan diukur dari awal video", () => {
    const plan = withTracks((input) => {
      const track = input.audio?.tracks?.[0];
      if (track) {
        track.sceneId = null;
        track.atSec = 2;
      }
    });
    const { clips } = trackLane(plan);
    expect(clips[0]?.startFrame).toBe(Math.round(2 * FPS));
  });

  /**
   * Trek tanpa panjang tercatat DILEWATI, dan laporannya mengatakan begitu.
   * Klip NLE wajib punya panjang; mengarang satu berarti mengekspor kebohongan
   * yang terlihat sah di editor tujuan.
   */
  it("trek tanpa panjang dilewati dan dilaporkan, bukan dikarang panjangnya", () => {
    const plan = withTracks((input) => {
      const assets = (input.renderState as { trackAssets: Record<string, unknown> })
        .trackAssets;
      assets["trek-ambience"] = {
        file: "assets/ambience.wav",
        kind: "audio",
        source: "unggahan",
      };
    });
    const { clips, timeline } = trackLane(plan);
    expect(clips).toHaveLength(0);
    expect(timeline.notes.map((note) => note.code)).toContain("trek-tanpa-durasi");
  });

  it("trek yang berkasnya belum tercatat tidak jadi klip menunjuk berkas hantu", () => {
    const plan = withTracks((input) => {
      (input.renderState as { trackAssets: Record<string, unknown> }).trackAssets = {};
    });
    expect(trackLane(plan).clips).toHaveLength(0);
  });

  /**
   * Kejujuran ekspor: amplop audio (volume, fade, ducking, normalisasi) adalah
   * otomatisasi milik render Dalang, BUKAN properti klip yang bisa dibawa OTIO
   * maupun FCPXML. Diam soal itu berarti orang membuka hasil ekspor, mendengar
   * semuanya berbunyi rata, dan mengira ekspornya rusak.
   */
  it("laporan mengaku amplop audio tidak ikut", () => {
    const { timeline } = trackLane(withTracks());
    const codes = timeline.notes.map((note) => note.code);
    expect(codes).toContain("trek-amplop");
    const detail = timeline.notes.find((note) => note.code === "trek-amplop")?.detail;
    for (const kata of ["volume", "fade", "ducking", "normalisasi"]) {
      expect(detail).toContain(kata);
    }
  });

  it("klip bersuara juga diakui kehilangan amplopnya", () => {
    const plan = makePlan((input) => {
      const scene = input.scenes.find((item) => item.id === "sc-batu");
      if (scene) scene.visual = { ...scene.visual, audio: { volume: 0.5 } };
    });
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    expect(timeline.notes.map((note) => note.code)).toContain("audio-klip-amplop");
  });

  it("trek tidak mengganggu jalur video mana pun", () => {
    // Trek audio adalah lajur BARU; kalau ia mendarat di lajur video, satu klip
    // gambar akan tertimpa berkas suara dan hasil ekspor jadi rusak diam-diam.
    const tanpa = trackLane(makePlan());
    const dengan = trackLane(withTracks());
    const videoOf = (timeline: { tracks: { kind: string; items: unknown[] }[] }) =>
      timeline.tracks
        .filter((track) => track.kind === "video")
        .map((t) => t.items.length);
    expect(videoOf(dengan.timeline)).toEqual(videoOf(tanpa.timeline));
    expect(dengan.timeline.totalFrames).toBe(tanpa.timeline.totalFrames);
  });
});
