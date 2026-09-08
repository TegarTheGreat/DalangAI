import { existsSync, readdirSync, statSync, watch } from "node:fs";
import { basename, join } from "node:path";
import type { ProjectSession } from "@dalang/agent";
import {
  conflictMessage,
  type Editor,
  type PatchOpInput,
  patchTouchKeys,
  rebaseRenderState,
  type ScenePlan,
  TOUCH_AUDIO,
  TOUCH_META,
  TOUCH_STRUCTURE,
  type TouchKey,
  touchConflicts,
} from "@dalang/core";
import { publishedRecordFor } from "@dalang/pipeline";
import { ELEVENLABS_ESTIMATED_USD_PER_CHAR } from "@dalang/providers";
import type {
  BusyKind,
  BusyState,
  PatchLogEntryLite,
  PlanUpdateReason,
  ProjectStatePayload,
  ProxyJobLite,
  PublishJobLite,
  PublishStateLite,
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

/**
 * Patch yang ditolak karena petaknya sudah berubah di tangan orang lain
 * (ADR-0038). Dibedakan dari sibuk: sibuk berarti "coba lagi sebentar
 * lagi", bentrok berarti "lihat dulu apa yang berubah".
 */
export class StudioConflictError extends Error {
  readonly keys: string[];
  constructor(keys: string[], message: string) {
    super(message);
    this.name = "StudioConflictError";
    this.keys = keys;
  }
}

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
  /** Pekerjaan proxy di latar (ADR-0028 §10); ditulis oleh ProxyJobRunner. */
  proxyJob: ProxyJobLite | null = null;
  /** Unggahan yang sedang berjalan (ADR-0030); ditulis oleh rute publish. */
  publishJob: PublishJobLite | null = null;
  private stopWatch: (() => void) | null = null;

  constructor(session: ProjectSession, bus: EventBus) {
    this.session = session;
    this.bus = bus;
    this.watchExternalEdits();
  }

  get busy(): BusyState {
    return { mutation: this.mutation, render: this.render };
  }

  /**
   * Riwayat petak yang disentuh tiap revisi (ADR-0038) — cincin pendek.
   *
   * Pendek dengan sengaja: klien yang tertinggal lebih dari 64 revisi bukan
   * klien yang perlu digabungkan per-scene, melainkan klien yang harus memuat
   * ulang. Cincin yang tumbuh selamanya cuma menahan memori demi menjawab
   * pertanyaan yang tidak ada yang tanya.
   */
  private readonly touchLog: Array<{ revision: number; keys: TouchKey[]; by: string }> =
    [];

  notifyPlan(reason: PlanUpdateReason, touched?: TouchKey[], by?: string): void {
    this.revision += 1;
    // Tanpa daftar petak, perubahan dianggap menyentuh SEGALANYA. Tahap
    // pipeline, undo, dan editan luar memang bisa menyentuh apa saja, dan
    // menganggapnya tidak menyentuh apa pun akan membuat bentrok yang nyata
    // lolos tanpa suara.
    this.touchLog.push({
      revision: this.revision,
      keys: touched ?? [TOUCH_STRUCTURE, TOUCH_META, TOUCH_AUDIO],
      by: by ?? "Perubahan lain",
    });
    while (this.touchLog.length > 64) this.touchLog.shift();
    this.bus.emit({ type: "plan-updated", reason, revision: this.revision });
  }

  /**
   * Petak yang berubah SEJAK sebuah revisi, atau `null` bila revisinya sudah
   * terlalu tua untuk dijawab.
   *
   * `null` bukan "tidak ada yang berubah" — ia berarti "tidak bisa dijawab",
   * dan pemanggilnya memperlakukannya sebagai bentrok. Menjawab "aman" untuk
   * pertanyaan yang tidak bisa dijawab adalah cara paling halus kehilangan
   * pekerjaan orang.
   */
  changesSince(baseRevision: number): { keys: TouchKey[]; by: string } | null {
    if (baseRevision === this.revision) return { keys: [], by: "" };
    if (baseRevision > this.revision) return null;
    const oldest = this.touchLog[0]?.revision;
    if (oldest === undefined || baseRevision < oldest - 1) return null;
    const keys = new Set<TouchKey>();
    let by = "Perubahan lain";
    for (const entry of this.touchLog) {
      if (entry.revision <= baseRevision) continue;
      for (const key of entry.keys) keys.add(key);
      by = entry.by;
    }
    return { keys: [...keys], by };
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

  /**
   * Plan yang SEGAR: kalau berkasnya diubah pihak lain (server MCP, CLI,
   * editor teks) sejak tulisan terakhir, muat ulang dulu. Job eksklusif
   * memanggil ini SEBELUM membaca `session.plan`, karena pengawas berkas
   * sengaja diam selagi job berjalan — dan job yang menulis di atas plan basi
   * mengembalikan editan orang lain ke keadaan lama tanpa suara.
   */
  freshPlan(): ScenePlan | null {
    const note = this.session.detectExternalEdit();
    if (note) this.notifyPlan("external");
    return this.session.plan;
  }

  /**
   * Simpan hasil tahap pipeline yang bekerja pada snapshot `before` dan
   * menghasilkan `after`. Tahap bisa berjalan lama; kalau selama itu
   * berkasnya diubah pihak lain, editan itu TIDAK ditimpa: yang dipindahkan
   * hanya delta renderState milik tahap, di atas plan terbaru dari disk
   * (`rebaseRenderState`). Tanpa editan luar, `after` ditulis apa adanya.
   */
  commitStage(before: ScenePlan, after: ScenePlan): { rebased: boolean } {
    const external = this.session.detectExternalEdit();
    const base = this.session.plan;
    this.session.plan = external && base ? rebaseRenderState(base, before, after) : after;
    this.session.persist();
    if (external) this.notifyPlan("external");
    return { rebased: Boolean(external) };
  }

  /** Patch cepat (form inspector, lock, reorder) — ditolak saat job berjalan. */
  /**
   * Patch dari seorang PENYUNTING (ADR-0038).
   *
   * `baseRevision` opsional, dan opsionalnya penting: klien lama, CLI, dan
   * server MCP tidak mengirimnya, dan mereka tetap harus bekerja persis
   * seperti sebelumnya. Yang mengirimnya mendapat jaminan tambahan — patch-nya
   * ditolak, bukan diterapkan, kalau petak yang disentuhnya sudah berubah di
   * tangan orang lain.
   */
  applyUserPatch(
    ops: PatchOpInput[],
    context?: { baseRevision?: number; editor?: Editor },
  ): string {
    if (this.mutation) throw new StudioBusyError(this.mutation);
    const touched = patchTouchKeys(ops);
    const base = context?.baseRevision;
    if (base !== undefined) {
      const since = this.changesSince(base);
      if (!since) {
        throw new StudioConflictError(
          [],
          "Proyek sudah berubah lebih jauh daripada yang bisa dibandingkan — muat ulang halamannya dulu.",
        );
      }
      const bentrok = touchConflicts(touched, since.keys);
      if (bentrok.length > 0) {
        throw new StudioConflictError(bentrok, conflictMessage(bentrok, since.by));
      }
    }
    const { summary } = this.session.applyUserPatch(ops);
    this.notifyPlan("patch-user", touched, context?.editor?.name);
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

  snapshot(
    models: ProjectStatePayload["models"],
    publish: Omit<PublishStateLite, "job">,
  ): ProjectStatePayload {
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
      proxyJob: this.proxyJob,
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
      publish: { ...publish, job: this.publishJob },
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
    const { session } = this;
    const dir = join(session.paths.dalangDir, "renders");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => /\.(mp4|webm|mov)$/.test(name))
      .map((name) => {
        const file = join(dir, name);
        const stats = statSync(file);
        // ADR-0030: catatan publikasi dari ledger, supaya UI menunjukkan
        // tautan yang sudah ada alih-alih menawarkan unggahan kedua.
        const published = publishedRecordFor(
          session.db,
          session.projectId,
          session.paths,
          file,
        );
        return {
          label: name.replace(/\.(mp4|webm|mov)$/, ""),
          url: `/.dalang/renders/${name}`,
          sizeBytes: stats.size,
          finishedAt: stats.mtime.toISOString(),
          ...(published
            ? {
                published: {
                  targetId: published.targetId,
                  url: published.url,
                  privacy: published.privacy,
                  at: published.at,
                },
              }
            : {}),
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
