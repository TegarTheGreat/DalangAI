import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenePlan } from "@dalang/core";
import type { MediaTranscoder } from "@dalang/pipeline";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectStatePayload } from "../src/shared/api-types";
import { callJson, makeStudio, makeTempProject } from "./helpers";

/**
 * Koherensi Studio dengan PENULIS LAIN pada plan.json yang sama (batas
 * ADR-0023 "server MCP tidak menyelaraskan diri dengan Studio").
 *
 * Studio memegang plan di memori dan tahap pipeline bekerja pada snapshot.
 * Server MCP (atau CLI) menulis berkasnya langsung. Yang dijaga di sini:
 * editan dari luar yang masuk SELAGI tahap berjalan, atau tepat sebelum job
 * eksklusif membaca plan, tidak pernah ditimpa diam-diam.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const rewriteTitle = (planPath: string, title: string) => {
  const onDisk = JSON.parse(readFileSync(planPath, "utf8")) as ScenePlan;
  onDisk.meta.title = title;
  writeFileSync(planPath, `${JSON.stringify(onDisk, null, 2)}\n`);
};

const fakeTranscoder = (): MediaTranscoder => ({
  id: "fake-ff",
  probe: async () => ({
    durationSec: 12,
    width: 1280,
    height: 720,
    fps: 30,
    codec: "h264",
    hasAudio: true,
    audioCodec: "aac",
    channels: 2,
    sampleRate: 48000,
    bitrate: 4_000_000,
    sizeBytes: 1,
  }),
  makeProxy: async () => ({ ok: false, reason: "tidak dipakai di tes ini" }),
  extractFrame: async () => ({ ok: true }),
  toWav: async () => ({ ok: true }),
  decodeMonoPcm: async () => null,
});

describe("koherensi Studio dengan penulis lain pada plan.json (ADR-0023)", () => {
  it("editan eksternal SELAGI tahap TTS berjalan tidak ditimpa: judul dari luar dan narasi dari tahap sama-sama tersimpan", async () => {
    const { dir, planPath } = makeTempProject();
    const studio = makeStudio(planPath, { ttsDelayMs: 250 });
    cleanups.push(() => {
      studio.close();
      rmSync(dir, { recursive: true, force: true });
    });

    const tts = callJson<{ ok: boolean }>(studio, "/api/pipeline/tts", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await sleep(60);
    // "Server MCP" menulis plan.json selagi TTS masih berjalan.
    rewriteTitle(planPath, "Diubah dari luar selagi TTS");
    expect((await tts).status).toBe(200);

    const project = (await callJson<ProjectStatePayload>(studio, "/api/project")).body;
    expect(project.plan?.meta.title).toBe("Diubah dari luar selagi TTS");
    expect(project.plan?.renderState.narrationAudio["sc-batu"]?.file).toMatch(
      /^\.dalang\/tts\//,
    );
    const written = JSON.parse(readFileSync(planPath, "utf8")) as ScenePlan;
    expect(written.meta.title).toBe("Diubah dari luar selagi TTS");
    expect(written.renderState.narrationAudio["sc-batu"]).toBeDefined();
  });

  it("job eksklusif membaca plan yang SEGAR: editan eksternal tepat sebelum pendaftaran rekaman tidak dikembalikan ke judul lama", async () => {
    const { dir, planPath } = makeTempProject();
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets/rekaman.mp4"), "rekaman palsu");
    const studio = makeStudio(planPath, { transcoder: fakeTranscoder });
    cleanups.push(() => {
      studio.close();
      rmSync(dir, { recursive: true, force: true });
    });

    // Tulis dari luar, lalu SEGERA (sebelum pengawas berkas sempat bangun)
    // jalankan job yang menulis plan.
    rewriteTitle(planPath, "Diubah dari luar sebelum daftar");
    const registered = await callJson<{ ok: boolean }>(studio, "/api/sources/register", {
      method: "POST",
      body: JSON.stringify({ file: "assets/rekaman.mp4", sceneId: "sc-batu" }),
    });
    expect(registered.status).toBe(200);

    const project = (await callJson<ProjectStatePayload>(studio, "/api/project")).body;
    expect(project.plan?.meta.title).toBe("Diubah dari luar sebelum daftar");
    expect(project.plan?.scenes.find((s) => s.id === "sc-batu")?.visual.assetId).toBe(
      "assets/rekaman.mp4",
    );
    const written = JSON.parse(readFileSync(planPath, "utf8")) as ScenePlan;
    expect(written.meta.title).toBe("Diubah dari luar sebelum daftar");
  });
});
