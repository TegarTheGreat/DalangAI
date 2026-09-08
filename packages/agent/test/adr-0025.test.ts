import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools } from "../src/index";
import { basicPlan, execOptions, makeDeps, tempProject } from "./helpers";

/**
 * ADR-0025: lapisan video lewat agent.
 *
 * Yang diuji adalah pagarnya, bukan hasil visualnya: batas jumlah, jendela
 * tampil yang masuk akal, dan bahwa keluarannya patch op biasa — tercatat,
 * bisa di-undo, terlihat di konteks.
 */

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

type AnyTool = { execute: (input: unknown, options: unknown) => Promise<unknown> };
const exec = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as AnyTool).execute(input, execOptions) as Promise<
    Record<string, unknown>
  >;

const setup = () => {
  const project = tempProject(basicPlan());
  cleanups.push(project.cleanup);
  const { deps } = makeDeps({});
  return {
    session: project.session,
    tools: buildAgentTools(project.session, deps) as Record<string, unknown>,
  };
};

describe("addLayer", () => {
  it("menambah lapisan lewat patch op, lengkap dengan kueri dan jendela tampilnya", async () => {
    const { session, tools } = setup();
    const out = await exec(tools, "addLayer", {
      sceneId: "sc-001",
      query: "rain on window",
      anchor: "kiri-bawah",
      width: 0.3,
      height: 0.26,
      startFrac: 0.2,
      endFrac: 0.7,
    });
    expect(out.ok).toBe(true);

    const scene = session.plan?.scenes.find((s) => s.id === "sc-001");
    expect(scene?.layers).toHaveLength(1);
    expect(scene?.layers[0]?.visual.query).toBe("rain on window");
    expect(scene?.layers[0]?.anchor).toBe("kiri-bawah");
    expect(scene?.layers[0]?.startFrac).toBe(0.2);
    // Keluarannya patch op biasa: tercatat, jadi bisa dibatalkan.
    expect(String(out.ringkasanPerubahan)).toContain("sc-001");
  });

  it("menolak lapisan ketiga di satu scene", async () => {
    const { tools } = setup();
    for (let index = 0; index < 2; index++) {
      const ok = await exec(tools, "addLayer", {
        sceneId: "sc-001",
        query: `klip ${index}`,
      });
      expect(ok.ok).toBe(true);
    }
    const third = await exec(tools, "addLayer", { sceneId: "sc-001", query: "lagi" });
    expect(third.ok).toBe(false);
    expect(String(third.error)).toContain("batas maksimum");
  });

  it("menolak jendela tampil kosong alih-alih diam-diam membalikkannya", async () => {
    const { tools } = setup();
    const out = await exec(tools, "addLayer", {
      sceneId: "sc-001",
      query: "x",
      startFrac: 0.8,
      endFrac: 0.3,
    });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("endFrac");
  });

  it("id lapisan unik walau kueri dan scene-nya sama", async () => {
    const { session, tools } = setup();
    await exec(tools, "addLayer", { sceneId: "sc-001", query: "kopi" });
    await exec(tools, "addLayer", { sceneId: "sc-002", query: "kopi" });
    const ids = session.plan?.scenes.flatMap((scene) =>
      scene.layers.map((layer) => layer.id),
    );
    expect(new Set(ids).size).toBe(ids?.length);
  });

  it("scene yang tidak ada dijawab error, bukan lemparan", async () => {
    const { tools } = setup();
    const out = await exec(tools, "addLayer", { sceneId: "hantu", query: "x" });
    expect(out.ok).toBe(false);
  });
});

describe("removeLayer", () => {
  it("menghapus lapisan tapi MENINGGALKAN berkasnya, supaya undo utuh", async () => {
    const { session, tools } = setup();
    const added = await exec(tools, "addLayer", { sceneId: "sc-001", query: "kopi" });
    const layerId = String(added.layerId);

    const out = await exec(tools, "removeLayer", { sceneId: "sc-001", layerId });
    expect(out.ok).toBe(true);
    expect(session.plan?.scenes.find((s) => s.id === "sc-001")?.layers).toHaveLength(0);

    // Undo mengembalikan lapisannya utuh — itulah inti patch log.
    session.undo();
    expect(session.plan?.scenes.find((s) => s.id === "sc-001")?.layers).toHaveLength(1);
  });

  it("lapisan yang tidak ada dijawab error yang menyebut scene-nya", async () => {
    const { tools } = setup();
    const out = await exec(tools, "removeLayer", { sceneId: "sc-001", layerId: "hantu" });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("sc-001");
  });
});
