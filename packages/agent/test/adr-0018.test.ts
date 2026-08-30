import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools } from "../src/index";
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
  (tools[name] as AnyTool).execute(input, execOptions) as Promise<
    Record<string, unknown>
  >;

const setup = () => {
  const { session } = open(basicPlan());
  const { deps } = makeDeps({});
  return { session, tools: buildAgentTools(session, deps) as Record<string, unknown> };
};

describe("ikon lewat agent (ADR-0018)", () => {
  it("searchIcons hanya mengembalikan yang aman-komersial, dengan tanda kredit", async () => {
    const { tools } = setup();
    const out = await exec(tools, "searchIcons", { query: "home", limit: 3 });
    expect(out.ok).toBe(true);
    const icons = out.ikon as Array<{ ref: string; perluKredit: boolean }>;
    expect(icons.length).toBeGreaterThan(0);
    expect(icons[0]?.ref.startsWith("iconify:")).toBe(true);
    expect(icons[0]?.perluKredit).toBe(true);
  });

  it("addIcon mengunduh SVG ke proyek DAN menambah grafis ke scene", async () => {
    const { session, tools } = setup();
    const out = await exec(tools, "addIcon", {
      sceneId: "sc-001",
      ref: "iconify:mdi:home",
      anchor: "kiri-atas",
      size: 0.18,
    });
    expect(out.ok).toBe(true);

    const scene = session.plan?.scenes.find((s) => s.id === "sc-001");
    expect(scene?.graphics).toHaveLength(1);
    expect(scene?.graphics[0]).toMatchObject({
      ref: "iconify:mdi:home",
      anchor: "kiri-atas",
      size: 0.18,
    });

    // Berkas nyatanya wajib ada di renderState, kalau tidak render melewatinya.
    const graphicId = scene?.graphics[0]?.id as string;
    expect(session.plan?.renderState.graphicAssets[graphicId]?.file).toContain("icons/");
  });

  it("menolak rujukan yang bukan dari searchIcons", async () => {
    const { tools } = setup();
    const out = await exec(tools, "addIcon", { sceneId: "sc-001", ref: "giphy:abc" });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("bukan ikon Iconify");
  });

  it("scene tidak ada -> ditolak sebagai data, bukan exception", async () => {
    const { tools } = setup();
    const out = await exec(tools, "addIcon", {
      sceneId: "sc-hantu",
      ref: "iconify:mdi:home",
    });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("sc-hantu");
  });

  it("batas 4 grafis per scene ditegakkan dengan pesan yang jelas", async () => {
    const { tools } = setup();
    for (let i = 0; i < 4; i += 1) {
      const ok = await exec(tools, "addIcon", {
        sceneId: "sc-001",
        ref: `iconify:mdi:home-${i}`,
      });
      expect(ok.ok).toBe(true);
    }
    const fifth = await exec(tools, "addIcon", {
      sceneId: "sc-001",
      ref: "iconify:mdi:extra",
    });
    expect(fifth.ok).toBe(false);
    expect(String(fifth.error)).toContain("4 grafis");
  });

  it("kegagalan mengambil SVG dikembalikan sebagai data, plan tidak berubah", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({
      iconProvider: () => ({
        id: "iconify",
        label: "Iconify",
        search: async () => [],
        fetchSvg: async () => {
          throw new Error("jaringan mati");
        },
      }),
    });
    const tools = buildAgentTools(session, deps) as Record<string, unknown>;
    const before = structuredClone(session.plan);
    const out = await exec(tools, "addIcon", {
      sceneId: "sc-001",
      ref: "iconify:mdi:home",
    });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("jaringan mati");
    expect(session.plan).toEqual(before);
  });
});

describe("efek suara lewat agent (ADR-0018)", () => {
  it("searchSfx mengembalikan kandidat berlisensi terbuka", async () => {
    const { tools } = setup();
    const out = await exec(tools, "searchSfx", { query: "whoosh", limit: 2 });
    expect(out.ok).toBe(true);
    const sounds = out.suara as Array<{ assetId: string; lisensi: string }>;
    expect(sounds.length).toBeGreaterThan(0);
    expect(sounds[0]?.lisensi).toContain("cc0");
  });

  it("addSfx mengunduh berkas DAN menambat cue ke scene", async () => {
    const { session, tools } = setup();
    const out = await exec(tools, "addSfx", {
      sceneId: "sc-002",
      assetId: "openverse:whoosh-0",
      atSec: 0.5,
      volume: 0.4,
    });
    expect(out.ok).toBe(true);

    const cue = session.plan?.audio.sfx[0];
    expect(cue).toMatchObject({ sceneId: "sc-002", atSec: 0.5, volume: 0.4 });
    const cueId = cue?.id as string;
    expect(session.plan?.renderState.sfxAssets[cueId]?.file).toContain("sfx/");
    // Lisensi ikut tercatat untuk audit (PRD §10).
    expect(session.plan?.renderState.sfxAssets[cueId]?.license).toContain("cc0");
  });

  it("scene tidak ada -> ditolak", async () => {
    const { tools } = setup();
    const out = await exec(tools, "addSfx", {
      sceneId: "sc-hantu",
      assetId: "openverse:whoosh-0",
    });
    expect(out.ok).toBe(false);
  });

  it("beberapa cue bisa hidup berdampingan dengan id berbeda", async () => {
    const { session, tools } = setup();
    await exec(tools, "addSfx", { sceneId: "sc-001", assetId: "openverse:whoosh-0" });
    await exec(tools, "addSfx", { sceneId: "sc-002", assetId: "openverse:whoosh-1" });
    const ids = session.plan?.audio.sfx.map((cue) => cue.id) ?? [];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
