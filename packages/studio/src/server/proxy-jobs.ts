import {
  type MediaProbeNote,
  type ProxyMedia,
  type ScenePlan,
  setProxy,
} from "@dalang/core";
import { proxyCandidates, runProxyStage } from "@dalang/pipeline";
import type { ProxyJobLite } from "../shared/api-types";
import type { StudioContext } from "./context";

/**
 * Proxy DI LATAR (ADR-0028 §10).
 *
 * Versi pertama menjalankan tahap proxy di dalam `runExclusive`: satu rekaman
 * satu jam berarti editor terkunci beberapa menit tanpa angka kemajuan. Kini
 * tahapnya berjalan di latar TANPA kunci mutasi — patch, undo, dan render
 * tetap jalan — dan setiap berkas yang selesai ditulis ke plan HIDUP lewat
 * `setProxy` (data turunan di renderState, di luar log patch, jadi tidak
 * pernah bertabrakan dengan undo).
 *
 * Dua jebakan yang ditangani, bukan diharapkan tidak terjadi:
 *  - Mutasi lain (TTS, aset) memegang SNAPSHOT plan dan menulisnya kembali
 *    saat selesai; proxy yang ditulis di tengah-tengahnya akan tertimpa.
 *    Karena itu proxy diterapkan ulang setiap kali plan berubah atau kunci
 *    mutasi lepas — idempoten, dan hanya menulis kalau memang hilang.
 *  - Permintaan kedua selagi berjalan tidak ditolak: ia ANTRE, karena
 *    "coba lagi nanti" untuk rekaman yang baru dipasang adalah pekerjaan
 *    yang pengguna tidak seharusnya ingat.
 */

const IDLE: ProxyJobLite = {
  running: false,
  file: null,
  label: null,
  index: 0,
  total: 0,
  fraction: 0,
  done: 0,
  failed: 0,
  cancelled: false,
};

interface Applied {
  proxy: ProxyMedia | null;
  note: MediaProbeNote;
}

export interface ProxyStartOutcome {
  started: boolean;
  queued: boolean;
  reason?: string;
  job: ProxyJobLite;
}

const proxyFileOf = (plan: ScenePlan, file: string): string | null => {
  for (const store of [plan.renderState.clipAssets, plan.renderState.layerAssets]) {
    for (const asset of Object.values(store)) {
      if (asset.file === file) return asset.proxy?.file ?? null;
    }
  }
  return null;
};

export class ProxyJobRunner {
  private controller: AbortController | null = null;
  private queue: Array<{ files: string[] | null; force: boolean }> = [];
  private readonly applied = new Map<string, Applied>();
  private readonly written = new Set<string>();
  private job: ProxyJobLite = IDLE;

  constructor(private readonly ctx: StudioContext) {
    ctx.store.bus.subscribe((event) => {
      if (event.type === "project-closed") {
        this.cancel();
        this.applied.clear();
        this.written.clear();
        return;
      }
      if (
        (event.type === "busy" && event.busy.mutation === null) ||
        event.type === "plan-updated"
      ) {
        this.ensureApplied();
      }
    });
  }

  get status(): ProxyJobLite {
    return this.job;
  }

  /** Mulai (atau antrekan) pembuatan proxy untuk `files` (null = semua kandidat). */
  start(files: string[] | null, force: boolean): ProxyStartOutcome {
    const plan = this.ctx.store.session.plan;
    if (!plan) {
      return {
        started: false,
        queued: false,
        reason: "proyek belum punya scene-plan",
        job: this.job,
      };
    }
    const wanted = files ? new Set(files) : null;
    const total = proxyCandidates(plan).filter(
      (job) => !wanted || wanted.has(job.file),
    ).length;
    if (total === 0) {
      return {
        started: false,
        queued: false,
        reason: "tidak ada berkas video yang perlu proxy",
        job: this.job,
      };
    }
    if (this.controller) {
      this.queue.push({ files, force });
      return { started: true, queued: true, job: this.job };
    }
    this.launch(plan, files, force, total);
    return { started: true, queued: false, job: this.job };
  }

  /** Hentikan yang sedang berjalan dan buang antrean; false bila tidak ada. */
  cancel(): boolean {
    this.queue = [];
    if (!this.controller) return false;
    this.controller.abort();
    return true;
  }

  private publish(job: ProxyJobLite): void {
    this.job = job;
    this.ctx.store.proxyJob = job.running ? job : null;
    this.ctx.store.bus.emit({ type: "proxy-progress", job });
  }

  private launch(
    plan: ScenePlan,
    files: string[] | null,
    force: boolean,
    total: number,
  ): void {
    const { store, deps } = this.ctx;
    const { session } = store;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ ...IDLE, running: true, total });
    const transcoder = deps.transcoder?.();
    void runProxyStage({
      paths: session.paths,
      plan,
      db: session.db,
      ...(transcoder ? { transcoder } : {}),
      ...(files ? { files } : {}),
      force,
      signal: controller.signal,
      log: { info: () => {}, warn: () => {} },
      onProgress: (event) =>
        this.publish({
          ...this.job,
          file: event.file,
          label: event.label,
          index: event.index,
          total: event.total,
          fraction: event.fraction,
        }),
      onFile: (event) => {
        if (event.proxy !== undefined) {
          this.applied.set(event.file, { proxy: event.proxy, note: event.note ?? {} });
          this.written.delete(event.file);
          this.ensureApplied();
        }
        // Berkas yang dilewati KARENA dibatalkan bukan "selesai": angkanya
        // harus jujur tentang apa yang sempat dikerjakan sebelum berhenti.
        const failed = event.result.status === "error";
        const abandoned = controller.signal.aborted && event.result.status === "skipped";
        this.publish({
          ...this.job,
          done: this.job.done + (failed || abandoned ? 0 : 1),
          failed: this.job.failed + (failed ? 1 : 0),
          fraction: 1,
        });
        store.bus.emit({
          type: "stage-results",
          stage: "proxy",
          results: [
            {
              sceneId: event.result.sceneId,
              status: event.result.status,
              detail: event.result.detail,
            },
          ],
        });
      },
    })
      .catch(() => undefined)
      .finally(() => {
        this.controller = null;
        this.publish({
          ...this.job,
          running: false,
          file: null,
          label: null,
          cancelled: controller.signal.aborted,
        });
        const next = this.queue.shift();
        if (next) this.start(next.files, next.force);
      });
  }

  /**
   * Tulis proxy yang sudah jadi ke plan HIDUP. Ditunda selagi mutasi lain
   * memegang kunci (ia akan menulis plan-nya sendiri); dipanggil lagi begitu
   * kunci lepas atau plan berubah, dan hanya menulis yang belum ada.
   */
  private ensureApplied(): void {
    const { store } = this.ctx;
    const { session } = store;
    if (store.busy.mutation || !session.plan || this.applied.size === 0) return;
    let plan = session.plan;
    let changed = false;
    for (const [file, { proxy, note }] of this.applied) {
      const wantedFile = proxy?.file ?? null;
      if (this.written.has(file) && proxyFileOf(plan, file) === wantedFile) continue;
      plan = setProxy(plan, file, proxy, note);
      this.written.add(file);
      changed = true;
    }
    if (!changed) return;
    session.plan = plan;
    session.persist();
    store.notifyPlan("pipeline");
  }
}
