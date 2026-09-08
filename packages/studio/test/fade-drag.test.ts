import { describe, expect, it } from "vitest";
import {
  fadeFromLeft,
  fadeFromRight,
  MAX_FADE_SEC,
  maxFadeFor,
  nudgeFade,
} from "../src/app/model/fade-drag";

describe("fade-drag (murni)", () => {
  it("mengubah piksel jadi detik pada skala timeline, dibulatkan sepersepuluh", () => {
    expect(fadeFromLeft(48, 24, 60)).toBe(2);
    expect(fadeFromRight(30, 24, 60)).toBe(1.3);
    expect(fadeFromLeft(-12, 24, 60)).toBe(0);
  });

  it("dipangkas ke batas skema dan ke setengah rentang bar", () => {
    expect(fadeFromLeft(2400, 24, 60)).toBe(MAX_FADE_SEC);
    expect(maxFadeFor(6)).toBe(3);
    expect(fadeFromRight(240, 24, 6)).toBe(3);
    expect(nudgeFade(2.26, 60)).toBe(2.3);
    expect(nudgeFade(-1, 60)).toBe(0);
  });

  it("skala nol tidak membagi dengan nol", () => {
    expect(fadeFromLeft(48, 0, 60)).toBe(0);
  });
});
