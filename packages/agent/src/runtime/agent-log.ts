import { openSqlite, type SqliteDatabase } from "@dalang/pipeline";

/**
 * Log terstruktur SETIAP tool call & pemakaian LLM (PRD §6.3: input, output,
 * durasi, biaya) — observability & debugging. Hidup di pipeline.db proyek
 * yang sama sehingga `dalang log` menampilkan satu garis waktu utuh.
 */

export type AgentEventKind = "tool" | "llm" | "system";

export interface AgentEvent {
  id: number;
  at: string;
  turn: number;
  kind: AgentEventKind;
  name: string;
  inputJson: string | null;
  outputJson: string | null;
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS agent_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  turn        INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('tool', 'llm', 'system')),
  name        TEXT NOT NULL,
  input_json  TEXT,
  output_json TEXT,
  error       TEXT,
  duration_ms INTEGER,
  cost_usd    REAL
);
`;

const clip = (value: unknown, max = 4000): string => {
  const json = JSON.stringify(value) ?? "null";
  return json.length > max ? `${json.slice(0, max)}…[terpotong]` : json;
};

export class AgentEventLog {
  private readonly db: SqliteDatabase;

  constructor(
    path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db = openSqlite(path);
    this.db.exec(MIGRATION);
  }

  record(event: {
    turn: number;
    kind: AgentEventKind;
    name: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    durationMs?: number;
    costUsd?: number | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO agent_events (at, turn, kind, name, input_json, output_json, error, duration_ms, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.now().toISOString(),
        event.turn,
        event.kind,
        event.name,
        event.input === undefined ? null : clip(event.input),
        event.output === undefined ? null : clip(event.output),
        event.error ?? null,
        event.durationMs ?? null,
        event.costUsd ?? null,
      );
  }

  recent(limit = 30): AgentEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, at, turn, kind, name, input_json, output_json, error, duration_ms, cost_usd
         FROM agent_events ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as unknown as Array<Record<string, unknown>>;
    return rows.reverse().map((row) => ({
      id: row.id as number,
      at: row.at as string,
      turn: row.turn as number,
      kind: row.kind as AgentEventKind,
      name: row.name as string,
      inputJson: row.input_json as string | null,
      outputJson: row.output_json as string | null,
      error: row.error as string | null,
      durationMs: row.duration_ms as number | null,
      costUsd: row.cost_usd as number | null,
    }));
  }

  /** Total biaya tool/llm yang pernah tercatat untuk proyek ini. */
  totalCostUsd(): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM agent_events")
      .get() as { total: number };
    return row.total;
  }

  close(): void {
    this.db.close();
  }
}
