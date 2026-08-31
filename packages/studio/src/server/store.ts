import { existsSync, readdirSync, statSync, watch } from "node:fs";
import { basename, join } from "node:path";
import type { ProjectSession } from "@dalang/agent";
import type { PatchOpInput, ScenePlan } from "@dalang/core";
import { ELEVENLABS_ESTIMATED_USD_PER_CHAR } from "@dalang/providers";
import type {
  BusyKind,
  BusyState,
  PatchLogEntryLite,
  PlanUpdateReason,
  ProjectStatePayload,
  RenderOutput,
  StageRunLite,
  TranscriptSummary,
} from "../shared/api-types";
import type { EventBus } from "./bus";

/**
 * Penjaga state proyek di sisi server: SATU penulis (ProjectSession yang sama
 * dengan CLI/agent), semua mutasi lewat sini agar:
 *  - job yang memutasi plan berjalan satu-per-satu (busy lock — chat/stage
 *    yang setengah jalan tidak boleh ditimpa patch lain, ADR-0010),
 *  - setiap perubahan disiarkan ke semua panel via EventBus,
 *  - edit manual file plan di luar UI terdeteksi (fs.watch + hash session).
 */

export class StudioBusyError extends Error {
  constructor(current: string) {
    super(`Sedang ada pekerjaan berjalan (${current}) — coba lagi setelah selesai`);
    this.name = "StudioBusyError";
  }
}

export class StudioStore {
  readonly session: ProjectSession;
  readonly bus: EventBus;
  revision = 0;
  private mutation: BusyKind | null = null;
  private render: string | null = null;
  private stopWatch: (() => void) | null = null;

  constructor(session: ProjectSession, bus: EventBus) {
    this.session = session;
    this.bus = bus;
    this.watchExternalEdits();
  }

  get busy(): BusyState {
    return { mutation: this.mutation, render: this.render };
  }

  notifyPlan(reason: PlanUpdateReason): void {
    this.revision += 1;
    this.bus.emit({ type: "plan-updated", reason, revision: this.revision });
  }

  private notifyBusy(): void {
    this.bus.emit({ type: "busy", busy: this.busy });
  }

  /** Jalankan job yang memutasi plan; hanya satu pada satu waktu. */
  async runExclusive<T>(kind: BusyKind, fn: () => Promise<T>): Promise<T> {
    if (this.mutation) throw new StudioBusyError(this.mutation);
    this.mutation = kind;
    this.notifyBusy();
    try {
      return await fn();
    } finally {
      this.mutation = null;
      this.notifyBusy();
    }
  }

  /** Render berjalan paralel dengan baca, tapi hanya satu render sekaligus. */
  beginRender(label: string): void {
    if (this.render) {
      throw new StudioBusyError(`render-${this.render}`);
    }
    this.render = label;
    this.notifyBusy();
  }

  endRender(): void {
    this.render = null;
    this.notifyBusy();
  }

  /** Patch cepat (form inspector, lock, reorder) — ditolak saat job berjalan. */
  applyUserPatch(ops: PatchOpInput[]): string {
    if (this.mutation) throw new StudioBusyError(this.mutation);
    const { summary } = this.session.applyUserPatch(ops);
    this.notifyPlan("patch-user");
    return summary;
  }

  undo(): string | null {
    if (this.mutation) throw new StudioBusyError(this.mutation);
    const summary = this.session.undo();
    if (summary) this.notifyPlan("undo");
    return summary;
  }

  redo(): string | null {
    if (this.mutation) throw new StudioBusyError(this.mutation);
    const summary = this.session.redo();
    if (summary) this.notifyPlan("redo");
    return summary;
  }

  // -- snapshot --------------------------------------------------------------

  patchLogLite(count = 12): PatchLogEntryLite[] {
    return this.session.patchLog.recent(count).map((entry) => ({
      seq: entry.seq,
      origin: entry.origin,
      at: entry.at,
      summary: entry.summary,
      opsCount: entry.ops.length,
    }));
  }

  snapshot(models: ProjectStatePayload["models"]): ProjectStatePayload {
    const { session } = this;
    // Transkrip DIBUANG dari muatan state (ADR-0021). Rekaman satu jam
    // menambah ratusan kilobyte, dan state ini disiarkan ulang pada SETIAP
    // perubahan — memuatnya di sini berarti mengirimi setiap penonton seluruh
    // transkrip tiap kali satu judul discene diketik. UI mengambilnya lewat
    // /api/transcript saat panelnya dibuka; ringkasannya tetap di sini supaya
    // UI tahu apa yang ada tanpa mengunduh isinya.
    const plan = session.plan ? stripTranscripts(session.plan) : null;
    const transcripts: TranscriptSummary[] = session.plan
      ? Object.entries(session.plan.renderState.transcripts).map(
          ([file, transcript]) => ({
            file,
            words: transcript.words.length,
            durationSec: Number(transcript.durationSec.toFixed(2)),
            language: transcript.language,
            source: transcript.source,
            fromNarration: transcript.fromNarration === true,
            speakers: [
              ...new Set(
                transcript.words
                  .map((word) => word.speaker)
                  .filter((speaker): speaker is string => speaker !== undefined),
              ),
            ].sort(),
          }),
        )
      : [];

    const stageRuns: StageRunLite[] = plan
      ? session.db.listRuns(plan.projectId).map((run) => ({
          sceneId: run.sceneId,
          stage: run.stage,
          status: run.status,
          provider: run.provider ?? null,
          fallback: run.fallback,
          costUsd: run.costUsd ?? null,
          error: run.error ?? null,
        }))
      : [];

    return {
      planPath: session.paths.planPath,
      projectId: session.projectId,
      plan,
      busy: this.busy,
      patchLog: {
        canUndo: session.patchLog.canUndo,
        canRedo: session.patchLog.canRedo,
        recent: this.patchLogLite(),
      },
      stageRuns,
      transcripts,
      totalCostUsd: Number(session.events.totalCostUsd().toFixed(4)),
      models,
      ttsEstimate: this.ttsEstimate(),
      renders: this.listRenders(),
    };
  }

  /** Estimasi biaya TTS semua scene bernarasi (ditampilkan SEBELUM aksi, §8.2). */
  ttsEstimate(): ProjectStatePayload["ttsEstimate"] {
    const plan = this.session.plan;
    if (!plan?.audio.voice) return null;
    const narrated = plan.scenes.filter((scene) => scene.narration.trim() !== "");
    const chars = narrated.reduce((sum, scene) => sum + scene.narration.length, 0);
    const usd =
      plan.audio.voice.provider === "elevenlabs"
        ? Number((chars * ELEVENLABS_ESTIMATED_USD_PER_CHAR).toFixed(4))
        : 0;
    return { scenes: narrated.length, chars, usd };
  }

  listRenders(): RenderOutput[] {
    const dir = join(this.session.paths.dalangDir, "renders");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => /\.(mp4|webm|mov)$/.test(name))
      .map((name) => {
        const stats = statSync(join(dir, name));
        return {
          label: name.replace(/\.(mp4|webm|mov)$/, ""),
          url: `/.dalang/renders/${name}`,
          sizeBytes: stats.size,
          finishedAt: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  }

  // -- edit manual di luar UI (PRD §5.2) ------------------------------------

  private watchExternalEdits(): void {
    const planFile = basename(this.session.paths.planPath);
    let timer: NodeJS.Timeout | null = null;
    try {
      const watcher = watch(this.session.paths.planDir, (_event, filename) => {
        if (filename !== planFile) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          // Tulisan kami sendiri tidak memicu apa-apa: session membandingkan
          // hash disk dengan hash tulisan terakhirnya.
          if (this.mutation) return; // job aktif akan mendeteksinya sendiri
          const note = this.session.detectExternalEdit();
          if (note) this.notifyPlan("external");
        }, 250);
        timer.unref?.();
      });
      this.stopWatch = () => watcher.close();
    } catch {
      this.stopWatch = null; // platform tanpa fs.watch → deteksi tetap per giliran chat
    }
  }

  close(): void {
    this.stopWatch?.();
    this.session.close();
  }
}

/**
 * Salinan plan tanpa isi transkrip (ADR-0021).
 *
 * Kuncinya DIPERTAHANKAN sebagai entri kosong, bukan dihapus: UI perlu tahu
 * berkas mana yang punya transkrip untuk menyalakan panelnya, dan menghapus
 * seluruh kuncinya akan membuat panel itu tampak tidak ada padahal ada.
 */
export const stripTranscripts = (plan: ScenePlan): ScenePlan => ({
  ...plan,
  renderState: { ...plan.renderState, transcripts: {} },
});
