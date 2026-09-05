import { rmSync } from "node:fs";
import type { Scene } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import type { Studio } from "../src/server/index";
import type { ProjectStatePayload } from "../src/shared/api-types";
import { call, callJson, makeStudio, makeTempProject } from "./helpers";

/**
 * Klip di dalam scene lewat permukaan Studio (ADR-0033 fase 2).
 *
 * Yang diuji di sini adalah SEAM-nya, bukan aritmetikanya: aritmetika sudah
 * diuji di core, dan menguliangi rumusnya di sini cuma menggandakan tempat
 * berbohong. Yang bisa salah di lapisan ini adalah rute yang mengirim op yang
 * ditolak skema, dan belah scene yang diam-diam membuang potongan kedua.
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

const planOf = async (studio: Studio) =>
  (await callJson<ProjectStatePayload>(studio, "/api/project")).body.plan;

const sceneOf = async (studio: Studio, id: string): Promise<Scene> => {
  const plan = await planOf(studio);
  const scene = plan?.scenes.find((candidate) => candidate.id === id);
  if (!scene) throw new Error(`scene ${id} hilang`);
  return scene;
};

const patch = (studio: Studio, ops: unknown[]) =>
  callJson<{ summary: string; error?: string }>(studio, "/api/patch", {
    method: "POST",
    body: JSON.stringify({ ops }),
  });

/** sc-batu jadi dua potongan 4+3 detik. */
const duaKlip = async (studio: Studio) => {
  const response = await patch(studio, [
    {
      op: "setClips",
      sceneId: "sc-batu",
      clips: [
        {
          id: "sc-batu-k1",
          type: "stock",
          query: "ancient stone temple",
          durationSec: 4,
        },
        { id: "sc-batu-k2", type: "stock", query: "temple stairs", durationSec: 3 },
      ],
    },
  ]);
  expect(response.status).toBe(200);
};

describe("op klip lewat /api/patch", () => {
  it("memasang dua klip dan durasinya jadi jumlah potongannya", async () => {
    const studio = boot();
    await duaKlip(studio);
    const scene = await sceneOf(studio, "sc-batu");
    expect(scene.clips.map((clip) => clip.id)).toEqual(["sc-batu-k1", "sc-batu-k2"]);
    expect(scene.duration).toBe("auto");
  });

  it("membelah, menggeser tepi, lalu membuang — semuanya lewat op", async () => {
    const studio = boot();
    await duaKlip(studio);

    const dibelah = await patch(studio, [
      {
        op: "splitClip",
        sceneId: "sc-batu",
        clipId: "sc-batu-k1",
        atSec: 1.5,
        newClipId: "sc-batu-k3",
      },
    ]);
    expect(dibelah.status).toBe(200);
    expect(
      (await sceneOf(studio, "sc-batu")).clips.map((clip) => clip.durationSec),
    ).toEqual([1.5, 2.5, 3]);

    const digeser = await patch(studio, [
      {
        op: "trimClip",
        sceneId: "sc-batu",
        clipId: "sc-batu-k3",
        edge: "keluar",
        mode: "roll",
        deltaSec: 0.5,
      },
    ]);
    expect(digeser.status).toBe(200);
    expect(
      (await sceneOf(studio, "sc-batu")).clips.map((clip) => clip.durationSec),
    ).toEqual([1.5, 3, 2.5]);

    const dibuang = await patch(studio, [
      { op: "removeClip", sceneId: "sc-batu", clipId: "sc-batu-k3" },
    ]);
    expect(dibuang.status).toBe(200);
    expect((await sceneOf(studio, "sc-batu")).clips.map((clip) => clip.id)).toEqual([
      "sc-batu-k1",
      "sc-batu-k2",
    ]);
  });

  it("undo satu langkah mengembalikan seluruh daftar klip", async () => {
    const studio = boot();
    await duaKlip(studio);
    const sebelum = (await sceneOf(studio, "sc-batu")).clips;
    await patch(studio, [
      {
        op: "trimClip",
        sceneId: "sc-batu",
        clipId: "sc-batu-k1",
        edge: "keluar",
        deltaSec: -1,
      },
    ]);
    await call(studio, "/api/undo", { method: "POST" });
    expect((await sceneOf(studio, "sc-batu")).clips).toEqual(sebelum);
  });

  it("menolak geseran di luar batas dengan pesan yang menyebut batasnya", async () => {
    const studio = boot();
    await duaKlip(studio);
    const response = await patch(studio, [
      {
        op: "trimClip",
        sceneId: "sc-batu",
        clipId: "sc-batu-k1",
        edge: "keluar",
        deltaSec: -99,
      },
    ]);
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("di luar batas");
  });
});

describe("belah scene pada scene berklip banyak", () => {
  it("membagi potongannya ke dua scene, bukan membuang yang kedua", async () => {
    const studio = boot();
    await duaKlip(studio);
    const response = await callJson<{ newId: string }>(studio, "/api/scene/split", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", atSec: 4 }),
    });
    expect(response.status).toBe(200);

    const kiri = await sceneOf(studio, "sc-batu");
    const kanan = await sceneOf(studio, response.body.newId);
    // Batasnya tepat di titik potong: masing-masing dapat satu potongan utuh,
    // dan karena tinggal satu, durasinya kembali ke scene.
    expect(kiri.clips.map((clip) => clip.id)).toEqual(["sc-batu-k1"]);
    expect(kiri.duration).toBe(4);
    expect(kanan.clips.map((clip) => clip.id)).toEqual(["sc-batu-k2"]);
    expect(kanan.duration).toBe(3);
  });

  it("membelah klip yang dilewati titik belahnya, dan berkasnya ikut", async () => {
    const studio = boot();
    await duaKlip(studio);
    await patch(studio, [
      { op: "replaceAsset", sceneId: "sc-batu", assetId: "aset-batu" },
    ]);
    const response = await callJson<{ newId: string }>(studio, "/api/scene/split", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", atSec: 2 }),
    });
    expect(response.status).toBe(200);

    const kiri = await sceneOf(studio, "sc-batu");
    const kanan = await sceneOf(studio, response.body.newId);
    expect(kiri.clips).toHaveLength(1);
    expect(kiri.duration).toBe(2);
    // Paruh kedua klip pertama + klip kedua yang utuh pindah ke scene baru.
    expect(kanan.clips).toHaveLength(2);
    expect(kanan.duration).toBe("auto");
    expect(kanan.clips[0]?.trimStartSec).toBe(2);
  });
});
