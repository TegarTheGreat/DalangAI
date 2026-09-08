import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtInTemplate, parseScenePlan } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import { hostCall, makeHost } from "./helpers";

/**
 * Template lewat permukaan Studio (ADR-0037, roadmap §10.2).
 *
 * Yang diuji SEAM-nya, bukan aritmetikanya: bentuk paket dan aturan "tidak
 * membawa berkas" sudah diuji di core, dan mengulanginya di sini cuma
 * menggandakan tempat berbohong. Yang bisa salah di lapisan ini adalah rute
 * yang menerima id sembarang, dan proyek baru yang lahir tanpa isi template.
 */

const cleanups: Array<() => void> = [];
const boot = () => {
  const root = mkdtempSync(join(tmpdir(), "dalang-template-"));
  const host = makeHost(root);
  cleanups.push(() => {
    host.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { host, root };
};

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe("GET /api/workspace/templates", () => {
  it("mendaftarkan template bawaan meski registri kosong", async () => {
    // Registri kosong pada pemasangan baru adalah keadaan NORMAL, dan lobi
    // yang menampilkan daftar kosong di situ membuat fiturnya terbaca sebagai
    // janji, bukan barang.
    const { host } = boot();
    const body = await json(await hostCall(host, "/api/workspace/templates"));
    const templates = body.templates as Array<{ id: string; builtIn: boolean }>;
    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(templates.every((item) => item.builtIn)).toBe(true);
    expect(templates.map((item) => item.id)).toContain("klip-tiga-detik");
  });

  it("berkas rusak di registri DILAPORKAN, bukan disaring diam-diam", async () => {
    const { host, root } = boot();
    const dir = join(root, ".template-uji");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "rusak.json"), "{ bukan json");
    const body = await json(await hostCall(host, "/api/workspace/templates"));
    const broken = body.broken as Array<{ file: string; reason: string }>;
    expect(broken).toHaveLength(1);
    // Daftar template TETAP terisi: satu berkas salah ketik tidak boleh
    // membuat seluruh fitur terlihat mati.
    expect((body.templates as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
});

describe("POST /api/workspace/from-template", () => {
  it("membuat proyek yang isinya benar-benar dari template", async () => {
    const { host } = boot();
    const res = await hostCall(host, "/api/workspace/from-template", {
      method: "POST",
      body: JSON.stringify({ templateId: "esai-video", judul: "Kenapa Beras Naik" }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    const project = body.project as { id: string; title: string };
    expect(project.title).toBe("Kenapa Beras Naik");

    // Bukan cuma "ada proyeknya": isinya harus berasal dari template, dan
    // judulnya harus MILIK PROYEK BARU — bukan judul pembuat template.
    const pack = builtInTemplate("esai-video");
    if (!pack) throw new Error("template bawaan esai-video hilang");
    const state = await json(await hostCall(host, "/api/project"));
    const plan = parseScenePlan((state as { plan: unknown }).plan);
    expect(plan.meta.title).toBe("Kenapa Beras Naik");
    expect(plan.meta.stylePreset).toBe(pack.plan.meta.stylePreset);
    expect(plan.scenes).toHaveLength(pack.plan.scenes.length);
  });

  it("id yang tidak ada ditolak 404, bukan membuat proyek kosong", async () => {
    const { host } = boot();
    const res = await hostCall(host, "/api/workspace/from-template", {
      method: "POST",
      body: JSON.stringify({ templateId: "tidak-ada", judul: "X" }),
    });
    expect(res.status).toBe(404);
  });

  it("body tanpa judul ditolak 400", async () => {
    const { host } = boot();
    const res = await hostCall(host, "/api/workspace/from-template", {
      method: "POST",
      body: JSON.stringify({ templateId: "esai-video" }),
    });
    expect(res.status).toBe(400);
  });
});
