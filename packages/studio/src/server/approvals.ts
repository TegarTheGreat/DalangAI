import { randomUUID } from "node:crypto";

/**
 * Jembatan approval gate §6.3 ke UI: agent meminta izin → server memancarkan
 * `approval-request` di stream chat → user menjawab lewat
 * POST /api/approvals/:id. Tanpa jawaban sampai timeout = DITOLAK
 * (deny-by-default, konsisten dengan CLI non-interaktif).
 */
export class ApprovalBroker {
  private pending = new Map<
    string,
    { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly timeoutMs = 10 * 60 * 1000) {}

  create(): { id: string; promise: Promise<boolean> } {
    const id = randomUUID();
    const promise = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(false);
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, timer });
    });
    return { id, promise };
  }

  /** true bila id dikenal (belum dijawab/timeout). */
  answer(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(approved);
    return true;
  }

  /** Tolak semua yang menggantung (mis. stream chat terputus). */
  denyAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve(false);
      this.pending.delete(id);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
