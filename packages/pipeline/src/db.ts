import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Stage-run ledger on SQLite — the pipeline's memory (PRD §7.2): status of
 * every stage per scene, so a crash/restart resumes instead of redoing, and
 * every run is observable after the fact (provider, duration, cost, error).
 *
 * Uses the built-in `node:sqlite` (zero native deps, local-first). The API
 * surface is wrapped in this one module so the driver can be swapped without
 * touching stages. The experimental warning is filtered specifically; every
 * other warning still prints.
 */

let warningFilterInstalled = false;
const installSqliteWarningFilter = (): void => {
  if (warningFilterInstalled) return;
  warningFilterInstalled = true;
  const existing = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    if (
      warning.name === "ExperimentalWarning" &&
      String(warning.message).includes("SQLite")
    ) {
      return;
    }
    if (existing.length > 0) {
      for (const listener of existing) listener(warning);
    } else {
      console.warn(`${warning.name}: ${warning.message}`);
    }
  });
};

installSqliteWarningFilter();
const { DatabaseSync } = await import("node:sqlite");

export type SqliteDatabase = InstanceType<typeof DatabaseSync>;

/**
 * Open a SQLite database with the shared warning filter applied. Consumers
 * outside the pipeline (e.g. the agent's event log) build their own tables on
 * the same project database through this single entry point.
 */
export const openSqlite = (path: string): SqliteDatabase => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
};

/**
 * Satuan kerja per baris ledger. "tts"/"assets" dikunci per SCENE; "asr"
 * dikunci per BERKAS REKAMAN (kolom scene_id memuat path relatif-plan-nya),
 * karena satu rekaman yang dipakai lima scene ditranskrip sekali (ADR-0021).
 */
export type StageName = "tts" | "assets" | "asr" | "loudness";
export type RunStatus = "running" | "done" | "error";

export interface StageRun {
  projectId: string;
  sceneId: string;
  stage: StageName;
  inputHash: string;
  status: RunStatus;
  provider: string | null;
  fallback: boolean;
  /** JSON snapshot of the stage output (e.g. NarrationAudio/ResolvedAsset). */
  outputJson: string | null;
  error: string | null;
  costUsd: number | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS stage_runs (
  project_id  TEXT NOT NULL,
  scene_id    TEXT NOT NULL,
  stage       TEXT NOT NULL,
  input_hash  TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
  provider    TEXT,
  fallback    INTEGER NOT NULL DEFAULT 0,
  output_json TEXT,
  error       TEXT,
  cost_usd    REAL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  PRIMARY KEY (project_id, scene_id, stage)
);
`;

interface Row {
  project_id: string;
  scene_id: string;
  stage: string;
  input_hash: string;
  status: string;
  provider: string | null;
  fallback: number;
  output_json: string | null;
  error: string | null;
  cost_usd: number | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

const toRun = (row: Row): StageRun => ({
  projectId: row.project_id,
  sceneId: row.scene_id,
  stage: row.stage as StageName,
  inputHash: row.input_hash,
  status: row.status as RunStatus,
  provider: row.provider,
  fallback: row.fallback === 1,
  outputJson: row.output_json,
  error: row.error,
  costUsd: row.cost_usd,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  durationMs: row.duration_ms,
});

export class PipelineDb {
  private readonly db: SqliteDatabase;

  constructor(
    path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db = openSqlite(path);
    this.db.exec(MIGRATION);
  }

  getRun(projectId: string, sceneId: string, stage: StageName): StageRun | null {
    const row = this.db
      .prepare(
        "SELECT * FROM stage_runs WHERE project_id = ? AND scene_id = ? AND stage = ?",
      )
      .get(projectId, sceneId, stage) as Row | undefined;
    return row ? toRun(row) : null;
  }

  listRuns(projectId: string): StageRun[] {
    const rows = this.db
      .prepare("SELECT * FROM stage_runs WHERE project_id = ? ORDER BY scene_id, stage")
      .all(projectId) as unknown as Row[];
    return rows.map(toRun);
  }

  /** Mark a run as started (upsert — a stale 'running' row is overwritten). */
  startRun(
    projectId: string,
    sceneId: string,
    stage: StageName,
    inputHash: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO stage_runs (project_id, scene_id, stage, input_hash, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)
         ON CONFLICT (project_id, scene_id, stage) DO UPDATE SET
           input_hash = excluded.input_hash,
           status = 'running',
           provider = NULL, fallback = 0, output_json = NULL, error = NULL,
           cost_usd = NULL, started_at = excluded.started_at,
           finished_at = NULL, duration_ms = NULL`,
      )
      .run(projectId, sceneId, stage, inputHash, this.now().toISOString());
  }

  finishRun(
    projectId: string,
    sceneId: string,
    stage: StageName,
    result: {
      provider: string;
      fallback: boolean;
      outputJson: string;
      costUsd: number;
      durationMs: number;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE stage_runs SET
           status = 'done', provider = ?, fallback = ?, output_json = ?,
           error = NULL, cost_usd = ?, finished_at = ?, duration_ms = ?
         WHERE project_id = ? AND scene_id = ? AND stage = ?`,
      )
      .run(
        result.provider,
        result.fallback ? 1 : 0,
        result.outputJson,
        result.costUsd,
        this.now().toISOString(),
        result.durationMs,
        projectId,
        sceneId,
        stage,
      );
  }

  failRun(
    projectId: string,
    sceneId: string,
    stage: StageName,
    error: string,
    durationMs: number,
  ): void {
    this.db
      .prepare(
        `UPDATE stage_runs SET
           status = 'error', error = ?, finished_at = ?, duration_ms = ?
         WHERE project_id = ? AND scene_id = ? AND stage = ?`,
      )
      .run(error, this.now().toISOString(), durationMs, projectId, sceneId, stage);
  }

  close(): void {
    this.db.close();
  }
}
