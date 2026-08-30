import type { PatchOpInput } from "@dalang/core";
import type {
  ChatTurnResultLite,
  ExportSettingsLite,
  ProjectStatePayload,
  StockCandidateLite,
  StudioEvent,
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
  query: string;
  kind: "video" | "image";
  loading: boolean;
  provider: string | null;
  candidates: StockCandidateLite[];
  error: string | null;
}

export interface RenderProgress {
  /** Deskripsi ekspor, mis. "mp4 1080p seimbang". */
  label: string;
  status: "started" | "done" | "error";
  url?: string;
  error?: string;
}

export interface StudioState {
  loading: boolean;
  fatal: string | null;
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
  toast: string | null;
  /** Status SSE: false = terputus, EventSource sedang menyambung ulang. */
  connected: boolean;
}

type Listener = () => void;

const emptyState: StudioState = {
  loading: true,
  fatal: null,
  project: null,
  selectedSceneId: null,
  chat: [],
  chatBusy: false,
  approval: null,
  confirm: null,
  pendingImages: [],
  assetSearch: null,
  renderProgress: null,
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
    this.set({ loading: false });
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
      case "render":
        this.set({
          renderProgress: {
            label: event.label,
            status: event.status,
            ...(event.url ? { url: event.url } : {}),
            ...(event.error ? { error: event.error } : {}),
          },
        });
        if (event.status === "done") {
          this.toast(`Ekspor ${event.label} selesai`);
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

  async searchAssets(sceneId: string, query: string, kind: "video" | "image") {
    this.set({
      assetSearch: {
        sceneId,
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
      const result = await api.stockPick(search.sceneId, search.query, index);
      this.toast(`Aset terpasang dan ter-pin: ${result.file}`);
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
