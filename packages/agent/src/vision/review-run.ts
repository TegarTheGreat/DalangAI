import { readFileSync } from "node:fs";
import { critiquePlan, type DirectorNote, type ScenePlan } from "@dalang/core";
import { pickReviewFrames, type ReviewFrame } from "@dalang/templates/review-frames";
import { generateText } from "ai";
import { estimateLlmCostUsd } from "../models/registry";
import type { ResolvedModel } from "../models/resolve";
import { parseReviewFindings, type ReviewFinding, reviewPrompt } from "./review";

/**
 * Menjalankan satu tinjauan render (ADR-0022) — dipakai BERTIGA: tool agent,
 * rute Studio, dan perintah CLI.
 *
 * Diekstrak sebelum pemakai keduanya ada, bukan sesudah: jalur "pilih frame ->
 * render still -> satu panggilan vision multi-gambar -> urai temuan" punya
 * beberapa detail yang mudah menyimpang kalau disalin (pemetaan nomor scene ke
 * id, geseran waktu, perlakuan jawaban tak terurai). Tiga salinan yang perlahan
 * berbeda jauh lebih mahal daripada satu fungsi dengan tiga pemanggil.
 */

/**
 * Perkiraan token per gambar tinjauan, untuk GERBANG BIAYA saja.
 *
 * Angkanya kasar dan disengaja: model vision menghitung gambar dengan cara
 * yang berbeda-beda, dan tidak ada satu angka yang benar untuk semuanya.
 * Dipakai hanya untuk memutuskan apakah perlu minta izin dan apakah anggaran
 * proyek masih cukup — TIDAK PERNAH untuk penagihan. Biaya sebenarnya dicatat
 * dari `usage` yang dikembalikan model, setelah panggilannya jadi.
 *
 * Sengaja dilebihkan: gerbang biaya yang terlalu optimistis lebih berbahaya
 * daripada yang terlalu hati-hati (pola yang sama dengan estimasi pra-render
 * di ADR-0019).
 */
export const ESTIMATED_TOKENS_PER_REVIEW_IMAGE = 1600;
/** Perkiraan token teks prompt + jawaban satu tinjauan. */
export const ESTIMATED_TOKENS_PER_REVIEW_TEXT = 1200;

/** Perkiraan biaya SEBELUM memanggil model; null = harga model tak diketahui. */
export const estimateReviewUsd = (
  model: ResolvedModel,
  frameCount: number,
): number | null =>
  estimateLlmCostUsd(model.info, {
    inputTokens:
      frameCount * ESTIMATED_TOKENS_PER_REVIEW_IMAGE + ESTIMATED_TOKENS_PER_REVIEW_TEXT,
    outputTokens: 600,
  });

/** Temuan gambar yang sudah tertaut ke id scene — siap dipakai applyPatch. */
export interface LinkedFinding extends ReviewFinding {
  sceneId?: string;
}

export interface RenderReviewResult {
  frames: ReviewFrame[];
  /** Berkas still yang dirender; berguna untuk UI dan penelusuran. */
  files: string[];
  findings: LinkedFinding[];
  /** Kritik struktur dari plan — sudut yang tidak bisa dilihat dari gambar. */
  structural: DirectorNote[];
  /**
   * True = model tidak menjawab dalam bentuk yang bisa diurai. BUKAN berarti
   * gambarnya bersih, dan pemanggilnya WAJIB membedakan keduanya.
   */
  unparsed: boolean;
  /** Entri yang dibuang karena bentuknya tidak sah. */
  dropped: number;
  usage: { inputTokens?: number; outputTokens?: number };
}

export interface RenderReviewOptions {
  plan: ScenePlan;
  planPath: string;
  /** Folder tujuan still tinjauan. */
  outDir: string;
  /** Model vision; pemanggil yang memastikan ia menerima gambar. */
  model: ResolvedModel;
  renderStills: (options: {
    planPath: string;
    frames: number[];
    outDir: string;
    scale: number;
  }) => Promise<string[]>;
  maxFrames?: number;
  /** Perhatian khusus dari user, disisipkan ke prompt. */
  extra?: string;
}

export const runRenderReview = async ({
  plan,
  planPath,
  outDir,
  model,
  renderStills,
  maxFrames = 4,
  extra,
}: RenderReviewOptions): Promise<RenderReviewResult> => {
  const frames = pickReviewFrames(plan, { max: maxFrames });
  const files = await renderStills({
    planPath,
    frames: frames.map((item) => item.frame),
    outDir,
    // Seperempat ukuran: cukup untuk menilai tata letak dan keterbacaan, jauh
    // lebih murah dikirim ke model.
    scale: 0.25,
  });

  const images = files.map((file) => readFileSync(file));
  const result = await generateText({
    model: model.model,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((bytes) => ({
            type: "file" as const,
            data: bytes,
            mediaType: "image/png",
          })),
          { type: "text" as const, text: reviewPrompt(frames, extra) },
        ],
      },
    ],
  });

  const parsed = parseReviewFindings(result.text);
  // Nomor scene dari model dipetakan balik ke id: temuan tanpa id tidak bisa
  // ditindaklanjuti lewat patch op, dan nomornya bisa saja meleset.
  const byNumber = new Map(plan.scenes.map((scene, index) => [index + 1, scene.id]));
  const findings: LinkedFinding[] = parsed.findings.map((finding) => ({
    ...finding,
    ...(finding.scene !== undefined && byNumber.has(finding.scene)
      ? { sceneId: byNumber.get(finding.scene) as string }
      : {}),
  }));

  return {
    frames,
    files,
    findings,
    structural: critiquePlan(plan),
    unparsed: parsed.unparsed,
    dropped: parsed.dropped,
    usage: result.totalUsage,
  };
};

/** Pesan baku saat tidak ada model vision — dipakai ketiga permukaan. */
export const NO_VISION_MODEL =
  "Model vision tidak tersedia — tinjauan render butuh model tier-volume yang menerima gambar.";

/** Pesan baku saat jawaban model tidak bisa diurai. */
export const UNPARSED_WARNING =
  "Model vision tidak menjawab dalam bentuk yang bisa diurai — TIDAK ADA temuan gambar yang sah. Jangan menganggap ini berarti gambarnya bersih.";
