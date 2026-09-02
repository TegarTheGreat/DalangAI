import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import {
  type AudioProbeResult,
  decodeWav,
  type FrameResult,
  isPcmWav,
  type LoudnessResult,
  type MediaProbeInfo,
  type MediaTranscoder,
  measureWavLoudness,
  type ProxyRequest,
  type ProxyResult,
} from "@dalang/pipeline";
import { RenderInternals } from "@remotion/renderer";

/**
 * Implementasi port `MediaTranscoder` (ADR-0028) di atas ffmpeg/ffprobe yang
 * SUDAH dibundel Remotion (`@remotion/compositor-*`).
 *
 * Ini biner yang sama yang dipakai Remotion untuk mengenkode setiap render —
 * jadi tidak ada dependensi biner baru, tidak ada "pasang ffmpeg dulu", dan
 * kemampuannya persis yang Remotion janjikan di semua platform yang didukung:
 * dekoder h264/hevc/vp8/vp9/av1/prores/mpeg4 dan aac/mp3/opus/vorbis/flac/pcm,
 * enkoder libx264 dan aac, filter `scale` dan `aresample`. Build-nya SENGAJA
 * ramping (kebanyakan filter dimatikan), dan modul ini hanya memakai yang ada
 * di daftar itu — setiap perintah di sini pernah dijalankan terhadap biner
 * sungguhan, bukan disalin dari dokumentasi ffmpeg penuh.
 *
 * Dipanggil lewat `RenderInternals.callFf`, pintu yang sama yang dipakai
 * `extractAudio` dan `getVideoMetadata` milik Remotion sendiri. Versi Remotion
 * dipin persis di repo ini, jadi permukaan internal itu stabil selama pin-nya
 * tidak berubah — dan tes nyata di bawah yang menjaganya.
 */

type FfBin = "ffmpeg" | "ffprobe";

interface FfError {
  stderr?: string;
  shortMessage?: string;
  message?: string;
}

/** Baris terakhir stderr ffmpeg: itu yang biasanya memuat alasannya. */
const reasonOf = (error: unknown): string => {
  const err = (error ?? {}) as FfError;
  const lines = (err.stderr ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? err.shortMessage ?? err.message ?? String(error);
};

const callFf = async (bin: FfBin, args: string[]): Promise<{ stdout: string }> => {
  const result = await RenderInternals.callFf({
    bin,
    args,
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
  });
  return { stdout: result.stdout };
};

const QUIET = ["-hide_banner", "-loglevel", "error", "-y"];

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: { duration?: string; bit_rate?: string; size?: string };
}

/** "30000/1001" → 29.97; "0/0" dan bentuk rusak → null. */
export const parseFrameRate = (value: string | undefined): number | null => {
  if (!value) return null;
  const [num, den] = value.split("/").map(Number);
  if (!num || !den || !Number.isFinite(num) || !Number.isFinite(den)) return null;
  const fps = num / den;
  return fps > 0 && Number.isFinite(fps) ? Math.round(fps * 1000) / 1000 : null;
};

/** Susun MediaProbeInfo dari keluaran JSON ffprobe — murni, diuji sendiri. */
export const probeInfoFromJson = (
  raw: string,
  sizeBytes: number,
): MediaProbeInfo | null => {
  let data: ProbeOutput;
  try {
    data = JSON.parse(raw) as ProbeOutput;
  } catch {
    return null;
  }
  const streams = data.streams ?? [];
  // Sampul album di MP3 ikut terdaftar sebagai "video" — itu bukan jalur video.
  const video = streams.find(
    (stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video && !audio) return null;
  const duration = Number(
    data.format?.duration ?? video?.duration ?? audio?.duration ?? Number.NaN,
  );
  const bitrate = Number(data.format?.bit_rate ?? Number.NaN);
  const sampleRate = Number(audio?.sample_rate ?? Number.NaN);
  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: parseFrameRate(video?.avg_frame_rate) ?? parseFrameRate(video?.r_frame_rate),
    codec: video?.codec_name?.toLowerCase() ?? null,
    hasAudio: audio !== undefined,
    audioCodec: audio?.codec_name?.toLowerCase() ?? null,
    channels: audio?.channels ?? null,
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : null,
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
    sizeBytes,
  };
};

const probe = async (sourcePath: string): Promise<MediaProbeInfo | null> => {
  if (!existsSync(sourcePath)) return null;
  try {
    const { stdout } = await callFf("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      sourcePath,
    ]);
    return probeInfoFromJson(stdout, statSync(sourcePath).size);
  } catch {
    return null;
  }
};

const makeProxy = async (request: ProxyRequest): Promise<ProxyResult> => {
  mkdirSync(dirname(request.outputPath), { recursive: true });
  try {
    await callFf("ffmpeg", [
      ...QUIET,
      "-i",
      request.sourcePath,
      // Jalur video pertama wajib, jalur audio pertama KALAU ADA (tanda tanya):
      // rekaman tanpa suara tetap dapat proxy, bukan galat "stream tidak ada".
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      `scale=${request.width}:${request.height}`,
      ...(request.fps ? ["-r", String(request.fps)] : []),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-pix_fmt",
      "yuv420p",
      // Keyframe tiap detik: scrub di Player melompat ke keyframe terdekat,
      // dan GOP panjang bawaan x264 (250) terasa seperti seret yang macet.
      "-g",
      "30",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-ac",
      "2",
      "-ar",
      "48000",
      // Indeks di depan berkas supaya browser bisa mulai memutar dan seeking
      // sebelum seluruh berkasnya terunduh.
      "-movflags",
      "+faststart",
      request.outputPath,
    ]);
  } catch (error) {
    rmSync(request.outputPath, { force: true });
    return { ok: false, reason: reasonOf(error) };
  }
  const info = await probe(request.outputPath);
  if (!info?.codec) {
    rmSync(request.outputPath, { force: true });
    return { ok: false, reason: "proxy tertulis tapi tidak terbaca kembali" };
  }
  return {
    ok: true,
    width: info.width,
    height: info.height,
    durationSec: info.durationSec,
    fps: info.fps,
  };
};

const extractFrame = async (
  sourcePath: string,
  atSec: number,
  outputPath: string,
  options: { height?: number } = {},
): Promise<FrameResult> => {
  mkdirSync(dirname(outputPath), { recursive: true });
  const png = extname(outputPath).toLowerCase() === ".png";
  try {
    await callFf("ffmpeg", [
      ...QUIET,
      // `-ss` SEBELUM `-i` = lompat lewat indeks, bukan mendekode dari awal:
      // pada rekaman satu jam bedanya detik versus menit.
      "-ss",
      String(Math.max(0, atSec)),
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      ...(options.height ? ["-vf", `scale=-2:${options.height}`] : []),
      ...(png ? ["-c:v", "png"] : ["-q:v", "4"]),
      outputPath,
    ]);
  } catch (error) {
    rmSync(outputPath, { force: true });
    return { ok: false, reason: reasonOf(error) };
  }
  if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
    rmSync(outputPath, { force: true });
    return { ok: false, reason: "tidak ada bingkai pada detik itu" };
  }
  return { ok: true };
};

const toWav = async (sourcePath: string, wavPath: string): Promise<AudioProbeResult> => {
  mkdirSync(dirname(wavPath), { recursive: true });
  try {
    await callFf("ffmpeg", [
      ...QUIET,
      "-i",
      sourcePath,
      "-vn",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      wavPath,
    ]);
  } catch (error) {
    rmSync(wavPath, { force: true });
    return { ok: false, reason: reasonOf(error) };
  }
  if (!existsSync(wavPath) || !isPcmWav(readFileSync(wavPath))) {
    rmSync(wavPath, { force: true });
    return { ok: false, reason: "tidak punya jalur audio" };
  }
  return { ok: true };
};

/**
 * Salin video apa adanya, geser audionya `gainDb`, tulis ke `outputPath`
 * (ADR-0028 §9: koreksi campuran akhir). Video TIDAK dienkode ulang — hanya
 * jalur audio yang lewat `volume`, jadi biayanya sedetik-dua untuk video
 * berapa pun panjangnya, dan piksel hasil render tidak berubah sebit pun.
 */
export const applyGain = async (
  sourcePath: string,
  outputPath: string,
  gainDb: number,
  audio: { codec: "aac" | "pcm_s16le"; bitrate?: string },
): Promise<AudioProbeResult> => {
  const quickTime = /\.(mp4|m4v|mov)$/i.test(outputPath);
  try {
    await callFf("ffmpeg", [
      ...QUIET,
      "-i",
      sourcePath,
      "-map",
      "0",
      "-c:v",
      "copy",
      "-af",
      `volume=${gainDb.toFixed(2)}dB`,
      "-c:a",
      audio.codec,
      ...(audio.bitrate ? ["-b:a", audio.bitrate] : []),
      ...(quickTime ? ["-movflags", "+faststart"] : []),
      outputPath,
    ]);
    return { ok: true };
  } catch (error) {
    rmSync(outputPath, { force: true });
    return { ok: false, reason: reasonOf(error) };
  }
};

const decodeMonoPcm = async (
  sourcePath: string,
  sampleRate: number,
): Promise<Int16Array | null> => {
  const scratch = mkdtempSync(join(tmpdir(), "dalang-pcm-"));
  const wavPath = join(scratch, "mono.wav");
  try {
    await callFf("ffmpeg", [
      ...QUIET,
      "-i",
      sourcePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      wavPath,
    ]);
    const decoded = decodeWav(readFileSync(wavPath));
    const channel = decoded.channels[0];
    if (!channel) return null;
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      pcm[i] = Math.round(Math.max(-1, Math.min(1, channel[i] ?? 0)) * 32767);
    }
    return pcm;
  } catch {
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

/** Transkoder di atas ffmpeg bawaan Remotion — tanpa state, aman dipakai bersama. */
export const remotionTranscoder = (): MediaTranscoder => ({
  id: "ffmpeg-remotion",
  probe,
  makeProxy,
  extractFrame,
  toWav,
  decodeMonoPcm,
});

/**
 * Kenyaringan terintegrasi sebuah berkas media apa pun yang ffmpeg bisa dekode
 * — dipakai untuk mengukur CAMPURAN AKHIR hasil render (ADR-0028 mencabut batas
 * "campuran akhirnya tidak diukur" milik ADR-0026). null = tidak terukur.
 */
export const measureMediaLoudness = async (
  sourcePath: string,
): Promise<LoudnessResult | null> => {
  const scratch = mkdtempSync(join(tmpdir(), "dalang-mix-"));
  try {
    const wavPath = join(scratch, "mix.wav");
    const decoded = await toWav(sourcePath, wavPath);
    if (!decoded.ok) return null;
    return measureWavLoudness(readFileSync(wavPath));
  } catch {
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
