import { type AspectRatio, DIMENSIONS, parseScenePlan } from "@dalang/core";
import { describe, expect, it } from "vitest";
import demoPlan from "../../../examples/borobudur-60s/plan.json";
import {
  activeSceneIndex,
  aspectMetrics,
  computeFrameLayout,
  FPS,
  TRANSITION_FRAMES,
} from "../src/layout";

describe("computeFrameLayout", () => {
  it("overlaps transitions and quantizes to frames", () => {
    const plan = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        { id: "a", duration: 3, clips: [{ id: "a-k1", type: "solid" }] },
        { id: "b", duration: 4, clips: [{ id: "b-k1", type: "solid" }] },
        { id: "c", duration: 5, clips: [{ id: "c-k1", type: "solid" }] },
      ],
    });
    const layout = computeFrameLayout(plan);
    expect(layout.sceneFrames).toEqual([90, 120, 150]);
    expect(layout.sceneStarts).toEqual([
      0,
      90 - TRANSITION_FRAMES,
      90 + 120 - 2 * TRANSITION_FRAMES,
    ]);
    expect(layout.totalFrames).toBe(90 + 120 + 150 - 2 * TRANSITION_FRAMES);
  });

  it("clamps pathological short scenes so transitions always fit", () => {
    const plan = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        { id: "a", duration: 0.2, clips: [{ id: "a-k1", type: "solid" }] },
        { id: "b", duration: 0.2, clips: [{ id: "b-k1", type: "solid" }] },
      ],
    });
    const layout = computeFrameLayout(plan);
    for (const frames of layout.sceneFrames) {
      expect(frames).toBeGreaterThanOrEqual(TRANSITION_FRAMES * 2 + 6);
    }
    expect(layout.totalFrames).toBeGreaterThan(0);
  });

  it("demo plan timeline stays stable (guards accidental timing changes)", () => {
    const plan = parseScenePlan(demoPlan);
    const layout = computeFrameLayout(plan);
    // ADR-0014: tempo transisi demo bervariasi (10-24 frame per batas).
    // ADR-0017: angka bergeser naik saat estimasi durasi pindah dari jumlah
    // KATA ke jumlah SUKU KATA. Nilai lama memuat tiga scene yang kebetulan
    // sama persis (216, 216, 216) — tanda bahwa hitungan kata tidak bisa
    // membedakan narasi yang panjang ucapannya berbeda. Nilai baru semuanya
    // berbeda karena mengukur apa yang benar-benar diucapkan.
    expect(layout.sceneFrames).toEqual([150, 244, 223, 286, 229, 255, 244, 135]);
    expect(layout.totalFrames).toBe(1647);
    expect(layout.totalFrames / FPS).toBeCloseTo(54.9, 1);
  });
});

describe("activeSceneIndex", () => {
  it("switches at the transition midpoint", () => {
    const plan = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        { id: "a", duration: 3, clips: [{ id: "a-k1", type: "solid" }] },
        { id: "b", duration: 3, clips: [{ id: "b-k1", type: "solid" }] },
      ],
    });
    const layout = computeFrameLayout(plan);
    const cut = (layout.sceneStarts[1] ?? 0) + TRANSITION_FRAMES / 2;
    expect(activeSceneIndex(layout, 0)).toBe(0);
    expect(activeSceneIndex(layout, cut - 1)).toBe(0);
    expect(activeSceneIndex(layout, cut)).toBe(1);
    expect(activeSceneIndex(layout, layout.totalFrames - 1)).toBe(1);
  });
});

describe("aspectMetrics", () => {
  const aspects: AspectRatio[] = ["9:16", "16:9", "1:1"];

  it.each(aspects)("%s matches core dimensions", (aspect) => {
    const metrics = aspectMetrics(aspect);
    expect({ width: metrics.width, height: metrics.height }).toEqual(DIMENSIONS[aspect]);
  });

  it.each(aspects)(
    "%s respects video-layout minimums (safe area, text sizes)",
    (aspect) => {
      const metrics = aspectMetrics(aspect);
      const widthScale = metrics.width / 1080;
      // Remotion video-layout guidance: ≥80px sides, ≥44px supporting text,
      // ≥84px headline at 1080w — scaled by width.
      expect(metrics.marginX).toBeGreaterThanOrEqual(80 * widthScale);
      expect(metrics.captionFontSize).toBeGreaterThanOrEqual(44 * widthScale * 0.5);
      expect(metrics.titleFontSize).toBeGreaterThanOrEqual(84);
      // Captions must sit inside the frame with breathing room.
      expect(metrics.captionBottom).toBeGreaterThan(metrics.height * 0.05);
      expect(metrics.captionMaxWidth).toBeLessThanOrEqual(
        metrics.width - 2 * (metrics.marginX * 0.5),
      );
    },
  );
});

/**
 * Zona aman platform (ADR-0034).
 *
 * Diuji sebagai ARITMETIKA, karena itu yang dijanjikan repo ini: berapa yang
 * harus dikosongkan adalah pengetahuan pemakainya, tapi bahwa tata letak
 * benar-benar menghormatinya adalah tanggung jawab kode ini.
 */
describe("aspectMetrics · zona aman platform", () => {
  it("bawaannya tidak menggeser apa pun", () => {
    // Sifat yang menjaga gerbang paritas byte tetap berarti: plan yang sudah
    // ada tidak boleh berpindah satu piksel pun karena fitur ini lahir.
    for (const aspect of ["9:16", "16:9", "1:1"] as AspectRatio[]) {
      expect(aspectMetrics(aspect, { top: 0, bottom: 0, left: 0, right: 0 })).toEqual(
        aspectMetrics(aspect),
      );
    }
  });

  it("caption naik keluar dari pita bawah yang dipesan", () => {
    const polos = aspectMetrics("9:16");
    const aman = aspectMetrics("9:16", { top: 0, bottom: 0.22, left: 0, right: 0 });
    const pita = polos.height * 0.22;
    expect(polos.captionBottom).toBeLessThan(pita);
    expect(aman.captionBottom).toBeGreaterThanOrEqual(pita);
  });

  it("rel tombol di kanan mempersempit KEDUA sisi, jadi isinya tetap di tengah", () => {
    const polos = aspectMetrics("9:16");
    const aman = aspectMetrics("9:16", { top: 0, bottom: 0, left: 0, right: 0.16 });
    const rel = polos.width * 0.16;
    expect(aman.marginX).toBeGreaterThanOrEqual(rel);
    // Lebar caption ikut menyempit; kalau tidak, teksnya tetap menembus rel
    // dari samping meskipun marginnya sudah benar.
    expect(aman.captionMaxWidth).toBeLessThanOrEqual(aman.width - aman.marginX * 2);
    expect(aman.captionMaxWidth).toBeLessThan(polos.captionMaxWidth);
  });

  it("zona aman yang lebih sempit daripada margin desain tidak menguranginya", () => {
    // Zona aman MENAMBAH kelonggaran. Kalau ia boleh mengurangi, menyalakannya
    // dengan angka kecil justru membuat tata letak lebih berbahaya daripada
    // mematikannya — kebalikan dari gunanya.
    const polos = aspectMetrics("16:9");
    const kecil = aspectMetrics("16:9", {
      top: 0.001,
      bottom: 0.001,
      left: 0.001,
      right: 0.001,
    });
    expect(kecil.marginX).toBe(polos.marginX);
    expect(kecil.marginTop).toBe(polos.marginTop);
    expect(kecil.captionBottom).toBe(polos.captionBottom);
    expect(kecil.captionMaxWidth).toBe(polos.captionMaxWidth);
  });

  it("bidang yang tersisa tetap positif di batas paling ekstrem skema", () => {
    // 0,4 per sisi adalah maksimum skema; dua sisi berhadapan menyisakan 20%.
    for (const aspect of ["9:16", "16:9", "1:1"] as AspectRatio[]) {
      const m = aspectMetrics(aspect, { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 });
      expect(m.captionMaxWidth).toBeGreaterThan(0);
      expect(m.captionBottom + m.marginTop).toBeLessThan(m.height);
    }
  });
});
