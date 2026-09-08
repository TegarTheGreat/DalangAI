import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedModel } from "@dalang/agent";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { call, callJson, makeStudio, makeTempProject, postJson } from "./helpers";

/**
 * Rute /api/review (ADR-0022) — permukaan Studio untuk tinjauan render.
 *
 * Yang dikunci di sini adalah hal-hal yang MUDAH salah dan mahal kalau salah:
 * mesin tanpa model vision harus menolak dengan jujur (501, bukan 500 dan
 * bukan hasil kosong), dan jawaban model yang tidak bisa diurai TIDAK BOLEH
 * sampai ke UI sebagai "tidak ada temuan".
 */

/** 1x1 PNG — cukup untuk dikirim ke model palsu sebagai gambar sungguhan. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Model vision palsu yang selalu menjawab teks yang sama. */
const visionSaying = (text: string, info?: ResolvedModel["info"]): ResolvedModel => ({
  key: "mock/vision",
  model: new MockLanguageModelV3({
    provider: "mock",
    modelId: "vision",
    doGenerate: async () => ({
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: 900,
          noCache: 900,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 40, text: 40, reasoning: undefined },
        raw: undefined,
      },
      warnings: [],
    }),
  }),
  ...(info ? { info } : {}),
});

const stills = async ({ frames, outDir }: { frames: number[]; outDir: string }) => {
  mkdirSync(outDir, { recursive: true });
  return frames.map((frame) => {
    const file = join(outDir, `review-${frame}.png`);
    writeFileSync(file, PNG);
    return file;
  });
};

const ONE_FINDING =
  '[{"scene":2,"level":"perhatian","masalah":"Teks tertutup foto","saran":"Geser ke bawah"}]';

interface ReviewBody {
  frames: Array<{ frame: number; sceneId: string; sceneNumber: number; reason: string }>;
  findings: Array<Record<string, unknown>>;
  structural: Array<Record<string, unknown>>;
  warning?: string;
  dropped?: number;
}

describe("/api/review (ADR-0022)", () => {
  it("501 saat mesin tidak punya model vision", async () => {
    // Kemampuan yang belum dikonfigurasi, bukan kerusakan — dan UI menampilkan
    // pesannya apa adanya, jadi pesannya harus menyebut apa yang kurang.
    const project = makeTempProject();
    const studio = makeStudio(project.planPath);
    const response = await call(studio, "/api/review", postJson({}));
    expect(response.status).toBe(501);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("vision-unavailable");
    expect(body.error).toMatch(/vision/i);
  });

  it("501 saat model tier-volume ada tapi tidak menerima gambar", async () => {
    // Kesalahan paling sering: model teks murah dipasang untuk tier volume.
    // Ditolak SEBELUM render, supaya tidak ada frame yang dirender sia-sia.
    const project = makeTempProject();
    let dirender = 0;
    const studio = makeStudio(project.planPath, {
      volumeModel: visionSaying(ONE_FINDING, {
        key: "mock/teks",
        provider: "mock",
        id: "teks",
        name: "Teks saja",
        toolCall: true,
        imageInput: false,
        reasoning: false,
      }),
      renderStills: async (options) => {
        dirender++;
        return stills(options);
      },
    });
    const response = await call(studio, "/api/review", postJson({}));
    expect(response.status).toBe(501);
    expect(dirender).toBe(0);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/tidak menerima input gambar/);
  });

  it("merender frame lalu mengembalikan temuan yang tertaut ke sceneId", async () => {
    const project = makeTempProject();
    const dirender: number[][] = [];
    const studio = makeStudio(project.planPath, {
      volumeModel: visionSaying(ONE_FINDING),
      renderStills: async (options) => {
        dirender.push(options.frames);
        return stills(options);
      },
    });
    const { status, body } = await callJson<ReviewBody>(
      studio,
      "/api/review",
      postJson({ maxFrames: 2 }),
    );
    expect(status).toBe(200);
    expect(dirender[0]).toHaveLength(2);
    expect(body.frames).toHaveLength(2);
    // Nomor scene dari model dipetakan ke id: tanpa itu tombol "Buka <scene>"
    // di dialog tidak punya tujuan.
    expect(body.findings[0]?.sceneId).toBe("sc-batu");
    expect(body.warning).toBeUndefined();
  });

  it("jawaban tak terurai jadi PERINGATAN, bukan 'tidak ada temuan'", async () => {
    // Kekeliruan yang paling berbahaya di seluruh fase ini: model menjawab
    // ngawur, temuannya nol, dan UI melaporkan drafnya bersih.
    const project = makeTempProject();
    const studio = makeStudio(project.planPath, {
      volumeModel: visionSaying("Menurut saya videonya sudah bagus sekali."),
      renderStills: stills,
    });
    const { status, body } = await callJson<ReviewBody>(
      studio,
      "/api/review",
      postJson({}),
    );
    expect(status).toBe(200);
    expect(body.findings).toHaveLength(0);
    expect(body.warning).toBeDefined();
    expect(body.warning).toMatch(/TIDAK ADA temuan/);
  });

  it("menyertakan kritik struktur yang tidak bisa dilihat dari gambar", async () => {
    const project = makeTempProject();
    const studio = makeStudio(project.planPath, {
      volumeModel: visionSaying("[]"),
      renderStills: stills,
    });
    const { body } = await callJson<ReviewBody>(studio, "/api/review", postJson({}));
    // Plan uji 3 scene tanpa outro: kritik struktur pasti ada isinya, dan
    // itulah sudut yang TIDAK akan pernah muncul dari frame.
    expect(body.structural.length).toBeGreaterThan(0);
    expect(body.findings).toHaveLength(0);
    expect(body.warning).toBeUndefined();
  });

  it("mencatat biaya NYATA dari usage model, bukan nol", async () => {
    // Cacat yang pernah ada di rute ini: memanggil model berbayar lalu
    // mencatat 0 — chip biaya di topbar dan anggaran proyek jadi berbohong.
    const project = makeTempProject();
    const studio = makeStudio(project.planPath, {
      volumeModel: visionSaying("[]", {
        key: "mock/vision",
        provider: "mock",
        id: "vision",
        name: "Vision",
        toolCall: true,
        imageInput: true,
        reasoning: false,
        // $1/$5 per MTok atas 900/40 token = $0.0011.
        costInputPerMTok: 1,
        costOutputPerMTok: 5,
      }),
      renderStills: stills,
    });
    const { body } = await callJson<ReviewBody & { costUsd?: number; model: string }>(
      studio,
      "/api/review",
      postJson({}),
    );
    expect(body.model).toBe("mock/vision");
    expect(body.costUsd).toBeCloseTo(0.0011, 4);

    // Bukti bahwa angkanya benar-benar masuk buku besar proyek, bukan cuma
    // dikembalikan ke pemanggil.
    const state = await callJson<{ totalCostUsd: number }>(studio, "/api/project");
    expect(state.body.totalCostUsd).toBeCloseTo(0.0011, 4);
  });

  it("model tanpa harga: biaya TIDAK dilaporkan, bukan dilaporkan nol", async () => {
    const project = makeTempProject();
    const studio = makeStudio(project.planPath, {
      volumeModel: visionSaying("[]"),
      renderStills: stills,
    });
    const { body } = await callJson<ReviewBody & { costUsd?: number }>(
      studio,
      "/api/review",
      postJson({}),
    );
    expect(body.costUsd).toBeUndefined();
  });

  it("menolak maxFrames di luar batas", async () => {
    const project = makeTempProject();
    const studio = makeStudio(project.planPath, {
      volumeModel: visionSaying("[]"),
      renderStills: stills,
    });
    const response = await call(studio, "/api/review", postJson({ maxFrames: 99 }));
    expect(response.status).toBe(400);
  });
});
