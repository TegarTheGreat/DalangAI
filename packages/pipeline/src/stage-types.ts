export interface StageLogger {
  info(message: string): void;
  warn(message: string): void;
}

export const consoleLogger: StageLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

export type SceneStageStatus = "done" | "cached" | "skipped" | "error";

export interface SceneStageResult {
  sceneId: string;
  status: SceneStageStatus;
  /** Human-readable detail: provider label, skip reason, or error message. */
  detail: string;
  provider?: string;
  fallback?: boolean;
  costUsd?: number;
  durationMs?: number;
}

export const countErrors = (results: SceneStageResult[]): number =>
  results.filter((result) => result.status === "error").length;
