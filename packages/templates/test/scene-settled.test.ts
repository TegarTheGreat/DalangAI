import { describe, expect, it } from "vitest";
import { activeSceneIndex, type FrameLayout, sceneSettledFrame } from "../src/layout";

/**
 * `sceneStarts + 1` BUKAN frame yang menampilkan scene itu: menurut aturan
 * titik-tengah transisi, scene yang aktif di sana masih scene sebelumnya.
 * Tes ini mengunci jebakan itu bersama pembetulannya.
 */
const layout: FrameLayout = {
  sceneFrames: [126, 150, 120],
  sceneStarts: [0, 111, 246],
  boundaryFrames: [15, 15],
  totalFrames: 366,
};

describe("sceneSettledFrame", () => {
  it("scene pertama mulai di 0", () => {
    expect(sceneSettledFrame(layout, 0)).toBe(0);
    expect(activeSceneIndex(layout, 0)).toBe(0);
  });

  it("di sceneStarts + 1 renderer masih menganggap scene SEBELUMNYA yang aktif", () => {
    expect(activeSceneIndex(layout, (layout.sceneStarts[1] ?? 0) + 1)).toBe(0);
    expect(activeSceneIndex(layout, (layout.sceneStarts[2] ?? 0) + 1)).toBe(1);
  });

  it("di frame settled scene itu sendiri yang aktif, dan transisinya sudah habis", () => {
    for (const index of [1, 2]) {
      const settled = sceneSettledFrame(layout, index);
      expect(settled).toBe((layout.sceneStarts[index] ?? 0) + 15);
      expect(activeSceneIndex(layout, settled)).toBe(index);
      // Satu frame sebelum titik tengah transisi masih milik scene sebelumnya.
      expect(activeSceneIndex(layout, (layout.sceneStarts[index] ?? 0) + 7)).toBe(
        index - 1,
      );
    }
  });

  it("indeks di luar rentang tidak meledak", () => {
    expect(sceneSettledFrame(layout, -1)).toBe(0);
    expect(sceneSettledFrame(layout, 9)).toBe(15);
  });
});
