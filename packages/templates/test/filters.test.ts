import { visualFilterSchema } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { filterToCss } from "../src/presets/documentary-01/filters";

describe("filterToCss (ADR-0011)", () => {
  it("tanpa filter atau serba-netral = tanpa CSS", () => {
    expect(filterToCss(undefined)).toEqual({});
    expect(filterToCss(visualFilterSchema.parse({}))).toEqual({});
  });

  it("preset menghasilkan rantai filter deterministik", () => {
    const css = filterToCss(visualFilterSchema.parse({ preset: "mono" }));
    expect(css.filter).toBe("grayscale(1) contrast(1.06)");
    expect(css.opacity).toBeUndefined();
  });

  it("penyesuaian manual ditambahkan setelah preset; opacity terpisah", () => {
    const css = filterToCss(
      visualFilterSchema.parse({
        preset: "warm",
        brightness: 1.2,
        saturation: 0.8,
        opacity: 0.65,
      }),
    );
    expect(css.filter).toContain("sepia(0.18)");
    expect(css.filter).toContain("brightness(1.2)");
    expect(css.filter).toContain("saturate(0.8)");
    expect(css.filter).not.toContain("contrast(1)");
    expect(css.opacity).toBe(0.65);
  });
});
