import {
  computeTimeline,
  critiquePlan,
  primaryClip,
  recipeFor,
  type ScenePlan,
} from "@dalang/core";

/**
 * Penilaian plan untuk suite eval agent (ADR-0022 §7.4).
 *
 * Kenapa ini ada. Sampai fase ini tidak ada cara mengukur apakah perubahan
 * prompt atau pergantian model membuat keluaran agent LEBIH BAIK atau lebih
 * buruk — yang ada hanya kesan setelah membaca beberapa hasil. Suite eval
 * mengubahnya jadi angka yang bisa dibandingkan antar-jalan.
 *
 * BATAS YANG HARUS DINYATAKAN, dan tidak boleh dilupakan saat membaca skornya:
 * penilai ini deterministik, jadi ia mengukur KEPATUHAN dan KERAJINAN, bukan
 * apakah naskahnya menarik. Plan yang membosankan tapi rapi bisa mendapat 100.
 * Skor ini berguna untuk menangkap kemunduran, bukan untuk memutuskan bahwa
 * sebuah video bagus.
 */

export interface PlanExpectation {
  /** Rasio yang diminta brief; dilewati kalau tidak disebut. */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Format konten yang diharapkan disimpulkan agent dari brief. */
  format?: string;
  /** Durasi target detik; toleransi 30% karena "auto" ikut bicara. */
  targetSec?: number;
  language?: string;
  /** Kata yang HARUS muncul di suatu tempat di naskah (topik dipahami). */
  mustMention?: string[];
}

export interface ScoreCheck {
  name: string;
  /** Bobot poin bila lulus. */
  weight: number;
  passed: boolean;
  detail: string;
}

export interface PlanScore {
  /** 0-100. */
  score: number;
  checks: ScoreCheck[];
  /** Catatan sutradara level "perhatian" yang tersisa — makin sedikit makin baik. */
  perhatian: number;
  saran: number;
}

const norm = (text: string): string => text.toLowerCase();

/**
 * Nilai plan terhadap brief-nya.
 *
 * Bobotnya bukan selera: kepatuhan pada permintaan eksplisit user (rasio,
 * bahasa, durasi) diberi bobot lebih besar daripada kerajinan, karena
 * mengabaikan permintaan yang jelas adalah kegagalan yang berbeda kelas dari
 * transisi yang monoton.
 */
export const scorePlan = (
  plan: ScenePlan,
  expectation: PlanExpectation = {},
): PlanScore => {
  const checks: ScoreCheck[] = [];
  const recipe = recipeFor(plan.meta.format);
  const timeline = computeTimeline(plan);
  const notes = critiquePlan(plan);
  const perhatian = notes.filter((note) => note.level === "perhatian").length;
  const saran = notes.filter((note) => note.level === "saran").length;

  // -- kepatuhan brief -------------------------------------------------------

  if (expectation.aspectRatio) {
    checks.push({
      name: "rasio sesuai brief",
      weight: 12,
      passed: plan.meta.aspectRatio === expectation.aspectRatio,
      detail: `diminta ${expectation.aspectRatio}, dapat ${plan.meta.aspectRatio}`,
    });
  }
  if (expectation.language) {
    checks.push({
      name: "bahasa sesuai brief",
      weight: 8,
      passed: plan.meta.language === expectation.language,
      detail: `diminta ${expectation.language}, dapat ${plan.meta.language}`,
    });
  }
  if (expectation.format) {
    checks.push({
      name: "format disimpulkan benar",
      weight: 12,
      passed: plan.meta.format === expectation.format,
      detail: `diharapkan ${expectation.format}, dapat ${plan.meta.format}`,
    });
  }
  if (expectation.targetSec !== undefined) {
    // Toleransi 30%: durasi "auto" ditentukan panjang narasi, jadi menuntut
    // ketepatan detik berarti menghukum plan yang benar.
    const low = expectation.targetSec * 0.7;
    const high = expectation.targetSec * 1.3;
    checks.push({
      name: "durasi mendekati target",
      weight: 10,
      passed: timeline.totalSec >= low && timeline.totalSec <= high,
      detail: `target ~${expectation.targetSec}s, dapat ${timeline.totalSec.toFixed(1)}s`,
    });
  }
  if (expectation.mustMention && expectation.mustMention.length > 0) {
    const script = norm(
      [plan.meta.title, ...plan.scenes.map((scene) => scene.narration)].join(" "),
    );
    const missing = expectation.mustMention.filter(
      (word) => !script.includes(norm(word)),
    );
    checks.push({
      name: "topik brief tersentuh",
      weight: 12,
      passed: missing.length === 0,
      detail:
        missing.length === 0
          ? "semua kata kunci muncul"
          : `hilang: ${missing.join(", ")}`,
    });
  }

  // -- struktur --------------------------------------------------------------

  const sceneCount = plan.scenes.length;
  checks.push({
    name: "jumlah scene di rentang format",
    weight: 10,
    passed: sceneCount >= recipe.minScenes && sceneCount <= recipe.maxScenes,
    detail: `${sceneCount} scene (${recipe.label}: ${recipe.minScenes}-${recipe.maxScenes})`,
  });

  const bodyNarrated = plan.scenes.filter(
    (scene) => primaryClip(scene).type !== "template-anim",
  );
  const empty = bodyNarrated.filter((scene) => scene.narration.trim() === "").length;
  checks.push({
    name: "scene isi bernarasi",
    weight: 10,
    passed: bodyNarrated.length > 0 && empty === 0,
    detail: empty === 0 ? "semua scene isi punya narasi" : `${empty} scene isi kosong`,
  });

  if (recipe.needsOutro) {
    const last = plan.scenes.at(-1);
    checks.push({
      name: "ada penutup",
      weight: 6,
      passed: last !== undefined && primaryClip(last).variant === "outro",
      detail:
        last !== undefined && primaryClip(last).variant === "outro"
          ? "outro ada"
          : "tidak ada scene outro",
    });
  }

  // -- kerajinan -------------------------------------------------------------

  // Nol "perhatian" = poin penuh; tiap catatan memotong, dengan lantai nol
  // supaya plan yang buruk tidak menghasilkan skor negatif yang tak terbaca.
  const craftWeight = 20;
  const craftEarned = Math.max(0, craftWeight - perhatian * 5 - saran * 1);
  checks.push({
    name: "kritik sutradara bersih",
    weight: craftWeight,
    passed: perhatian === 0,
    detail: `${perhatian} perhatian, ${saran} saran`,
  });

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => {
    if (check.name === "kritik sutradara bersih") return sum + craftEarned;
    return sum + (check.passed ? check.weight : 0);
  }, 0);

  return {
    score: totalWeight === 0 ? 0 : Number(((earned / totalWeight) * 100).toFixed(1)),
    checks,
    perhatian,
    saran,
  };
};

/** Ringkasan satu baris untuk papan skor runner. */
export const formatScoreLine = (name: string, score: PlanScore): string => {
  const failed = score.checks.filter((check) => !check.passed).map((check) => check.name);
  return (
    `  ${name.padEnd(28)} ${String(score.score).padStart(5)}  ` +
    `${score.perhatian} perhatian / ${score.saran} saran` +
    (failed.length > 0 ? `  gagal: ${failed.join(", ")}` : "")
  );
};
