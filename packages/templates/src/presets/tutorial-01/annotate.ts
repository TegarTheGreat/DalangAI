import { type Annotation, primaryClip, type ScenePlan } from "@dalang/core";

/**
 * Matematika anotasi murni (PRD §9) — tanpa React, diuji unit. Anotasi
 * dieksekusi sebagai animasi deterministik: zoom kamera ke target, ring
 * highlight + peredup sekitar, panah penunjuk, dan patch blur privasi.
 */

/** Durasi animasi masuk/keluar anotasi (frame @30fps). */
export const ANNOTATION_ENTER_FRAMES = 12;
export const ANNOTATION_EXIT_FRAMES = 10;
/** Porsi sisi terpendek stage yang diisi target saat zoom penuh. */
export const ZOOM_COVERAGE = 0.66;
export const ZOOM_MAX_SCALE = 3.4;

export interface AnnotationWindow {
  /** Frame scene-relatif anotasi mulai/berakhir (end eksklusif). */
  from: number;
  to: number;
}

/**
 * Jendela frame sebuah anotasi di dalam scene. `endSec` kosong = bertahan
 * sampai scene berakhir. Nilai di luar rentang scene diklem.
 */
export const annotationWindow = (
  annotation: Annotation,
  sceneFrames: number,
  fps: number,
): AnnotationWindow => {
  const from = Math.min(
    Math.max(0, Math.round(annotation.timing.startSec * fps)),
    Math.max(0, sceneFrames - 1),
  );
  const rawTo =
    annotation.timing.endSec === undefined
      ? sceneFrames
      : Math.round(annotation.timing.endSec * fps);
  return { from, to: Math.min(Math.max(rawTo, from + 1), sceneFrames) };
};

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInCubic = (t: number): number => t ** 3;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Kehadiran anotasi pada sebuah frame: 0 (belum/selesai) → 1 (penuh),
 * dengan easing masuk (ease-out) dan keluar (ease-in). Anotasi yang
 * bertahan sampai akhir scene tidak memudar keluar (transisi scene yang
 * mengambil alih).
 */
export const annotationPresence = (
  frame: number,
  window: AnnotationWindow,
  sceneFrames: number,
): number => {
  if (frame < window.from || frame >= window.to) return 0;
  const enter = easeOutCubic(clamp01((frame - window.from) / ANNOTATION_ENTER_FRAMES));
  if (window.to >= sceneFrames) return enter;
  const exit = 1 - easeInCubic(clamp01(1 - (window.to - frame) / ANNOTATION_EXIT_FRAMES));
  return Math.min(enter, exit);
};

export interface ZoomTransform {
  scale: number;
  /** Translasi px (diterapkan SEBELUM scale: `scale(s) translate(x,y)`). */
  translateX: number;
  translateY: number;
}

/**
 * Transform kamera agar rect target (ternormalisasi 0–1) berpindah ke pusat
 * stage dan mengisi ~ZOOM_COVERAGE sisi terkecilnya. Skala diklem supaya
 * screenshot tidak pecah; pan DIKLEM agar gambar selalu menutupi stage
 * (target di tepi tidak menyingkap area kosong — pola auto-pan perekam
 * layar); `presence` menginterpolasi dari netral.
 */
export const zoomTransform = (
  target: Annotation["target"],
  stageWidth: number,
  stageHeight: number,
  presence: number,
): ZoomTransform => {
  const safeW = Math.max(target.w, 0.02);
  const safeH = Math.max(target.h, 0.02);
  const fullScale = Math.min(
    ZOOM_MAX_SCALE,
    Math.max(1, Math.min(ZOOM_COVERAGE / safeW, ZOOM_COVERAGE / safeH)),
  );
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const t = clamp01(presence);
  const scale = 1 + (fullScale - 1) * t;
  // Batas pan pada skala saat ini: melewati ini, tepi gambar masuk stage.
  const maxTx = ((scale - 1) * stageWidth) / (2 * scale);
  const maxTy = ((scale - 1) * stageHeight) / (2 * scale);
  const wantTx = -(cx - 0.5) * stageWidth * t;
  const wantTy = -(cy - 0.5) * stageHeight * t;
  return {
    scale,
    translateX: Math.min(maxTx, Math.max(-maxTx, wantTx)),
    translateY: Math.min(maxTy, Math.max(-maxTy, wantTy)),
  };
};

/**
 * Gabungkan zoom semua anotasi `zoom` yang aktif pada frame ini (yang paling
 * hadir menang — tumpang-tindih di-blend lewat presence maksimum per target).
 */
export const activeZoom = (
  annotations: Annotation[],
  frame: number,
  sceneFrames: number,
  fps: number,
  stageWidth: number,
  stageHeight: number,
): ZoomTransform => {
  let best: { presence: number; target: Annotation["target"] } | null = null;
  for (const annotation of annotations) {
    if (annotation.type !== "zoom") continue;
    const presence = annotationPresence(
      frame,
      annotationWindow(annotation, sceneFrames, fps),
      sceneFrames,
    );
    if (presence > 0 && (best === null || presence > best.presence)) {
      best = { presence, target: annotation.target };
    }
  }
  if (!best) return { scale: 1, translateX: 0, translateY: 0 };
  return zoomTransform(best.target, stageWidth, stageHeight, best.presence);
};

/** Sisi bebas untuk meletakkan panah relatif terhadap target. */
export type ArrowSide = "left" | "right" | "top" | "bottom";

/** Ruang minimum agar panah muat tanpa menabrak target (fraksi stage). */
const ARROW_NEED: Record<ArrowSide, number> = {
  left: 0.1,
  right: 0.1,
  top: 0.17,
  bottom: 0.17,
};
/** Preferensi: dari bawah (konvensi tutorial), lalu horizontal, atas terakhir
 * karena paling sering melintasi konten di atas target. */
const ARROW_PREFERENCE: ArrowSide[] = ["bottom", "left", "right", "top"];

export const arrowSide = (target: Annotation["target"]): ArrowSide => {
  const room: Record<ArrowSide, number> = {
    left: target.x,
    right: 1 - (target.x + target.w),
    top: target.y,
    bottom: 1 - (target.y + target.h),
  };
  const fits = ARROW_PREFERENCE.find((side) => room[side] >= ARROW_NEED[side]);
  if (fits) return fits;
  return ARROW_PREFERENCE.reduce((bestSide, side) =>
    room[side] > room[bestSide] ? side : bestSide,
  );
};

export interface StepInfo {
  step: number;
  total: number;
}

/**
 * Nomor langkah per scene: hanya scene "isi" (bukan template-anim) yang
 * dihitung — pembuka/penutup tidak diberi nomor.
 */
export const stepNumbers = (plan: ScenePlan): Map<string, StepInfo> => {
  const bodyScenes = plan.scenes.filter(
    (scene) => primaryClip(scene).type !== "template-anim",
  );
  const map = new Map<string, StepInfo>();
  bodyScenes.forEach((scene, index) => {
    map.set(scene.id, { step: index + 1, total: bodyScenes.length });
  });
  return map;
};
