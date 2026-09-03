import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ScenePlanInput } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveQuery,
  orientationForAspect,
  PipelineDb,
  projectPaths,
  readPlanFile,
  runAssetStage,
} from "../src/index";
import { basicPlan, fakeStock, makeTempProject, silentLog } from "./helpers";

let cleanupFns: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
});

const setup = (planOverrides: Partial<ScenePlanInput> = {}) => {
  const project = makeTempProject(basicPlan(planOverrides));
  cleanupFns.push(project.cleanup);
  const paths = projectPaths(project.planPath);
  const plan = readPlanFile(paths.planPath);
  const db = new PipelineDb(":memory:");
  cleanupFns.push(() => db.close());
  return { paths, plan, db };
};

describe("helpers", () => {
  it("maps aspect ratios to orientations", () => {
    expect(orientationForAspect("9:16")).toBe("portrait");
    expect(orientationForAspect("16:9")).toBe("landscape");
    expect(orientationForAspect("1:1")).toBe("square");
  });

  it("derives a query from the narration deterministically", () => {
    expect(
      deriveQuery("Di jantung Pulau Jawa berdiri mahakarya abad kesembilan yang megah"),
    ).toBe("Di jantung Pulau Jawa berdiri mahakarya abad kesembilan");
  });
});

describe("runAssetStage", () => {
  it("resolves stock scenes: video preferred, license + assetId recorded", async () => {
    const { paths, plan, db } = setup();
    const provider = fakeStock("pexels-palsu");
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });

    const result = results.find((r) => r.sceneId === "sc-001");
    expect(result).toMatchObject({ status: "done", provider: "pexels-palsu" });
    expect(provider.searchCalls[0]).toEqual({ query: "candi jawa", kind: "video" });

    const scene = next.scenes.find((s) => s.id === "sc-001")!;
    expect(scene.clips[0]?.assetId).toBe("pexels-palsu:video:42");
    expect(scene.clips[0]?.pinned).toBe(false); // auto-resolve never pins

    const asset = next.renderState.clipAssets["sc-001-k1"]!;
    expect(asset.license).toBe("pexels-palsu License");
    expect(asset.kind).toBe("video");
    expect(existsSync(join(paths.planDir, asset.file))).toBe(true);
  });

  it("falls through video→image and across providers", async () => {
    const { paths, plan, db } = setup();
    const videoless = fakeStock("utama", { kinds: ["image"] });
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [videoless],
      db,
      log: silentLog,
    });
    expect(results.find((r) => r.sceneId === "sc-001")?.status).toBe("done");
    expect(next.renderState.clipAssets["sc-001-k1"]?.kind).toBe("image");

    const { paths: paths2, plan: plan2, db: db2 } = setup();
    const broken = fakeStock("utama", { failSearch: true });
    const backup = fakeStock("cadangan");
    const { results: results2 } = await runAssetStage({
      paths: paths2,
      plan: plan2,
      providers: [broken, backup],
      db: db2,
      log: silentLog,
    });
    expect(results2.find((r) => r.sceneId === "sc-001")).toMatchObject({
      status: "done",
      provider: "cadangan",
      fallback: true,
    });
  });

  it("never touches pinned or locked scenes", async () => {
    const { paths, plan, db } = setup({
      scenes: [
        {
          id: "sc-pin",
          narration: "Aset pilihan user.",
          clips: [
            {
              id: "sc-pin-k1",
              type: "stock",
              query: "x",
              assetId: "manual:1",
              pinned: true,
            },
          ],
        },
        {
          id: "sc-lock",
          locked: true,
          narration: "Scene terkunci.",
          clips: [{ id: "sc-lock-k1", type: "stock", query: "y" }],
        },
      ],
    });
    const provider = fakeStock("p");
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(results.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(provider.searchCalls).toHaveLength(0);
    expect(next.scenes[0]?.clips[0]?.assetId).toBe("manual:1");
  });

  it("second run hits the cache; changed query re-resolves", async () => {
    const { paths, plan, db } = setup();
    const provider = fakeStock("p");
    const first = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    const second = await runAssetStage({
      paths,
      plan: first.plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(second.results.find((r) => r.sceneId === "sc-001")?.status).toBe("cached");
    expect(provider.searchCalls).toHaveLength(1);

    const edited = structuredClone(second.plan);
    edited.scenes[0]!.clips[0]!.query = "kueri baru";
    const third = await runAssetStage({
      paths,
      plan: edited,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(third.results.find((r) => r.sceneId === "sc-001")?.status).toBe("done");
    expect(provider.searchCalls).toHaveLength(2);
  });

  it("derives the query from narration when none is set", async () => {
    const { paths, plan, db } = setup({
      scenes: [
        {
          id: "sc-001",
          narration: "Candi Borobudur berdiri megah di Jawa Tengah",
          clips: [{ id: "sc-001-k1", type: "stock" }],
        },
      ],
    });
    const provider = fakeStock("p");
    const { results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(provider.searchCalls[0]?.query).toBe(
      "Candi Borobudur berdiri megah di Jawa Tengah",
    );
    expect(results[0]?.detail).toContain("query turunan");
  });

  it("errors clearly with an empty provider chain, per scene", async () => {
    const { paths, plan, db } = setup();
    const { results } = await runAssetStage({
      paths,
      plan,
      providers: [],
      db,
      log: silentLog,
    });
    const result = results.find((r) => r.sceneId === "sc-001");
    expect(result?.status).toBe("error");
    expect(result?.detail).toContain("PEXELS_API_KEY");
  });
});
