import { z } from "zod";

/**
 * Penguraian temuan tinjauan render (ADR-0022).
 *
 * Dipisah dari toolnya supaya bisa diuji tanpa model — dan karena inilah
 * bagian yang paling mungkin patah: model menjawab teks bebas, dan jawaban
 * yang "hampir JSON" adalah keadaan normal, bukan pengecualian.
 *
 * Prinsipnya: TOLERAN pada bungkusnya, KETAT pada isinya. Pagar kode, blok
 * penjelasan sebelum/sesudah, dan trailing comma dimaafkan; entri yang
 * kehilangan field wajib dibuang dan dilaporkan, bukan diloloskan dengan nilai
 * karangan yang akan menuding scene yang salah.
 */

export const findingSchema = z.object({
  /** Nomor scene 1-based; 0/tidak ada = temuan menyeluruh, bukan per scene. */
  scene: z.number().int().min(0).optional(),
  level: z.enum(["perhatian", "saran"]).default("saran"),
  masalah: z.string().min(1),
  saran: z.string().default(""),
});
export type ReviewFinding = z.infer<typeof findingSchema>;

export interface ParsedReview {
  findings: ReviewFinding[];
  /** Entri yang dibuang karena bentuknya tidak sah — dilaporkan, tidak disembunyikan. */
  dropped: number;
  /** True kalau tidak ada blok JSON sama sekali. */
  unparsed: boolean;
}

/** Cari blok array JSON terluar, walaupun dibungkus pagar kode atau prosa. */
const extractArray = (text: string): string | null => {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

export const parseReviewFindings = (text: string): ParsedReview => {
  const block = extractArray(text);
  if (block === null) return { findings: [], dropped: 0, unparsed: true };

  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch {
    // Trailing comma adalah kesalahan paling sering model, dan satu-satunya
    // yang aman diperbaiki tanpa menebak maksudnya.
    try {
      raw = JSON.parse(block.replace(/,(\s*[\]}])/g, "$1"));
    } catch {
      return { findings: [], dropped: 0, unparsed: true };
    }
  }
  if (!Array.isArray(raw)) return { findings: [], dropped: 0, unparsed: true };

  const findings: ReviewFinding[] = [];
  let dropped = 0;
  for (const entry of raw) {
    const parsed = findingSchema.safeParse(entry);
    if (parsed.success) findings.push(parsed.data);
    else dropped += 1;
  }
  return { findings, dropped, unparsed: false };
};

/**
 * Prompt tinjauan. Dipisah supaya bisa dibaca dan diubah tanpa membuka tool,
 * dan supaya tesnya bisa memastikan hal-hal yang WAJIB ada di dalamnya.
 *
 * Dua aturan di dalamnya yang bukan hiasan:
 *  - "jangan melaporkan yang tidak terlihat di gambar" — model vision sangat
 *    mudah diajak berhalusinasi soal audio, durasi, dan transisi yang tidak
 *    bisa dilihat dari satu frame diam;
 *  - "sebutkan nomor scene" — tanpa itu temuannya tidak bisa ditindaklanjuti
 *    lewat patch op, dan cuma jadi paragraf enak dibaca yang tak mengubah apa
 *    pun.
 */
export const reviewPrompt = (
  frames: { sceneNumber: number; sceneId: string; reason: string }[],
  extra?: string,
): string =>
  [
    "Kamu pengarah gambar yang menilai FRAME HASIL RENDER video pendek berbahasa Indonesia.",
    "",
    "Frame yang dikirim, berurutan:",
    ...frames.map(
      (frame, index) =>
        `  gambar ${index + 1} = scene ${frame.sceneNumber} (${frame.sceneId}) — dipilih karena ${frame.reason}`,
    ),
    "",
    "Nilai HANYA yang benar-benar TERLIHAT di gambar:",
    "  - teks terpotong, tertimpa, terlalu kecil, atau kontrasnya kurang terhadap latar",
    "  - elemen bertabrakan atau keluar dari bingkai aman",
    "  - komposisi: subjek terpotong janggal, ruang kosong yang tidak disengaja",
    "  - keterbacaan caption di atas footage ramai",
    "  - kesan menyeluruh: apakah tampak dikerjakan atau tampak template",
    "",
    "JANGAN melaporkan hal yang tidak bisa dilihat dari frame diam: audio, musik,",
    "durasi, kecepatan transisi, atau isi scene yang framenya tidak dikirim.",
    "Kalau sebuah gambar tidak bermasalah, jangan mengarang temuan untuknya.",
    ...(extra ? ["", `Perhatian khusus dari user: ${extra}`] : []),
    "",
    "Jawab HANYA dengan array JSON, tanpa kalimat pembuka:",
    '[{"scene": 2, "level": "perhatian", "masalah": "...", "saran": "..."}]',
    'level = "perhatian" untuk yang merusak keterbacaan/kesan, "saran" untuk pemolesan.',
    "Array kosong [] kalau semuanya sudah baik.",
  ].join("\n");
