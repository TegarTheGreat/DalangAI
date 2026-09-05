import {
  type Clip,
  DIMENSIONS,
  primaryClip,
  type Scene,
  type ScenePlan,
} from "@dalang/core";
import {
  clipFrameSpans,
  computeFrameLayout,
  FPS,
  sceneSettledFrame,
} from "@dalang/templates/layout";

/**
 * Metadata Player diturunkan dari plan — logika yang SAMA dengan
 * calculateDalangMetadata renderer (templates/layout), jadi preview dan
 * render tak pernah beda durasi/dimensi.
 */

export interface PlanMeta {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  sceneStarts: number[];
  /**
   * Frame pertama tiap scene tampil UTUH (transisi masuk selesai). Ke sinilah
   * klik klip melompat: pada `sceneStarts` scene sebelumnya masih menutupi
   * dan renderer pun masih menganggapnya yang aktif.
   */
  sceneSettledStarts: number[];
  sceneFrames: number[];
  totalSec: number;
}

export const planMeta = (plan: ScenePlan): PlanMeta => {
  const layout = computeFrameLayout(plan);
  const { width, height } = DIMENSIONS[plan.meta.aspectRatio];
  return {
    durationInFrames: layout.totalFrames,
    fps: FPS,
    width,
    height,
    sceneStarts: layout.sceneStarts,
    sceneSettledStarts: layout.sceneStarts.map((_, index) =>
      sceneSettledFrame(layout, index),
    ),
    sceneFrames: layout.sceneFrames,
    totalSec: layout.totalFrames / FPS,
  };
};

/** Frame perwakilan sebuah scene untuk thumbnail (lewati transisi masuk). */
export const sceneThumbFrame = (meta: PlanMeta, index: number): number => {
  const start = meta.sceneStarts[index] ?? 0;
  const frames = meta.sceneFrames[index] ?? 1;
  return start + Math.min(24, Math.max(0, Math.floor(frames / 2)));
};

/**
 * Frame GLOBAL di TENGAH sebuah potongan (ADR-0033).
 *
 * Ke sinilah preview melompat saat potongan dipilih di panel Properti. Tengah,
 * bukan awal: awal potongan pertama masih ditutupi transisi masuk scene, dan
 * awal potongan lain jatuh tepat di titik larut kalau ada — dua tempat yang
 * justru paling tidak mewakili isi potongannya. Menyetel gerak kamera sambil
 * menatap potongan yang salah adalah cara termudah menghabiskan sepuluh menit
 * untuk perubahan yang tidak pernah terlihat.
 *
 * Petaknya dihitung `clipFrameSpans` milik renderer, sama seperti yang dipakai
 * ClipStrip saat merender — bukan pembagian rata sendiri, yang akan meleset
 * begitu durasi potongannya tidak sama panjang.
 */
export const clipMidFrame = (
  meta: PlanMeta,
  plan: ScenePlan,
  sceneId: string,
  clipId: string,
): number | null => {
  const index = plan.scenes.findIndex((scene) => scene.id === sceneId);
  const scene = plan.scenes[index];
  if (!scene) return null;
  const span = clipFrameSpans(scene, meta.sceneFrames[index] ?? 1).find(
    (candidate) => candidate.id === clipId,
  );
  if (!span) return null;
  return Math.min(
    Math.max(meta.durationInFrames - 1, 0),
    (meta.sceneStarts[index] ?? 0) + span.startFrame + Math.floor(span.frames / 2),
  );
};

/**
 * Potongan yang sedang disunting di panel Properti (ADR-0033).
 *
 * Hidup di sini, bukan diulang di tiap tab: tab Visual dan tab Audio harus
 * menyasar potongan yang SAMA, dan dua salinan aturan "pilihan, kalau tidak
 * ada yang pertama" adalah dua tempat yang bisa menyimpang — persis kelas
 * cacat yang membuat orang mengira setelannya tidak tersimpan, karena satu tab
 * menyetel potongan lain daripada yang dilihatnya.
 *
 * Pilihan yang menunjuk klip yang sudah tidak ada (baru dibuang, atau scene-nya
 * berganti) jatuh kembali ke potongan pertama, bukan menghasilkan undefined
 * yang harus dijaga tiap pemanggil.
 */
export const selectedClip = (scene: Scene, selectedClipId: string | null): Clip =>
  scene.clips.find((clip) => clip.id === selectedClipId) ?? primaryClip(scene);
