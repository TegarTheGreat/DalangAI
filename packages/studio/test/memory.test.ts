import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Memory, MemoryEntry } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import { hostCall, hostJson, makeHost } from "./helpers";

/**
 * Memori preferensi lintas proyek di lobi (ADR-0029): terlihat, bisa ditambah
 * dan dihapus orang, tersimpan di berkas yang dibaca agent — dan tidak
 * pernah menyentuh rumah pengguna dari tes.
 */
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const boot = () => {
  const root = mkdtempSync(join(tmpdir(), "dalang-memori-"));
  const host = makeHost(root);
  cleanups.push(() => {
    host.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, host };
};

describe("/api/workspace/memory", () => {
  it("kosong → tambah → terlihat & tersimpan di berkas → duplikat tidak digandakan → hapus", async () => {
    const { root, host } = boot();
    const empty = await hostJson<{ memory: Memory }>(host, "/api/workspace/memory");
    expect(empty.status).toBe(200);
    expect(empty.body.memory.entries).toEqual([]);

    const added = await hostJson<{ entry: MemoryEntry; duplicate: boolean }>(
      host,
      "/api/workspace/memory",
      {
        method: "POST",
        body: JSON.stringify({
          jenis: "gaya",
          teks: "Selalu pakai caption tegas untuk klip",
        }),
      },
    );
    expect(added.status).toBe(200);
    expect(added.body.entry).toMatchObject({
      kind: "gaya",
      source: "user",
      projectId: null,
    });
    const file = join(root, ".memori-uji.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).entries).toHaveLength(1);

    const again = await hostJson<{ duplicate: boolean; memory: Memory }>(
      host,
      "/api/workspace/memory",
      {
        method: "POST",
        body: JSON.stringify({
          jenis: "catatan",
          teks: "selalu pakai CAPTION tegas untuk klip",
        }),
      },
    );
    expect(again.body.duplicate).toBe(true);
    expect(again.body.memory.entries).toHaveLength(1);

    const removed = await hostJson<{ memory: Memory }>(
      host,
      `/api/workspace/memory/${added.body.entry.id}`,
      {
        method: "DELETE",
      },
    );
    expect(removed.status).toBe(200);
    expect(removed.body.memory.entries).toEqual([]);
    expect(
      (await hostCall(host, "/api/workspace/memory/tidak-ada", { method: "DELETE" }))
        .status,
    ).toBe(404);
  });

  it("menolak jenis yang tidak dikenal dan teks yang terlalu pendek", async () => {
    const { host } = boot();
    const badKind = await hostCall(host, "/api/workspace/memory", {
      method: "POST",
      body: JSON.stringify({ jenis: "warna", teks: "Selalu biru" }),
    });
    expect(badKind.status).toBe(400);
    const short = await hostCall(host, "/api/workspace/memory", {
      method: "POST",
      body: JSON.stringify({ jenis: "gaya", teks: "ab" }),
    });
    expect(short.status).toBe(400);
  });
});
