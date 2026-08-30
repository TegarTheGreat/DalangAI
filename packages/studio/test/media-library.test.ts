import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AddGraphicResponse,
  AddSfxResponse,
  IconSearchResponse,
  ProjectStatePayload,
  SfxSearchResponse,
  StickerSearchResponse,
} from "../src/shared/api-types";
import { call, callJson, makeStudio, makeTempProject } from "./helpers";

/**
 * Pustaka media di panel MANUAL (ADR-0018).
 *
 * Yang dijaga di sini bukan "endpointnya menjawab 200", melainkan janji yang
 * membuat fitur ini ada: ikon dan efek suara harus bisa dipakai TANPA chat
 * (jadi tanpa API key model), pemasangannya harus jadi patch user yang bisa
 * di-undo, dan berkas nyatanya harus tercatat di renderState — kalau tidak,
 * render melewatinya diam-diam.
 */

const cleanups: Array<() => void> = [];
const boot = (overrides?: Parameters<typeof makeStudio>[1]) => {
  const { dir, planPath } = makeTempProject();
  const studio = makeStudio(planPath, overrides);
  cleanups.push(() => {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { studio };
};

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const getProject = async (studio: ReturnType<typeof boot>["studio"]) =>
  (await callJson<ProjectStatePayload>(studio, "/api/project")).body;

describe("ikon (Iconify) tanpa kunci API", () => {
  it("cari → pasang = grafis + berkas di renderState, lewat patch user", async () => {
    const { studio } = boot();
    const search = await callJson<IconSearchResponse>(
      studio,
      "/api/icons/search?query=home",
    );
    expect(search.status).toBe(200);
    expect(search.body.icons.length).toBeGreaterThan(0);
    const iconId = search.body.icons[0]?.iconId as string;

    const added = await callJson<AddGraphicResponse>(studio, "/api/graphics/icon", {
      method: "POST",
      body: JSON.stringify({
        sceneId: "sc-batu",
        iconId,
        anchor: "kiri-atas",
        size: 0.2,
        color: "#22c55e",
        anim: "denyut",
      }),
    });
    expect(added.status).toBe(200);

    const project = await getProject(studio);
    const scene = project.plan?.scenes.find((s) => s.id === "sc-batu");
    expect(scene?.graphics).toHaveLength(1);
    expect(scene?.graphics[0]).toMatchObject({
      ref: `iconify:${iconId}`,
      anchor: "kiri-atas",
      size: 0.2,
      color: "#22c55e",
      anim: "denyut",
    });
    // Tanpa entri ini render tidak menemukan berkasnya — dan diam saja.
    const graphicId = scene?.graphics[0]?.id as string;
    expect(project.plan?.renderState.graphicAssets[graphicId]?.file).toContain("icons/");
    // Patch USER: masuk riwayat, bisa di-undo, terlihat agent giliran berikutnya.
    expect(project.patchLog.recent.at(-1)?.origin).toBe("user");
    expect(project.patchLog.canUndo).toBe(true);
  });

  it("chat mati (tanpa API key) tidak mematikan pustaka ikon", async () => {
    const { studio } = boot({ noOrchestrator: true });
    const project = await getProject(studio);
    expect(project.models.chatDisabled).toBeTruthy();

    const search = await callJson<IconSearchResponse>(
      studio,
      "/api/icons/search?query=map",
    );
    expect(search.status).toBe(200);
    const added = await call(studio, "/api/graphics/icon", {
      method: "POST",
      body: JSON.stringify({
        sceneId: "sc-batu",
        iconId: search.body.icons[0]?.iconId,
      }),
    });
    expect(added.status).toBe(200);
  });

  it("undo mengembalikan grafis DAN berkasnya tetap ada untuk redo", async () => {
    const { studio } = boot();
    const search = await callJson<IconSearchResponse>(
      studio,
      "/api/icons/search?query=home",
    );
    await call(studio, "/api/graphics/icon", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", iconId: search.body.icons[0]?.iconId }),
    });
    await call(studio, "/api/undo", { method: "POST" });

    const afterUndo = await getProject(studio);
    expect(afterUndo.plan?.scenes.find((s) => s.id === "sc-batu")?.graphics).toHaveLength(
      0,
    );
    // Entri berkas SENGAJA tidak ikut dihapus: redo harus mengembalikan grafis
    // yang utuh, bukan grafis yang berkasnya hilang.
    expect(Object.keys(afterUndo.plan?.renderState.graphicAssets ?? {})).toHaveLength(1);

    await call(studio, "/api/redo", { method: "POST" });
    const afterRedo = await getProject(studio);
    const scene = afterRedo.plan?.scenes.find((s) => s.id === "sc-batu");
    expect(scene?.graphics).toHaveLength(1);
    const graphicId = scene?.graphics[0]?.id as string;
    expect(afterRedo.plan?.renderState.graphicAssets[graphicId]).toBeTruthy();
  });

  it("batas 4 grafis per scene ditegakkan server, bukan hanya UI", async () => {
    const { studio } = boot();
    const search = await callJson<IconSearchResponse>(
      studio,
      "/api/icons/search?query=home",
    );
    const iconId = search.body.icons[0]?.iconId as string;
    for (let i = 0; i < 4; i += 1) {
      const ok = await call(studio, "/api/graphics/icon", {
        method: "POST",
        body: JSON.stringify({ sceneId: "sc-batu", iconId }),
      });
      expect(ok.status).toBe(200);
    }
    const fifth = await callJson<{ error: string }>(studio, "/api/graphics/icon", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", iconId }),
    });
    expect(fifth.status).toBe(400);
    expect(fifth.body.error).toContain("4 grafis");
  });

  it("scene terkunci menolak tempelan", async () => {
    const { studio } = boot();
    await call(studio, "/api/patch", {
      method: "POST",
      body: JSON.stringify({ ops: [{ op: "lockScene", id: "sc-batu", locked: true }] }),
    });
    const blocked = await callJson<{ error: string }>(studio, "/api/graphics/icon", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", iconId: "mdi:home" }),
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toContain("terkunci");
  });

  it("pratinjau ikon disajikan sebagai SVG, dan id ngawur ditolak", async () => {
    const { studio } = boot();
    const svg = await call(studio, "/api/icons/svg?id=mdi:home");
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-type")).toContain("image/svg+xml");
    expect(await svg.text()).toContain("<svg");

    const bad = await call(studio, "/api/icons/svg?id=../../etc/passwd");
    expect(bad.status).toBe(400);
  });
});

describe("stiker (GIPHY/Tenor)", () => {
  it("cari → pasang, dengan lisensi apa adanya ikut tercatat", async () => {
    const { studio } = boot();
    const search = await callJson<StickerSearchResponse>(
      studio,
      "/api/stickers/search?query=clap",
    );
    expect(search.status).toBe(200);
    expect(search.body.stickers[0]?.license).toContain("PERIKSA HAK PAKAI");

    const added = await callJson<AddGraphicResponse>(studio, "/api/graphics/sticker", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", query: "clap", index: 0 }),
    });
    expect(added.status).toBe(200);

    const project = await getProject(studio);
    const scene = project.plan?.scenes.find((s) => s.id === "sc-batu");
    const graphicId = scene?.graphics[0]?.id as string;
    // Stiker BUKAN ikon: rujukannya assetId provider, dan warnanya tidak diubah.
    expect(scene?.graphics[0]?.ref.startsWith("iconify:")).toBe(false);
    expect(scene?.graphics[0]?.color).toBeNull();
    expect(project.plan?.renderState.graphicAssets[graphicId]?.license).toContain(
      "PERIKSA HAK PAKAI",
    );
  });

  it("memasang tanpa mencari lebih dulu ditolak", async () => {
    const { studio } = boot();
    const added = await call(studio, "/api/graphics/sticker", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", query: "clap", index: 0 }),
    });
    expect(added.status).toBe(400);
  });
});

describe("efek suara (Openverse)", () => {
  it("cari → pasang = cue tertambat ke scene + berkas di renderState", async () => {
    const { studio } = boot();
    const search = await callJson<SfxSearchResponse>(
      studio,
      "/api/sfx/search?query=whoosh",
    );
    expect(search.status).toBe(200);
    expect(search.body.sounds[0]?.license).toContain("cc0");
    const assetId = search.body.sounds[0]?.assetId as string;

    const added = await callJson<AddSfxResponse>(studio, "/api/sfx/add", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-peta", assetId, atSec: 1.25, volume: 0.35 }),
    });
    expect(added.status).toBe(200);

    const project = await getProject(studio);
    const cue = project.plan?.audio.sfx[0];
    expect(cue).toMatchObject({ sceneId: "sc-peta", atSec: 1.25, volume: 0.35 });
    expect(project.plan?.renderState.sfxAssets[cue?.id ?? ""]?.file).toContain("sfx/");
    expect(project.patchLog.recent.at(-1)?.origin).toBe("user");
  });

  /**
   * assetId Openverse adalah UUID: mencari ulang dengannya selalu nihil, jadi
   * kandidatnya harus diingat dari pencarian. Memasang tanpa mencari lebih dulu
   * karenanya ditolak dengan jelas, bukan gagal diam-diam saat mengunduh.
   */
  it("memasang assetId yang tidak pernah dicari ditolak dengan alasan jelas", async () => {
    const { studio } = boot();
    const added = await callJson<{ error: string }>(studio, "/api/sfx/add", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-peta", assetId: "openverse:tak-dikenal" }),
    });
    expect(added.status).toBe(400);
    expect(added.body.error).toContain("cari ulang");
  });

  it("scene yang tidak ada ditolak", async () => {
    const { studio } = boot();
    const search = await callJson<SfxSearchResponse>(
      studio,
      "/api/sfx/search?query=whoosh",
    );
    const added = await call(studio, "/api/sfx/add", {
      method: "POST",
      body: JSON.stringify({
        sceneId: "sc-hantu",
        assetId: search.body.sounds[0]?.assetId,
      }),
    });
    expect(added.status).toBe(400);
  });
});
