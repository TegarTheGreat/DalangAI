import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type NarrationAudio,
  narrationAudioSchema,
  type ScenePlan,
  setNarrationAudio,
} from "@dalang/core";
import type { PipelineDb } from "./db";
import { atomicWriteFile, round3 } from "./fs-utils";
import { contentHash } from "./hash";
import type { TtsProvider } from "./ports";
import type { ProjectPaths } from "./project-paths";
import { consoleLogger, type SceneStageResult, type StageLogger } from "./stage-types";

/**
 * TTS stage — per-scene, cached, resumable (PRD §7.1 [2], §7.2).
 *
 * Cache key = creative input only: narration text + voice config + language.
 * The provider that happened to succeed is recorded but never part of the key.
 * A cache hit also re-materializes renderState from the ledger, so a reverted
 * plan heals without re-synthesis.
 */

export interface TtsStageOptions {
  paths: ProjectPaths;
  plan: ScenePlan;
  /** Fallback chain, primary first. */
  providers: TtsProvider[];
  db: PipelineDb;
  /** Limit to these scene ids (partial runs, PRD §6.2 generateVoiceover). */
  sceneIds?: string[];
  force?: boolean;
  log?: StageLogger;
}

export interface TtsStageOutcome {
  plan: ScenePlan;
  results: SceneStageResult[];
}

export const runTtsStage = async ({
  paths,
  plan,
  providers,
  db,
  sceneIds,
  force = false,
  log = consoleLogger,
}: TtsStageOptions): Promise<TtsStageOutcome> => {
  const voice = plan.audio.voice;
  const results: SceneStageResult[] = [];

  const targetIds = sceneIds ? new Set(sceneIds) : null;
  if (targetIds) {
    const known = new Set(plan.scenes.map((scene) => scene.id));
    for (const id of targetIds) {
      if (!known.has(id)) {
        results.push({
          sceneId: id,
          status: "error",
          detail: "scene tidak ditemukan di plan",
        });
      }
    }
  }
  const narrated = plan.scenes.filter(
    (scene) => scene.narration.trim() !== "" && (!targetIds || targetIds.has(scene.id)),
  );

  if (!voice) {
    if (narrated.length > 0) {
      log.info(
        "  TTS dilewati: plan belum menyetel audio.voice (caption memakai estimasi timing).",
      );
    }
    return {
      plan,
      results: [
        ...results,
        ...narrated.map(
          (scene): SceneStageResult => ({
            sceneId: scene.id,
            status: "skipped",
            detail: "audio.voice belum diset",
          }),
        ),
      ],
    };
  }
  if (providers.length === 0) {
    throw new Error("Tidak ada provider TTS yang tersedia untuk dijalankan");
  }

  let current = plan;
  for (const scene of narrated) {
    const inputHash = contentHash({
      kind: "tts",
      text: scene.narration,
      voiceId: voice.voiceId,
      speed: voice.speed,
      language: plan.meta.language,
    });

    const existing = db.getRun(plan.projectId, scene.id, "tts");
    if (
      !force &&
      existing?.status === "done" &&
      existing.inputHash === inputHash &&
      existing.outputJson
    ) {
      const entry = narrationAudioSchema.parse(JSON.parse(existing.outputJson));
      if (existsSync(join(paths.planDir, entry.file))) {
        current = setNarrationAudio(current, scene.id, entry);
        results.push({
          sceneId: scene.id,
          status: "cached",
          detail: `cache (${existing.provider ?? "?"})`,
          provider: existing.provider ?? undefined,
          fallback: existing.fallback,
          costUsd: 0,
        });
        continue;
      }
    }

    db.startRun(plan.projectId, scene.id, "tts", inputHash);
    const startedAt = Date.now();
    let succeeded = false;
    let lastError = "tidak ada provider yang dicoba";

    for (let index = 0; index < providers.length; index++) {
      const provider = providers[index]!;
      try {
        const result = await provider.synthesize({
          text: scene.narration,
          voiceId: voice.voiceId,
          speed: voice.speed,
          language: plan.meta.language,
        });
        const file = join(paths.ttsDir, `${inputHash}.${result.format}`);
        atomicWriteFile(file, result.audio);

        const fallback = index > 0 || provider.placeholderQuality;
        const entry: NarrationAudio = {
          file: paths.relFromPlan(file),
          durationSec: round3(result.durationSec),
          wordTimestamps: result.wordTimestamps,
          ...(fallback ? { fallbackQuality: true } : {}),
        };
        current = setNarrationAudio(current, scene.id, entry);

        const durationMs = Date.now() - startedAt;
        db.finishRun(plan.projectId, scene.id, "tts", {
          provider: provider.id,
          fallback,
          outputJson: JSON.stringify(entry),
          costUsd: result.costUsd,
          durationMs,
        });
        if (fallback) {
          log.warn(
            `  ! ${scene.id}: suara memakai ${provider.label}` +
              `${index > 0 ? ` (fallback dari ${providers[0]!.label})` : ""} — ditandai fallbackQuality`,
          );
        }
        results.push({
          sceneId: scene.id,
          status: "done",
          detail: `${provider.label} · ${result.wordTimestamps.length} kata (${result.timestampsSource})`,
          provider: provider.id,
          fallback,
          costUsd: result.costUsd,
          durationMs,
        });
        succeeded = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        log.warn(`  provider ${provider.id} gagal untuk ${scene.id}: ${lastError}`);
      }
    }

    if (!succeeded) {
      const durationMs = Date.now() - startedAt;
      db.failRun(plan.projectId, scene.id, "tts", lastError, durationMs);
      results.push({
        sceneId: scene.id,
        status: "error",
        detail: lastError,
        durationMs,
      });
    }
  }

  return { plan: current, results };
};
