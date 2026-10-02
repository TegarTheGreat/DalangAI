import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseScenePlan, planInLanguage, type ScenePlanInput } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineDb } from "../src/db";
import { runDubStage } from "../src/dub-stage";
import type { TtsProvider } from "../src/ports";
import { projectPaths } from "../src/project-paths";
import { runTtsStage } from "../src/tts-stage";
import { makeTempProject } from "./helpers";

/**
 * Tahap sulih suara (ADR-0040).
 *
 * Yang dijaga di sini bukan mutu suaranya, melainkan tiga hal yang salahnya
 * mahal: hasilnya mendarat di lumbung bahasa yang BENAR, cache-nya tidak
 * saling menimpa dengan bahasa utama (kalau menimpa, bolak-balik antar bahasa
 * berarti tagihan provider tiap kali), dan scene yang belum diterjemahkan
 * dilaporkan alih-alih disintesis jadi berkas kosong.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const planInput = (): ScenePlanInput => ({
  version: 2,
  projectId: "uji-sulih",
  meta: { title: "Uji Sulih", language: "id" },
  audio: { voice: { provider: "hitung", voiceId: "id-1", speed: 1 } },
  scenes: [
    {
      id: "sc-1",
      narration: "Candi ini berdiri sejak abad kesembilan.",
      dubs: { en: "This temple has stood since the ninth century." },
      clips: [{ id: "sc-1-k1", type: "solid" }],
    },
    {
      id: "sc-2",
      narration: "Batunya disusun tanpa perekat.",
      clips: [{ id: "sc-2-k1", type: "solid" }],
    },
  ],
});

/** Provider yang MENGHITUNG panggilan — cache yang bocor langsung terlihat. */
const countingTts = () => {
  const calls: Array<{ text: string; language: string; voiceId: string }> = [];
  const provider: TtsProvider & { calls: typeof calls } = {
    id: "hitung",
    label: "TTS Hitung",
    placeholderQuality: false,
    calls,
    synthesize: async ({ text, language, voiceId }) => {
      calls.push({ text, language, voiceId });
      const samples = 1600;
      const data = new Uint8Array(44 + samples * 2);
      const view = new DataView(data.buffer);
      const ascii = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++) data[offset + i] = s.charCodeAt(i);
      };
      ascii(0, "RIFF");
      view.setUint32(4, 36 + samples * 2, true);
      ascii(8, "WAVEfmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true);
      view.setUint32(28, 16000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      ascii(36, "data");
      view.setUint32(40, samples * 2, true);
      return {
        audio: data,
        format: "wav" as const,
        durationSec: 0.2,
        wordTimestamps: text
          .trim()
          .split(/\s+/)
          .map((word, i) => ({ word, startSec: i * 0.02, endSec: (i + 1) * 0.02 })),
        timestampsSource: "native" as const,
        costUsd: 0.01,
      };
    },
  };
  return provider;
};

const boot = () => {
  const input = planInput();
  const { dir, planPath } = makeTempProject(input);
  const paths = projectPaths(planPath);
  const db = new PipelineDb(paths.dbPath);
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, paths, db, plan: parseScenePlan(input) };
};

describe("runDubStage (ADR-0040)", () => {
  it("hasilnya mendarat di dubAudio bahasa itu, bukan di narrationAudio", async () => {
    const { paths, db, plan } = boot();
    const tts = countingTts();
    const { plan: sesudah, belumDiterjemahkan } = await runDubStage({
      paths,
      plan,
      language: "en",
      providers: [tts],
      db,
      log: { info: () => {}, warn: () => {} },
    });

    expect(sesudah.renderState.narrationAudio).toEqual({});
    expect(sesudah.renderState.dubAudio.en?.["sc-1"]).toMatchObject({ durationSec: 0.2 });
    // sc-2 belum punya sulihan: dilaporkan, bukan disintesis jadi berkas kosong.
    expect(belumDiterjemahkan).toEqual(["sc-2"]);
    expect(sesudah.renderState.dubAudio.en?.["sc-2"]).toBeUndefined();
    expect(tts.calls).toHaveLength(1);
    expect(tts.calls[0]).toMatchObject({
      text: "This temple has stood since the ninth century.",
      language: "en",
    });
    expect(
      existsSync(join(paths.planDir, sesudah.renderState.dubAudio.en!["sc-1"]!.file)),
    ).toBe(true);
  });

  it("cache bahasa sulih TIDAK menimpa cache bahasa utama", async () => {
    // Kalau kuncinya sama, bolak-balik antar bahasa berarti sintesis ulang
    // setiap kali — dengan tagihan providernya.
    const { paths, db, plan } = boot();
    const tts = countingTts();
    const log = { info: () => {}, warn: () => {} };

    const utama = await runTtsStage({ paths, plan, providers: [tts], db, log });
    expect(tts.calls).toHaveLength(2);

    const sulih = await runDubStage({
      paths,
      plan: utama.plan,
      language: "en",
      providers: [tts],
      db,
      log,
    });
    expect(tts.calls).toHaveLength(3);

    // Jalankan KEDUANYA lagi: dua-duanya harus kena cache, nol panggilan baru.
    const utamaLagi = await runTtsStage({
      paths,
      plan: sulih.plan,
      providers: [tts],
      db,
      log,
    });
    const sulihLagi = await runDubStage({
      paths,
      plan: utamaLagi.plan,
      language: "en",
      providers: [tts],
      db,
      log,
    });
    expect(tts.calls).toHaveLength(3);
    expect(utamaLagi.results.every((r) => r.status === "cached")).toBe(true);
    expect(sulihLagi.results.every((r) => r.status === "cached")).toBe(true);
    // Dan kedua lumbung tetap terisi bersamaan.
    expect(Object.keys(sulihLagi.plan.renderState.narrationAudio)).toEqual([
      "sc-1",
      "sc-2",
    ]);
    expect(Object.keys(sulihLagi.plan.renderState.dubAudio.en ?? {})).toEqual(["sc-1"]);
  });

  it("suara khusus bahasa dipakai, bukan suara bahasa utama", async () => {
    const { paths, db, plan } = boot();
    const tts = countingTts();
    const dengan = parseScenePlan({
      ...planInput(),
      audio: {
        voice: { provider: "hitung", voiceId: "id-1", speed: 1 },
        dubVoices: { en: { provider: "hitung", voiceId: "en-natural", speed: 1 } },
      },
    });
    await runDubStage({
      paths,
      plan: dengan,
      language: "en",
      providers: [tts],
      db,
      log: { info: () => {}, warn: () => {} },
    });
    expect(tts.calls[0]?.voiceId).toBe("en-natural");
    expect(plan.audio.voice?.voiceId).toBe("id-1");
  });

  it("bahasa utama ditolak — itu tahap TTS biasa, bukan sulih suara", async () => {
    const { paths, db, plan } = boot();
    await expect(
      runDubStage({
        paths,
        plan,
        language: "id",
        providers: [countingTts()],
        db,
        log: { info: () => {}, warn: () => {} },
      }),
    ).rejects.toThrow(/bahasa utama/);
  });

  it("bahasa tanpa satu pun teks sulihan tidak memanggil provider sama sekali", async () => {
    const { paths, db, plan } = boot();
    const tts = countingTts();
    const { results, belumDiterjemahkan } = await runDubStage({
      paths,
      plan,
      language: "jv",
      providers: [tts],
      db,
      log: { info: () => {}, warn: () => {} },
    });
    expect(tts.calls).toHaveLength(0);
    expect(results).toEqual([]);
    expect(belumDiterjemahkan).toEqual(["sc-1", "sc-2"]);
  });

  it("plan hasil sulih bisa langsung dibaca planInLanguage tanpa langkah lain", async () => {
    const { paths, db, plan } = boot();
    const { plan: sesudah } = await runDubStage({
      paths,
      plan,
      language: "en",
      providers: [countingTts()],
      db,
      log: { info: () => {}, warn: () => {} },
    });
    const en = planInLanguage(sesudah, "en");
    expect(en.renderState.narrationAudio["sc-1"]).toMatchObject({ durationSec: 0.2 });
    expect(en.scenes[0]?.narration).toBe(
      "This temple has stood since the ninth century.",
    );
  });
});
