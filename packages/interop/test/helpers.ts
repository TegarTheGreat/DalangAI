import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScenePlan, type ScenePlan, type ScenePlanInput } from "@dalang/core";

/**
 * Plan uji: 3 scene, satu di antaranya template-anim tanpa aset (judul), satu
 * video ber-trim, satu gambar. Sengaja bercampur — jalur ekspor punya cabang
 * berbeda untuk masing-masing, dan plan yang seragam hanya menguji satu.
 */
export const planInput = (): ScenePlanInput => ({
  version: 2,
  projectId: "uji-interop",
  meta: {
    title: "Uji Interop",
    aspectRatio: "16:9",
    language: "id",
    stylePreset: "documentary-01",
  },
  audio: {
    voice: { provider: "silence", voiceId: "uji", speed: 1 },
    music: { assetId: "pustaka:tenang", volume: 0.15, ducking: true },
    sfx: [
      {
        id: "sfx-1",
        assetId: "pustaka:pop",
        sceneId: "sc-batu",
        atSec: 0.5,
        volume: 0.6,
      },
    ],
  },
  scenes: [
    {
      id: "sc-judul",
      narration: "",
      duration: 3,
      clips: [{ id: "sc-judul-k1", type: "template-anim", variant: "title" }],
      transition: { type: "cross-fade", durationFrames: 15 },
    },
    {
      id: "sc-batu",
      narration: "Candi batu berdiri sejak dua belas abad silam.",
      duration: 6,
      clips: [
        {
          id: "sc-batu-k1",
          type: "stock",
          query: "temple",
          motion: "kenburns-in",
          trimStartSec: 4,
        },
      ],
      texts: [{ id: "t1", content: "Borobudur" }],
      transition: { type: "slide-left", durationFrames: 12 },
    },
    {
      id: "sc-peta",
      narration: "Letaknya di jantung Jawa.",
      duration: 4,
      clips: [{ id: "sc-peta-k1", type: "image" }],
      transition: { type: "none", durationFrames: 15 },
    },
  ],
  renderState: {
    narrationAudio: {
      "sc-batu": { file: "audio/sc-batu.wav", durationSec: 4.2 },
      "sc-peta": { file: "audio/sc-peta.wav", durationSec: 2.5 },
    },
    clipAssets: {
      "sc-batu-k1": {
        file: "media/candi.mp4",
        kind: "video",
        source: "pexels",
        durationSec: 30,
      },
      "sc-peta-k1": { file: "media/peta.jpg", kind: "image", source: "pexels" },
    },
    sfxAssets: {
      "sfx-1": {
        file: "media/pop.mp3",
        kind: "audio",
        source: "openverse",
        durationSec: 0.8,
      },
    },
  },
});

export const makePlan = (mutate?: (input: ScenePlanInput) => void): ScenePlan => {
  const input = planInput();
  mutate?.(input);
  return parseScenePlan(input);
};

/** Folder proyek sementara berisi plan.json — path aset dihitung darinya. */
export const tempProject = (plan: ScenePlan): { dir: string; planPath: string } => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-interop-"));
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return { dir, planPath };
};
