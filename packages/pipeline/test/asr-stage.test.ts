import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenePlan, setNarrationAudio, setResolvedAsset } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AsrProvider,
  narrationTranscripts,
  PipelineDb,
  projectPaths,
  recordingsInPlan,
  runAsrStage,
} from "../src/index";
import { basicPlan, makeTempProject } from "./helpers";

interface FakeAsr extends AsrProvider {
  calls: string[];
}

const fakeAsr = (
  id: string,
  options: { fail?: boolean; empty?: boolean } = {},
): FakeAsr => {
  const provider: FakeAsr = {
    id,
    label: `Fake ${id}`,
    offline: true,
    calls: [],
    transcribe: async (request) => {
      provider.calls.push(request.file);
      if (options.fail) throw new Error(`${id} sengaja gagal`);
      return {
        words: options.empty
          ? []
          : [
              { word: "halo", startSec: 0, endSec: 0.5 },
              { word: "dunia", startSec: 0.6, endSec: 1.2 },
            ],
        segments: options.empty ? [] : [{ startSec: 0, endSec: 1.2, text: "halo dunia" }],
        language: "id",
        durationSec: 1.2,
        costUsd: 0.01,
      };
    },
  };
  return provider;
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** Proyek dengan satu berkas rekaman yang dipakai DUA scene. */
const projectWithRecording = (bytes = "rekaman-a") => {
  const project = makeTempProject(basicPlan());
  cleanups.push(project.cleanup);
  const paths = projectPaths(project.planPath);
  mkdirSync(join(project.dir, "media"), { recursive: true });
  writeFileSync(join(project.dir, "media", "wawancara.mp4"), bytes);

  let plan = parseScenePlan(basicPlan());
  for (const sceneId of ["sc-001", "sc-002"]) {
    plan = setResolvedAsset(plan, sceneId, {
      file: "media/wawancara.mp4",
      kind: "video",
      source: "local",
    });
  }
  return { project, paths, plan, db: new PipelineDb(paths.dbPath) };
};

describe("recordingsInPlan", () => {
  it("mengelompokkan scene menurut BERKAS, bukan sebaliknya", () => {
    const { plan } = projectWithRecording();
    expect([...recordingsInPlan(plan)]).toEqual([
      ["media/wawancara.mp4", ["sc-001", "sc-002"]],
    ]);
  });

  it("melewatkan aset gambar", () => {
    let plan = parseScenePlan(basicPlan());
    plan = setResolvedAsset(plan, "sc-001", {
      file: "assets/foto.jpg",
      kind: "image",
      source: "pexels",
    });
    // Menranskrip gambar diam pasti tidak menghasilkan apa-apa, dan pada
    // provider berbayar biayanya nyata.
    expect(recordingsInPlan(plan).size).toBe(0);
  });

  it("menghormati batasan sceneIds", () => {
    const { plan } = projectWithRecording();
    expect([...recordingsInPlan(plan, ["sc-002"])]).toEqual([
      ["media/wawancara.mp4", ["sc-002"]],
    ]);
  });
});

describe("runAsrStage", () => {
  it("menranskrip satu berkas SEKALI walau dipakai dua scene", async () => {
    const { paths, plan, db } = projectWithRecording();
    const provider = fakeAsr("fake");
    const outcome = await runAsrStage({ paths, plan, providers: [provider], db });

    expect(provider.calls).toHaveLength(1);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.detail).toContain("dipakai 2 scene");
    const transcript = outcome.plan.renderState.transcripts["media/wawancara.mp4"];
    expect(transcript?.words.map((w) => w.word)).toEqual(["halo", "dunia"]);
    expect(transcript?.source).toBe("fake");
  });

  it("cache dipakai pada jalan kedua — provider tidak dipanggil lagi", async () => {
    const { paths, plan, db } = projectWithRecording();
    const first = fakeAsr("fake");
    const after = await runAsrStage({ paths, plan, providers: [first], db });

    const second = fakeAsr("fake");
    const again = await runAsrStage({ paths, plan: after.plan, providers: [second], db });
    expect(second.calls).toEqual([]);
    expect(again.results[0]?.status).toBe("cached");
    expect(again.plan.renderState.transcripts["media/wawancara.mp4"]?.words).toHaveLength(
      2,
    );
  });

  it("ISI berkas yang berubah membatalkan cache, walau namanya sama", async () => {
    // Ini inti kunci cache-nya: rekaman diganti dengan nama yang sama tidak
    // boleh memakai transkrip lama, dan salinan identik di folder lain tidak
    // boleh ditranskrip dua kali.
    const { project, paths, plan, db } = projectWithRecording("rekaman-a");
    const first = fakeAsr("fake");
    await runAsrStage({ paths, plan, providers: [first], db });

    writeFileSync(join(project.dir, "media", "wawancara.mp4"), "rekaman-B-BERBEDA");
    const second = fakeAsr("fake");
    const again = await runAsrStage({ paths, plan, providers: [second], db });
    expect(second.calls).toHaveLength(1);
    expect(again.results[0]?.status).toBe("done");
  });

  it("diarisasi ikut jadi kunci cache", async () => {
    const { paths, plan, db } = projectWithRecording();
    await runAsrStage({ paths, plan, providers: [fakeAsr("fake")], db });
    const kedua = fakeAsr("fake");
    await runAsrStage({ paths, plan, providers: [kedua], db, diarize: true });
    expect(kedua.calls).toHaveLength(1);
  });

  it("jatuh ke provider berikutnya saat yang pertama gagal, dan menandainya fallback", async () => {
    const { paths, plan, db } = projectWithRecording();
    const gagal = fakeAsr("gagal", { fail: true });
    const cadangan = fakeAsr("cadangan");
    const outcome = await runAsrStage({
      paths,
      plan,
      providers: [gagal, cadangan],
      db,
      log: { info: () => undefined, warn: () => undefined },
    });
    expect(outcome.results[0]).toMatchObject({ status: "done", fallback: true });
    expect(outcome.plan.renderState.transcripts["media/wawancara.mp4"]?.source).toBe(
      "cadangan",
    );
  });

  it("transkrip KOSONG diperlakukan sebagai kegagalan, bukan keberhasilan", async () => {
    // Rekaman yang tidak menghasilkan satu kata pun hampir selalu berarti
    // berkas atau bahasanya salah. Menyimpannya sebagai sukses akan
    // menyembunyikan itu di balik panel transkrip yang kosong.
    const { paths, plan, db } = projectWithRecording();
    const outcome = await runAsrStage({
      paths,
      plan,
      providers: [fakeAsr("kosong", { empty: true })],
      db,
      log: { info: () => undefined, warn: () => undefined },
    });
    expect(outcome.results[0]?.status).toBe("error");
    expect(outcome.plan.renderState.transcripts).toEqual({});
  });

  it("melempar galat yang menyebut apa yang kurang saat rantai kosong", async () => {
    const { paths, plan, db } = projectWithRecording();
    await expect(runAsrStage({ paths, plan, providers: [], db })).rejects.toThrow(
      /whisper\.cpp.*DEEPGRAM_API_KEY/s,
    );
  });

  it("plan tanpa rekaman: tidak melempar walau rantainya kosong", async () => {
    const project = makeTempProject(basicPlan());
    cleanups.push(project.cleanup);
    const paths = projectPaths(project.planPath);
    const outcome = await runAsrStage({
      paths,
      plan: parseScenePlan(basicPlan()),
      providers: [],
      db: new PipelineDb(paths.dbPath),
    });
    expect(outcome.results).toEqual([]);
  });

  it("berkas yang hilang jadi galat per-berkas, bukan menggagalkan seluruh stage", async () => {
    const project = makeTempProject(basicPlan());
    cleanups.push(project.cleanup);
    const paths = projectPaths(project.planPath);
    let plan = parseScenePlan(basicPlan());
    plan = setResolvedAsset(plan, "sc-001", {
      file: "media/hilang.mp4",
      kind: "video",
      source: "local",
    });
    const outcome = await runAsrStage({
      paths,
      plan,
      providers: [fakeAsr("fake")],
      db: new PipelineDb(paths.dbPath),
    });
    expect(outcome.results[0]).toMatchObject({ status: "error" });
    expect(outcome.results[0]?.detail).toContain("tidak ada");
  });
});

describe("narrationTranscripts", () => {
  it("memakai word timestamp TTS Dalang sendiri — gratis, tanpa jaringan", () => {
    let plan = parseScenePlan(basicPlan());
    plan = setNarrationAudio(plan, "sc-001", {
      file: ".dalang/tts/abc.wav",
      durationSec: 2,
      wordTimestamps: [
        { word: "Kalimat", startSec: 0, endSec: 0.6 },
        { word: "pertama", startSec: 0.7, endSec: 1.4 },
      ],
    });
    const after = narrationTranscripts(plan);
    const transcript = after.renderState.transcripts[".dalang/tts/abc.wav"];
    expect(transcript?.source).toBe("narration");
    expect(transcript?.fromNarration).toBe(true);
    expect(transcript?.words).toHaveLength(2);
  });

  it("tidak menimpa transkrip hasil mendengarkan rekaman sungguhan", async () => {
    const { paths, plan, db } = projectWithRecording();
    const withAsr = (await runAsrStage({ paths, plan, providers: [fakeAsr("fake")], db }))
      .plan;
    const withNarration = setNarrationAudio(withAsr, "sc-001", {
      file: "media/wawancara.mp4",
      durationSec: 9,
      wordTimestamps: [{ word: "palsu", startSec: 0, endSec: 1 }],
    });
    const after = narrationTranscripts(withNarration);
    expect(after.renderState.transcripts["media/wawancara.mp4"]?.source).toBe("fake");
  });

  it("melewatkan narasi yang belum punya word timestamp", () => {
    let plan = parseScenePlan(basicPlan());
    plan = setNarrationAudio(plan, "sc-001", {
      file: ".dalang/tts/x.wav",
      durationSec: 1,
    });
    expect(narrationTranscripts(plan).renderState.transcripts).toEqual({});
  });
});
