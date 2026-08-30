import { describe, expect, it } from "vitest";
import { easeSettle, enterExit, kf } from "../src/anim";
import { motionTransform } from "../src/motion-model";

const vis = (over: Record<string, unknown> = {}) => ({
  motion: "none" as const,
  flipH: false,
  focusX: 0.5,
  focusY: 0.5,
  ...over,
});

describe("kf (keyframe piecewise + easing)", () => {
  it("clamp di kedua ujung, tepat di keyframe", () => {
    const frames = [
      [10, 0],
      [20, 100],
      [40, 50],
    ] as const;
    expect(kf(0, frames)).toBe(0);
    expect(kf(10, frames)).toBe(0);
    expect(kf(20, frames)).toBe(100);
    expect(kf(40, frames)).toBe(50);
    expect(kf(99, frames)).toBe(50);
  });

  it("monoton naik dalam segmen naik (kurva tidak overshoot ke bawah)", () => {
    let prev = -1;
    for (let f = 0; f <= 30; f++) {
      const v = kf(f, [
        [0, 0],
        [30, 1],
      ]);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("easeSettle: lebih dari setengah jalan pada 30% waktu (settle di akhir)", () => {
    expect(easeSettle(0.3)).toBeGreaterThan(0.5);
  });
});

describe("enterExit", () => {
  it("masuk 0->1, tahan, keluar ->0; opacity = min(masuk, keluar)", () => {
    const { opacity: awal } = enterExit(0, 0, 100, 12, 10);
    const { opacity: tengah } = enterExit(50, 0, 100, 12, 10);
    const { opacity: akhir } = enterExit(100, 0, 100, 12, 10);
    expect(awal).toBe(0);
    expect(tengah).toBe(1);
    expect(akhir).toBe(0);
  });
});

describe("motionTransform", () => {
  it("delapan motion menghasilkan transform yang berbeda & terklem", () => {
    const at = (motion: string, p: number) =>
      motionTransform(vis({ motion }) as never, p);
    expect(at("none", 0.5).scale).toBeUndefined();
    expect(Number(at("kenburns-in", 0).scale)).toBeCloseTo(1.03);
    expect(Number(at("kenburns-in", 1).scale)).toBeCloseTo(1.13);
    expect(at("pan-left", 0).translate).toBe("2.2% 0%");
    expect(at("pan-up", 1).translate).toBe("0% -2.2%");
    expect(at("pan-down", 0).translate).toBe("0% -2.2%");
    const d0 = at("drift", 0);
    const d1 = at("drift", 1);
    expect(d0.translate).toBe("1.200% 0.000%");
    expect(d1.translate).toBe("-1.200% 0.000%");
    expect(at("drift", 0.5).translate).toContain("0.800%");
  });

  it("flipH membalik komponen-x scale, motion tetap jalan", () => {
    const t = motionTransform(vis({ motion: "kenburns-in", flipH: true }), 1);
    expect(t.scale).toBe("-1.13 1.13");
    const diam = motionTransform(vis({ flipH: true }), 0);
    expect(diam.scale).toBe("-1 1");
  });

  it("titik fokus menjadi objectPosition", () => {
    expect(motionTransform(vis({ focusX: 0.2, focusY: 0.85 }), 0).objectPosition).toBe(
      "20.0% 85.0%",
    );
  });
});
