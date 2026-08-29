import { useSyncExternalStore } from "react";

/**
 * Preferensi UI murni (laci panel terbuka/tertutup) — terpisah dari state
 * produk. Default mengikuti lebar layar: di ponsel kedua laci tertutup
 * agar panggung + timeline yang tampil dulu.
 */

interface UiState {
  chatOpen: boolean;
  inspectorOpen: boolean;
}

type Listener = () => void;

const wide = typeof window !== "undefined" ? window.innerWidth > 1100 : true;

class UiStore {
  private state: UiState = { chatOpen: wide, inspectorOpen: wide };
  private listeners = new Set<Listener>();

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
    this.set({
      chatOpen: next,
      ...(next && window.innerWidth <= 1100 ? { inspectorOpen: false } : {}),
    });
  }

  toggleInspector(): void {
    const next = !this.state.inspectorOpen;
    this.set({
      inspectorOpen: next,
      ...(next && window.innerWidth <= 1100 ? { chatOpen: false } : {}),
    });
  }

  closeChat(): void {
    this.set({ chatOpen: false });
  }

  closeInspector(): void {
    this.set({ inspectorOpen: false });
  }

  openChat(): void {
    this.set({
      chatOpen: true,
      ...(window.innerWidth <= 1100 ? { inspectorOpen: false } : {}),
    });
  }
}

export const uiStore = new UiStore();

export const useUi = (): UiState =>
  useSyncExternalStore(uiStore.subscribe, uiStore.getState);
