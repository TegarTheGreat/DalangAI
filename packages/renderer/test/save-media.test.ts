import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_MEDIA_BYTES, saveMediaToProject } from "../src/save-media";

/**
 * ADR-0018. Fokus utamanya penjaga path: nama berkas datang dari LAYANAN LUAR,
 * jadi ia harus diperlakukan sebagai masukan yang tidak dipercaya.
 */

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-media-"));
  dirs.push(dir);
  return { dir, planPath: join(dir, "plan.json") };
};

const SVG = "data:image/svg+xml;utf8,%3Csvg%3E%3C%2Fsvg%3E";

describe("saveMediaToProject", () => {
  it("menulis data URI ke assets/<folder>/<nama>.<ext> dan mengembalikan path relatif", async () => {
    const { dir, planPath } = project();
    const rel = await saveMediaToProject({
      planPath,
      url: SVG,
      folder: "icons",
      name: "mdi:home",
      fileExt: "svg",
    });
    expect(rel).toBe("assets/icons/mdi-home.svg");
    expect(existsSync(join(dir, rel))).toBe(true);
    expect(readFileSync(join(dir, rel), "utf8")).toBe("<svg></svg>");
  });

  it("data URI base64 juga didukung", async () => {
    const { dir, planPath } = project();
    const rel = await saveMediaToProject({
      planPath,
      url: `data:text/plain;base64,${Buffer.from("halo").toString("base64")}`,
      folder: "sfx",
      name: "a",
      fileExt: "txt",
    });
    expect(readFileSync(join(dir, rel), "utf8")).toBe("halo");
  });

  // Regresi: nilai "." dan ".." sempat lolos utuh sebagai segmen path,
  // sehingga berkas mendarat di akar proyek, bukan di dalam assets/.
  it.each([
    ["..", "x"],
    ["../..", "x"],
    ["icons", ".."],
    [".", "y"],
    ["icons", "."],
    ["../../../etc", "passwd"],
  ])("folder=%s nama=%s tetap mendarat di dalam assets/", async (folder, name) => {
    const { planPath } = project();
    const rel = await saveMediaToProject({
      planPath,
      url: SVG,
      folder,
      name,
      fileExt: "svg",
    });
    expect(rel.startsWith("assets/")).toBe(true);
    // Tidak boleh ada satu pun segmen yang berupa "." atau "..".
    expect(rel.split("/").some((part) => part === "." || part === "..")).toBe(false);
  });

  it("nama kosong tidak menghasilkan berkas tanpa nama", async () => {
    const { planPath } = project();
    const rel = await saveMediaToProject({
      planPath,
      url: SVG,
      folder: "",
      name: "!!!",
      fileExt: "svg",
    });
    expect(rel).toBe("assets/aset/aset.svg");
  });

  it("berkas kosong ditolak", async () => {
    const { planPath } = project();
    await expect(
      saveMediaToProject({
        planPath,
        url: "https://x.test/a.mp3",
        folder: "sfx",
        name: "a",
        fileExt: "mp3",
        fetchImpl: async () => new Response(new Uint8Array()),
      }),
    ).rejects.toThrow("kosong");
  });

  it("berkas raksasa ditolak sebelum ditulis", async () => {
    const { dir, planPath } = project();
    await expect(
      saveMediaToProject({
        planPath,
        url: "https://x.test/besar.mp3",
        folder: "sfx",
        name: "besar",
        fileExt: "mp3",
        fetchImpl: async () => new Response(new Uint8Array(MAX_MEDIA_BYTES + 1)),
      }),
    ).rejects.toThrow("melebihi batas");
    expect(existsSync(join(dir, "assets/sfx/besar.mp3"))).toBe(false);
  });

  it("HTTP gagal dilaporkan dengan status aslinya", async () => {
    const { planPath } = project();
    await expect(
      saveMediaToProject({
        planPath,
        url: "https://x.test/a.mp3",
        folder: "sfx",
        name: "a",
        fileExt: "mp3",
        fetchImpl: async () => new Response("nope", { status: 404 }),
      }),
    ).rejects.toThrow("404");
  });
});
