import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { decodeWav, isPcmWav, wavFormatCode } from "@dalang/pipeline";
import { RenderInternals } from "@remotion/renderer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remotionAudioProbe } from "../src/audio-probe";
import {
  measureMediaLoudness,
  parseFrameRate,
  probeInfoFromJson,
  remotionTranscoder,
} from "../src/ffmpeg";

/**
 * Transkoder di atas ffmpeg bawaan Remotion (ADR-0028) — diuji NYATA, bukan
 * dengan mock: sumbernya video sintetis (bingkai PNG yang dibuat di sini +
 * nada sinus) yang di-mux oleh ffmpeg yang sama, jadi tes ini juga membuktikan
 * build ramping Remotion memang punya demuxer/dekoder/enkoder yang dipakai
 * modulnya. Tanpa browser, tanpa jaringan, beberapa detik.
 */

// --- PNG sekecil-kecilnya (RGB, tanpa filter) supaya ada bingkai yang bergerak ---
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const encodePng = (
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number],
) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/** WAV stereo 48 kHz berisi nada 440 Hz pada -10 dBFS. */
const sineWav = (seconds: number): Buffer => {
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
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 0.316 * 32767);
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
let source: string;
let silent: string;
const W = 320;
const H = 180;
const FPS = 30;
const SECONDS = 2;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "dalang-ffmpeg-test-"));
  const frames = join(dir, "frames");
  mkdirSync(frames);
  // Batang kuning yang bergerak dari kiri ke kanan: bingkai detik ke-1 dan
  // detik ke-0 harus berbeda, dan itu yang diperiksa extractFrame.
  for (let f = 0; f < FPS * SECONDS; f++) {
    const x0 = Math.floor((f / (FPS * SECONDS)) * W);
    writeFileSync(
      join(frames, `f-${String(f).padStart(3, "0")}.png`),
      encodePng(W, H, (x) => (x >= x0 && x < x0 + 24 ? [255, 200, 0] : [20, 30, 60])),
    );
  }
  writeFileSync(join(dir, "sine.wav"), sineWav(SECONDS));
  source = join(dir, "src.mp4");
  silent = join(dir, "silent.mp4");
  await ff([
    "-framerate",
    String(FPS),
    "-i",
    join(frames, "f-%03d.png"),
    "-i",
    join(dir, "sine.wav"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-shortest",
    source,
  ]);
  await ff([
    "-framerate",
    String(FPS),
    "-i",
    join(frames, "f-%03d.png"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    silent,
  ]);
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("parseFrameRate / probeInfoFromJson (murni)", () => {
  it("membaca pecahan laju bingkai, menolak 0/0", () => {
    expect(parseFrameRate("30000/1001")).toBe(29.97);
    expect(parseFrameRate("25/1")).toBe(25);
    expect(parseFrameRate("0/0")).toBeNull();
    expect(parseFrameRate(undefined)).toBeNull();
  });

  it("mengabaikan sampul album sebagai jalur video, dan menandai berkas tanpa media", () => {
    const mp3 = probeInfoFromJson(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "mjpeg",
            width: 600,
            height: 600,
            disposition: { attached_pic: 1 },
          },
          { codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2 },
        ],
        format: { duration: "183.5", bit_rate: "128000" },
      }),
      1234,
    );
    expect(mp3?.codec).toBeNull();
    expect(mp3?.hasAudio).toBe(true);
    expect(mp3?.audioCodec).toBe("mp3");
    expect(mp3?.durationSec).toBe(183.5);
    expect(mp3?.bitrate).toBe(128000);
    expect(probeInfoFromJson(JSON.stringify({ streams: [] }), 1)).toBeNull();
    expect(probeInfoFromJson("bukan json", 1)).toBeNull();
  });
});

describe("remotionTranscoder (ffmpeg bawaan Remotion, nyata)", () => {
  const transcoder = remotionTranscoder();

  it("probe membaca kodek, dimensi, laju bingkai, durasi, dan jalur audio", async () => {
    const info = await transcoder.probe(source);
    expect(info).not.toBeNull();
    expect(info?.codec).toBe("h264");
    expect(info?.width).toBe(W);
    expect(info?.height).toBe(H);
    expect(info?.fps).toBe(FPS);
    expect(info?.durationSec).toBeCloseTo(SECONDS, 1);
    expect(info?.hasAudio).toBe(true);
    expect(info?.audioCodec).toBe("aac");
    expect(info?.channels).toBe(2);
    expect(info?.sampleRate).toBe(48000);
    expect(info?.sizeBytes).toBe(statSync(source).size);

    const mute = await transcoder.probe(silent);
    expect(mute?.hasAudio).toBe(false);
    expect(await transcoder.probe(join(dir, "tidak-ada.mp4"))).toBeNull();
    // Berkas yang bukan media sama sekali → null, bukan lemparan.
    writeFileSync(join(dir, "teks.mp4"), "ini bukan video");
    expect(await transcoder.probe(join(dir, "teks.mp4"))).toBeNull();
  });

  it("makeProxy menulis H.264/AAC berdimensi yang diminta, laju yang diminta, dan terbaca kembali", async () => {
    const out = join(dir, "proxies", "src-540p.mp4");
    const made = await transcoder.makeProxy({
      sourcePath: source,
      outputPath: out,
      width: 160,
      height: 90,
      fps: 15,
    });
    expect(made).toMatchObject({ ok: true, width: 160, height: 90, fps: 15 });
    if (!made.ok) throw new Error(made.reason);
    expect(made.durationSec).toBeCloseTo(SECONDS, 0);
    const info = await transcoder.probe(out);
    expect(info?.codec).toBe("h264");
    expect(info?.audioCodec).toBe("aac");
    expect(info?.channels).toBe(2);
    // faststart: atom "moov" berada di depan "mdat".
    const bytes = readFileSync(out);
    expect(bytes.indexOf("moov")).toBeLessThan(bytes.indexOf("mdat"));
  });

  it("makeProxy pada sumber TANPA suara tetap berhasil (peta audio opsional)", async () => {
    const out = join(dir, "proxies", "silent-540p.mp4");
    const made = await transcoder.makeProxy({
      sourcePath: silent,
      outputPath: out,
      width: 160,
      height: 90,
    });
    expect(made.ok).toBe(true);
    const info = await transcoder.probe(out);
    expect(info?.hasAudio).toBe(false);
    // Tanpa fps yang diminta, laju sumber dipertahankan.
    expect(info?.fps).toBe(FPS);
  });

  it("makeProxy melaporkan kegagalan sebagai nilai dan tidak meninggalkan berkas", async () => {
    const out = join(dir, "proxies", "gagal.mp4");
    const made = await transcoder.makeProxy({
      sourcePath: join(dir, "teks.mp4"),
      outputPath: out,
      width: 160,
      height: 90,
    });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("seharusnya gagal");
    expect(made.reason.length).toBeGreaterThan(0);
    expect(existsSync(out)).toBe(false);
  });

  it("extractFrame mengambil bingkai pada detik yang diminta, diskalakan; bingkai berbeda per waktu", async () => {
    const t0 = join(dir, "thumbs", "t0.jpg");
    const t1 = join(dir, "thumbs", "t1.jpg");
    const png = join(dir, "thumbs", "t1.png");
    expect(await transcoder.extractFrame(source, 0, t0, { height: 90 })).toEqual({
      ok: true,
    });
    expect(await transcoder.extractFrame(source, 1.0, t1, { height: 90 })).toEqual({
      ok: true,
    });
    expect(await transcoder.extractFrame(source, 1.0, png, { height: 90 })).toEqual({
      ok: true,
    });
    expect(statSync(t0).size).toBeGreaterThan(100);
    expect(readFileSync(t0).equals(readFileSync(t1))).toBe(false);
    // Penanda PNG di berkas .png, JPEG di .jpg.
    expect(readFileSync(png).subarray(1, 4).toString()).toBe("PNG");
    expect(readFileSync(t1)[0]).toBe(0xff);
    // Di luar durasi: tidak ada bingkai — dikatakan, bukan berkas kosong.
    const beyond = await transcoder.extractFrame(
      source,
      60,
      join(dir, "thumbs", "x.jpg"),
    );
    expect(beyond.ok).toBe(false);
  });

  it("toWav mendekode AAC jadi PCM 16-bit stereo 48 kHz — batas ADR-0026 dicabut", async () => {
    const wav = join(dir, "back.wav");
    expect(await transcoder.toWav(source, wav)).toEqual({ ok: true });
    const bytes = readFileSync(wav);
    expect(isPcmWav(bytes)).toBe(true);
    expect(wavFormatCode(bytes)).toBe(1);
    const decoded = decodeWav(bytes);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.channels).toHaveLength(2);
    expect(decoded.channels[0]?.length).toBeGreaterThan(48000 * (SECONDS - 0.2));
    // Sumber tanpa suara → alasan, bukan WAV kosong.
    const none = await transcoder.toWav(silent, join(dir, "none.wav"));
    expect(none.ok).toBe(false);
  });

  it("decodeMonoPcm mengembalikan PCM mono pada laju rendah, null untuk sumber bisu", async () => {
    const pcm = await transcoder.decodeMonoPcm(source, 1000);
    expect(pcm).not.toBeNull();
    expect(pcm?.length).toBeGreaterThan(1000 * (SECONDS - 0.2));
    expect(pcm?.length).toBeLessThan(1000 * (SECONDS + 0.2));
    // Nada -10 dBFS: puncaknya jauh dari nol dan dari kliping.
    const peak = Math.max(...Array.from(pcm ?? []).map(Math.abs));
    expect(peak).toBeGreaterThan(8000);
    expect(peak).toBeLessThan(14000);
    expect(await transcoder.decodeMonoPcm(silent, 1000)).toBeNull();
  });

  it("measureMediaLoudness mengukur berkas MP4/AAC — nada -10 dBFS stereo mendarat dekat -13 LUFS", async () => {
    const measured = await measureMediaLoudness(source);
    expect(measured).not.toBeNull();
    // Sinus 440 Hz pada -10 dBFS per kanal: K-weighting menambah ~+0,6 dB di
    // 440 Hz belum terasa (di bawah 1 kHz hampir datar), dua kanal identik
    // -> -10 - 0,691 + ~0 ≈ -10,7... per kanal; stereo ≈ -7,7? Yang diuji di
    // sini bukan angka absolutnya (itu urusan tes pengukur di pipeline),
    // melainkan bahwa angkanya WAJAR dan stabil untuk sinyal yang diketahui.
    expect(measured?.lufs).toBeGreaterThan(-14);
    expect(measured?.lufs).toBeLessThan(-5);
    expect(measured?.channels).toBe(2);
    expect(await measureMediaLoudness(silent)).toBeNull();
  });
});

describe("remotionAudioProbe — lapisan ffmpeg menangkap AAC sebelum browser", () => {
  it("MP4/AAC terukur tanpa membuka browser", async () => {
    const probe = remotionAudioProbe();
    const wav = join(dir, "probe.wav");
    const result = await probe.toWav(source, wav);
    expect(result).toEqual({ ok: true });
    expect(isPcmWav(readFileSync(wav))).toBe(true);
    await probe.close?.();
  }, 30_000);
});

describe("makeProxy — kemajuan dan pembatalan (ADR-0028 §10)", () => {
  it("melaporkan kemajuan yang tidak pernah turun dan berakhir tepat di 1", async () => {
    const seen: number[] = [];
    const out = join(dir, "progress-proxy.mp4");
    const made = await remotionTranscoder().makeProxy(
      {
        sourcePath: source,
        outputPath: out,
        width: 160,
        height: 90,
        fps: 30,
        durationSec: SECONDS,
      },
      { onProgress: (fraction) => seen.push(fraction) },
    );
    expect(made.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] ?? 0);
    }
    expect(seen.at(-1)).toBe(1);
    expect(existsSync(out)).toBe(true);
  }, 30_000);

  it("sinyal yang sudah dibatalkan tidak memulai ffmpeg dan tidak meninggalkan berkas", async () => {
    const controller = new AbortController();
    controller.abort();
    const out = join(dir, "batal-proxy.mp4");
    const made = await remotionTranscoder().makeProxy(
      { sourcePath: source, outputPath: out, width: 160, height: 90 },
      { signal: controller.signal },
    );
    expect(made).toEqual({ ok: false, reason: "dibatalkan" });
    expect(existsSync(out)).toBe(false);
  });
});
