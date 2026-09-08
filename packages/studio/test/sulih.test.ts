import { rmSync } from "node:fs";
import { dubCoverage, planLanguages } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import type { Studio } from "../src/server/index";
import type { ProjectStatePayload } from "../src/shared/api-types";
import { callJson, makeStudio, makeTempProject } from "./helpers";

/**
 * Sulih suara lewat Studio (ADR-0040).
 *
 * Permukaannya, bukan aritmetikanya: op `setDub` sampai ke plan lewat rute
 * patch biasa (jadi ikut undo dan ikut deteksi bentrok ADR-0038), TTS bahasa
 * sulih mendarat di lumbung yang benar, dan permintaan bahasa yang tidak ada
 * DITOLAK alih-alih diam-diam jatuh ke bahasa utama.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const boot = () => {
  const { dir, planPath } = makeTempProject();
  const studio = makeStudio(planPath);
  cleanups.push(() => {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { studio, dir };
};

const post = <T>(studio: Studio, path: string, body: unknown) =>
  callJson<T>(studio, path, { method: "POST", body: JSON.stringify(body) });

const project = async (studio: Studio) =>
  (await callJson<ProjectStatePayload>(studio, "/api/project")).body;

const sulihkan = (studio: Studio, sceneId: string, text: string) =>
  post<{ ok: true }>(studio, "/api/patch", {
    ops: [{ op: "setDub", sceneId, language: "en", text }],
  });

describe("setDub lewat rute patch (ADR-0040)", () => {
  it("sulihan tersimpan dan bisa di-undo seperti perubahan lain", async () => {
    const { studio } = boot();
    expect((await sulihkan(studio, "sc-batu", "A stone temple.")).status).toBe(200);

    const sesudah = await project(studio);
    expect(sesudah.plan?.scenes[1]?.dubs.en).toBe("A stone temple.");
    expect(planLanguages(sesudah.plan!)).toEqual(["id", "en"]);
    expect(sesudah.patchLog.canUndo).toBe(true);

    expect((await post(studio, "/api/undo", {})).status).toBe(200);
    expect((await project(studio)).plan?.scenes[1]?.dubs).toEqual({});
  });

  it("kode bahasa ngawur ditolak 400 — kode itu jadi nama berkas", async () => {
    const { studio } = boot();
    const ditolak = await post<{ error: string }>(studio, "/api/patch", {
      ops: [{ op: "setDub", sceneId: "sc-batu", language: "../etc", text: "x" }],
    });
    expect(ditolak.status).toBe(400);
    expect((await project(studio)).plan?.scenes[1]?.dubs).toEqual({});
  });
});

describe("/api/pipeline/sulih (ADR-0040)", () => {
  it("bahasa yang belum ada ditolak, bukan diam-diam jatuh ke bahasa utama", async () => {
    const { studio } = boot();
    const ditolak = await post<{ error: string }>(studio, "/api/pipeline/sulih", {
      bahasa: "en",
      confirm: true,
    });
    expect(ditolak.status).toBe(400);
    expect(String(ditolak.body.error)).toContain("belum punya sulihan");
  });

  it("bahasa utama ditolak — itu tahap TTS biasa", async () => {
    const { studio } = boot();
    const ditolak = await post<{ error: string }>(studio, "/api/pipeline/sulih", {
      bahasa: "id",
      confirm: true,
    });
    expect(ditolak.status).toBe(400);
    expect(String(ditolak.body.error)).toContain("/api/pipeline/tts");
  });

  it("TTS sulih mendarat di dubAudio, bukan menimpa narrationAudio", async () => {
    const { studio } = boot();
    await sulihkan(studio, "sc-batu", "A stone temple that has stood for ages.");
    await sulihkan(studio, "sc-peta", "It sits in the heart of Java.");

    const hasil = await post<{
      bahasa: string;
      results: unknown[];
      belumDiterjemahkan: string[];
      suaraSendiri: boolean;
    }>(studio, "/api/pipeline/sulih", { bahasa: "en", confirm: true });
    expect(hasil.status).toBe(200);
    expect(hasil.body.bahasa).toBe("en");
    expect(hasil.body.results).toHaveLength(2);
    // Plan uji tidak menyetel dubVoices, jadi ini HARUS dilaporkan false:
    // suara Indonesia yang membaca teks Inggris terdengar persis seperti itu.
    expect(hasil.body.suaraSendiri).toBe(false);

    const plan = (await project(studio)).plan;
    if (!plan) throw new Error("plan hilang");
    expect(Object.keys(plan.renderState.dubAudio.en ?? {})).toEqual([
      "sc-batu",
      "sc-peta",
    ]);
    expect(plan.renderState.narrationAudio).toEqual({});
    expect(dubCoverage(plan, "en").bersuara).toBe(2);
  });
});

describe("subtitle per bahasa (ADR-0039 + ADR-0040)", () => {
  it("menulis berkas bernama bahasanya, dari teks sulihannya", async () => {
    const { studio } = boot();
    await sulihkan(studio, "sc-batu", "A stone temple that has stood for ages.");

    const hasil = await post<{ file: string; language: string; cues: number }>(
      studio,
      "/api/subtitle",
      { format: "srt", bahasa: "en" },
    );
    expect(hasil.status).toBe(200);
    expect(hasil.body.file).toBe("proyek-uji.en.srt");
    expect(hasil.body.language).toBe("en");
    expect(hasil.body.cues).toBeGreaterThan(0);
  });

  it("bahasa yang belum ada ditolak — salah ketik tidak boleh jadi berkas bahasa lain", async () => {
    const { studio } = boot();
    const ditolak = await post<{ error: string }>(studio, "/api/subtitle", {
      format: "srt",
      bahasa: "jv",
    });
    expect(ditolak.status).toBe(400);
  });
});
