import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeBundleFingerprint, computeFingerprint } from "../src/fingerprint";

let dir: string;
const setup = () => {
  dir = mkdtempSync(join(tmpdir(), "dalang-fp-"));
  mkdirSync(join(dir, "src", "nested"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "src", "nested", "b.ts"), "export const b = 2;\n");
  return computeFingerprint({ base: dir, paths: [join(dir, "src")] });
};

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("computeFingerprint", () => {
  it("is stable across calls for identical content", () => {
    const first = setup();
    expect(computeFingerprint({ base: dir, paths: [join(dir, "src")] })).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when file content changes", () => {
    const first = setup();
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 999;\n");
    expect(computeFingerprint({ base: dir, paths: [join(dir, "src")] })).not.toBe(first);
  });

  it("changes when a file is added or renamed", () => {
    const first = setup();
    writeFileSync(join(dir, "src", "c.ts"), "export const c = 3;\n");
    const withAdded = computeFingerprint({ base: dir, paths: [join(dir, "src")] });
    expect(withAdded).not.toBe(first);
  });

  it("honors excludes and skips missing paths", () => {
    const first = setup();
    mkdirSync(join(dir, "src", "assets"));
    writeFileSync(join(dir, "src", "assets", "big.bin"), "x".repeat(10));
    const excluded = computeFingerprint({
      base: dir,
      paths: [join(dir, "src"), join(dir, "does-not-exist")],
      exclude: ["src/assets"],
    });
    expect(excluded).toBe(first);
  });
});

describe("computeBundleFingerprint", () => {
  it("fingerprints the real workspace deterministically", () => {
    const first = computeBundleFingerprint();
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(computeBundleFingerprint()).toBe(first);
  });
});
