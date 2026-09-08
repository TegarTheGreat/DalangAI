import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools, Guardrails } from "../src/index";
import {
  basicPlan,
  execOptions,
  makeDeps,
  resolvedScripted,
  SCRIPTED_INFO,
  tempProject,
  textStep,
} from "./helpers";

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

/**
 * Model vision palsu yang selalu menjawab teks yang sama.
 *
 * Bentuk FUNGSI, bukan array: tes batas tinjauan memanggilnya berkali-kali,
 * dan skrip berupa array habis setelah satu langkah.
 */
const visionSaying = (text: string) => resolvedScripted(() => textStep(text));

const CLEAN = "[]";
const ONE_FINDING =
  '[{"scene":1,"level":"perhatian","masalah":"Judul terpotong di kanan","saran":"Perkecil size ke m"}]';

describe("ADR-0022 · reviewRender", () => {
  it("merender frame lalu mengembalikan temuan gambar yang tertaut ke sceneId", async () => {
    const { session } = open(basicPlan());
    const rendered: number[][] = [];
    const { deps } = makeDeps({
      volumeModel: visionSaying(ONE_FINDING),
      renderStills: async ({ frames, outDir }) => {
        rendered.push(frames);
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        mkdirSync(outDir, { recursive: true });
        return frames.map((frame) => {
          const file = join(outDir, `f-${frame}.png`);
          writeFileSync(
            file,
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              "base64",
            ),
          );
          return file;
        });
      },
    });

    const result = await exec(buildAgentTools(session, deps), "reviewRender", {});
    expect(result.ok).toBe(true);
    expect(rendered[0]?.length).toBeGreaterThan(0);

    const temuan = result.temuanGambar as Array<Record<string, unknown>>;
    expect(temuan).toHaveLength(1);
    // Nomor scene dari model DIPETAKAN ke id: tanpa itu temuannya tidak bisa
    // ditindaklanjuti lewat applyPatch.
    expect(temuan[0]?.sceneId).toBe("sc-001");
    expect(temuan[0]?.level).toBe("perhatian");
  });

  it("menggabungkan kritik STRUKTUR di laporan yang sama", async () => {
    // Dua sudut yang tidak saling menggantikan: gambar tidak bisa melihat
    // musik yang hilang, JSON tidak bisa melihat teks yang tertimpa.
    const { session } = open(basicPlan());
    const { deps } = makeDeps({ volumeModel: visionSaying(CLEAN) });
    const result = await exec(buildAgentTools(session, deps), "reviewRender", {});
    const struktur = result.temuanStruktur as Array<{ kode: string }>;
    expect(struktur.map((note) => note.kode)).toContain("musik-hening");
    expect(result.bersih).toBe(false);
  });

  it("melaporkan alasan tiap frame dipilih", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({ volumeModel: visionSaying(CLEAN) });
    const result = await exec(buildAgentTools(session, deps), "reviewRender", {});
    const frames = result.frameDitinjau as Array<{ alasanDipilih: string }>;
    expect(frames[0]?.alasanDipilih).toMatch(/pembuka/);
  });

  it("jawaban model yang tak terurai TIDAK dianggap bersih", async () => {
    // Ini pembeda yang menentukan: "tidak ada temuan" dan "jawabannya tidak
    // terbaca" adalah dua hal yang sangat berbeda, dan menyamakannya membuat
    // agent yakin videonya baik padahal belum pernah dinilai.
    const { session } = open(basicPlan());
    const { deps } = makeDeps({
      volumeModel: visionSaying("Menurut saya semuanya sudah bagus sekali."),
    });
    const result = await exec(buildAgentTools(session, deps), "reviewRender", {});
    expect(result.temuanGambar).toEqual([]);
    expect(String(result.peringatan)).toMatch(/Jangan menganggap ini berarti/);
  });

  it("menolak tanpa model vision, dan melarang mengarang penilaian", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({ volumeModel: undefined });
    const result = await exec(buildAgentTools(session, deps), "reviewRender", {});
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/JANGAN mengarang/);
  });

  it("menolak model yang tidak menerima gambar", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({
      volumeModel: resolvedScripted([textStep(CLEAN)], {
        ...SCRIPTED_INFO,
        imageInput: false,
      }),
    });
    const result = await exec(buildAgentTools(session, deps), "reviewRender", {});
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/tidak menerima input gambar/);
  });

  it("BATAS tinjauan per giliran menghentikan loop render-lihat-perbaiki", async () => {
    const { session } = open(basicPlan());
    const guards = new Guardrails({ reviewRenderCap: 2 }, async () => true);
    const { deps } = makeDeps({ guards, volumeModel: visionSaying(CLEAN) });
    const tools = buildAgentTools(session, deps);

    expect((await exec(tools, "reviewRender", {})).ok).toBe(true);
    const kedua = await exec(tools, "reviewRender", {});
    expect(kedua.ok).toBe(true);
    expect(kedua.sisaJatahTinjauan).toBe(0);

    const ketiga = await exec(tools, "reviewRender", {});
    expect(ketiga.ok).toBe(false);
    expect(String(ketiga.error)).toMatch(/Terapkan dulu temuan sebelumnya/);
  });

  it("GERBANG BIAYA meminta izin saat perkiraannya melewati ambang", async () => {
    // Roadmap 7.2 menuntut batas iterasi DAN biaya. Batas iterasi saja tidak
    // cukup: tiga tinjauan pada delapan frame tetap pengeluaran nyata.
    const { session } = open(basicPlan());
    const ditolak = new Guardrails({ approvalGateUsd: 0.001 }, async () => false);
    const { deps } = makeDeps({ guards: ditolak, volumeModel: visionSaying(CLEAN) });
    // Pembungkus tool mengubah lemparan jadi { ok: false, error } — itulah
    // bentuk yang benar-benar dibaca agent.
    const result = await exec(buildAgentTools(session, deps), "reviewRender", {
      maxFrame: 8,
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/menolak tinjauan render/);
  });

  it("izin yang diberikan meneruskan tinjauan", async () => {
    const { session } = open(basicPlan());
    const diizinkan = new Guardrails({ approvalGateUsd: 0.001 }, async () => true);
    const { deps } = makeDeps({ guards: diizinkan, volumeModel: visionSaying(CLEAN) });
    expect(
      (await exec(buildAgentTools(session, deps), "reviewRender", { maxFrame: 8 })).ok,
    ).toBe(true);
  });

  it("tidak meminta izin untuk tinjauan kecil di bawah ambang", async () => {
    const permintaan: unknown[] = [];
    const { session } = open(basicPlan());
    const guards = new Guardrails({ approvalGateUsd: 1 }, async (request) => {
      permintaan.push(request);
      return true;
    });
    const { deps } = makeDeps({ guards, volumeModel: visionSaying(CLEAN) });
    await exec(buildAgentTools(session, deps), "reviewRender", { maxFrame: 2 });
    expect(permintaan).toEqual([]);
  });

  it("model tanpa harga tidak diblokir gerbang biaya", async () => {
    // Registry tidak selalu tahu harga tiap model. Menolak menjalankan hanya
    // karena harganya tak diketahui akan mematikan fitur ini untuk model
    // lokal dan model baru — padahal keduanya justru yang termurah.
    const { session } = open(basicPlan());
    const guards = new Guardrails({ approvalGateUsd: 0.000001 }, async () => false);
    const { deps } = makeDeps({
      guards,
      // `undefined` sebagai argumen kedua memakai DEFAULT-nya (yang berharga),
      // jadi harganya dikosongkan lewat field — persis kondisi yang membuat
      // estimateLlmCostUsd mengembalikan null.
      volumeModel: resolvedScripted(() => textStep(CLEAN), {
        ...SCRIPTED_INFO,
        costInputPerMTok: undefined,
        costOutputPerMTok: undefined,
      }),
    });
    expect(
      (await exec(buildAgentTools(session, deps), "reviewRender", { maxFrame: 8 })).ok,
    ).toBe(true);
  });

  it("jatah pulih di giliran berikutnya", async () => {
    const { session } = open(basicPlan());
    const guards = new Guardrails({ reviewRenderCap: 1 }, async () => true);
    const { deps } = makeDeps({ guards, volumeModel: visionSaying(CLEAN) });
    const tools = buildAgentTools(session, deps);

    await exec(tools, "reviewRender", {});
    expect((await exec(tools, "reviewRender", {})).ok).toBe(false);
    guards.beginTurn();
    expect((await exec(tools, "reviewRender", {})).ok).toBe(true);
  });

  it("kegagalan render jadi galat yang menyebut sebabnya, bukan lemparan mentah", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({
      volumeModel: visionSaying(CLEAN),
      renderStills: async () => {
        throw new Error("bundler meledak");
      },
    });
    const result = await exec(buildAgentTools(session, deps), "reviewRender", {});
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/bundler meledak/);
  });

  it("menghormati batas jumlah frame yang diminta", async () => {
    const { session } = open(
      basicPlan({
        scenes: Array.from({ length: 8 }, (_, i) => ({
          id: `sc-${i + 1}`,
          narration: "Kalimat narasi cukup panjang untuk mengisi durasi scene.",
          clips: [{ id: `sc-${i + 1}-k1`, type: "solid" as const }],
        })),
      }),
    );
    let count = 0;
    const { deps } = makeDeps({
      volumeModel: visionSaying(CLEAN),
      renderStills: async ({ frames, outDir }) => {
        count = frames.length;
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        mkdirSync(outDir, { recursive: true });
        return frames.map((frame) => {
          const file = join(outDir, `f-${frame}.png`);
          writeFileSync(
            file,
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              "base64",
            ),
          );
          return file;
        });
      },
    });
    await exec(buildAgentTools(session, deps), "reviewRender", { maxFrame: 2 });
    expect(count).toBe(2);
  });

  it("temuan tanpa nomor scene tetap dilaporkan sebagai temuan menyeluruh", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({
      volumeModel: visionSaying('[{"masalah":"Palet keseluruhan terasa datar"}]'),
    });
    const result = await exec(buildAgentTools(session, deps), "reviewRender", {});
    const temuan = result.temuanGambar as Array<Record<string, unknown>>;
    expect(temuan).toHaveLength(1);
    expect(temuan[0]?.sceneId).toBeUndefined();
  });
});
