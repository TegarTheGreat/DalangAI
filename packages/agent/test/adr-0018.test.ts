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
    // searchSfx dulu: assetId saja tidak membawa URL unduhan, dan assetId
    // Openverse (UUID) tidak bisa dipakai sebagai kata pencarian.
    await exec(tools, "searchSfx", { query: "whoosh", limit: 2 });
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
    await exec(tools, "searchSfx", { query: "whoosh", limit: 2 });
    const out = await exec(tools, "addSfx", {
      sceneId: "sc-hantu",
      assetId: "openverse:whoosh-0",
    });
    expect(out.ok).toBe(false);
  });

  it("beberapa cue bisa hidup berdampingan dengan id berbeda", async () => {
    const { session, tools } = setup();
    await exec(tools, "searchSfx", { query: "whoosh", limit: 2 });
    await exec(tools, "addSfx", { sceneId: "sc-001", assetId: "openverse:whoosh-0" });
    await exec(tools, "addSfx", { sceneId: "sc-002", assetId: "openverse:whoosh-1" });
    const ids = session.plan?.audio.sfx.map((cue) => cue.id) ?? [];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  /**
   * Regresi. Sebelum ada ingatan kandidat, addSfx MENCARI ULANG dengan
   * `assetId.split(":").pop()` sebagai kata kunci. Untuk Openverse itu berarti
   * mencari sebuah UUID — yang tidak akan pernah cocok dengan judul apa pun,
   * sehingga pemasangan selalu gagal di layanan sungguhan. Bug itu tak terlihat
   * karena provider palsu menjawab query apa pun.
   */
  it("assetId gaya UUID tetap bisa dipasang setelah searchSfx", async () => {
    const { session } = open(basicPlan());
    const uuid = "openverse:4f2c8b1e-77aa-4d1e-9a10-0c9f1b2d3e4f";
    const { deps } = makeDeps({
      sfxChain: () => [
        {
          id: "openverse",
          label: "Openverse",
          search: async (query: string) =>
            // Meniru layanan aslinya: mencari UUID tidak menghasilkan apa pun.
            query === "whoosh"
              ? [
                  {
                    providerId: "openverse",
                    assetId: uuid,
                    title: "Whoosh pendek",
                    downloadUrl: "https://cdn.test/whoosh.mp3",
                    fileExt: "mp3",
                    license: "cc0 1.0",
                    commercialSafe: true,
                  },
                ]
              : [],
          download: async () => new Uint8Array([1]),
        },
      ],
    });
    const tools = buildAgentTools(session, deps) as Record<string, unknown>;

    const tanpaCari = await exec(tools, "addSfx", { sceneId: "sc-001", assetId: uuid });
    expect(tanpaCari.ok).toBe(false);
    expect(String(tanpaCari.error)).toContain("searchSfx");

    await exec(tools, "searchSfx", { query: "whoosh", limit: 4 });
    const out = await exec(tools, "addSfx", { sceneId: "sc-001", assetId: uuid });
    expect(out.ok).toBe(true);
    expect(session.plan?.audio.sfx[0]?.assetId).toBe(uuid);
  });
});

describe("stiker lewat agent (ADR-0018)", () => {
  it("searchStickers lalu addSticker memasang grafis dengan lisensi tercatat", async () => {
    const { session, tools } = setup();
    const found = await exec(tools, "searchStickers", { query: "clap", limit: 4 });
    expect(found.ok).toBe(true);

    const out = await exec(tools, "addSticker", {
      sceneId: "sc-001",
      query: "clap",
      index: 0,
      anchor: "kiri-bawah",
    });
    expect(out.ok).toBe(true);

    const scene = session.plan?.scenes.find((s) => s.id === "sc-001");
    expect(scene?.graphics).toHaveLength(1);
    // Stiker BUKAN ikon: rujukannya assetId provider, bukan "iconify:".
    expect(scene?.graphics[0]?.ref.startsWith("iconify:")).toBe(false);
    const graphicId = scene?.graphics[0]?.id as string;
    expect(session.plan?.renderState.graphicAssets[graphicId]?.file).toContain(
      "stickers/",
    );
    expect(session.plan?.renderState.graphicAssets[graphicId]?.license).toBeTruthy();
  });

  it("memasang tanpa mencari lebih dulu ditolak sebagai data", async () => {
    const { tools } = setup();
    const out = await exec(tools, "addSticker", {
      sceneId: "sc-001",
      query: "clap",
      index: 0,
    });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("searchStickers");
  });

  it("tanpa provider stiker, pesannya menunjuk alternatif tanpa kunci", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({ stickerChain: () => [] });
    const tools = buildAgentTools(session, deps) as Record<string, unknown>;
    const out = await exec(tools, "searchStickers", { query: "clap" });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("searchIcons");
  });
});

describe("id media unik se-plan (ADR-0018)", () => {
  /**
   * Regresi. Id grafis dulu dinomori PER SCENE, padahal renderState.graphicAssets
   * dikunci per id untuk SELURUH plan: dua scene yang sama-sama memasang grafis
   * pertamanya menghasilkan id yang sama, sehingga entri berkas yang satu
   * menimpa yang lain.
   */
  it("dua scene yang memasang ikon yang sama tidak berbagi id", async () => {
    const { session, tools } = setup();
    await exec(tools, "addIcon", { sceneId: "sc-001", ref: "iconify:mdi:home" });
    await exec(tools, "addIcon", { sceneId: "sc-002", ref: "iconify:mdi:home" });
    const ids =
      session.plan?.scenes.flatMap((scene) => scene.graphics.map((g) => g.id)) ?? [];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(Object.keys(session.plan?.renderState.graphicAssets ?? {})).toHaveLength(2);
  });

  it("warna ikut nama berkas ikon supaya dua warna tidak saling menimpa", async () => {
    const { session, tools } = setup();
    await exec(tools, "addIcon", {
      sceneId: "sc-001",
      ref: "iconify:mdi:home",
      color: "#e11d48",
    });
    await exec(tools, "addIcon", {
      sceneId: "sc-002",
      ref: "iconify:mdi:home",
      color: "#22c55e",
    });
    const files = Object.values(session.plan?.renderState.graphicAssets ?? {}).map(
      (asset) => asset.file,
    );
    expect(new Set(files).size).toBe(2);
  });
});
