import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PublishRequest, PublishTarget } from "@dalang/pipeline";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools, SYSTEM_PROMPT } from "../src/index";
import { basicPlan, execOptions, makeDeps, tempProject } from "./helpers";

/**
 * Publikasi langsung dari agent (ADR-0030): tool publishVideo SELALU lewat
 * gerbang persetujuan, bawaannya privat, memakai ledger yang sama dengan CLI
 * dan Studio, dan tanpa tujuan ia berkata tidak tersedia — bukan pura-pura.
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
        videoId: `v${calls.length}`,
        url: `https://youtu.be/v${calls.length}`,
      };
    },
  };
  return target;
};

/** Berkas render palsu dengan mtime tertentu — urutan "terbaru" diuji dari sini. */
const writeRender = (dir: string, name: string, atSec: number): string => {
  const renders = join(dir, ".dalang", "renders");
  mkdirSync(renders, { recursive: true });
  const file = join(renders, name);
  writeFileSync(file, `mp4-${name}`);
  utimesSync(file, atSec, atSec);
  return file;
};

describe("publishVideo (ADR-0030)", () => {
  it("tanpa tujuan: tidak tersedia dengan petunjuk token, tanpa meminta persetujuan", async () => {
    const project = open();
    writeRender(project.dir, "final.mp4", 1_700_000_000);
    const { deps, approvals } = makeDeps({});
    const output = await exec(buildAgentTools(project.session, deps), "publishVideo", {
      privasi: "private",
    });
    expect(output.ok).toBe(false);
    expect(String(output.pesan)).toContain("YOUTUBE_ACCESS_TOKEN");
    expect(approvals.requests).toHaveLength(0);
  });

  it("tanpa berkas render: menyuruh render dulu, tidak meminta persetujuan, tidak mengunggah", async () => {
    const project = open();
    const target = fakeTarget();
    const { deps, approvals } = makeDeps({ publishTargets: () => [target] });
    const output = await exec(buildAgentTools(project.session, deps), "publishVideo", {
      privasi: "private",
    });
    expect(output.ok).toBe(false);
    expect(String(output.pesan)).toContain("renderFinal");
    expect(approvals.requests).toHaveLength(0);
    expect(target.calls).toHaveLength(0);
  });

  it("SELALU lewat persetujuan: ditolak = tidak diunggah; disetujui = render terbaru naik dengan metadata dari plan; kedua kali dari ledger; file bisa dipilih", async () => {
    const project = open();
    writeRender(project.dir, "preview.mp4", 1_700_000_000);
    writeRender(project.dir, "final.mp4", 1_700_000_100);
    const target = fakeTarget();

    const denied = makeDeps({ approvalAnswer: false, publishTargets: () => [target] });
    const refused = await exec(
      buildAgentTools(project.session, denied.deps),
      "publishVideo",
      {
        privasi: "public",
      },
    );
    expect(refused.ok).toBe(false);
    expect(denied.approvals.requests[0]).toMatchObject({ action: "publishVideo" });
    expect(denied.approvals.requests[0]?.detail).toContain("final.mp4");
    expect(denied.approvals.requests[0]?.detail).toContain("Publik");
    expect(target.calls).toHaveLength(0);

    const approved = makeDeps({ approvalAnswer: true, publishTargets: () => [target] });
    const tools = buildAgentTools(project.session, approved.deps);
    const output = await exec(tools, "publishVideo", {
      privasi: "private",
      judul: "Judul dari agent",
    });
    expect(output).toMatchObject({
      ok: true,
      berkas: "final.mp4",
      url: "https://youtu.be/v1",
      privasi: "private",
      dariCache: false,
    });
    expect(target.calls[0]).toMatchObject({
      title: "Judul dari agent",
      privacy: "private",
      tags: ["bebas", "dalang"],
    });
    expect(target.calls[0]?.description).toContain("Kalimat pertama untuk agent.");
    expect(target.calls[0]?.filePath.endsWith("final.mp4")).toBe(true);

    const again = await exec(tools, "publishVideo", {
      privasi: "private",
      judul: "Judul dari agent",
    });
    expect(again).toMatchObject({
      ok: true,
      dariCache: true,
      url: "https://youtu.be/v1",
    });
    expect(target.calls).toHaveLength(1);
    expect(approved.approvals.requests).toHaveLength(2);

    const named = await exec(tools, "publishVideo", {
      privasi: "unlisted",
      file: "preview.mp4",
    });
    expect(named).toMatchObject({
      ok: true,
      berkas: "preview.mp4",
      url: "https://youtu.be/v2",
      privasi: "unlisted",
    });
    expect(target.calls).toHaveLength(2);
  });

  it("system prompt: unggah hanya bila diminta, selalu lewat persetujuan, bawaan privat", () => {
    expect(SYSTEM_PROMPT).toContain("publishVideo");
    expect(SYSTEM_PROMPT).toContain("privat");
  });
});
