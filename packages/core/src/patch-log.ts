import { type AppliedPatch, applyPatch, type PatchOrigin } from "./patch";
import type { ScenePlan } from "./scene-plan";

/**
 * Lightweight event-sourced history of applied patches.
 *
 * - Undo/redo come for free: each entry carries its inverse ops.
 * - `summarize()` produces the recap that is injected into the agent's context
 *   before it acts ("user baru saja memperpanjang sc-003 …", PRD §5.2).
 *
 * In-memory for Fase 0; persisted to SQLite from Fase 1 via toJSON/fromJSON.
 */

export interface PatchLogEntry extends AppliedPatch {
  seq: number;
}

export interface PatchLogJSON {
  seq: number;
  applied: PatchLogEntry[];
  redo: PatchLogEntry[];
}

export class PatchLog {
  private appliedEntries: PatchLogEntry[] = [];
  private redoEntries: PatchLogEntry[] = [];
  private seq = 0;

  /** Record a freshly applied patch. Clears the redo stack. */
  record(applied: AppliedPatch): PatchLogEntry {
    const entry: PatchLogEntry = { ...applied, seq: ++this.seq };
    this.appliedEntries.push(entry);
    this.redoEntries = [];
    return entry;
  }

  get canUndo(): boolean {
    return this.appliedEntries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  /**
   * Revert the most recent patch. Enforcement is disabled during replay: a
   * lock added after an edit must never block undoing that edit.
   */
  undo(plan: ScenePlan): { plan: ScenePlan; entry: PatchLogEntry } | null {
    const entry = this.appliedEntries.pop();
    if (!entry) return null;
    const { plan: reverted } = applyPatch(plan, entry.inverse, {
      origin: entry.origin,
      enforce: false,
    });
    this.redoEntries.push(entry);
    return { plan: reverted, entry };
  }

  /** Re-apply the most recently undone patch. */
  redo(plan: ScenePlan): { plan: ScenePlan; entry: PatchLogEntry } | null {
    const entry = this.redoEntries.pop();
    if (!entry) return null;
    const { plan: reapplied } = applyPatch(plan, entry.ops, {
      origin: entry.origin,
      enforce: false,
    });
    this.appliedEntries.push(entry);
    return { plan: reapplied, entry };
  }

  /** Most recent entries, newest last. */
  recent(count = 5): PatchLogEntry[] {
    return this.appliedEntries.slice(-count);
  }

  /**
   * Recap for the agent's context. Filterable by origin so the agent can be
   * told specifically what the *user* changed since its last turn.
   */
  summarize(count = 5, origin?: PatchOrigin): string {
    const entries = this.appliedEntries
      .filter((entry) => (origin ? entry.origin === origin : true))
      .slice(-count);
    if (entries.length === 0) return "Belum ada perubahan.";
    return entries.map((entry) => `- ${entry.summary}`).join("\n");
  }

  toJSON(): PatchLogJSON {
    return {
      seq: this.seq,
      applied: structuredClone(this.appliedEntries),
      redo: structuredClone(this.redoEntries),
    };
  }

  static fromJSON(json: PatchLogJSON): PatchLog {
    const log = new PatchLog();
    log.seq = json.seq;
    log.appliedEntries = structuredClone(json.applied);
    log.redoEntries = structuredClone(json.redo);
    return log;
  }
}
