import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PublishRequest, PublishTarget } from "@dalang/pipeline";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools, SYSTEM_PROMPT } from "../src/index";
import { basicPlan, execOptions, makeDeps, tempProject } from "./helpers";

/**
 * Berkas subtitle dari agent (ADR-0039).
 *
 * Dua hal yang dijaga di sini, dan keduanya soal PERMUKAAN — isi kartunya
 * diuji di @dalang/templates: writeSubtitle menghasilkan berkas nyata tanpa
 * menyentuh plan, dan publishVideo membawa subtitle yang DITULIS SAAT ITU
 * JUGA, bukan berkas lama yang kebetulan tertinggal di folder.
 */

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});
const open = () => {
  const project = tempProject(basicPlan());
  cleanups.push(project.cleanup);
  return project;
};

type AnyTool = { execute: (input: unknown, options: unknown) => Promise<unknown> };
const exec = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as AnyTool).execute(input, execOptions) as Promise<
    Record<string, unknown>
  >;

const fakeTarget = () => {
  const calls: PublishRequest[] = [];
  const target: PublishTarget & { calls: PublishRequest[] } = {
    id: "youtube-palsu",
    label: "YouTube (uji)",
    calls,
    publish: async (request) => {
      calls.push(request);
      return {
        providerId: "youtube-palsu",
        videoId: "v1",
        url: "https://youtu.be/v1",
        ...(request.subtitle ? { subtitleUploaded: true } : {}),
      };
    },
  };
  return target;
};

const writeRender = (dir: string, name: string): string => {
  const renders = join(dir, ".dalang", "renders");
  mkdirSync(renders, { recursive: true });
  const file = join(renders, name);
  writeFileSync(file, `mp4-${name}`);
  return file;
};

describe("writeSubtitle (ADR-0039)", () => {
  it("menulis berkas SRT di samping plan tanpa menyentuh plan sama sekali", async () => {
    const project = open();
    const sebelum = readFileSync(project.planPath, "utf8");
    const { deps } = makeDeps({});
    const tools = buildAgentTools(project.session, deps);
    const out = await exec(tools, "writeSubtitle", { format: "srt" });

    expect(out.ok).toBe(true);
    expect(out.berkas).toBe("proj-agent-test.id.srt");
    expect(Number(out.kartu)).toBeGreaterThan(0);

    const berkas = join(project.dir, "proj-agent-test.id.srt");
    expect(existsSync(berkas)).toBe(true);
    expect(readFileSync(berkas, "utf8")).toContain(" --> ");
    // Berkas teks BUKAN perubahan plan: tidak ada patch, tidak ada undo.
    expect(readFileSync(project.planPath, "utf8")).toBe(sebelum);
  });

  it("format vtt menghasilkan berkas VTT, dan memperingatkan waktu yang masih ditaksir", async () => {
    const project = open();
    const { deps } = makeDeps({});
    const tools = buildAgentTools(project.session, deps);
    const out = await exec(tools, "writeSubtitle", { format: "vtt" });

    const isi = readFileSync(join(project.dir, "proj-agent-test.id.vtt"), "utf8");
    expect(isi.startsWith("WEBVTT\n\n")).toBe(true);
    // Plan uji belum lewat TTS, jadi peringatannya HARUS ada — berkas yang
    // melenceng baru ketahuan setelah videonya tayang.
    expect(String(out.peringatan)).toContain("DITAKSIR");
  });

  it("disebut di system prompt — tool yang tidak pernah disebut tidak pernah dipanggil", () => {
    expect(SYSTEM_PROMPT).toContain("writeSubtitle");
  });
});

describe("publishVideo membawa subtitle (ADR-0039)", () => {
  it("subtitle ditulis SEGAR saat unggah, menimpa berkas basi bernama sama", async () => {
    const project = open();
    const target = fakeTarget();
    const { deps } = makeDeps({ publishTargets: () => [target] });
    const tools = buildAgentTools(project.session, deps);
    writeRender(project.dir, "final.mp4");

    const basi = join(project.dir, ".dalang", "subtitle.id.srt");
    writeFileSync(basi, "1\n00:00:00,000 --> 00:00:01,000\nTEKS BASI\n\n");

    const out = await exec(tools, "publishVideo", { privasi: "private" });
    expect(out.ok).toBe(true);
    expect(String(out.subtitle)).toContain("ikut terunggah");

    const request = target.calls[0];
    if (!request) throw new Error("tujuan tidak pernah dipanggil");
    expect(request.subtitle?.path).toBe(basi);
    expect(request.subtitle?.language).toBe("id");
    const isi = readFileSync(basi, "utf8");
    expect(isi).toContain(" --> ");
    expect(isi).not.toContain("TEKS BASI");
  });

  it("tanpaSubtitle: videonya tetap naik, berkas subtitle tidak ikut", async () => {
    const project = open();
    const target = fakeTarget();
    const { deps } = makeDeps({ publishTargets: () => [target] });
    const tools = buildAgentTools(project.session, deps);
    writeRender(project.dir, "final.mp4");

    const out = await exec(tools, "publishVideo", {
      privasi: "private",
      tanpaSubtitle: true,
    });
    expect(out.ok).toBe(true);
    expect(out.subtitle).toBe("tidak ada");
    expect(target.calls[0]?.subtitle).toBeUndefined();
  });
});

describe("nama berkas subtitle dari plan yang tidak dipercaya", () => {
  it("projectId berisi ../ tidak membuat berkas di luar folder proyek", async () => {
    const project = tempProject(basicPlan({ projectId: "../sasaran/DITIMPA" }));
    cleanups.push(project.cleanup);
    const { deps } = makeDeps({});
    const tools = buildAgentTools(project.session, deps);
    const out = await exec(tools, "writeSubtitle", { format: "srt" });

    expect(out.ok).toBe(true);
    expect(String(out.berkas)).not.toContain("/");
    expect(existsSync(join(project.dir, String(out.berkas)))).toBe(true);
    // Folder induk tidak boleh kejatuhan berkas apa pun.
    expect(existsSync(join(project.dir, "..", "sasaran"))).toBe(false);
  });
});

describe("render dan unggah dalam bahasa sulih (ADR-0040)", () => {
  const sulih = () =>
    basicPlan({
      meta: { title: "Uji Agent", dubTitles: { en: "Agent Test" } },
      scenes: [
        {
          id: "sc-001",
          narration: "Kalimat pertama untuk agent.",
          dubs: { en: "The first sentence for the agent." },
          clips: [{ id: "sc-001-k1", type: "solid" }],
        },
      ],
    });

  it("renderPreview dengan bahasa meneruskannya dan memberi akhiran pada berkas", async () => {
    const project = tempProject(sulih());
    cleanups.push(project.cleanup);
    const { deps, render } = makeDeps({});
    const tools = buildAgentTools(project.session, deps);
    const out = await exec(tools, "renderPreview", { bahasa: "en" });

    expect(out.ok).toBe(true);
    expect(render.calls[0]?.language).toBe("en");
    expect(render.calls[0]?.outputLocation.endsWith("preview.en.mp4")).toBe(true);
  });

  it("bahasa yang belum ada ditolak dengan daftar pilihannya", async () => {
    const project = tempProject(sulih());
    cleanups.push(project.cleanup);
    const { deps, render } = makeDeps({});
    const tools = buildAgentTools(project.session, deps);
    const out = await exec(tools, "renderPreview", { bahasa: "jv" });

    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("jv");
    expect(String(out.error)).toContain("id, en");
    expect(render.calls).toHaveLength(0);
  });

  it("publishVideo membaca bahasa dari nama berkas: judul, deskripsi, dan subtitle bahasa itu", async () => {
    const project = tempProject(sulih());
    cleanups.push(project.cleanup);
    const target = fakeTarget();
    const { deps } = makeDeps({ publishTargets: () => [target] });
    const tools = buildAgentTools(project.session, deps);
    writeRender(project.dir, "final.en.mp4");

    const out = await exec(tools, "publishVideo", {
      file: "final.en.mp4",
      privasi: "private",
    });
    expect(out.ok).toBe(true);

    const request = target.calls[0];
    if (!request) throw new Error("tujuan tidak pernah dipanggil");
    expect(request.title).toBe("Agent Test");
    expect(request.language).toBe("en");
    expect(request.description).toContain("The first sentence");
    expect(request.description).not.toContain("Kalimat pertama");
    expect(request.subtitle?.language).toBe("en");
    expect(request.subtitle?.path.endsWith("subtitle.en.srt")).toBe(true);
    expect(readFileSync(request.subtitle?.path ?? "", "utf8")).toContain(
      "first sentence",
    );
  });
});
