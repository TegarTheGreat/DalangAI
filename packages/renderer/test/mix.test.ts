import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RenderInternals } from "@remotion/renderer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measureMediaLoudness } from "../src/ffmpeg";
import { finalizeMix } from "../src/mix";

/**
 * Koreksi campuran akhir (ADR-0028 §9) diuji NYATA di atas ffmpeg bawaan
 * Remotion: nada sinus yang kenyaringannya bisa dihitung di kertas, dienkode
 * AAC, dikoreksi, lalu diukur lagi. Angka yang dibandingkan adalah angka
 * berkas yang benar-benar ditulis.
 */

/** WAV stereo 48 kHz, nada 440 Hz, amplitudo puncak `amp` (0..1). */
const sineWav = (seconds: number, amp: number): Buffer => {
  const sr = 48000;
  const n = sr * seconds;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * amp * 32767);
    buf.writeInt16LE(v, 44 + i * 4);
    buf.writeInt16LE(v, 46 + i * 4);
  }
  return buf;
};

const ff = (args: string[]) =>
  RenderInternals.callFf({
    bin: "ffmpeg",
    args: ["-hide_banner", "-loglevel", "error", "-y", ...args],
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
  });

let dir: string;
/** MP4 (AAC) berisi nada -10 dBFS: kenyaringannya sekitar -10,7 LUFS. */
const makeMp4 = async (name: string, amp: number): Promise<string> => {
  const wav = join(dir, `${name}.wav`);
  const mp4 = join(dir, `${name}.mp4`);
  writeFileSync(wav, sineWav(3, amp));
  await ff(["-i", wav, "-c:a", "aac", "-b:a", "128k", mp4]);
  return mp4;
};
const AAC = { codec: "aac" as const, bitrate: "128k" };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dalang-mix-test-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("finalizeMix (ffmpeg nyata)", () => {
  it("menurunkan campuran yang terlalu keras ke sasaran, dan angkanya dari berkas yang ditulis", async () => {
    const mp4 = await makeMp4("loud", 0.316);
    const before = await measureMediaLoudness(mp4);
    expect(before?.lufs).toBeCloseTo(-10.7, 0);

    const report = await finalizeMix(mp4, AAC, -16);
    expect(report.gainDb).toBeCloseTo(-5.3, 0);
    expect(report.lufsBefore).toBeCloseTo(before?.lufs ?? 0, 1);
    expect(report.lufs).toBeCloseTo(-16, 0);
    expect(report.note).toContain("diturunkan");
    // Berkas yang sama diukur lagi dari nol: hasilnya harus sama dengan laporan.
    const again = await measureMediaLoudness(mp4);
    expect(again?.lufs).toBeCloseTo(report.lufs ?? 0, 1);
  }, 30_000);

  it("menaikkan yang terlalu pelan, dan memangkas kenaikan di langit-langit puncak", async () => {
    // Amplitudo 0,5 = puncak -6 dBFS: ruang 5 dB. Kenyaringannya sekitar -6,7 LUFS.
    const mp4 = await makeMp4("capped", 0.5);
    const report = await finalizeMix(mp4, AAC, 0);
    expect(report.gainDb).toBeGreaterThan(4.5);
    expect(report.gainDb).toBeLessThanOrEqual(5.1);
    expect(report.note).toContain("dibatasi puncak");
    expect(report.lufs).toBeCloseTo((report.lufsBefore ?? 0) + report.gainDb, 0);
  }, 30_000);

  it("di dalam toleransi berkas tidak disentuh sama sekali", async () => {
    const mp4 = await makeMp4("near", 0.316);
    const stamp = statSync(mp4).mtimeMs;
    const report = await finalizeMix(mp4, AAC, -11);
    expect(report.gainDb).toBe(0);
    expect(report.note).toContain("toleransi");
    expect(statSync(mp4).mtimeMs).toBe(stamp);
  }, 30_000);

  it("WebM (Opus) dilaporkan tidak bisa dikoreksi, bukan dienkode ulang ke kodek lain", async () => {
    const mp4 = await makeMp4("webm-like", 0.316);
    const stamp = statSync(mp4).mtimeMs;
    const report = await finalizeMix(mp4, { codec: "opus", bitrate: "128k" }, -16);
    expect(report.gainDb).toBe(0);
    expect(report.note).toContain("opus");
    expect(statSync(mp4).mtimeMs).toBe(stamp);
  }, 30_000);

  it("berkas yang bukan media dilaporkan tidak terukur, tanpa lemparan", async () => {
    const bogus = join(dir, "bukan.mp4");
    writeFileSync(bogus, "bukan video");
    const report = await finalizeMix(bogus, AAC, -16);
    expect(report.lufs).toBeNull();
    expect(report.gainDb).toBe(0);
    expect(report.note).toContain("tidak terukur");
  }, 30_000);
});
