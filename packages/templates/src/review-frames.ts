import type { Scene, ScenePlan } from "@dalang/core";
import { computeFrameLayout, FPS } from "./layout";

/**
 * Pemilihan frame untuk tinjauan render (ADR-0022).
 *
 * Agent tidak bisa menonton seluruh video — tiap frame yang dilihat model
 * vision berbiaya. Maka pertanyaannya bukan "berapa frame", melainkan "frame
 * MANA yang paling mungkin memperlihatkan kesalahan".
 *
 * Jawabannya dua lapis:
 *
 *  1. Di DALAM scene, ambil momen paling ramai — saat paling banyak teks dan
 *     grafis tampil bersamaan. Di situlah tabrakan tata letak terjadi; frame
 *     kosong di detik pertama tidak memberi tahu apa pun. Overlay punya
 *     jendela startFrac/endFrac, jadi momen ini bisa dihitung, bukan ditebak.
 *  2. Antar scene, dahulukan yang paling berisiko: scene pembuka (kesan
 *     pertama menentukan apakah ada yang menonton sampai habis), scene
 *     penutup, lalu yang paling banyak elemennya.
 *
 * Murni: tidak merender apa pun, tidak menyentuh berkas.
 */

export interface ReviewFrame {
  /** Nomor frame di komposisi utuh — siap dipakai renderPlanStills. */
  frame: number;
  sceneId: string;
  /** Urutan scene, 1-based; dipakai di prompt supaya model bisa menyebutnya. */
  sceneNumber: number;
  /** Kenapa frame INI dipilih — ikut masuk prompt vision sebagai konteks. */
  reason: string;
}

/** Elemen yang terlihat pada fraksi tertentu dari durasi scene. */
const visibleAt = (scene: Scene, frac: number): number => {
  const texts = scene.texts.filter(
    (text) => frac >= text.startFrac && frac <= text.endFrac,
  ).length;
  const graphics = scene.graphics.filter(
    (graphic) => frac >= graphic.startFrac && frac <= graphic.endFrac,
  ).length;
  return texts + graphics;
};

/**
 * Fraksi durasi scene yang paling ramai.
 *
 * Digrid halus, bukan diturunkan analitis: jendela overlay bisa saling
 * bertumpuk dengan pola apa pun, dan grid 0,05 sudah cukup halus untuk video
 * berdurasi detik sambil tetap bisa dibaca orang yang membaca kodenya. Seri
 * dimenangkan yang paling dekat ke tengah — di situ gerak kamera sudah
 * settle, jadi framenya mewakili tampilan scene, bukan tampilan transisinya.
 */
export const busiestFrac = (scene: Scene): number => {
  let best = 0.5;
  let bestCount = visibleAt(scene, 0.5);
  for (let frac = 0.05; frac <= 0.95001; frac += 0.05) {
    const rounded = Number(frac.toFixed(2));
    const count = visibleAt(scene, rounded);
    if (
      count > bestCount ||
      (count === bestCount && Math.abs(rounded - 0.5) < Math.abs(best - 0.5))
    ) {
      best = rounded;
      bestCount = count;
    }
  }
  return best;
};

/**
 * Skor risiko scene — makin tinggi makin layak dilihat lebih dulu.
 *
 * Pembuka dan penutup dapat bobot tetap karena keduanya selalu penting
 * terlepas dari isinya; sisanya diperingkat oleh banyaknya elemen yang bisa
 * bertabrakan.
 */
export const reviewPriority = (
  scene: Scene,
  index: number,
  total: number,
): { score: number; reason: string } => {
  const overlays = scene.texts.length + scene.graphics.length;
  const annotations = scene.annotations.length;

  if (index === 0) {
    return {
      score: 100 + overlays,
      reason: "scene pembuka — kesan pertama menentukan apakah video ditonton terus",
    };
  }
  if (index === total - 1 && total > 1) {
    return { score: 90 + overlays, reason: "scene penutup" };
  }
  if (overlays + annotations > 0) {
    const bagian = [
      scene.texts.length > 0 ? `${scene.texts.length} teks` : null,
      scene.graphics.length > 0 ? `${scene.graphics.length} grafis` : null,
      annotations > 0 ? `${annotations} anotasi` : null,
    ].filter((part) => part !== null);
    return {
      score: 10 * overlays + 5 * annotations,
      reason: `paling ramai: ${bagian.join(" + ")}`,
    };
  }
  return { score: 1, reason: "scene tanpa overlay — dicek untuk tampilan dasar" };
};

/**
 * Frame yang perlu ditinjau, urut menurut waktu.
 *
 * `max` sengaja kecil dan berbayar: tiap frame adalah satu gambar yang dikirim
 * ke model vision.
 */
export const pickReviewFrames = (
  plan: ScenePlan,
  { max = 6 }: { max?: number } = {},
): ReviewFrame[] => {
  const layout = computeFrameLayout(plan);
  const total = plan.scenes.length;

  const ranked = plan.scenes
    .map((scene, index) => ({ scene, index, ...reviewPriority(scene, index, total) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, max));

  return ranked
    .sort((a, b) => a.index - b.index)
    .map(({ scene, index, reason }) => {
      const start = layout.sceneStarts[index] ?? 0;
      const frames = layout.sceneFrames[index] ?? FPS;
      const frac = busiestFrac(scene);
      // Dijepit ke dalam scene: frame terakhir milik scene BERIKUTNYA kalau
      // transisinya menindih, dan menilai frame tetangga sebagai frame scene
      // ini akan membuat temuannya menuding scene yang salah.
      const frame = Math.min(start + Math.round(frames * frac), start + frames - 1);
      return {
        frame: Math.max(0, frame),
        sceneId: scene.id,
        sceneNumber: index + 1,
        reason,
      };
    });
};
