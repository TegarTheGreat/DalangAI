import { useSyncExternalStore } from "react";

/**
 * Preferensi UI murni (laci panel terbuka/tertutup) — terpisah dari state
 * produk. Default mengikuti lebar layar: di layar sempit kedua laci tertutup
 * agar panggung + timeline yang tampil dulu.
 *
 * Lebarnya DIPANTAU, bukan dibaca sekali saat memuat. Sebelumnya nilainya
 * dihitung di tingkat modul, jadi jendela yang dikecilkan (atau tablet yang
 * diputar) meninggalkan dua laci melayang menutupi seluruh panggung — persis
 * keadaan yang aturan ini seharusnya cegah.
 */

interface UiState {
  chatOpen: boolean;
  inspectorOpen: boolean;
}

type Listener = () => void;

/** Ambang yang sama dengan `@media (max-width: 1100px)` di styles.css. */
const DRAWER_WIDTH = 1100;
const isWide = (): boolean =>
  typeof window === "undefined" || window.innerWidth > DRAWER_WIDTH;

class UiStore {
  private state: UiState = { chatOpen: isWide(), inspectorOpen: isWide() };
  private listeners = new Set<Listener>();
  /** Laci yang KAMI tutup karena layar menyempit — bukan yang ditutup user. */
  private autoClosed = { chat: false, inspector: false };

  constructor() {
    if (typeof window === "undefined") return;
    let wasWide = isWide();
    window.addEventListener("resize", () => {
      const wide = isWide();
      if (wide === wasWide) return;
      wasWide = wide;
      if (!wide) {
        // Menyempit: laci melayang yang saling menumpuk menutupi panggung.
        this.autoClosed = {
          chat: this.state.chatOpen,
          inspector: this.state.inspectorOpen,
        };
        this.set({ chatOpen: false, inspectorOpen: false });
        return;
      }
      // Melebar lagi: kembalikan HANYA yang kami tutup sendiri — membuka
      // kembali panel yang sengaja ditutup user terasa seperti melawan.
      this.set({
        ...(this.autoClosed.chat ? { chatOpen: true } : {}),
        ...(this.autoClosed.inspector ? { inspectorOpen: true } : {}),
      });
      this.autoClosed = { chat: false, inspector: false };
    });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): UiState => this.state;

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  toggleChat(): void {
    // Di layar sempit, laci saling eksklusif agar tidak saling menumpuk.
    const next = !this.state.chatOpen;
    this.autoClosed.chat = false;
    this.set({
      chatOpen: next,
      ...(next && !isWide() ? { inspectorOpen: false } : {}),
    });
  }

  toggleInspector(): void {
    const next = !this.state.inspectorOpen;
    this.autoClosed.inspector = false;
    this.set({
      inspectorOpen: next,
      ...(next && !isWide() ? { chatOpen: false } : {}),
    });
  }

  closeChat(): void {
    this.autoClosed.chat = false;
    this.set({ chatOpen: false });
  }

  closeInspector(): void {
    this.autoClosed.inspector = false;
    this.set({ inspectorOpen: false });
  }

  openChat(): void {
    this.autoClosed.chat = false;
    this.set({
      chatOpen: true,
      ...(isWide() ? {} : { inspectorOpen: false }),
    });
  }
}

export const uiStore = new UiStore();

export const useUi = (): UiState =>
  useSyncExternalStore(uiStore.subscribe, uiStore.getState);
