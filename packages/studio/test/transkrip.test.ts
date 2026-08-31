import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AsrProvider } from "@dalang/pipeline";
import { describe, expect, it } from "vitest";
import type { ProjectStatePayload } from "../src/shared/api-types";
import { call, callJson, makeStudio, makeTempProject, postJson } from "./helpers";

const fakeAsr = (options: { fail?: boolean } = {}): AsrProvider & { calls: string[] } => {
  const provider: AsrProvider & { calls: string[] } = {
    id: "asr-uji",
    label: "ASR Uji",
    offline: true,
    calls: [],
    transcribe: async (request) => {
      provider.calls.push(request.file);
      if (options.fail) throw new Error("sengaja gagal");
      return {
        words: [
          { word: "Selamat", startSec: 0, endSec: 0.6 },
          { word: "datang", startSec: 0.7, endSec: 1.3 },
          { word: "semua", startSec: 3.2, endSec: 3.8 },
        ],
        segments: [],
        language: "id",
        durationSec: 4,
        costUsd: 0,
      };
    },
  };
  return provider;
};

/**
 * Proyek dengan satu rekaman NYATA di disk: kunci cache stage ASR adalah isi
 * berkas, jadi rekaman khayalan hanya akan menguji jalur galat.
 */
const projectWithRecording = () => {
  const project = makeTempProject();
  mkdirSync(join(project.dir, "media"), { recursive: true });
  writeFileSync(join(project.dir, "media", "wawancara.wav"), "rekaman");

  const plan = JSON.parse(readFileSync(project.planPath, "utf8")) as {
    renderState: { resolvedAssets: Record<string, unknown> };
  };
  plan.renderState.resolvedAssets["sc-batu"] = {
    file: "media/wawancara.wav",
    kind: "audio",
    source: "local",
    durationSec: 4,
  };
  writeFileSync(project.planPath, JSON.stringify(plan, null, 2));
  return project;
};

describe("transkripsi (ADR-0021)", () => {
  it("501 dengan pesan yang menyebut apa yang kurang saat tidak ada jalur ASR", async () => {
    // Bukan 500: ini kemampuan yang belum dipasang, bukan kerusakan — dan UI
    // menampilkan pesannya apa adanya.
    const project = projectWithRecording();
    const studio = makeStudio(project.planPath, { asrChain: () => [] });
    const response = await call(studio, "/api/pipeline/transcribe", postJson({}));
    expect(response.status).toBe(501);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("asr-unavailable");
    expect(body.error).toMatch(/whisper\.cpp/);
    expect(body.error).toMatch(/DEEPGRAM_API_KEY/);
  });

  it("menjalankan stage lalu menyediakan ringkasan di state", async () => {
    const project = projectWithRecording();
    const asr = fakeAsr();
    const studio = makeStudio(project.planPath, { asrChain: () => [asr] });

    await call(studio, "/api/pipeline/transcribe", postJson({}));
    expect(asr.calls).toHaveLength(1);

    const { body: state } = await callJson<ProjectStatePayload>(studio, "/api/project");
    expect(state.transcripts).toEqual([
      {
        file: "media/wawancara.wav",
        words: 3,
        durationSec: 4,
        language: "id",
        source: "asr-uji",
        fromNarration: false,
        speakers: [],
      },
    ]);
  });

  it("ISI transkrip DIBUANG dari muatan state — hanya ringkasannya yang ikut", async () => {
    // Rekaman satu jam menambah ratusan kilobyte, dan state ini disiarkan
    // ulang pada SETIAP perubahan. Ini yang menjaga siaran itu tetap ringan.
    const project = projectWithRecording();
    const studio = makeStudio(project.planPath, { asrChain: () => [fakeAsr()] });
    await call(studio, "/api/pipeline/transcribe", postJson({}));

    const { body: state } = await callJson<ProjectStatePayload>(studio, "/api/project");
    expect(state.plan?.renderState.transcripts).toEqual({});
    expect(state.transcripts[0]?.words).toBe(3);
  });

  it("/api/transcript melayani isi lengkap beserta kalimatnya", async () => {
    const project = projectWithRecording();
    const studio = makeStudio(project.planPath, { asrChain: () => [fakeAsr()] });
    await call(studio, "/api/pipeline/transcribe", postJson({}));

    const { body: payload } = await callJson<{
      file: string;
      transcript: { words: unknown[] };
      spans: Array<{ startSec: number; text: string }>;
    }>(studio, "/api/transcript?file=media%2Fwawancara.wav");

    expect(payload.transcript.words).toHaveLength(3);
    // Celah 1,9 detik antara "datang" dan "semua" memecahnya jadi dua kalimat.
    expect(payload.spans).toHaveLength(2);
    expect(payload.spans[0]?.text).toBe("Selamat datang");
  });

  it("/api/transcript menolak berkas tanpa transkrip dengan 404", async () => {
    const project = projectWithRecording();
    const studio = makeStudio(project.planPath, { asrChain: () => [fakeAsr()] });
    const response = await call(studio, "/api/transcript?file=media%2Fbelum.wav");
    expect(response.status).toBe(404);
  });

  it("/api/transcript butuh parameter file", async () => {
    const project = projectWithRecording();
    const studio = makeStudio(project.planPath, { asrChain: () => [fakeAsr()] });
    expect((await call(studio, "/api/transcript")).status).toBe(400);
  });

  it("kegagalan provider jadi hasil ber-status error, bukan 500", async () => {
    const project = projectWithRecording();
    const studio = makeStudio(project.planPath, {
      asrChain: () => [fakeAsr({ fail: true })],
    });
    const response = await call(studio, "/api/pipeline/transcribe", postJson({}));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: Array<{ status: string }> };
    expect(body.results[0]?.status).toBe("error");
  });
});
