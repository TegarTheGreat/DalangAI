/**
 * Bus playhead terpisah dari store utama: frameupdate datang ~30x/dtk dan
 * hanya boleh me-render ulang timeline (bukan seluruh app). Preview menulis
 * frame + melayani permintaan seek; timeline membaca + meminta seek.
 */

type Listener = () => void;

class PlaybackBus {
  private currentFrame = 0;
  private listeners = new Set<Listener>();
  private seekHandlers = new Set<(frame: number) => void>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getFrame = (): number => this.currentFrame;

  setFrame(frame: number): void {
    if (frame === this.currentFrame) return;
    this.currentFrame = frame;
    for (const listener of this.listeners) listener();
  }

  /** Timeline meminta lompat; Preview (pemilik Player) mengeksekusi. */
  requestSeek(frame: number): void {
    for (const handler of this.seekHandlers) handler(frame);
    this.setFrame(frame);
  }

  onSeek(handler: (frame: number) => void): () => void {
    this.seekHandlers.add(handler);
    return () => this.seekHandlers.delete(handler);
  }
}

export const playback = new PlaybackBus();
