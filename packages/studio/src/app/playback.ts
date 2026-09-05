/**
 * Bus playhead terpisah dari store utama: frameupdate datang ~30x/dtk dan
 * hanya boleh me-render ulang timeline (bukan seluruh app). Preview menulis
 * frame + melayani permintaan seek; timeline membaca + meminta seek.
 */

type Listener = () => void;

class PlaybackBus {
  private currentFrame = 0;
  private isPlaying = false;
  private listeners = new Set<Listener>();
  private seekHandlers = new Set<(frame: number) => void>();
  private toggleHandlers = new Set<() => void>();
  private pauseHandlers = new Set<() => void>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getFrame = (): number => this.currentFrame;
  getPlaying = (): boolean => this.isPlaying;

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  setFrame(frame: number): void {
    if (frame === this.currentFrame) return;
    this.currentFrame = frame;
    this.notify();
  }

  setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    this.isPlaying = playing;
    this.notify();
  }

  /** Timeline meminta lompat; Preview (pemilik Player) mengeksekusi. */
  requestSeek(frame: number): void {
    for (const handler of this.seekHandlers) handler(frame);
    this.setFrame(frame);
  }

  requestToggle(): void {
    for (const handler of this.toggleHandlers) handler();
  }

  requestPause(): void {
    for (const handler of this.pauseHandlers) handler();
  }

  onSeek(handler: (frame: number) => void): () => void {
    this.seekHandlers.add(handler);
    return () => this.seekHandlers.delete(handler);
  }

  onToggle(handler: () => void): () => void {
    this.toggleHandlers.add(handler);
    return () => this.toggleHandlers.delete(handler);
  }

  onPause(handler: () => void): () => void {
    this.pauseHandlers.add(handler);
    return () => this.pauseHandlers.delete(handler);
  }
}

export const playback = new PlaybackBus();
