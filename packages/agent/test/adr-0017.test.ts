import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools, SYSTEM_PROMPT } from "../src/index";
import { basicPlan, execOptions, makeDeps, tempProject } from "./helpers";

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
  (tools[name] as AnyTool).execute(input, execOptions);

describe("critiqueDraft (ADR-0017)", () => {
  it("mengembalikan catatan + kerangka format yang sedang dipakai", async () => {
    const { session } = open(
      basicPlan({ meta: { title: "Uji", format: "klip" } as never }),
    );
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "critiqueDraft", {})) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(out.format).toBe("klip");
    expect(String(out.kerangkaFormat)).toContain("Hook");
    expect(Array.isArray(out.catatan)).toBe(true);
    const codes = (out.catatan as Array<{ kode: string }>).map((n) => n.kode);
    // Plan 2 scene tanpa teks hook -> format klip menuntut hook terlihat.
    expect(codes).toContain("format-hook-tanpa-teks");
  });

  it("proyek tanpa plan mengembalikan error sebagai data, bukan exception", async () => {
    const { session } = open(null);
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "critiqueDraft", {})) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("scene-plan");
  });
});

describe("ingestVideo (ADR-0017)", () => {
  it("mendaftarkan video sumber: aset ter-pin + durasi terbaca", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "ingestVideo", {
      sceneId: "sc-001",
      file: "assets/podcast.mp4",
    })) as Record<string, unknown>;

    expect(out.ok).toBe(true);
    expect(out.durasiDetik).toBe(600);
    const plan = session.plan;
    expect(plan?.renderState.clipAssets["sc-001-k1"]).toMatchObject({
      file: "assets/podcast.mp4",
      kind: "video",
      source: "local",
      durationSec: 600,
    });
    expect(plan?.scenes[0]?.clips[0]?.pinned).toBe(true);
  });

  it("file tak terbaca -> {ok:false} dengan pesan, plan tidak berubah", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const before = structuredClone(session.plan);
    const out = (await exec(tools, "ingestVideo", {
      sceneId: "sc-001",
      file: "assets/bukan-video.txt",
    })) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("bukan-video.txt");
    expect(session.plan).toEqual(before);
  });

  it("scene tidak ada -> ditolak sebagai data", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "ingestVideo", {
      sceneId: "sc-hantu",
      file: "assets/podcast.mp4",
    })) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("sc-hantu");
  });

  it("satu rekaman dipakai dua scene dengan titik masuk berbeda (inti klip)", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    await exec(tools, "ingestVideo", { sceneId: "sc-001", file: "assets/podcast.mp4" });
    await exec(tools, "ingestVideo", { sceneId: "sc-002", file: "assets/podcast.mp4" });
    await exec(tools, "applyPatch", {
      ops: [
        {
          op: "updateScene",
          id: "sc-001",
          patch: { clip: { trimStartSec: 65 }, duration: 18 },
        },
        {
          op: "updateScene",
          id: "sc-002",
          patch: { clip: { trimStartSec: 402.5 }, duration: 22 },
        },
      ],
    });
    const scenes = session.plan?.scenes ?? [];
    expect(scenes[0]?.clips[0]?.trimStartSec).toBe(65);
    expect(scenes[1]?.clips[0]?.trimStartSec).toBe(402.5);
    expect(session.plan?.renderState.clipAssets["sc-002-k1"]?.file).toBe(
      "assets/podcast.mp4",
    );
  });
});

describe("findCutPoints (ADR-0017)", () => {
  it("mengubah jeda hening jadi titik potong (tengah jeda)", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "findCutPoints", {
      file: "assets/podcast.mp4",
    })) as Record<string, unknown>;

    expect(out.ok).toBe(true);
    expect(out.jumlahJeda).toBe(3);
    // Titik potong = tengah jeda, di situ pemotongan paling tidak terdengar.
    expect(out.titikPotongDetik).toEqual([0.4, 64.65, 402.3]);
    expect(String(out.catatan)).toContain("transkrip");
  });

  it("sekitarDetik memilih jeda terdekat untuk merapikan satu batas", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "findCutPoints", {
      file: "assets/podcast.mp4",
      sekitarDetik: 60,
    })) as Record<string, unknown>;
    expect(out.titikTerdekat).toBe(64.65);
  });

  it("berkas tak terbaca -> {ok:false}, bukan exception", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "findCutPoints", {
      file: "assets/catatan.txt",
    })) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("catatan.txt");
  });
});

describe("system prompt sadar format", () => {
  it("memuat daftar format dari resep core dan aturan mengklip", () => {
    expect(SYSTEM_PROMPT).toContain("FORMAT KONTEN");
    for (const format of ["edukasi", "tutorial", "klip", "berita", "cerita"]) {
      expect(SYSTEM_PROMPT).toContain(`- ${format} (`);
    }
    expect(SYSTEM_PROMPT).toContain("MENGKLIP REKAMAN PANJANG");
    expect(SYSTEM_PROMPT).toContain("critiqueDraft");
    // Jujur soal batas: agent tidak bisa mendengar isi rekaman.
    expect(SYSTEM_PROMPT).toContain("TIDAK bisa mendengar");
  });
});
