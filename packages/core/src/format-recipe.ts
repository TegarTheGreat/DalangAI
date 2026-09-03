import { primaryClip, type ScenePlan } from "./scene-plan";

/**
 * ADR-0017: RESEP per format konten — kerangka yang bisa DIPERIKSA MESIN,
 * bukan nasihat di prompt yang bisa diabaikan model.
 *
 * Kenapa ini ada: agent yang hanya diberi persona umum ("kamu editor video")
 * menghasilkan struktur yang seragam untuk semua jenis konten — tutorial
 * terasa seperti esai, klip terasa seperti dokumenter. Resep memberi tiap
 * format kerangka beat, rentang durasi, dan aturan yang bisa dicek, sehingga
 * kritik otomatis (critiquePlan) bisa menegur penyimpangan secara konkret.
 *
 * Angka di sini adalah keputusan produk yang dikalibrasi agar terasa wajar,
 * bukan hasil pengukuran ilmiah — nilainya bukan pada presisinya melainkan
 * pada adanya batas yang memaksa pilihan.
 */

export const CONTENT_FORMATS = [
  "bebas",
  "edukasi",
  "tutorial",
  "klip",
  "berita",
  "cerita",
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export interface FormatRecipe {
  format: ContentFormat;
  label: string;
  /** Ringkasan kerangka untuk system prompt agent. */
  kerangka: string;
  /** Beat berurutan yang diharapkan; jadi panduan penulisan, bukan paksaan. */
  beats: readonly string[];
  minScenes: number;
  maxScenes: number;
  /** Rentang durasi total yang wajar (detik). */
  minTotalSec: number;
  maxTotalSec: number;
  /** Rentang kata narasi per scene isi. */
  minWordsPerScene: number;
  maxWordsPerScene: number;
  /** Butuh scene pembuka template-anim "title". */
  needsTitle: boolean;
  /** Butuh scene penutup template-anim "outro". */
  needsOutro: boolean;
  /** Butuh teks overlay penahan di scene isi pertama (hook terlihat). */
  needsHookText: boolean;
}

const RECIPES: Record<ContentFormat, FormatRecipe> = {
  bebas: {
    format: "bebas",
    label: "Bebas",
    kerangka: "Tanpa kerangka baku — struktur mengikuti maksud user.",
    beats: [],
    minScenes: 2,
    maxScenes: 40,
    minTotalSec: 5,
    maxTotalSec: 900,
    minWordsPerScene: 0,
    maxWordsPerScene: 60,
    needsTitle: false,
    // Saran outro berlaku umum (perilaku sejak ADR-0014); hanya format yang
    // memang tidak memakainya — mis. "klip" — yang mematikannya.
    needsOutro: true,
    needsHookText: false,
  },
  edukasi: {
    format: "edukasi",
    label: "Edukasi / video esai",
    kerangka:
      "Hook (klaim atau pertanyaan tajam) - pertanyaan inti - konteks - bukti/mekanisme - implikasi - penutup yang menutup lingkaran ke hook.",
    beats: ["hook", "pertanyaan", "konteks", "bukti", "implikasi", "penutup"],
    minScenes: 6,
    maxScenes: 14,
    minTotalSec: 45,
    maxTotalSec: 420,
    minWordsPerScene: 10,
    maxWordsPerScene: 28,
    needsTitle: true,
    needsOutro: true,
    needsHookText: true,
  },
  tutorial: {
    format: "tutorial",
    label: "Tutorial / how-to",
    kerangka:
      "Pembuka (hasil akhir dulu, supaya orang tahu ini layak diikuti) - prasyarat - langkah bernomor satu aksi per scene - hasil - tips/jebakan.",
    beats: ["pembuka", "prasyarat", "langkah", "hasil", "tips"],
    minScenes: 4,
    maxScenes: 20,
    minTotalSec: 30,
    maxTotalSec: 600,
    minWordsPerScene: 6,
    maxWordsPerScene: 24,
    needsTitle: true,
    needsOutro: true,
    needsHookText: false,
  },
  klip: {
    format: "klip",
    label: "Klip pendek",
    kerangka:
      "Hook di 3 detik pertama - klaim - bukti/cerita singkat - punchline. Tanpa basa-basi pembuka; potongan harus utuh secara makna.",
    beats: ["hook", "klaim", "bukti", "punchline"],
    minScenes: 2,
    maxScenes: 8,
    minTotalSec: 12,
    maxTotalSec: 90,
    minWordsPerScene: 8,
    maxWordsPerScene: 32,
    needsTitle: false,
    needsOutro: false,
    needsHookText: true,
  },
  berita: {
    format: "berita",
    label: "Berita / analisis singkat",
    kerangka:
      "Lead (apa yang terjadi, satu kalimat) - konteks - dampak - apa yang perlu diperhatikan berikutnya.",
    beats: ["lead", "konteks", "dampak", "lanjutan"],
    minScenes: 4,
    maxScenes: 10,
    minTotalSec: 30,
    maxTotalSec: 240,
    minWordsPerScene: 12,
    maxWordsPerScene: 30,
    needsTitle: true,
    needsOutro: false,
    needsHookText: true,
  },
  cerita: {
    format: "cerita",
    label: "Naratif / cerita",
    kerangka:
      "Setup (dunia & tokoh) - pemicu - konflik menanjak - titik balik - resolusi. Tempo dibawa gambar, narasi menahan diri.",
    beats: ["setup", "pemicu", "konflik", "titik balik", "resolusi"],
    minScenes: 5,
    maxScenes: 16,
    minTotalSec: 40,
    maxTotalSec: 480,
    minWordsPerScene: 8,
    maxWordsPerScene: 26,
    needsTitle: true,
    needsOutro: true,
    needsHookText: false,
  },
};

export const recipeFor = (format: string | undefined): FormatRecipe =>
  RECIPES[(format ?? "bebas") as ContentFormat] ?? RECIPES.bebas;

/** Semua resep, untuk menyusun dokumentasi/prompt. */
export const allRecipes = (): readonly FormatRecipe[] => Object.values(RECIPES);

/** Ringkasan satu baris per format untuk system prompt agent. */
export const formatBriefLines = (): string[] =>
  allRecipes()
    .filter((recipe) => recipe.format !== "bebas")
    .map(
      (recipe) =>
        `- ${recipe.format} (${recipe.label}): ${recipe.kerangka} ` +
        `Sasaran ${recipe.minScenes}-${recipe.maxScenes} scene, ` +
        `${recipe.minTotalSec}-${recipe.maxTotalSec} detik, ` +
        `${recipe.minWordsPerScene}-${recipe.maxWordsPerScene} kata narasi per scene isi.`,
    );

/** Scene isi = bukan kartu template (title/outro). */
export const isBodyScene = (scene: ScenePlan["scenes"][number]): boolean =>
  primaryClip(scene).type !== "template-anim";
