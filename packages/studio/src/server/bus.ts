import type { StudioEvent } from "../shared/api-types";

/**
 * Bus broadcast in-process: setiap mutasi state memancarkan event ke semua
 * langganan SSE (GET /api/events) — begitulah tiga panel tetap sinkron
 * (PRD §8.1: "perubahan dari satu panel langsung terlihat di panel lain").
 */
export class EventBus {
  private listeners = new Set<(event: StudioEvent) => void>();

  subscribe(listener: (event: StudioEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: StudioEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // satu subscriber rusak tidak boleh menjatuhkan broadcast
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
