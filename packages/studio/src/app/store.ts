import type { Memory, MemoryKind, PatchOpInput } from "@dalang/core";
import type {
  ChatTurnResultLite,
  ExportSettingsLite,
  NewProjectRequest,
  ProjectStatePayload,
  RegisterSourceRequest,
  SourceLite,
  StockCandidateLite,
  StudioEvent,
  WorkspacePayload,
} from "../shared/api-types";
import { ApiError, api, ConfirmationRequired } from "./api";

/**
 * Store klien: satu sumber state untuk ketiga panel, disuplai snapshot
 * /api/project + broadcast SSE. Komponen membaca lewat useSyncExternalStore;
 * semua aksi (patch, chat, job) lewat method di sini — TIDAK ada state produk
 * di komponen.
 */

export interface ActivityLine {
  id: number;
  line: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "agent" | "system";
  text: string;
  /** Data URL gambar yang dilampirkan user (thumbnail di bubble). */
  images: string[];
  activities: ActivityLine[];
  result: ChatTurnResultLite | null;
  pending: boolean;
}

export interface PendingApproval {
  id: string;
  action: string;
  detail: string;
  estimatedUsd: number | null;
}

export interface PendingConfirm {
  detail: string;
  estimatedUsd: number | null;
  /** Jalankan ulang aksi dengan confirm: true. */
  proceed: () => void;
}

export interface AssetSearchState {
  sceneId: string;
  /** Lapisan tujuan (ADR-0025); null = visual dasar scene. */
  layerId: string | null;
  query: string;
  kind: "video" | "image";
  loading: boolean;
  provider: string | null;
  candidates: StockCandidateLite[];
  error: string | null;
}

/** Daftar rekaman proyek (ADR-0028) — diambil saat panel sumber dibuka. */
export interface SourcesState {
  loading: boolean;
  error: string | null;
  transcoder: boolean;
  maxUploadBytes: number;
  items: SourceLite[];
}

export interface RenderProgress {
  /** Deskripsi ekspor, mis. "mp4 1080p seimbang". */
  label: string;
  status: "started" | "done" | "error";
  url?: string;
  error?: string;
  /** Kenyaringan campuran akhir hasil render (ADR-0028); null = tidak terukur. */
  mixLufs?: number | null;
  /** Berkas video yang dirender dari proxy (ADR-0028). */
  proxied?: number;
  /** Penguatan koreksi campuran akhir, dB (ADR-0028 §9). */
  mixGainDb?: number;
  mixNote?: string;
}

export interface StudioState {
  loading: boolean;
  fatal: string | null;
  /**
   * Layar aktif. Lobi bukan modal di atas editor: tanpa proyek terbuka, server
   * memang tidak punya sesi, dan UI harus jujur soal itu.
   */
  view: "lobby" | "editor";
  workspace: WorkspacePayload | null;
  /** Memori preferensi lintas proyek (ADR-0029); null = belum dimuat. */
  memory: Memory | null;
  /** Id proyek yang sedang dibuka/dibuat — kartu terkait tampil menunggu. */
  switching: string | null;
  project: ProjectStatePayload | null;
  selectedSceneId: string | null;
  chat: ChatMessage[];
  chatBusy: boolean;
  approval: PendingApproval | null;
  confirm: PendingConfirm | null;
  /** Lampiran gambar menunggu dikirim bersama pesan berikutnya. */
  pendingImages: string[];
  assetSearch: AssetSearchState | null;
  renderProgress: RenderProgress | null;
  /** Daftar rekaman proyek (ADR-0028); null = belum pernah dibuka. */
  sources: SourcesState | null;
  /** Unggahan rekaman yang sedang berjalan (ADR-0028). */
  sourceUpload: { name: string; progress: number } | null;
  toast: string | null;
  /** Status SSE: false = terputus, EventSource sedang menyambung ulang. */
  connected: boolean;
}

type Listener = () => void;

const emptyState: StudioState = {
  loading: true,
  fatal: null,
  view: "lobby",
  workspace: null,
  memory: null,
  switching: null,
  project: null,
  selectedSceneId: null,
  chat: [],
  chatBusy: false,
  approval: null,
  confirm: null,
  pendingImages: [],
  assetSearch: null,
  renderProgress: null,
  sources: null,
  sourceUpload: null,
  toast: null,
  connected: true,
};

export class StudioClient {
  private state: StudioState = emptyState;
  private listeners = new Set<Listener>();
  private nextMessageId = 1;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private stopEvents: (() => void) | null = null;

  // -- plumbing --------------------------------------------------------------

  getState = (): StudioState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<StudioState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private toast(message: string): void {
    this.set({ toast: message });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.set({ toast: null }), 4200);
  }

  private failure(error: unknown): void {
    if (error instanceof ConfirmationRequired) return; // ditangani pemanggil
    const message =
      error instanceof ApiError || error instanceof Error ? error.message : String(error);
    this.toast(`Gagal: ${message}`);
  }

  // -- lifecycle -------------------------------------------------------------

  async start(): Promise<void> {
    try {
      const workspace = await api.getWorkspace();
      this.set({ workspace });
      void this.loadMemory();
      if (workspace.open) await this.enterEditor();
      else this.set({ view: "lobby" });
    } catch (error) {
      this.set({ fatal: error instanceof Error ? error.message : String(error) });
    }
    this.set({ loading: false });
  }

  // -- lobi ------------------------------------------------------------------

  /**
   * Masuk editor: langganan SSE dibuka SETELAH sesi proyek ada di server,
   * karena tanpa proyek `/api/events` menjawab 409 dan EventSource akan
   * mencoba ulang tanpa henti.
   */
  private async enterEditor(): Promise<void> {
    this.stopEvents?.();
    this.stopEvents = api.subscribeEvents(
      (event) => this.onEvent(event),
      (connected) => {
        const wasConnected = this.state.connected;
        if (connected === wasConnected) return;
        this.set({ connected });
        if (connected && !wasConnected) {
          // Tersambung ulang: segarkan state — event saat putus tak terkirim.
          void this.refresh();
          this.toast("Tersambung kembali — state disegarkan");
        }
      },
    );
    await this.refresh();
    this.set({ view: "editor" });
  }

  /** Kembali ke lobi: sesi editor dilepas seluruhnya, bukan disembunyikan. */
  private leaveEditor(workspace: WorkspacePayload | null): void {
    this.stopEvents?.();
    this.stopEvents = null;
    this.set({
      view: "lobby",
      project: null,
      selectedSceneId: null,
      chat: [],
      chatBusy: false,
      approval: null,
      confirm: null,
      assetSearch: null,
      renderProgress: null,
      sources: null,
      sourceUpload: null,
      connected: true,
      switching: null,
      ...(workspace ? { workspace } : {}),
    });
  }

  /** Memori preferensi lintas proyek (ADR-0029): dibaca dari lobi. */
  async loadMemory(): Promise<void> {
    try {
      const { memory } = await api.getMemory();
      this.set({ memory });
    } catch {
      // Lobi tanpa memori (server lama) tetap berjalan; bagiannya kosong.
    }
  }

  async addMemory(jenis: MemoryKind, teks: string): Promise<void> {
    try {
      const reply = await api.addMemory(jenis, teks);
      this.set({ memory: reply.memory });
      this.toast(
        reply.duplicate
          ? "Preferensi itu sudah ada"
          : "Preferensi disimpan — berlaku di semua proyek",
      );
    } catch (error) {
      this.failure(error);
    }
  }

  async removeMemory(id: string): Promise<void> {
    try {
      const { memory } = await api.removeMemory(id);
      this.set({ memory });
      this.toast("Preferensi dihapus");
    } catch (error) {
      this.failure(error);
    }
  }

  async refreshWorkspace(): Promise<void> {
    try {
      this.set({ workspace: await api.getWorkspace() });
    } catch (error) {
      this.failure(error);
    }
  }

  async openProject(id: string): Promise<void> {
    if (this.state.switching) return;
    this.set({ switching: id });
    try {
      const { workspace } = await api.openProject(id);
      this.set({ workspace, project: null, selectedSceneId: null, chat: [] });
      await this.enterEditor();
    } catch (error) {
      this.failure(error);
    } finally {
      this.set({ switching: null });
    }
  }

  async createProject(input: NewProjectRequest): Promise<boolean> {
    if (this.state.switching) return false;
    this.set({ switching: "baru" });
    try {
      const { project, workspace } = await api.createProject(input);
      this.set({ workspace, project: null, selectedSceneId: null, chat: [] });
      await this.enterEditor();
      this.toast(`Proyek "${project.title}" siap — folder ${project.id}`);
      return true;
    } catch (error) {
      this.failure(error);
      return false;
    } finally {
      this.set({ switching: null });
    }
  }

  /**
   * Impor berkas interchange jadi proyek baru (ADR-0023).
   *
   * Catatan impornya dikembalikan, bukan cuma di-toast: daftar "yang tidak
   * ikut" bisa panjang, dan toast yang hilang dalam tiga detik adalah cara
   * paling efektif untuk membuat orang mengira impornya utuh.
   */
  async importTimeline(isi: string, judul?: string): Promise<string[] | null> {
    if (this.state.switching) return null;
    this.set({ switching: "baru" });
    try {
      const { project, workspace, catatan } = await api.importTimeline(isi, judul);
      this.set({ workspace, project: null, selectedSceneId: null, chat: [] });
      await this.enterEditor();
      this.toast(`Diimpor jadi "${project.title}" — folder ${project.id}`);
      return catatan;
    } catch (error) {
      this.failure(error);
      return null;
    } finally {
      this.set({ switching: null });
    }
  }

  async backToLobby(): Promise<void> {
    try {
      const { workspace } = await api.closeProject();
      this.leaveEditor(workspace);
    } catch (error) {
      this.failure(error);
    }
  }

  async renameProject(id: string, title: string): Promise<void> {
    try {
      const { workspace } = await api.renameProject(id, title);
      this.set({ workspace });
      if (this.state.view === "editor") await this.refresh();
      this.toast(`Judul proyek jadi "${title}"`);
    } catch (error) {
      this.failure(error);
    }
  }

  async duplicateProject(id: string): Promise<void> {
    try {
      const { project, workspace } = await api.duplicateProject(id);
      this.set({ workspace });
      this.toast(`Salinan dibuat: ${project.id} (tanpa cache & riwayat proyek asal)`);
    } catch (error) {
      this.failure(error);
    }
  }

  async trashProject(id: string): Promise<void> {
    try {
      const { workspace, trashedTo } = await api.trashProject(id);
      if (workspace.open === null && this.state.view === "editor") {
        this.leaveEditor(workspace);
      } else {
        this.set({ workspace });
      }
      this.toast(`Dipindah ke ${trashedTo} — masih bisa dikembalikan dari folder`);
    } catch (error) {
      this.failure(error);
    }
  }

  /** Unggah gambar lokal ke scene (server menulis file + patch + pin). */
  async uploadAsset(sceneId: string, filename: string, dataUrl: string): Promise<void> {
    try {
      const { file } = await api.uploadAsset(sceneId, filename, dataUrl);
      this.toast(`Gambar terpasang dan ter-pin: ${file}`);
      await this.refresh();
    } catch (error) {
      this.failure(error);
    }
  }

  // --- Sumber rekaman & proxy (ADR-0028) -------------------------------------

  async loadSources(): Promise<void> {
    const previous = this.state.sources;
    this.set({
      sources: {
        loading: true,
        error: null,
        transcoder: previous?.transcoder ?? true,
        maxUploadBytes: previous?.maxUploadBytes ?? 0,
        items: previous?.items ?? [],
      },
    });
    try {
      const payload = await api.listSources();
      this.set({
        sources: {
          loading: false,
          error: null,
          transcoder: payload.transcoder,
          maxUploadBytes: payload.maxUploadBytes,
          items: payload.sources,
        },
      });
    } catch (error) {
      this.set({
        sources: {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          transcoder: previous?.transcoder ?? true,
          maxUploadBytes: previous?.maxUploadBytes ?? 0,
          items: previous?.items ?? [],
        },
      });
    }
  }

  /** Pasang rekaman yang sudah ada di folder proyek ke scene/lapisan. */
  async registerSource(req: RegisterSourceRequest): Promise<boolean> {
    try {
      const result = await api.registerSource(req);
      this.toast(
        result.proxy
          ? `Rekaman terpasang · proxy ${result.proxy.width}×${result.proxy.height} siap`
          : `Rekaman terpasang · ${result.proxyNote}`,
      );
      await this.refresh();
      void this.loadSources();
      return true;
    } catch (error) {
      this.failure(error);
      return false;
    }
  }

  /** Unggah rekaman (streaming, dengan kemajuan) lalu pasang ke scene/lapisan. */
  async uploadSource(
    file: File,
    target: { sceneId: string; layerId?: string | null } | null,
  ): Promise<void> {
    this.set({ sourceUpload: { name: file.name, progress: 0 } });
    try {
      const uploaded = await api.uploadSource(file, (progress) =>
        this.set({ sourceUpload: { name: file.name, progress } }),
      );
      this.set({ sourceUpload: null });
      if (uploaded.existed) this.toast(`Rekaman yang sama sudah ada: ${uploaded.file}`);
      if (target) {
        await this.registerSource({
          file: uploaded.file,
          sceneId: target.sceneId,
          ...(target.layerId ? { layerId: target.layerId } : {}),
        });
      } else {
        this.toast(`Rekaman tersimpan: ${uploaded.file}`);
        void this.loadSources();
      }
    } catch (error) {
      this.set({ sourceUpload: null });
      this.failure(error);
    }
  }

  /** Proxy dibuat DI LATAR (ADR-0028 §10): jawabannya segera, hasilnya lewat event. */
  async runProxies(files?: string[], force?: boolean): Promise<void> {
    try {
      const reply = await api.runProxies(files, force);
      if (!reply.started) {
        this.toast(reply.reason ?? "Tidak ada berkas video yang perlu proxy");
        return;
      }
      this.toast(
        reply.queued
          ? "Proxy antre di belakang yang sedang dibuat"
          : `Proxy dibuat di latar (${reply.job.total} berkas) — editor tetap bisa dipakai`,
      );
    } catch (error) {
      this.failure(error);
    }
  }

  async cancelProxies(): Promise<void> {
    try {
      const { cancelled } = await api.cancelProxies();
      if (!cancelled) this.toast("Tidak ada pembuatan proxy yang berjalan");
    } catch (error) {
      this.failure(error);
    }
  }

  /** Belah scene di titik waktu lokal (ADR-0015); bisa di-undo. */
  async splitScene(sceneId: string, atSec: number): Promise<void> {
    try {
      const { newId } = await api.splitScene(sceneId, atSec);
      this.toast(`Scene dibelah — bagian kedua: ${newId}`);
      await this.refresh();
    } catch (error) {
      this.failure(error);
    }
  }

  // --- Pustaka media (ADR-0018) ---------------------------------------------
  //
  // Ketiganya memakai jalur yang sama dengan panel manual lain: server menulis
  // berkas, mengisi renderState, lalu menerapkan SATU patch user — jadi
  // hasilnya bisa di-undo dan terlihat agent di giliran berikutnya.

  async addIcon(input: {
    sceneId: string;
    iconId: string;
    anchor: string;
    size: number;
    color: string | null;
    anim: string;
  }): Promise<boolean> {
    try {
      await api.addIcon(input);
      this.toast(`Ikon ${input.iconId} terpasang`);
      await this.refresh();
      return true;
    } catch (error) {
      this.failure(error);
      return false;
    }
  }

  async addSticker(input: {
    sceneId: string;
    query: string;
    index: number;
    anchor: string;
    size: number;
    anim: string;
  }): Promise<boolean> {
    try {
      await api.addSticker(input);
      this.toast("Stiker terpasang — periksa hak pakainya sebelum publikasi");
      await this.refresh();
      return true;
    } catch (error) {
      this.failure(error);
      return false;
    }
  }

  async addSfx(input: {
    sceneId: string;
    assetId: string;
    atSec: number;
    volume: number;
  }): Promise<boolean> {
    try {
      const { cueId } = await api.addSfx(input);
      this.toast(`Efek suara terpasang: ${cueId}`);
      await this.refresh();
      return true;
    } catch (error) {
      this.failure(error);
      return false;
    }
  }

  stop(): void {
    this.stopEvents?.();
  }

  private onEvent(event: StudioEvent): void {
    switch (event.type) {
      case "plan-updated":
        this.scheduleRefresh();
        break;
      case "busy": {
        const project = this.state.project;
        if (project) {
          this.set({ project: { ...project, busy: event.busy } });
        }
        break;
      }
      case "proxy-progress": {
        const project = this.getState().project;
        if (project)
          this.set({
            project: { ...project, proxyJob: event.job.running ? event.job : null },
          });
        if (!event.job.running) {
          this.toast(
            event.job.cancelled
              ? `Proxy dibatalkan (${event.job.done} selesai sebelum berhenti)`
              : `Proxy selesai: ${event.job.done} berkas${event.job.failed ? `, ${event.job.failed} gagal` : ""}`,
          );
          this.scheduleRefresh();
          void this.loadSources();
        }
        break;
      }
      case "stage-results": {
        const errors = event.results.filter((r) => r.status === "error");
        if (errors.length > 0) {
          this.toast(
            `Gagal (${event.stage}) ${errors[0]?.sceneId}: ${errors[0]?.detail}`,
          );
        }
        this.scheduleRefresh();
        break;
      }
      case "project-closed":
        // Server melepas proyek (mis. dibuang dari lobi di tab lain).
        this.leaveEditor(null);
        void this.refreshWorkspace();
        break;
      case "render":
        this.set({
          renderProgress: {
            label: event.label,
            status: event.status,
            ...(event.url ? { url: event.url } : {}),
            ...(event.error ? { error: event.error } : {}),
            ...(event.mixLufs !== undefined ? { mixLufs: event.mixLufs } : {}),
            ...(event.mixGainDb ? { mixGainDb: event.mixGainDb } : {}),
            ...(event.mixNote ? { mixNote: event.mixNote } : {}),
            ...(event.proxied ? { proxied: event.proxied } : {}),
          },
        });
        if (event.status === "done") {
          this.toast(
            typeof event.mixLufs === "number"
              ? `Ekspor ${event.label} selesai · campuran akhir ${event.mixLufs.toFixed(1)} LUFS${
                  event.mixGainDb
                    ? ` (dikoreksi ${event.mixGainDb > 0 ? "+" : ""}${event.mixGainDb.toFixed(1)} dB)`
                    : ""
                }`
              : `Ekspor ${event.label} selesai`,
          );
          this.scheduleRefresh();
        }
        if (event.status === "error") this.toast(`Render gagal: ${event.error}`);
        break;
      default:
        break;
    }
  }

  /** Gabungkan burst plan-updated jadi satu fetch. */
  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 120);
  }

  async refresh(): Promise<void> {
    try {
      const project = await api.getProject();
      const selected =
        this.state.selectedSceneId &&
        project.plan?.scenes.some((scene) => scene.id === this.state.selectedSceneId)
          ? this.state.selectedSceneId
          : (project.plan?.scenes[0]?.id ?? null);
      this.set({ project, selectedSceneId: selected, fatal: null });
    } catch (error) {
      if (this.state.project === null) {
        this.set({
          fatal: error instanceof Error ? error.message : String(error),
        });
      } else {
        this.failure(error);
      }
    }
  }

  // -- seleksi & patch manual ------------------------------------------------

  selectScene(id: string | null): void {
    this.set({ selectedSceneId: id });
  }

  async applyPatch(ops: PatchOpInput[], label?: string): Promise<boolean> {
    try {
      const { summary } = await api.patch(ops);
      this.toast(label ?? summary);
      await this.refresh();
      return true;
    } catch (error) {
      this.failure(error);
      return false;
    }
  }

  async undo(): Promise<void> {
    try {
      const { summary } = await api.undo();
      this.toast(summary ? `Undo: ${summary}` : "Tidak ada yang bisa di-undo");
      await this.refresh();
    } catch (error) {
      this.failure(error);
    }
  }

  async redo(): Promise<void> {
    try {
      const { summary } = await api.redo();
      this.toast(summary ? `Redo: ${summary}` : "Tidak ada yang bisa di-redo");
      await this.refresh();
    } catch (error) {
      this.failure(error);
    }
  }

  // -- jobs (dengan alur konfirmasi 428, §8.2) -------------------------------

  private async withConfirm(run: (confirm: boolean) => Promise<void>): Promise<void> {
    try {
      await run(false);
    } catch (error) {
      if (error instanceof ConfirmationRequired) {
        this.set({
          confirm: {
            detail: error.detail,
            estimatedUsd: error.estimatedUsd,
            proceed: () => {
              this.set({ confirm: null });
              run(true).catch((err) => this.failure(err));
            },
          },
        });
        return;
      }
      this.failure(error);
    }
  }

  dismissConfirm(): void {
    this.set({ confirm: null });
  }

  runTts(sceneIds?: string[]): Promise<void> {
    return this.withConfirm(async (confirm) => {
      await api.runTts(sceneIds, confirm);
      this.toast("Voiceover selesai diproses");
    });
  }

  /**
   * Transkripsi (ADR-0021). Galatnya SENGAJA dilempar ulang, tidak ditelan
   * jadi toast: pesan "tidak ada jalur ASR" menyebut persis apa yang harus
   * dipasang, dan panelnya menampilkannya utuh di tempat orang membacanya.
   */
  async transcribe(sceneIds: string[] | undefined, diarize: boolean): Promise<void> {
    const results = await api.runTranscribe(sceneIds, diarize);
    const gagal = results.results.filter((item) => item.status === "error").length;
    this.toast(
      gagal > 0
        ? `Transkripsi selesai dengan ${gagal} rekaman bermasalah`
        : "Transkripsi selesai",
    );
  }

  runAssets(sceneIds?: string[]): Promise<void> {
    return this.withConfirm(async (confirm) => {
      await api.runAssets(sceneIds, confirm);
      this.toast("Resolve aset selesai");
    });
  }

  startRender(profile: "draft" | "final"): Promise<void> {
    return this.withConfirm(async (confirm) => {
      await api.render({ profile, confirm });
    });
  }

  /** Dipanggil dari dialog Ekspor — pilihan di dialog ADALAH konfirmasinya. */
  async startExportConfirmed(settings: ExportSettingsLite): Promise<void> {
    try {
      await api.render({ ...settings, confirm: true });
    } catch (error) {
      this.failure(error);
    }
  }

  // -- grid aset (search → pick = patch user ter-pin) ------------------------

  async searchAssets(
    sceneId: string,
    query: string,
    kind: "video" | "image",
    layerId: string | null = null,
  ) {
    this.set({
      assetSearch: {
        sceneId,
        layerId,
        query,
        kind,
        loading: true,
        provider: null,
        candidates: [],
        error: null,
      },
    });
    try {
      const result = await api.stockSearch(query, kind);
      this.set({
        assetSearch: {
          sceneId,
          layerId,
          query: result.query,
          kind,
          loading: false,
          provider: result.provider,
          candidates: result.candidates,
          error: null,
        },
      });
    } catch (error) {
      this.set({
        assetSearch: {
          sceneId,
          layerId,
          query,
          kind,
          loading: false,
          provider: null,
          candidates: [],
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  closeAssetSearch(): void {
    this.set({ assetSearch: null });
  }

  async pickAsset(index: number): Promise<void> {
    const search = this.state.assetSearch;
    if (!search) return;
    try {
      const result = await api.stockPick(
        search.sceneId,
        search.query,
        index,
        search.layerId ?? undefined,
      );
      this.toast(
        search.layerId
          ? `Aset lapisan ${search.layerId} terpasang: ${result.file}`
          : `Aset terpasang dan ter-pin: ${result.file}`,
      );
      this.set({ assetSearch: null });
      await this.refresh();
    } catch (error) {
      this.failure(error);
    }
  }

  // -- chat ------------------------------------------------------------------

  /** Lampirkan gambar (data URL) untuk pesan berikutnya. */
  attachImage(dataUrl: string): void {
    if (this.state.pendingImages.length >= 3) {
      this.toast("Maksimal 3 gambar per pesan");
      return;
    }
    if (dataUrl.length * 0.75 > 4 * 1024 * 1024) {
      this.toast("Gambar terlalu besar (maks 4MB)");
      return;
    }
    this.set({ pendingImages: [...this.state.pendingImages, dataUrl] });
  }

  removeImage(index: number): void {
    this.set({
      pendingImages: this.state.pendingImages.filter((_, i) => i !== index),
    });
  }

  async sendChat(text: string): Promise<void> {
    if (this.state.chatBusy || text.trim() === "") return;
    const images = this.state.pendingImages;
    const userMessage: ChatMessage = {
      id: this.nextMessageId++,
      role: "user",
      text: text.trim(),
      images,
      activities: [],
      result: null,
      pending: false,
    };
    const agentMessage: ChatMessage = {
      id: this.nextMessageId++,
      role: "agent",
      text: "",
      images: [],
      activities: [],
      result: null,
      pending: true,
    };
    this.set({
      chat: [...this.state.chat, userMessage, agentMessage],
      chatBusy: true,
      pendingImages: [],
    });

    const patchAgent = (patch: Partial<ChatMessage>) => {
      this.set({
        chat: this.state.chat.map((message) =>
          message.id === agentMessage.id ? { ...message, ...patch } : message,
        ),
      });
    };

    try {
      await api.chat(userMessage.text, images, (event) => {
        switch (event.type) {
          case "activity": {
            const current = this.state.chat.find((m) => m.id === agentMessage.id);
            patchAgent({
              activities: [
                ...(current?.activities ?? []),
                { id: this.nextMessageId++, line: event.line.trim() },
              ],
            });
            break;
          }
          case "approval-request":
            this.set({
              approval: {
                id: event.id,
                action: event.action,
                detail: event.detail,
                estimatedUsd: event.estimatedUsd,
              },
            });
            break;
          case "approval-resolved":
            this.set({ approval: null });
            break;
          case "done":
            patchAgent({ text: event.result.text, result: event.result, pending: false });
            break;
          case "error":
            patchAgent({
              text: `Gagal: ${event.message}`,
              role: "system",
              pending: false,
            });
            break;
          default:
            break;
        }
      });
    } catch (error) {
      patchAgent({
        text: `Gagal: ${error instanceof Error ? error.message : String(error)}`,
        role: "system",
        pending: false,
      });
    } finally {
      this.set({ chatBusy: false, approval: null });
      void this.refresh();
    }
  }

  async answerApproval(approved: boolean): Promise<void> {
    const approval = this.state.approval;
    if (!approval) return;
    try {
      await api.answerApproval(approval.id, approved);
      this.set({ approval: null });
    } catch (error) {
      this.failure(error);
    }
  }
}

export const studioClient = new StudioClient();
