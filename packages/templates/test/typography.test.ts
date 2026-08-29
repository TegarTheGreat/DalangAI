import { describe, expect, it } from "vitest";
import { titleFontSize } from "../src/presets/documentary-01/typography";

describe("titleFontSize", () => {
  it("keeps the base size for short titles", () => {
    expect(titleFontSize("Borobudur", 124)).toBe(124);
    expect(titleFontSize("A".repeat(18), 124)).toBe(124);
  });

  it("shrinks monotonically for longer titles", () => {
    const sizes = [20, 28, 40, 60, 90].map((n) => titleFontSize("A".repeat(n), 124));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
    }
  });

  it("never goes below the readability floor", () => {
    expect(titleFontSize("A".repeat(300), 124)).toBeGreaterThanOrEqual(62);
  });

  it("demo title fits the 9:16 base", () => {
    expect(titleFontSize("Sejarah Borobudur dalam 60 Detik", 124)).toBe(93);
  });
});
