import { parseScenePlan } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { planMeta, sceneThumbFrame } from "../src/app/model/plan-meta";
import { deriveSceneStatus } from "../src/app/model/scene-status";
import { SseParser } from "../src/app/sse";
import type { BusyState, StageRunLite } from "../src/shared/api-types";
import { makePlan } from "./helpers";

const idle: BusyState = { mutation: null, render: null };
const run = (partial: Partial<StageRunLite>): StageRunLite => ({
  sceneId: "sc-batu",
  stage: "tts",
  status: "done",
  provider: "fake",
  fallback: false,
  costUsd: 0,
  error: null,
  ...partial,
});

describe("SseParser", () => {
  it("menggabungkan chunk terpotong sembarang menjadi event utuh", () => {
    const parser = new SseParser();
    const events = [
      ...parser.push("event: done\nda"),
      ...parser.push('ta: {"a":1}\n'),
      ...parser.push("\nevent: activity\ndata: baris1\ndata: baris2\n\n"),
    ];
    expect(events).toEqual([
      { event: "done", data: '{"a":1}' },
      { event: "activity", data: "baris1\nbaris2" },
    ]);
  });

  it("mengabaikan komentar heartbeat dan CRLF", () => {
    const parser = new SseParser();
    const events = parser.push(": ping\r\nevent: x\r\ndata: y\r\n\r\n");
    expect(events).toEqual([{ event: "x", data: "y" }]);
  });
});

describe("deriveSceneStatus", () => {
  const plan = parseScenePlan(makePlan());
  const byId = (id: string) => {
    const scene = plan.scenes.find((s) => s.id === id);
    if (!scene) throw new Error(id);
    return scene;
  };

  it("scene tanpa narasi = n/a suara; template-anim = n/a aset", () => {
    const status = deriveSceneStatus(plan, byId("sc-judul"), [], idle);
    expect(status).toEqual({ voice: "n/a", asset: "n/a" });
  });

  it("belum diproses = belum; run error = error; run berjalan = proses", () => {
    expect(deriveSceneStatus(plan, byId("sc-batu"), [], idle).voice).toBe("belum");
    expect(
      deriveSceneStatus(
        plan,
        byId("sc-batu"),
        [run({ status: "error", error: "x" })],
        idle,
      ).voice,
    ).toBe("error");
    expect(
      deriveSceneStatus(plan, byId("sc-batu"), [run({ status: "running" })], idle).voice,
    ).toBe("proses");
    expect(
      deriveSceneStatus(plan, byId("sc-batu"), [], { mutation: "tts", render: null })
        .voice,
    ).toBe("proses");
  });

  it("audio fallbackQuality → fallback; aset pinned → pinned", () => {
    const withState = parseScenePlan({
      ...makePlan(),
      scenes: makePlan().scenes.map((scene) =>
        scene.id === "sc-batu"
          ? { ...scene, clips: [{ ...scene.clips[0]!, pinned: true, assetId: "a" }] }
          : scene,
      ),
      renderState: {
        narrationAudio: {
          "sc-batu": { file: "x.wav", durationSec: 2, fallbackQuality: true },
        },
        clipAssets: {
          "sc-batu-k1": {
            file: "a.jpg",
            kind: "image",
            source: "fake",
            license: "L",
            width: 10,
            height: 10,
          },
        },
      },
    });
    const status = deriveSceneStatus(withState, withState.scenes[1]!, [], idle);
    expect(status.voice).toBe("fallback");
    expect(status.asset).toBe("pinned");
  });
});

describe("planMeta", () => {
  const plan = parseScenePlan(makePlan());

  it("identik dengan layout renderer (satu sumber kebenaran durasi)", () => {
    const meta = planMeta(plan);
    expect(meta.fps).toBe(30);
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
    expect(meta.sceneFrames).toHaveLength(3);
    expect(meta.durationInFrames).toBeGreaterThan(0);
    // total = jumlah frame scene dikurangi overlap transisi
    const sum = meta.sceneFrames.reduce((a, b) => a + b, 0);
    expect(meta.durationInFrames).toBeLessThanOrEqual(sum);
  });

  it("sceneThumbFrame selalu berada di dalam durasi scene", () => {
    const meta = planMeta(plan);
    plan.scenes.forEach((_, index) => {
      const frame = sceneThumbFrame(meta, index);
      expect(frame).toBeGreaterThanOrEqual(meta.sceneStarts[index] ?? 0);
      expect(frame).toBeLessThan(
        (meta.sceneStarts[index] ?? 0) + (meta.sceneFrames[index] ?? 1),
      );
    });
  });
});
