import { describe, expect, it } from "vitest";
import { MIX_PEAK_CEILING_DBFS, MIX_TOLERANCE_LU, mixCorrection } from "../src/loudness";

/**
 * Koreksi campuran akhir (ADR-0028 §9) — murni: masuk hasil ukur, keluar
 * penguatan dan kalimatnya.
 */
describe("mixCorrection", () => {
  const quiet = { lufs: -23, peak: 0.1 }; // puncak -20 dBFS: ruang 19 dB

  it("tanpa sasaran atau materi sunyi tidak menyentuh apa pun", () => {
    expect(mixCorrection(quiet, null).gainDb).toBe(0);
    expect(mixCorrection(quiet, null).reason).toContain("nonaktif");
    expect(mixCorrection({ lufs: null, peak: 0 }, -16).gainDb).toBe(0);
  });

  it("di dalam toleransi ±1 LU dibiarkan, dan mengatakannya", () => {
    const near = mixCorrection({ lufs: -16.8, peak: 0.3 }, -16);
    expect(near.gainDb).toBe(0);
    expect(near.reason).toContain(`±${MIX_TOLERANCE_LU} LU`);
    expect(mixCorrection({ lufs: -15.1, peak: 0.9 }, -16).gainDb).toBe(0);
  });

  it("naik ke sasaran selama puncaknya masih punya ruang", () => {
    const up = mixCorrection(quiet, -16);
    expect(up.gainDb).toBe(7);
    expect(up.capped).toBe(false);
    expect(up.reason).toBe("dinaikkan +7.0 dB");
  });

  it("turun tanpa pernah dipangkas, walau puncaknya sudah tinggi", () => {
    const down = mixCorrection({ lufs: -9.4, peak: 0.99 }, -16);
    expect(down.gainDb).toBe(-6.6);
    expect(down.capped).toBe(false);
    expect(down.reason).toBe("diturunkan -6.6 dB");
  });

  it("kenaikan dipangkas ke langit-langit puncak, dan laporannya menyebut yang dibutuhkan", () => {
    // Puncak -6 dBFS: ruang 5 dB ke langit-langit -1; butuh +7.
    const capped = mixCorrection({ lufs: -23, peak: 0.501 }, -16);
    expect(capped.capped).toBe(true);
    expect(capped.gainDb).toBe(5);
    expect(capped.reason).toContain("dibatasi puncak");
    expect(capped.reason).toContain("+7.0 dB");
    // Puncak yang menghasilkan gain tepat di langit-langit: 20·log10(peak) + gain = ceiling.
    const peakAfter = 20 * Math.log10(0.501) + capped.gainDb;
    expect(peakAfter).toBeLessThanOrEqual(MIX_PEAK_CEILING_DBFS + 0.05);
  });

  it("ruang di bawah setengah dB tidak dikoreksi sama sekali, dengan alasan", () => {
    const stuck = mixCorrection({ lufs: -23, peak: 0.95 }, -16);
    expect(stuck.gainDb).toBe(0);
    expect(stuck.capped).toBe(true);
    expect(stuck.reason).toContain("tidak ada ruang");
  });
});
