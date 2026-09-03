import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MediaProbeInfo, MediaTranscoder } from "@dalang/pipeline";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools, SYSTEM_PROMPT } from "../src/index";
import { basicPlan, execOptions, makeDeps, tempProject } from "./helpers";

/**
 * ADR-0028 di sisi agent: ingestVideo membuat proxy dan melaporkan kodek,
 * analyzeImage bisa melihat satu bingkai video, renderPreview memakai proxy —
 * dan ketiganya JUJUR saat transkodernya tidak ada.
 */

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

const open = (plan: Parameters<typeof tempProject>[0]) => {
  const project = tempProject(plan);
  cleanups.push(project.cleanup);
  mkdirSync(join(project.dir, "assets"), { recursive: true });
  writeFileSync(
    join(project.dir, "assets/podcast.mp4"),
    "rekaman palsu yang cukup panjang",
  );
  return project;
};

type AnyTool = { execute: (input: unknown, options: unknown) => Promise<unknown> };
const exec = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as AnyTool).execute(input, execOptions);

const LONG: MediaProbeInfo = {
  durationSec: 600,
  width: 1920,
  height: 1080,
  fps: 59.94,
  codec: "hevc",
  hasAudio: true,
  audioCodec: "aac",
  channels: 2,
  sampleRate: 48000,
  bitrate: 12_000_000,
  sizeBytes: 1,
};

const fakeTranscoder = (): MediaTranscoder & { frames: number[] } => {
  const transcoder: MediaTranscoder & { frames: number[] } = {
    id: "fake-ff",
    frames: [],
    probe: async () => LONG,
    makeProxy: async (request) => {
      mkdirSync(join(request.outputPath, ".."), { recursive: true });
      writeFileSync(request.outputPath, "proxy");
      return {
        ok: true,
        width: request.width,
        height: request.height,
        durationSec: 600,
        fps: request.fps ?? 30,
      };
    },
    extractFrame: async (_source, atSec, outputPath) => {
      transcoder.frames.push(atSec);
      writeFileSync(
        outputPath,
        Buffer.from(
          "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z",
          "base64",
        ),
      );
      return { ok: true };
    },
    toWav: async () => ({ ok: true }),
    decodeMonoPcm: async () => null,
  };
  return transcoder;
};

describe("ingestVideo + proxy (ADR-0028)", () => {
  it("mendaftarkan rekaman DAN membuat proxy-nya, dengan kodek dan alasan yang terlihat", async () => {
    const { session, dir } = open(basicPlan());
    const transcoder = fakeTranscoder();
    const { deps } = makeDeps({ transcoder: () => transcoder });
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "ingestVideo", {
      sceneId: "sc-001",
      file: "assets/podcast.mp4",
    })) as Record<string, unknown>;

    expect(out.ok).toBe(true);
    expect(out.kodek).toBe("hevc");
    expect(out.fps).toBe(59.94);
    const proxy = out.proxy as { file: string; lebar: number; tinggi: number };
    expect(proxy.lebar).toBe(960);
    expect(proxy.tinggi).toBe(540);
    expect(proxy.file.startsWith(".dalang/proxies/")).toBe(true);
    expect(existsSync(join(dir, proxy.file))).toBe(true);
    expect(String(out.catatanProxy)).toContain("hevc");
    // Tersimpan di plan (renderState), bukan hanya di jawaban tool.
    const asset = session.plan?.renderState.clipAssets["sc-001-k1"];
    expect(asset?.proxy?.file).toBe(proxy.file);
    expect(asset?.codec).toBe("hevc");
    expect(asset?.proxy?.fps).toBe(30);
  });

  it("tanpa transkoder: aset tetap terdaftar, proxy null, dan alasannya dikatakan", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "ingestVideo", {
      sceneId: "sc-001",
      file: "assets/podcast.mp4",
    })) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(out.proxy).toBeNull();
    expect(out.kodek).toBeNull();
    expect(String(out.catatanProxy)).toContain("tidak ada transkoder");
    expect(session.plan?.renderState.clipAssets["sc-001-k1"]?.file).toBe(
      "assets/podcast.mp4",
    );
  });

  it("system prompt menyebut proxy dan bingkai video", () => {
    expect(SYSTEM_PROMPT).toContain("PROXY");
    expect(SYSTEM_PROMPT).toContain("detikKe");
  });
});

describe("analyzeImage pada aset video (ADR-0028)", () => {
  it("tanpa transkoder menolak dengan alasan, bukan menebak", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    await exec(tools, "ingestVideo", { sceneId: "sc-001", file: "assets/podcast.mp4" });
    const out = (await exec(tools, "analyzeImage", {
      sceneId: "sc-001",
      question: "Apa yang terlihat?",
    })) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("transkoder");
  });

  it("dengan transkoder: bingkai diambil pada trimStartSec + detikKe", async () => {
    const { session } = open(basicPlan());
    const transcoder = fakeTranscoder();
    const { deps } = makeDeps({ transcoder: () => transcoder });
    const tools = buildAgentTools(session, deps);
    await exec(tools, "ingestVideo", { sceneId: "sc-001", file: "assets/podcast.mp4" });
    await exec(tools, "applyPatch", {
      ops: [
        { op: "updateScene", id: "sc-001", patch: { visual: { trimStartSec: 120 } } },
      ],
    });
    // Tanpa model vision tier-volume, tool berhenti SETELAH memeriksa aset
    // dan SEBELUM mengambil bingkai — jadi galat yang muncul adalah soal model.
    const out = (await exec(tools, "analyzeImage", {
      sceneId: "sc-001",
      question: "Apa yang terlihat?",
      detikKe: 7.5,
    })) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("tier-volume");
    expect(transcoder.frames).toEqual([]);
  });
});

describe("renderPreview memakai proxy (ADR-0028)", () => {
  it("meminta render draf dengan useProxies dan meneruskan campuran akhir", async () => {
    const { session } = open(basicPlan());
    const { deps, render } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const out = (await exec(tools, "renderPreview", {})) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(render.calls[0]).toMatchObject({ profile: "draft", useProxies: true });
  });
});
