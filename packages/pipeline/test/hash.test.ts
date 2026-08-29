import { describe, expect, it } from "vitest";
import { contentHash, stableStringify } from "../src/index";

describe("stableStringify", () => {
  it("is insensitive to key order, recursively", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("preserves array order and drops undefined values", () => {
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe("contentHash", () => {
  it("is stable and 16 hex chars", () => {
    const hash = contentHash({ kind: "tts", text: "Halo" });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash({ text: "Halo", kind: "tts" })).toBe(hash);
  });

  it("changes when any input changes", () => {
    const base = contentHash({ kind: "tts", text: "Halo", speed: 1 });
    expect(contentHash({ kind: "tts", text: "Halo!", speed: 1 })).not.toBe(base);
    expect(contentHash({ kind: "tts", text: "Halo", speed: 1.1 })).not.toBe(base);
  });
});
