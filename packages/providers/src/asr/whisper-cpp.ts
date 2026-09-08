import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { AsrProvider, AsrResult } from "@dalang/pipeline";
import { z } from "zod";

/**
 * whisper.cpp — jalur ASR OFFLINE (ADR-0021).
 *
 * Setiap kemampuan baru di Dalang masuk lewat port dengan jalur yang berjalan
 * di mesin sendiri; untuk TTS itu `silence`, dan untuk ASR ini.
 *
 * Bedanya dengan `silence`: kalau TTS offline bisa mengarang audio senyap yang
 * jujur (naskahnya sudah diketahui), ASR offline TIDAK BOLEH mengarang apa pun
 * — tidak ada masukan yang bisa dipakai menebak isi rekaman. Maka provider ini
 * hanya ada kalau binari DAN modelnya benar-benar ada di mesin; kalau tidak, ia
 * tidak masuk rantai sama sekali, dan pemakainya mendapat pesan yang menyebut
 * apa yang kurang. Tidak ada transkrip palsu.
 */

const execFileAsync = promisify(execFile);

/** Keluaran `--output-json` whisper.cpp; hanya bagian yang kita pakai. */
const whisperJsonSchema = z.object({
  transcription: z.array(
    z.object({
      // Waktu dalam MILIDETIK pada `offsets`; blok `timestamps` berisi string
      // "00:00:01,234" yang tidak dipakai di sini.
      offsets: z.object({ from: z.number(), to: z.number() }),
      text: z.string(),
      tokens: z
        .array(
          z.object({
            text: z.string(),
            offsets: z.object({ from: z.number(), to: z.number() }),
            p: z.number().optional(),
          }),
        )
        .optional(),
    }),
  ),
  result: z.object({ language: z.string() }).optional(),
});

export interface WhisperCppOptions {
  /** Binari whisper.cpp (`whisper-cli` pada rilis baru, dulu `main`). */
  binPath: string;
  /** Berkas model GGML/GGUF, mis. ggml-base.bin. */
  modelPath: string;
  /** Jumlah thread; bawaan biar whisper.cpp yang menentukan. */
  threads?: number;
  /** Disuntikkan tes: menjalankan binari tanpa benar-benar memanggil proses. */
  runner?: (args: string[]) => Promise<void>;
}

/** Lokasi biasa binari & model, dipakai saat env tidak menyebut apa pun. */
const BIN_CANDIDATES = ["whisper-cli", "whisper-cpp", "main"];
const MODEL_DIRS = [
  join(homedir(), ".cache", "whisper.cpp"),
  join(homedir(), "whisper.cpp", "models"),
  "/usr/local/share/whisper.cpp",
  "/usr/share/whisper.cpp",
];
const MODEL_NAMES = [
  "ggml-large-v3-turbo.bin",
  "ggml-medium.bin",
  "ggml-small.bin",
  "ggml-base.bin",
  "ggml-tiny.bin",
];

const firstExisting = (paths: string[]): string | null =>
  paths.find((path) => existsSync(path)) ?? null;

/** Cari binari di PATH tanpa menjalankan shell. */
const onPath = (name: string): string | null => {
  const dirs = (process.env.PATH ?? "").split(":").filter((dir) => dir !== "");
  return firstExisting(dirs.map((dir) => join(dir, name)));
};

/**
 * Temukan whisper.cpp di mesin ini. `null` = tidak terpasang, dan itu KONDISI
 * NORMAL, bukan galat: rantainya cukup melanjutkan ke provider berikutnya.
 */
export const findWhisperCpp = (
  env: { WHISPER_CPP_BIN?: string; WHISPER_CPP_MODEL?: string } = process.env,
): { binPath: string; modelPath: string } | null => {
  const binPath = env.WHISPER_CPP_BIN
    ? existsSync(env.WHISPER_CPP_BIN)
      ? env.WHISPER_CPP_BIN
      : null
    : firstExisting(BIN_CANDIDATES.map((name) => onPath(name) ?? "").filter(Boolean));
  if (!binPath) return null;

  const modelPath = env.WHISPER_CPP_MODEL
    ? existsSync(env.WHISPER_CPP_MODEL)
      ? env.WHISPER_CPP_MODEL
      : null
    : firstExisting(MODEL_DIRS.flatMap((dir) => MODEL_NAMES.map((n) => join(dir, n))));
  if (!modelPath) return null;

  return { binPath, modelPath };
};

/**
 * Pecah satu segmen jadi kata-kata berwaktu.
 *
 * whisper.cpp memberi waktu per TOKEN, dan tokennya adalah potongan sub-kata:
 * "Borobudur" bisa keluar sebagai "Boro"+"budur". Menyerahkan token apa adanya
 * sebagai "kata" akan membuat caption tercacah dan pencarian frasa gagal, jadi
 * token yang tidak diawali spasi disambungkan ke kata sebelumnya — persis
 * aturan yang dipakai tokenizer-nya untuk menandai batas kata.
 */
export const tokensToWords = (
  tokens: { text: string; offsets: { from: number; to: number }; p?: number }[],
  speaker?: string,
): AsrResult["words"] => {
  const words: AsrResult["words"] = [];
  for (const token of tokens) {
    const raw = token.text;
    // Token khusus whisper ("[_BEG_]", "[_TT_110]") bukan ucapan.
    if (raw.startsWith("[_") || raw.trim() === "") continue;
    const startsWord = raw.startsWith(" ") || words.length === 0;
    const text = raw.trim();
    if (text === "") continue;

    if (startsWord) {
      words.push({
        word: text,
        startSec: Number((token.offsets.from / 1000).toFixed(3)),
        endSec: Number((token.offsets.to / 1000).toFixed(3)),
        ...(token.p !== undefined
          ? { confidence: Math.min(1, Math.max(0, token.p)) }
          : {}),
        ...(speaker !== undefined ? { speaker } : {}),
      });
      continue;
    }
    const last = words.at(-1);
    if (!last) continue;
    last.word += text;
    last.endSec = Number((token.offsets.to / 1000).toFixed(3));
  }
  return words;
};

export const createWhisperCppAsr = ({
  binPath,
  modelPath,
  threads,
  runner,
}: WhisperCppOptions): AsrProvider => ({
  id: "whisper-cpp",
  label: `whisper.cpp (${basename(modelPath)})`,
  offline: true,
  transcribe: async (request) => {
    // `--output-json-full` yang memuat waktu per token; tanpa "full" hanya
    // segmen yang keluar, dan caption per kata jadi mustahil.
    const outBase = `${request.file}.dalang-asr`;
    const args = [
      "-m",
      modelPath,
      "-f",
      request.file,
      "--output-json-full",
      "--output-file",
      outBase,
      "--no-prints",
    ];
    if (request.language !== "") args.push("-l", request.language);
    if (threads !== undefined) args.push("-t", String(threads));

    const jsonPath = `${outBase}.json`;
    try {
      if (runner) {
        await runner(args);
      } else {
        await execFileAsync(binPath, args, { maxBuffer: 64 * 1024 * 1024 });
      }
      if (!existsSync(jsonPath)) {
        throw new Error(`whisper.cpp tidak menulis ${basename(jsonPath)}`);
      }
      const parsed = whisperJsonSchema.parse(JSON.parse(readFileSync(jsonPath, "utf8")));

      const words: AsrResult["words"] = [];
      const segments: AsrResult["segments"] = [];
      for (const segment of parsed.transcription) {
        const text = segment.text.trim();
        if (text !== "") {
          segments.push({
            startSec: Number((segment.offsets.from / 1000).toFixed(3)),
            endSec: Number((segment.offsets.to / 1000).toFixed(3)),
            text,
          });
        }
        words.push(...tokensToWords(segment.tokens ?? []));
      }

      return {
        words,
        segments,
        language: parsed.result?.language ?? request.language ?? "",
        durationSec: segments.at(-1)?.endSec ?? words.at(-1)?.endSec ?? 0,
        // Berjalan di mesin sendiri: tidak ada yang ditagih.
        costUsd: 0,
      };
    } finally {
      rmSync(jsonPath, { force: true });
    }
  },
});
