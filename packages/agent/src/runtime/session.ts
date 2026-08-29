import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  applyPatch,
  computeTimeline,
  countWords,
  PatchLog,
  type PatchOpInput,
  parseScenePlan,
  resolveSceneDurationSec,
  type ScenePlan,
  type ScenePlanInput,
} from "@dalang/core";
import {
  atomicWriteFile,
  PipelineDb,
  type ProjectPaths,
  projectPaths,
  type StockCandidate,
  sha256Hex,
} from "@dalang/pipeline";
import type { ModelMessage } from "ai";
import { AgentEventLog } from "./agent-log";

/**
 * Sesi proyek: dokumen hidup yang sama untuk agent & manusia (PRD prinsip #2).
 *
 * - Plan + PatchLog dipersist di samping plan (undo lintas restart).
 * - Deteksi edit manual: hash file plan dibandingkan tiap giliran; bila
 *   berubah di luar sesi, plan dimuat ulang dan agent DIBERITAHU lewat
 *   konteks ("user baru saja mengubah … secara manual", PRD §5.2).
 * - Semua mutasi agent lewat applyPatch origin "agent" → lock ditegakkan core.
 */

const HISTORY_LIMIT = 40;

export class ProjectSession {
  readonly paths: ProjectPaths;
  readonly db: PipelineDb;
  readonly events: AgentEventLog;
  readonly patchLog: PatchLog;
  plan: ScenePlan | null = null;
  history: ModelMessage[] = [];
  turn = 0;
  /** Kandidat hasil searchAssets, per query — dipakai pickAsset. */
  readonly lastSearches = new Map<string, StockCandidate[]>();
  private planDiskHash: string | null = null;
  /** Snapshot terakhir yang dipersist — plan hanya ditulis bila berubah. */
  private lastPersistedPlan: string | null = null;

  private constructor(paths: ProjectPaths) {
    this.paths = paths;
    this.db = new PipelineDb(paths.dbPath);
    this.events = new AgentEventLog(paths.dbPath);
    this.patchLog = this.loadPatchLog();
    if (existsSync(paths.planPath)) {
      this.plan = parseScenePlan(JSON.parse(readFileSync(paths.planPath, "utf8")));
      this.planDiskHash = this.hashDisk();
      this.lastPersistedPlan = JSON.stringify(this.plan);
    }
    this.history = this.loadHistory();
  }

  static open(planPath: string): ProjectSession {
    return new ProjectSession(projectPaths(planPath));
  }

  get projectId(): string {
    return this.plan?.projectId ?? basename(this.paths.planDir);
  }

  get isEmpty(): boolean {
    return this.plan === null;
  }

  // -- persistence ----------------------------------------------------------

  private get patchLogPath(): string {
    return `${this.paths.dalangDir}/patch-log.json`;
  }

  private get historyPath(): string {
    return `${this.paths.dalangDir}/chat-history.json`;
  }

  private loadPatchLog(): PatchLog {
    try {
      if (existsSync(this.patchLogPath)) {
        return PatchLog.fromJSON(JSON.parse(readFileSync(this.patchLogPath, "utf8")));
      }
    } catch {
      // log korup → mulai bersih; plan tetap sumber kebenaran
    }
    return new PatchLog();
  }

  private loadHistory(): ModelMessage[] {
    try {
      if (existsSync(this.historyPath)) {
        return JSON.parse(readFileSync(this.historyPath, "utf8")) as ModelMessage[];
      }
    } catch {
      // riwayat korup → mulai bersih
    }
    return [];
  }

  persist(): void {
    if (this.plan) {
      const snapshot = JSON.stringify(this.plan);
      if (snapshot !== this.lastPersistedPlan) {
        atomicWriteFile(this.paths.planPath, `${JSON.stringify(this.plan, null, 2)}\n`);
        this.planDiskHash = this.hashDisk();
        this.lastPersistedPlan = snapshot;
      }
    }
    atomicWriteFile(this.patchLogPath, JSON.stringify(this.patchLog.toJSON()));
    atomicWriteFile(this.historyPath, JSON.stringify(this.history.slice(-HISTORY_LIMIT)));
  }

  private hashDisk(): string | null {
    try {
      if (!existsSync(this.paths.planPath)) return null;
      return sha256Hex(readFileSync(this.paths.planPath));
    } catch {
      return null;
    }
  }

  // -- mutations ------------------------------------------------------------

  /** Terapkan patch agent (lock ditegakkan), catat, persist. */
  applyAgentPatch(ops: PatchOpInput[]): { summary: string } {
    if (!this.plan) {
      throw new Error("Belum ada scene-plan — buat dulu lewat writeScenePlan");
    }
    const { plan, applied } = applyPatch(this.plan, ops, { origin: "agent" });
    this.plan = plan;
    this.patchLog.record(applied);
    this.persist();
    return { summary: applied.summary };
  }

  /** Inisialisasi plan baru dari draft agent (hanya saat proyek kosong). */
  initializePlan(input: ScenePlanInput): ScenePlan {
    if (this.plan) {
      throw new Error(
        "Proyek sudah punya scene-plan — gunakan applyPatch untuk mengubahnya",
      );
    }
    this.plan = parseScenePlan(input);
    this.persist();
    return this.plan;
  }

  undo(): string | null {
    if (!this.plan || !this.patchLog.canUndo) return null;
    const result = this.patchLog.undo(this.plan);
    if (!result) return null;
    this.plan = result.plan;
    this.persist();
    return result.entry.summary;
  }

  redo(): string | null {
    if (!this.plan || !this.patchLog.canRedo) return null;
    const result = this.patchLog.redo(this.plan);
    if (!result) return null;
    this.plan = result.plan;
    this.persist();
    return result.entry.summary;
  }

  /**
   * Muat ulang bila file plan berubah di luar sesi (editor manual, generate
   * dari terminal lain). Mengembalikan catatan untuk konteks agent, atau null.
   */
  detectExternalEdit(): string | null {
    const diskHash = this.hashDisk();
    if (diskHash === this.planDiskHash) return null;
    if (diskHash === null) return null;
    const before = this.plan;
    this.plan = parseScenePlan(JSON.parse(readFileSync(this.paths.planPath, "utf8")));
    this.planDiskHash = diskHash;
    this.lastPersistedPlan = JSON.stringify(this.plan);
    const changedScenes =
      before === null
        ? "seluruh plan"
        : this.plan.scenes
            .filter((scene) => {
              const prev = before.scenes.find((s) => s.id === scene.id);
              return !prev || JSON.stringify(prev) !== JSON.stringify(scene);
            })
            .map((scene) => scene.id)
            .join(", ") || "metadata/renderState";
    return `User baru saja mengubah plan secara MANUAL di luar chat (${changedScenes}). Hormati perubahan itu — jangan menimpanya tanpa diminta.`;
  }

  // -- context --------------------------------------------------------------

  /** Ringkasan kompak untuk konteks agent & tool getProjectState. */
  summary(): string {
    if (!this.plan) {
      return "Proyek kosong — belum ada scene-plan. Buat draft lewat tool writeScenePlan setelah memahami brief user.";
    }
    const plan = this.plan;
    const { totalSec } = computeTimeline(plan);
    const lines = plan.scenes.map((scene, index) => {
      const audio = plan.renderState.narrationAudio[scene.id];
      const asset = plan.renderState.resolvedAssets[scene.id];
      const flags = [
        scene.locked ? "TERKUNCI" : null,
        scene.visual.pinned ? "pinned" : null,
        audio ? (audio.fallbackQuality ? "suara:fallback" : "suara:ok") : null,
        asset
          ? `aset:${asset.kind}`
          : scene.visual.type === "stock"
            ? "aset:belum"
            : null,
      ]
        .filter(Boolean)
        .join(", ");
      return (
        `${index + 1}. ${scene.id} [${scene.visual.type}` +
        `${scene.visual.variant ? `/${scene.visual.variant}` : ""}] ` +
        `${countWords(scene.narration)} kata, ${resolveSceneDurationSec(scene, plan).toFixed(1)}s` +
        `${flags ? ` (${flags})` : ""} — "${scene.narration.slice(0, 70)}${scene.narration.length > 70 ? "…" : ""}"`
      );
    });
    return [
      `Judul: ${plan.meta.title} · ${plan.meta.aspectRatio} · preset ${plan.meta.stylePreset} · bahasa ${plan.meta.language}`,
      `Voice: ${plan.audio.voice ? `${plan.audio.voice.provider}/${plan.audio.voice.voiceId}` : "(belum diset)"} · total ±${totalSec.toFixed(0)}s`,
      ...lines,
      `Perubahan terakhir:\n${this.patchLog.summarize(5)}`,
    ].join("\n");
  }

  close(): void {
    this.db.close();
    this.events.close();
  }
}
