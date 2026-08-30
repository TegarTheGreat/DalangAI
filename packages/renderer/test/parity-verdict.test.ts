import { describe, expect, it } from "vitest";
import {
  describeAttempt,
  type ParityAttempt,
  parityVerdict,
} from "../src/parity-verdict";

const fingerprint = (hash: string, bytes = 1000) => ({ hash, bytes });
const attempt = (local: string, url: string): ParityAttempt => ({
  local: fingerprint(local),
  url: fingerprint(url),
});

describe("parityVerdict", () => {
  it("menyatakan identik tanpa perlu percobaan kedua", () => {
    expect(parityVerdict(attempt("aa", "aa"))).toBe("identik");
  });

  it("menyatakan berbeda kalau tidak ada ulangan untuk membuktikan sebaliknya", () => {
    expect(parityVerdict(attempt("aa", "bb"))).toBe("berbeda");
  });

  it("menyatakan goyah kalau ulangannya identik", () => {
    expect(parityVerdict(attempt("aa", "bb"), attempt("cc", "cc"))).toBe("goyah");
  });

  it("TETAP menyatakan berbeda kalau selisihnya berulang", () => {
    // Inilah yang terjadi pada staticFile() yang terlewat: asetnya hilang di
    // setiap render, jadi ulangan tidak menolongnya.
    expect(parityVerdict(attempt("aa", "bb"), attempt("aa", "bb"))).toBe("berbeda");
  });

  it("menyatakan berbeda walau ulangannya menghasilkan hash baru, asalkan kedua jalur masih beda", () => {
    expect(parityVerdict(attempt("aa", "bb"), attempt("cc", "dd"))).toBe("berbeda");
  });
});

describe("describeAttempt", () => {
  it("membawa hash DAN ukuran kedua jalur — ukuran yang membedakan aset hilang dari derau", () => {
    const text = describeAttempt("percobaan 1", {
      local: fingerprint("abc", 40_000),
      url: fingerprint("def", 900),
    });
    expect(text).toContain("percobaan 1");
    expect(text).toContain("abc");
    expect(text).toContain("40000 byte");
    expect(text).toContain("def");
    expect(text).toContain("900 byte");
  });
});
