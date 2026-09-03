import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ScenePlan,
  setClipAsset,
  setTranscript,
  type Transcript,
} from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools } from "../src/index";
import { basicPlan, execOptions, fakeAsr, makeDeps, tempProject } from "./helpers";

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

const open = (plan: Parameters<typeof tempProject>[0]) => {
  const project = tempProject(plan);
  cleanups.push(project.cleanup);
  return project;
};

type AnyTool = { execute: (input: unknown, options: unknown) => Promise<unknown> };
const exec = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as AnyTool).execute(input, execOptions) as Promise<
    Record<string, unknown>
  >;

const TRANSCRIPT: Transcript = {
  source: "uji",
  language: "id",
  durationSec: 60,
  words: [
    { word: "Selamat", startSec: 5, endSec: 5.5 },
    { word: "datang", startSec: 5.6, endSec: 6.1 },
    { word: "emm", startSec: 6.2, endSec: 6.6 },
    { word: "di", startSec: 6.7, endSec: 6.9 },
    { word: "kanal", startSec: 7, endSec: 7.5 },
    { word: "saya", startSec: 7.6, endSec: 8 },
    { word: "harga", startSec: 20, endSec: 20.5 },
    { word: "emas", startSec: 20.6, endSec: 21.1 },
    { word: "naik", startSec: 21.2, endSec: 21.7 },
  ],
  segments: [],
};

/**
 * Proyek dengan satu scene berisi rekaman. Berkasnya BENAR-BENAR ditulis ke
 * disk: kunci cache stage ASR adalah isi berkas, jadi rekaman khayalan akan
 * membuat stage-nya gagal membaca alih-alih menguji jalur yang sebenarnya.
 */
const withRecording = (options: { transcript?: boolean } = {}) => {
  const project = open(basicPlan());
  const file = "media/podcast.mp4";
  const abs = join(project.session.paths.planDir, file);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "isi-rekaman-palsu");

  let plan = setClipAsset(project.session.plan as ScenePlan, "sc-001-k1", {
    file,
    kind: "video",
    source: "local",
    durationSec: 60,
  });
  if (options.transcript !== false) {
    plan = setTranscript(plan, file, TRANSCRIPT);
  }
  project.session.plan = plan;
  return project;
};

const withTranscript = withRecording;

describe("ADR-0021 · transcribeVideo", () => {
  it("mengabarkan APA ADANYA saat tidak ada jalur ASR sama sekali", async () => {
    // Ini keadaan paling sering di mesin polos. Menyamarkannya jadi
    // "tidak ada rekaman" akan membuat agent mengarang isi rekaman.
    const { session } = withTranscript();
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const result = await exec(tools, "transcribeVideo", {});
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/whisper\.cpp/);
    expect(String(result.error)).toMatch(/jangan mengarang/i);
  });

  it("menjalankan stage dan menuliskan transkrip ke plan", async () => {
    const { session } = withRecording({ transcript: false });
    const asr = fakeAsr();
    const { deps } = makeDeps({ asrChain: () => [asr] });
    const result = await exec(buildAgentTools(session, deps), "transcribeVideo", {});

    expect(result.ok).toBe(true);
    expect(asr.calls).toHaveLength(1);
    expect(result.biayaUsd).toBeCloseTo(0.02, 4);
    expect(result.transkripTersedia).toEqual([
      {
        file: "media/podcast.mp4",
        kata: 2,
        durasiDetik: 1.2,
        bahasa: "id",
        dariNarasi: false,
      },
    ]);
    expect(session.plan?.renderState.transcripts["media/podcast.mp4"]?.source).toBe(
      "asr-palsu",
    );
  });

  it("tidak menranskrip dua kali — jalan kedua memakai cache", async () => {
    const { session } = withRecording({ transcript: false });
    const asr = fakeAsr();
    const tools = buildAgentTools(session, makeDeps({ asrChain: () => [asr] }).deps);
    await exec(tools, "transcribeVideo", {});
    await exec(tools, "transcribeVideo", {});
    expect(asr.calls).toHaveLength(1);
  });

  it("plan tanpa rekaman menjawab jujur, bukan gagal", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({ asrChain: () => [fakeAsr()] });
    const result = await exec(buildAgentTools(session, deps), "transcribeVideo", {});
    expect(result.ok).toBe(true);
    expect(String(result.catatan)).toMatch(/tidak ada yang perlu ditranskrip/i);
  });
});

describe("ADR-0021 · getTranscript", () => {
  it("mengembalikan kalimat berwaktu, bukan ribuan kata lepas", async () => {
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "getTranscript", { sceneId: "sc-001" });
    expect(result.ok).toBe(true);
    const kalimat = result.kalimat as Array<{ mulai: number; teks: string }>;
    // Dua giliran bicara: 5-8 detik lalu 20-21,7 detik.
    expect(kalimat).toHaveLength(2);
    expect(kalimat[0]?.teks).toContain("Selamat datang");
    expect(kalimat[1]?.mulai).toBe(20);
  });

  it("menyaring menurut jendela waktu", async () => {
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "getTranscript", {
      sceneId: "sc-001",
      dariDetik: 15,
    });
    expect((result.kalimat as unknown[]).length).toBe(1);
  });

  it("menyuruh menranskrip dulu kalau scene belum punya transkrip", async () => {
    const { session } = open(basicPlan());
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "getTranscript", { sceneId: "sc-001" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/transcribeVideo/);
  });
});

describe("ADR-0021 · findMoments", () => {
  it("menemukan frasa beserta detiknya", async () => {
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "findMoments", {
      sceneId: "sc-001",
      frasa: "harga emas",
    });
    expect(result.jumlah).toBe(1);
    expect((result.rentang as Array<{ mulai: number }>)[0]?.mulai).toBe(20);
  });

  it("menuntun ke getTranscript saat frasa tidak ketemu", async () => {
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "findMoments", {
      sceneId: "sc-001",
      frasa: "tidak pernah diucapkan",
    });
    expect(result.jumlah).toBe(0);
    expect(String(result.catatan)).toMatch(/getTranscript/);
  });

  it("jenis 'pengisi' mengembalikan bunyi ragu yang bisa dibuang", async () => {
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "findMoments", {
      sceneId: "sc-001",
      jenis: "pengisi",
    });
    expect(result.jumlah).toBe(1);
    expect((result.rentang as Array<{ teks: string }>)[0]?.teks).toBe("emm");
  });

  it("menolak pencarian frasa tanpa frasa", async () => {
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    expect((await exec(tools, "findMoments", { sceneId: "sc-001" })).ok).toBe(false);
  });
});

describe("ADR-0021 · cutByWords", () => {
  it("menyetel trimStartSec dan durasi lewat patch op yang SUDAH ada", async () => {
    // Tidak ada op baru: undo untuk potongan berbasis kata gratis.
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "cutByWords", {
      sceneId: "sc-001",
      dariDetik: 20,
      sampaiDetik: 21.7,
    });
    expect(result.ok).toBe(true);
    const scene = session.plan?.scenes.find((item) => item.id === "sc-001");
    expect(scene?.clips[0]?.trimStartSec).toBe(20);
    expect(scene?.duration).toBeCloseTo(1.7, 3);
    expect(String(result.teksTerpakai)).toContain("harga emas naik");

    session.undo();
    expect(
      session.plan?.scenes.find((item) => item.id === "sc-001")?.clips[0]?.trimStartSec,
    ).toBe(0);
  });

  it("menolak rentang terbalik", async () => {
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "cutByWords", {
      sceneId: "sc-001",
      dariDetik: 30,
      sampaiDetik: 20,
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/tidak sah/);
  });

  it("menolak titik mulai yang melewati akhir rekaman", async () => {
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "cutByWords", {
      sceneId: "sc-001",
      dariDetik: 90,
      sampaiDetik: 95,
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/melewati akhir rekaman/);
  });

  it("MENJEPIT ujung potongan ke panjang rekaman alih-alih menolaknya", async () => {
    // "10 detik terakhir" dari rekaman yang tersisa 2 detik adalah maksud yang
    // jelas; menolaknya hanya memaksa agent menghitung ulang sendiri.
    const { session } = withTranscript();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "cutByWords", {
      sceneId: "sc-001",
      dariDetik: 58,
      sampaiDetik: 68,
    });
    expect(result.ok).toBe(true);
    expect(result.dijepitKeAkhirRekaman).toBe(60);
    expect(result.durasiSceneDetik).toBe(2);
  });

  it("durasi scene memperhitungkan visual.speed", async () => {
    const { session } = withTranscript();
    session.applyUserPatch([
      { op: "updateScene", id: "sc-001", patch: { visual: { speed: 2 } } },
    ]);
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const result = await exec(tools, "cutByWords", {
      sceneId: "sc-001",
      dariDetik: 20,
      sampaiDetik: 24,
    });
    // 4 detik rekaman diputar 2x = 2 detik di layar.
    expect(result.durasiSceneDetik).toBe(2);
  });
});
