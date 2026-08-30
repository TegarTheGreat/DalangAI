import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScenePlan, type ScenePlan } from "@dalang/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSafeRelative, copyPlanAssets, stageTemplatesPublic } from "../src/stage";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "dalang-stage-test-"));
});
afterEach(() => rmSync(workDir, { recursive: true, force: true }));

const planWithAsset = (file: string): ScenePlan =>
  parseScenePlan({
    version: 1,
    projectId: "p",
    meta: { title: "T" },
    scenes: [{ id: "sc-001", visual: { type: "stock" } }],
    renderState: {
      narrationAudio: {},
      resolvedAssets: {
        "sc-001": { file, kind: "image", source: "local" },
      },
    },
  });

describe("assertSafeRelative", () => {
  it("accepts nested relative paths", () => {
    expect(() => assertSafeRelative("assets/bg.svg")).not.toThrow();
    expect(() => assertSafeRelative("a/b/../c.png")).not.toThrow(); // stays inside
  });

  it("rejects absolute paths and escapes", () => {
    expect(() => assertSafeRelative("/etc/passwd")).toThrow(/relatif/);
    expect(() => assertSafeRelative("../secret.png")).toThrow(/relatif/);
    expect(() => assertSafeRelative("a/../../secret.png")).toThrow(/relatif/);
  });
});

describe("copyPlanAssets", () => {
  it("copies referenced files preserving relative paths", () => {
    const planDir = join(workDir, "proyek");
    mkdirSync(join(planDir, "assets"), { recursive: true });
    writeFileSync(join(planDir, "assets", "bg.svg"), "<svg/>");
    const target = join(workDir, "public");
    mkdirSync(target);

    const copied = copyPlanAssets(
      join(planDir, "plan.json"),
      planWithAsset("assets/bg.svg"),
      target,
    );
    expect(copied).toEqual(["assets/bg.svg"]);
    expect(existsSync(join(target, "assets", "bg.svg"))).toBe(true);
  });

  it("fails loudly when a referenced asset is missing", () => {
    const planDir = join(workDir, "proyek");
    mkdirSync(planDir, { recursive: true });
    expect(() =>
      copyPlanAssets(
        join(planDir, "plan.json"),
        planWithAsset("assets/hilang.svg"),
        join(workDir, "public"),
      ),
    ).toThrow(/tidak ditemukan/);
  });

  it("refuses paths that escape the plan folder", () => {
    expect(() =>
      copyPlanAssets(
        join(workDir, "plan.json"),
        planWithAsset("../di-luar.png"),
        join(workDir, "public"),
      ),
    ).toThrow(/relatif/);
  });
});

describe("stageTemplatesPublic", () => {
  it("copies template statics but excludes the assets staging area", () => {
    const publicDir = join(workDir, "public-src");
    mkdirSync(join(publicDir, "fonts"), { recursive: true });
    mkdirSync(join(publicDir, "assets"), { recursive: true });
    writeFileSync(join(publicDir, "fonts", "Font.woff2"), "font");
    writeFileSync(join(publicDir, "assets", "demo.svg"), "<svg/>");

    const staged = stageTemplatesPublic(publicDir);
    try {
      expect(existsSync(join(staged.dir, "fonts", "Font.woff2"))).toBe(true);
      expect(existsSync(join(staged.dir, "assets"))).toBe(false);
    } finally {
      staged.cleanup();
      expect(existsSync(staged.dir)).toBe(false);
    }
  });
});

describe("copyPlanAssets: grafis & efek suara (ADR-0018)", () => {
  const planWithMedia = (): ScenePlan =>
    parseScenePlan({
      version: 1,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        {
          id: "sc-001",
          visual: { type: "solid" },
          graphics: [{ id: "hidup", ref: "iconify:mdi:home" }],
        },
      ],
      audio: {
        voice: { provider: "silence", voiceId: "x", speed: 1 },
        sfx: [{ id: "cue-hidup", assetId: "openverse:1", sceneId: "sc-001", atSec: 0 }],
      },
      renderState: {
        narrationAudio: {},
        resolvedAssets: {},
        graphicAssets: {
          hidup: { file: "assets/icons/hidup.svg", kind: "image", source: "iconify" },
          yatim: { file: "assets/icons/yatim.svg", kind: "image", source: "iconify" },
        },
        sfxAssets: {
          "cue-hidup": {
            file: "assets/sfx/hidup.mp3",
            kind: "audio",
            source: "openverse",
          },
          "cue-yatim": {
            file: "assets/sfx/yatim.mp3",
            kind: "audio",
            source: "openverse",
          },
        },
      },
    });

  const stageMedia = (writeOrphans: boolean) => {
    const planDir = join(workDir, "proyek");
    mkdirSync(join(planDir, "assets", "icons"), { recursive: true });
    mkdirSync(join(planDir, "assets", "sfx"), { recursive: true });
    writeFileSync(join(planDir, "assets", "icons", "hidup.svg"), "<svg/>");
    writeFileSync(join(planDir, "assets", "sfx", "hidup.mp3"), "audio");
    if (writeOrphans) {
      writeFileSync(join(planDir, "assets", "icons", "yatim.svg"), "<svg/>");
      writeFileSync(join(planDir, "assets", "sfx", "yatim.mp3"), "audio");
    }
    const publicDir = join(workDir, "public");
    const copied = copyPlanAssets(join(planDir, "plan.json"), planWithMedia(), publicDir);
    return { copied, publicDir };
  };

  it("menyalin berkas grafis dan efek suara yang dipakai", () => {
    const { copied, publicDir } = stageMedia(true);
    expect(copied).toContain("assets/icons/hidup.svg");
    expect(copied).toContain("assets/sfx/hidup.mp3");
    expect(existsSync(join(publicDir, "assets/icons/hidup.svg"))).toBe(true);
    expect(existsSync(join(publicDir, "assets/sfx/hidup.mp3"))).toBe(true);
  });

  /**
   * Entri yatim (grafis/cue-nya sudah dihapus) sengaja tetap tinggal di
   * renderState supaya undo mengembalikannya utuh. Yang TIDAK boleh terjadi:
   * berkasnya ikut dipentaskan — dan lebih buruk lagi, render gagal hanya karena
   * berkas yang sudah tidak dipakai siapa pun sudah dihapus dari disk.
   */
  it("melewati entri yatim, dan tidak gagal walau berkasnya sudah hilang", () => {
    const { copied, publicDir } = stageMedia(false);
    expect(copied).not.toContain("assets/icons/yatim.svg");
    expect(copied).not.toContain("assets/sfx/yatim.mp3");
    expect(existsSync(join(publicDir, "assets/icons/yatim.svg"))).toBe(false);
  });
});
