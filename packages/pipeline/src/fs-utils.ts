import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Atomic write: a crash mid-write can never leave a truncated file that a
 * later resume would mistake for a finished output (content-addressed names +
 * atomic rename = idempotency, PRD §7.2).
 */
export const atomicWriteFile = (path: string, data: Uint8Array | string): void => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
};

export const round3 = (value: number): number => Number(value.toFixed(3));
