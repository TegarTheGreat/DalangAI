import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { emptyMemory, type Memory, parseMemory } from "@dalang/core";
import { atomicWriteFile } from "@dalang/pipeline";

/**
 * Penyimpanan memori preferensi (ADR-0029).
 *
 * Memori milik ORANGNYA, bukan foldernya: satu berkas di rumah Dalang
 * (`$DALANG_HOME/memori.json`, bawaan `~/.dalang/memori.json`) yang dibaca
 * Studio, CLI `dalang chat`, dan `dalang memori` — proyek di folder mana pun
 * melihat preferensi yang sama. Tes menyuntikkan path sementara atau store
 * di memori, supaya tidak pernah menyentuh rumah pengguna.
 */
export interface MemoryStore {
  /** Path berkasnya; null untuk store di memori (tes). */
  readonly path: string | null;
  read(): Memory;
  write(memory: Memory): void;
}

export const defaultMemoryPath = (env: NodeJS.ProcessEnv = process.env): string =>
  join(env.DALANG_HOME ?? join(homedir(), ".dalang"), "memori.json");

export const fileMemoryStore = (path: string): MemoryStore => {
  let corrupt = false;
  return {
    path,
    read: () => {
      if (!existsSync(path)) return emptyMemory();
      try {
        const memory = parseMemory(JSON.parse(readFileSync(path, "utf8")));
        corrupt = false;
        return memory;
      } catch {
        // Berkas rusak dibaca sebagai kosong, tetapi TIDAK ditimpa diam-diam:
        // tulisan berikutnya menyimpan salinannya lebih dulu.
        corrupt = true;
        return emptyMemory();
      }
    },
    write: (memory) => {
      mkdirSync(dirname(path), { recursive: true });
      if (corrupt && existsSync(path)) {
        copyFileSync(path, `${path}.rusak-${Date.now()}`);
        corrupt = false;
      }
      atomicWriteFile(path, `${JSON.stringify(memory, null, 2)}\n`);
    },
  };
};

/** Store di memori untuk tes dan lingkungan tanpa disk. */
export const memoryStoreInMemory = (
  initial: Memory = emptyMemory(),
): MemoryStore & { current: Memory } => {
  const store = {
    path: null,
    current: initial,
    read: () => store.current,
    write: (memory: Memory) => {
      store.current = memory;
    },
  };
  return store;
};
