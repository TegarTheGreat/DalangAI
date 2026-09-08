import { parseScenePlan, type ScenePlanInput } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { clipProgress } from "../src/app/model/keyframe-window";

/**
 * Jendela keyframe kamera klip (ADR-0036).
 *
 * Tombol keyframe di panel Properti mati saat fungsi ini mengembalikan `null`,
 * jadi yang dijaga di sini adalah satu hal: playhead di luar potongan tidak
 * boleh terbaca sebagai posisi di dalamnya. Keyframe yang mendarat di detik
 * yang tidak sedang dilihat orang adalah animasi yang "tidak terjadi" — titiknya
 * ada, cuma di tempat yang tidak pernah dipandang.
 */

const input = (): ScenePlanInput => ({
  version: 2,
  projectId: "proj-kf",
  meta: {
    title: "Uji jendela klip",
    aspectRatio: "16:9",
    targetDuration: 20,
    language: "id",
    stylePreset: "documentary-01",
  },
  audio: {},
  scenes: [
    {
      id: "sc-a",
      narration: "",
      // "auto": begitu scene punya dua klip, durasinya datang dari jumlah klip.
      duration: "auto",
      clips: [
        { id: "k1", type: "solid", durationSec: 2 },
        { id: "k2", type: "solid", durationSec: 4 },
      ],
    },
    { id: "sc-b", narration: "", duration: 4, clips: [{ id: "k3", type: "solid" }] },
  ],
});

const plan = parseScenePlan(input());

describe("clipProgress", () => {
  it("potongan KEDUA diukur dari awal potongannya, bukan awal scene-nya", () => {
    // Kalau diukur dari awal scene, keyframe "di tengah k2" akan mendarat di
    // 75% jendelanya — dan animasinya bergeser sejauh durasi k1.
    const awal = clipProgress(plan, "sc-a", "k2", 60);
    const tengah = clipProgress(plan, "sc-a", "k2", 119);
    expect(awal).toBeCloseTo(0, 4);
    expect(tengah).toBeCloseTo(0.5, 2);
  });

  it("playhead di potongan lain berarti di LUAR jendela ini", () => {
    expect(clipProgress(plan, "sc-a", "k2", 10)).toBeNull();
    expect(clipProgress(plan, "sc-a", "k1", 120)).toBeNull();
  });

  it("scene berklip satu memakai jalur yang sama, bukan cabang sendiri", () => {
    expect(clipProgress(plan, "sc-b", "k3", 0)).toBeNull();
    const di = clipProgress(plan, "sc-b", "k3", 190);
    expect(di).not.toBeNull();
    expect(di!).toBeGreaterThan(0);
    expect(di!).toBeLessThanOrEqual(1);
  });

  it("scene atau klip yang tidak ada tidak menghasilkan angka", () => {
    expect(clipProgress(plan, "sc-tidak-ada", "k1", 10)).toBeNull();
    expect(clipProgress(plan, "sc-a", "k-tidak-ada", 10)).toBeNull();
  });
});
