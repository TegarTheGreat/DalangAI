import { describe, expect, it } from "vitest";
import { readCloudConfig } from "../src/config";

/**
 * Konfigurasi render cloud (ADR-0019).
 *
 * Yang diuji terutama BENTUK KEGAGALANNYA: konfigurasi setengah jadi harus
 * menyebut apa yang kurang, bukan gagal dengan pesan AWS yang tidak bisa
 * ditindaklanjuti siapa pun.
 */

const lengkap = {
  AWS_REGION: "ap-southeast-1",
  DALANG_LAMBDA_FUNCTION: "remotion-render-mem2048mb",
  DALANG_LAMBDA_BUCKET: "remotionlambda-apsoutheast1-abc",
  DALANG_LAMBDA_SERVE_URL: "https://s3.test/sites/dalang/index.html",
};

describe("readCloudConfig", () => {
  it("env lengkap -> konfigurasi terbaca, dengan default yang masuk akal", () => {
    const out = readCloudConfig(lengkap);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.config.region).toBe("ap-southeast-1");
    expect(out.config.memorySizeInMb).toBe(2048);
    expect(out.config.framesPerLambda).toBe(20);
  });

  it("menyebut SETIAP variabel yang kurang, bukan hanya yang pertama", () => {
    const out = readCloudConfig({ AWS_REGION: "ap-southeast-1" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.missing).toHaveLength(3);
    expect(out.missing.join("\n")).toContain("DALANG_LAMBDA_FUNCTION");
    expect(out.missing.join("\n")).toContain("DALANG_LAMBDA_BUCKET");
    expect(out.missing.join("\n")).toContain("DALANG_LAMBDA_SERVE_URL");
  });

  it("setiap kekurangan membawa petunjuk cara mendapatkannya", () => {
    const out = readCloudConfig({});
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.missing.every((line) => line.includes(" — "))).toBe(true);
  });

  /** String kosong dan spasi bukan konfigurasi — itu env yang lupa diisi. */
  it("nilai kosong diperlakukan sebagai belum diisi", () => {
    const out = readCloudConfig({ ...lengkap, DALANG_LAMBDA_BUCKET: "   " });
    expect(out.ok).toBe(false);
  });

  it("memori dan frame-per-lambda bisa ditimpa env", () => {
    const out = readCloudConfig({
      ...lengkap,
      DALANG_LAMBDA_MEMORY_MB: "3008",
      DALANG_LAMBDA_FRAMES_PER_LAMBDA: "40",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.config.memorySizeInMb).toBe(3008);
    expect(out.config.framesPerLambda).toBe(40);
  });
});
