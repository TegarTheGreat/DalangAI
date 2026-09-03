import { primaryClip, type Scene, type ScenePlan, sceneAsset } from "@dalang/core";
import type { BusyState, StageRunLite } from "../../shared/api-types";

/**
 * Derivasi status per scene untuk badge timeline (PRD §8.2: "indikator status
 * pipeline per scene — pending / processing / done / fallback / error").
 * Murni dan diuji unit — komponen tinggal menampilkan.
 */

export type SceneBadge =
  | "belum"
  | "proses"
  | "ok"
  | "fallback"
  | "error"
  | "pinned"
  | "n/a";

export interface SceneStatus {
  voice: SceneBadge;
  asset: SceneBadge;
}

const runFor = (
  runs: StageRunLite[],
  sceneId: string,
  stage: StageRunLite["stage"],
): StageRunLite | undefined =>
  runs.find((run) => run.sceneId === sceneId && run.stage === stage);

export const deriveSceneStatus = (
  plan: ScenePlan,
  scene: Scene,
  runs: StageRunLite[],
  busy: BusyState,
): SceneStatus => {
  const processing = (stage: StageRunLite["stage"]) =>
    (stage === "tts" && busy.mutation === "tts") ||
    (stage === "assets" && (busy.mutation === "assets" || busy.mutation === "pick"));

  let voice: SceneBadge;
  if (scene.narration.trim() === "") {
    voice = "n/a";
  } else {
    const audio = plan.renderState.narrationAudio[scene.id];
    const run = runFor(runs, scene.id, "tts");
    if (audio) {
      voice = audio.fallbackQuality ? "fallback" : "ok";
    } else if (run?.status === "running" || processing("tts")) {
      voice = "proses";
    } else if (run?.status === "error") {
      voice = "error";
    } else {
      voice = "belum";
    }
  }

  let asset: SceneBadge;
  if (
    primaryClip(scene).type === "template-anim" ||
    primaryClip(scene).type === "solid"
  ) {
    asset = "n/a";
  } else {
    const resolved = sceneAsset(plan, scene);
    const run = runFor(runs, scene.id, "assets");
    if (primaryClip(scene).pinned && resolved) {
      asset = "pinned";
    } else if (resolved) {
      asset = run?.fallback ? "fallback" : "ok";
    } else if (run?.status === "running" || processing("assets")) {
      asset = "proses";
    } else if (run?.status === "error") {
      asset = "error";
    } else {
      asset = "belum";
    }
  }

  return { voice, asset };
};

export const badgeLabel: Record<SceneBadge, string> = {
  belum: "belum",
  proses: "proses…",
  ok: "ok",
  fallback: "fallback",
  error: "error",
  pinned: "pinned",
  "n/a": "—",
};
