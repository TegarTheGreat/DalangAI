import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isLoopbackAddress } from "../src/server/guard";
import { call, collectSse, makeHost, makeStudio, makeTempProject } from "./helpers";

/**
 * Beberapa orang pada satu proyek (ADR-0038, roadmap §10.4).
 *
 * Yang diuji SEAM-nya: aturan bentroknya sudah diuji sebagai angka di core.
 * Yang bisa salah di lapisan ini adalah hal yang paling mahal — patch yang
 * DITERIMA padahal seharusnya ditolak, dan klien lama yang tiba-tiba berhenti
 * bekerja karena tidak tahu soal revisi.
 */

const cleanups: Array<() => void> = [];
const boot = () => {
  const { dir, planPath } = makeTempProject();
  const studio = makeStudio(planPath);
  cleanups.push(() => {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return studio;
};

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const patch = (
  studio: ReturnType<typeof makeStudio>,
  body: unknown,
  editor?: { id: string; name: string },
) =>
  call(studio, "/api/patch", {
    method: "POST",
    body: JSON.stringify(body),
    ...(editor
      ? {
          headers: {
            "content-type": "application/json",
            "x-dalang-editor-id": editor.id,
            "x-dalang-editor-name": editor.name,
          },
        }
      : {}),
  });

const rina = { id: "rina0001", name: "Rina" };
const budi = { id: "budi0001", name: "Budi" };

describe("bentrok penyunting", () => {
  it("tanpa baseRevision, perilakunya SAMA PERSIS seperti sebelumnya", async () => {
    // CLI, server MCP, dan klien lama tidak mengirim revisi. Kalau mereka
    // mulai ditolak, fitur kolaborasi memecahkan hal-hal yang sudah bekerja.
    const studio = boot();
    const a = await patch(studio, {
      ops: [{ op: "updateScene", id: "sc-batu", patch: { narration: "A" } }],
    });
    const b = await patch(studio, {
      ops: [{ op: "updateScene", id: "sc-batu", patch: { narration: "B" } }],
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it("dua orang di SCENE YANG SAMA: yang kedua ditolak, bukan menimpa", async () => {
    const studio = boot();
    const awal = (await (await call(studio, "/api/project")).json()) as {
      revision?: number;
    };
    const base = awal.revision ?? 0;

    const pertama = await patch(
      studio,
      {
        ops: [{ op: "updateScene", id: "sc-batu", patch: { narration: "Punya Rina" } }],
        baseRevision: base,
      },
      rina,
    );
    expect(pertama.status).toBe(200);

    // Budi menyunting dari revisi LAMA — persis keadaan orang yang tab-nya
    // belum menerima kabar.
    const kedua = await patch(
      studio,
      {
        ops: [{ op: "updateScene", id: "sc-batu", patch: { narration: "Punya Budi" } }],
        baseRevision: base,
      },
      budi,
    );
    expect(kedua.status).toBe(409);
    const body = (await kedua.json()) as { error: string; konflik: string[] };
    expect(body.konflik).toContain("scene:sc-batu");
    // Pesannya harus menyebut siapa dan apa — penolakan tanpa itu terbaca
    // sebagai aplikasi yang rusak.
    expect(body.error).toContain("Rina");
    expect(body.error).toContain("sc-batu");

    // Dan yang penting: tulisan Rina MASIH ADA.
    const state = (await (await call(studio, "/api/project")).json()) as {
      plan: { scenes: Array<{ id: string; narration: string }> };
    };
    expect(state.plan.scenes.find((s) => s.id === "sc-batu")?.narration).toBe(
      "Punya Rina",
    );
  });

  it("dua orang di SCENE BERBEDA: keduanya diterima", async () => {
    // Ini setengah fitur yang lain. Penolakan yang menuntut orang bergantian
    // adalah penolakan yang akan dimatikan.
    const studio = boot();
    const awal = (await (await call(studio, "/api/project")).json()) as {
      revision?: number;
    };
    const base = awal.revision ?? 0;
    const a = await patch(
      studio,
      {
        ops: [{ op: "updateScene", id: "sc-batu", patch: { narration: "Rina" } }],
        baseRevision: base,
      },
      rina,
    );
    const b = await patch(
      studio,
      {
        ops: [{ op: "updateScene", id: "sc-peta", patch: { narration: "Budi" } }],
        baseRevision: base,
      },
      budi,
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it("revisi yang terlalu tua ditolak, bukan dianggap aman", async () => {
    // Menjawab "aman" untuk pertanyaan yang tidak bisa dijawab adalah cara
    // paling halus kehilangan pekerjaan orang.
    const studio = boot();
    const res = await patch(
      studio,
      {
        ops: [{ op: "updateScene", id: "sc-batu", patch: { narration: "x" } }],
        baseRevision: 9999,
      },
      rina,
    );
    expect(res.status).toBe(409);
  });
});

describe("kehadiran", () => {
  it("rute presence menolak permintaan tanpa identitas", async () => {
    const studio = boot();
    const res = await call(studio, "/api/presence", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu" }),
    });
    expect(res.status).toBe(400);
  });

  it("penyunting yang menyebut diri muncul di daftar, berikut scene-nya", async () => {
    const studio = boot();
    const res = await call(studio, "/api/presence", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-peta" }),
      headers: {
        "content-type": "application/json",
        "x-dalang-editor-id": rina.id,
        "x-dalang-editor-name": rina.name,
      },
    });
    const body = (await res.json()) as {
      editors: Array<{ name: string; sceneId: string | null; color: string }>;
    };
    expect(body.editors).toHaveLength(1);
    expect(body.editors[0]?.name).toBe("Rina");
    expect(body.editors[0]?.sceneId).toBe("sc-peta");
    // Warna deterministik: sama di layar semua orang, bukan diundi per klien.
    expect(body.editors[0]?.color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("kedatangan disiarkan ke panel yang sudah terbuka", async () => {
    const studio = boot();
    const stream = await call(studio, "/api/events");
    const wait = collectSse(stream, (events) =>
      events.some((event) => event.event === "presence" && event.data.includes("Rina")),
    );
    await call(studio, "/api/presence", {
      method: "POST",
      body: JSON.stringify({ sceneId: null }),
      headers: {
        "content-type": "application/json",
        "x-dalang-editor-id": rina.id,
        "x-dalang-editor-name": rina.name,
      },
    });
    const events = await wait;
    expect(events.some((event) => event.event === "presence")).toBe(true);
  });
});

describe("kunci tautan (--lan)", () => {
  const bootLan = () => {
    const root = mkdtempSync(join(tmpdir(), "dalang-lan-"));
    const host = makeHost(root, undefined, { linkKey: "rahasia-uji" });
    cleanups.push(() => {
      host.close();
      rmSync(root, { recursive: true, force: true });
    });
    return host;
  };

  /** Permintaan dari alamat soket tertentu — yang dipercaya guard, bukan header. */
  const from = (host: ReturnType<typeof makeHost>, path: string, remoteAddress: string) =>
    host.app.fetch(new Request(`http://studio.local${path}`), {
      incoming: { socket: { remoteAddress } },
    });

  it("pemakai loopback tetap masuk tanpa kunci", async () => {
    // Membuka ke jaringan tidak boleh berarti pemiliknya sendiri harus
    // menempelkan kunci di URL-nya.
    const host = bootLan();
    expect((await from(host, "/api/workspace", "127.0.0.1")).status).toBe(200);
    expect((await from(host, "/api/workspace", "::1")).status).toBe(200);
  });

  it("tamu jaringan TANPA kunci ditolak — termasuk untuk MEMBACA", async () => {
    // Kalau hanya penulisan yang dijaga, "buka ke jaringan" berarti siapa pun
    // sejaringan bisa membaca seluruh proyek.
    const host = bootLan();
    const res = await from(host, "/api/workspace", "192.168.1.20");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toContain("kunci tautan");
  });

  it("tamu jaringan DENGAN kunci masuk", async () => {
    const host = bootLan();
    const viaQuery = await from(host, "/api/workspace?kunci=rahasia-uji", "192.168.1.20");
    expect(viaQuery.status).toBe(200);
    const viaHeader = await host.app.fetch(
      new Request("http://studio.local/api/workspace", {
        headers: { "x-dalang-key": "rahasia-uji" },
      }),
      { incoming: { socket: { remoteAddress: "192.168.1.20" } } },
    );
    expect(viaHeader.status).toBe(200);
  });

  it("kunci yang salah ditolak", async () => {
    const host = bootLan();
    expect(
      (await from(host, "/api/workspace?kunci=tebakan", "192.168.1.20")).status,
    ).toBe(401);
  });
});

describe("isLoopbackAddress", () => {
  it("mengenali bentuk yang dipakai Node, termasuk IPv4 ber-map IPv6", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.13.2.9")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    // Node melaporkan klien IPv4 begini saat soketnya IPv6 — dan yang lupa
    // ini akan menuntut kunci dari pemiliknya sendiri.
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.20")).toBe(false);
    expect(isLoopbackAddress("::ffff:192.168.1.20")).toBe(false);
  });
});
