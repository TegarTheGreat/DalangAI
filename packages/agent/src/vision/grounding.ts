import { Jimp } from "jimp";

/**
 * Grounding elemen UI (PRD §9): model vision mengembalikan bounding box
 * ternormalisasi; sebelum dipakai, crop area itu dikirim balik untuk
 * KONFIRMASI — mencegah zoom ke tempat yang salah. Bagian parse & crop di
 * sini murni dan diuji unit; panggilan modelnya ada di tool.
 */

export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Ekstrak rect ternormalisasi dari jawaban model. Menerima JSON murni,
 * JSON di tengah prosa, dan nilai persen (0–100 dinormalisasi bila ada
 * komponen > 1). Mengembalikan null bila tidak ada rect yang masuk akal.
 */
export const parseBbox = (text: string): NormalizedRect | null => {
  const match = text.match(/\{[^{}]*"x"[^{}]*\}/s);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const numbers = ["x", "y", "w", "h"].map((key) => record[key]);
  if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }
  let [x, y, w, h] = numbers as [number, number, number, number];
  if (x > 1 || y > 1 || w > 1 || h > 1) {
    x /= 100;
    y /= 100;
    w /= 100;
    h /= 100;
  }
  if (w <= 0 || h <= 0) return null;
  const rect = {
    x: clamp01(x),
    y: clamp01(y),
    w: clamp01(w),
    h: clamp01(h),
  };
  if (rect.x + rect.w > 1) rect.w = 1 - rect.x;
  if (rect.y + rect.h > 1) rect.h = 1 - rect.y;
  if (rect.w <= 0.001 || rect.h <= 0.001) return null;
  return rect;
};

/**
 * Crop area rect (ternormalisasi) dari byte gambar → PNG. Rect dilonggarkan
 * sedikit (padding 2% sisi terpendek) supaya konteks tepi ikut terlihat
 * saat konfirmasi; ukuran minimum 8px agar crop selalu valid.
 */
export const cropImage = async (
  bytes: Uint8Array,
  rect: NormalizedRect,
): Promise<{ png: Uint8Array; width: number; height: number }> => {
  const image = await Jimp.fromBuffer(Buffer.from(bytes));
  const pad = 0.02;
  const x0 = clamp01(rect.x - pad) * image.width;
  const y0 = clamp01(rect.y - pad) * image.height;
  const x1 = clamp01(rect.x + rect.w + pad) * image.width;
  const y1 = clamp01(rect.y + rect.h + pad) * image.height;
  const w = Math.max(8, Math.round(x1 - x0));
  const h = Math.max(8, Math.round(y1 - y0));
  const x = Math.min(Math.round(x0), Math.max(0, image.width - w));
  const y = Math.min(Math.round(y0), Math.max(0, image.height - h));
  image.crop({ x, y, w: Math.min(w, image.width - x), h: Math.min(h, image.height - y) });
  const png = await image.getBuffer("image/png");
  return { png: new Uint8Array(png), width: image.width, height: image.height };
};

/** Prompt langkah 1: minta bbox JSON ketat. */
export const locatePrompt = (description: string): string =>
  [
    `Temukan elemen UI berikut pada screenshot: "${description}".`,
    'Jawab HANYA dengan JSON persis berformat {"x":0.00,"y":0.00,"w":0.00,"h":0.00}',
    "— koordinat ternormalisasi 0–1 relatif ke seluruh gambar (x,y = pojok kiri-atas).",
    "Buat kotak sekecil mungkin yang masih mencakup elemennya. Tanpa teks lain.",
  ].join("\n");

/** Prompt langkah 2 (verifikasi grounding). */
export const verifyPrompt = (description: string): string =>
  `Apakah potongan gambar ini menunjukkan "${description}"? Jawab persis satu kata: YA atau TIDAK.`;

export const parseVerification = (text: string): boolean => /^\s*ya\b/i.test(text.trim());
