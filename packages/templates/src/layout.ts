import {
  type AspectRatio,
  computeTimeline,
  DIMENSIONS,
  NO_SAFE_AREA,
  type SafeArea,
  type Scene,
  type ScenePlan,
  sumClipDurationsSec,
  type TransitionType,
} from "@dalang/core";

/**
 * Frame-domain layout shared by calculateMetadata and the preset composition.
 * Core resolves durations in seconds (presentation-agnostic); this module
 * quantizes to frames and accounts for crossfade overlap.
 */

export const FPS = 30;

/** ID of the single scene-plan-driven composition registered in Root.tsx. */
export const COMPOSITION_ID = "Dalang";

/** Default crossfade length between scenes (ADR-0013: per-scene via transition.durationFrames). */
export const TRANSITION_FRAMES = 15;
/** Upper bound (mirrors core MAX_TRANSITION_FRAMES) — scenes always outlast two overlaps. */
const MAX_BOUNDARY_FRAMES = 24;

export interface FrameLayout {
  /** Frames per scene, index-aligned with plan.scenes. */
  sceneFrames: number[];
  /** Global start frame of each scene, transitions overlapped. */
  sceneStarts: number[];
  /** Overlap frames per boundary i→i+1 (= scene i's exit transition). */
  boundaryFrames: number[];
  totalFrames: number;
}

export const computeFrameLayout = (plan: ScenePlan): FrameLayout => {
  const { timings } = computeTimeline(plan);
  const minFrames = MAX_BOUNDARY_FRAMES * 2 + 6;
  const sceneFrames = timings.map((timing) =>
    Math.max(Math.round(timing.durationSec * FPS), minFrames),
  );
  const boundaryFrames = plan.scenes
    .slice(0, -1)
    .map((scene) => scene.transition.durationFrames);

  const sceneStarts: number[] = [];
  let cursor = 0;
  sceneFrames.forEach((frames, index) => {
    sceneStarts.push(cursor);
    cursor += frames;
    if (index < sceneFrames.length - 1) {
      cursor -= boundaryFrames[index] ?? TRANSITION_FRAMES;
    }
  });

  return { sceneFrames, sceneStarts, boundaryFrames, totalFrames: cursor };
};

/** Satu potongan gambar di dalam scene, sudah dikuantisasi ke bingkai. */
export interface ClipSpan {
  id: string;
  index: number;
  /** Bingkai pertama klip, dihitung dari AWAL SCENE. */
  startFrame: number;
  frames: number;
  /** Tumpang tindih ke klip BERIKUTNYA; 0 = potong keras (bawaan, ADR-0033 §6). */
  transitionFrames: number;
  transitionType: TransitionType | null;
}

/**
 * Kuantisasi klip sebuah scene ke bingkai (ADR-0033).
 *
 * Dua sifat yang dijaga, dan keduanya adalah alasan fungsi ini ada alih-alih
 * `Math.round(durationSec * FPS)` di tempat pemakaian:
 *
 * 1. **Petaknya menutup rapat.** Bingkai awal klip berikutnya dihitung dari
 *    jumlah KUMULATIF, bukan dari penjumlahan durasi yang sudah dibulatkan
 *    satu per satu. Membulatkan tiap durasi sendiri-sendiri menumpuk selisih
 *    setengah bingkai sampai klip terakhir berakhir sebelum scene-nya — dan
 *    yang terlihat adalah kedipan hitam yang tak seorang pun bisa lacak
 *    kembali ke pembulatan.
 * 2. **Jumlahnya persis `sceneFrames`.** Scene sangat pendek dinaikkan ke
 *    lantai bingkai oleh `computeFrameLayout`; di situ klipnya diskalakan
 *    proporsional, bukan dibiarkan menyisakan celah.
 *
 * SYARAT: `sceneFrames` minimal sebanyak klipnya — tiap klip butuh setidaknya
 * satu bingkai. Itu dijamin di hulu dan bukan kebetulan: lantai
 * `computeFrameLayout` 54 bingkai, sementara `MAX_CLIPS` 24.
 */
export const clipFrameSpans = (scene: Scene, sceneFrames: number): ClipSpan[] => {
  const clips = scene.clips;
  if (clips.length === 1) {
    return [
      {
        id: clips[0]?.id ?? scene.id,
        index: 0,
        startFrame: 0,
        frames: sceneFrames,
        transitionFrames: 0,
        transitionType: null,
      },
    ];
  }

  const total = sumClipDurationsSec(scene) || 1;
  const starts: number[] = [0];
  let cursorSec = 0;
  for (let index = 1; index < clips.length; index += 1) {
    cursorSec += clips[index - 1]?.durationSec ?? 0;
    const ideal = Math.round((cursorSec / total) * sceneFrames);
    // Setiap klip menyisakan minimal satu bingkai untuk dirinya DAN untuk
    // setiap klip sesudahnya; tanpa jepitan ini scene yang lebih pendek dari
    // jumlah klipnya melahirkan petak nol bingkai yang ditolak Remotion.
    const floor = (starts[index - 1] ?? 0) + 1;
    const ceiling = sceneFrames - (clips.length - index);
    starts.push(Math.min(Math.max(ideal, floor), Math.max(ceiling, floor)));
  }

  return clips.map((clip, index) => {
    const startFrame = starts[index] ?? 0;
    const frames = (starts[index + 1] ?? sceneFrames) - startFrame;
    const nextFrames = (starts[index + 2] ?? sceneFrames) - (starts[index + 1] ?? 0);
    const isLast = index === clips.length - 1;
    // Transisi klip TERAKHIR diabaikan: batas itu milik scene (ADR-0033 §6).
    // Yang lain dijepit supaya tidak pernah lebih panjang dari petak yang
    // ditumpanginya — Remotion menolak transisi yang melebihi sequence-nya.
    const wanted = isLast ? 0 : (clip.transition?.durationFrames ?? 0);
    const transitionFrames = Math.max(
      0,
      Math.min(wanted, frames - 1, Math.max(nextFrames - 1, 0)),
    );
    return {
      id: clip.id,
      index,
      startFrame,
      frames,
      transitionFrames,
      transitionType: transitionFrames > 0 ? (clip.transition?.type ?? null) : null,
    };
  });
};

/**
 * Frame pertama scene `index` tampil UTUH: transisi masuknya sudah selesai.
 *
 * `sceneStarts[index]` adalah awal scene di garis waktu, tapi pada frame itu
 * scene sebelumnya masih menutupinya hampir penuh (crossfade baru mulai), dan
 * menurut aturan titik-tengah di bawah scene yang "aktif" pun masih scene
 * sebelumnya. Klik klip di Studio yang melompat ke `sceneStarts + 1` pernah
 * membuat kanvas menampilkan pegangan scene yang diklik sementara editor
 * menganggap scene lain yang aktif — seretan lalu tidak menghasilkan apa-apa.
 */
export const sceneSettledFrame = (layout: FrameLayout, index: number): number => {
  if (index <= 0) return 0;
  const start = layout.sceneStarts[index] ?? 0;
  return start + (layout.boundaryFrames[index - 1] ?? TRANSITION_FRAMES);
};

/** Index of the scene considered "active" at a global frame (transition midpoint rule). */
export const activeSceneIndex = (layout: FrameLayout, frame: number): number => {
  for (let i = layout.sceneStarts.length - 1; i >= 0; i--) {
    const start = layout.sceneStarts[i] ?? 0;
    const overlap = layout.boundaryFrames[i - 1] ?? TRANSITION_FRAMES;
    const threshold = i === 0 ? 0 : start + overlap / 2;
    if (frame >= threshold) return i;
  }
  return 0;
};

export interface AspectMetrics {
  width: number;
  height: number;
  /** Horizontal safe margin in px. */
  marginX: number;
  /** Top safe margin in px. */
  marginTop: number;
  /** Distance of the caption baseline zone from the bottom edge. */
  captionBottom: number;
  captionFontSize: number;
  captionMaxWidth: number;
  titleFontSize: number;
  kickerFontSize: number;
}

const baseMetrics = (aspect: AspectRatio): AspectMetrics => {
  const { width, height } = DIMENSIONS[aspect];
  switch (aspect) {
    case "9:16":
      return {
        width,
        height,
        marginX: 84,
        marginTop: 108,
        captionBottom: 316,
        captionFontSize: 56,
        captionMaxWidth: width * 0.82,
        titleFontSize: 124,
        kickerFontSize: 27,
      };
    case "16:9":
      return {
        width,
        height,
        marginX: 144,
        marginTop: 96,
        captionBottom: 124,
        captionFontSize: 52,
        captionMaxWidth: width * 0.62,
        titleFontSize: 132,
        kickerFontSize: 27,
      };
    case "1:1":
      return {
        width,
        height,
        marginX: 88,
        marginTop: 92,
        captionBottom: 176,
        captionFontSize: 50,
        captionMaxWidth: width * 0.8,
        titleFontSize: 108,
        kickerFontSize: 26,
      };
  }
};

/**
 * Ukuran tata letak untuk sebuah rasio, dipersempit zona aman platform
 * (ADR-0034).
 *
 * SATU tempat, karena ini satu-satunya sumber angka tata letak: caption, teks
 * overlay, tempelan, dan chrome semuanya membaca `AspectMetrics`. Menyisipkan
 * zona amannya di sini berarti tidak ada satu pun overlay yang bisa lupa
 * menghormatinya — dan overlay yang lupa adalah persis cacat yang fitur ini
 * ada untuk mencegah.
 *
 * Sisi kiri dan kanan dijadikan SATU margin simetris sebesar yang terbesar.
 * Alasannya bukan kemalasan: tata letak Dalang berpusat (caption, judul,
 * kicker semuanya `left: 50%`), jadi margin asimetris tidak menggesernya
 * menjauh dari sisi yang dijaga — ia hanya membuat kotaknya melebar ke sisi
 * yang lain. Mengambil yang terbesar untuk keduanya menjaga isinya tetap di
 * tengah DAN tetap keluar dari rel tombol platform.
 *
 * Semua angkanya `Math.max` terhadap margin bawaan, tidak pernah menggantinya:
 * zona aman menambah kelonggaran, dan zona aman yang lebih sempit daripada
 * margin desain tidak boleh diam-diam MENGURANGI margin itu.
 */
export const aspectMetrics = (
  aspect: AspectRatio,
  safeArea: SafeArea = NO_SAFE_AREA,
): AspectMetrics => {
  const base = baseMetrics(aspect);
  const sisi = Math.max(safeArea.left, safeArea.right) * base.width;
  const marginX = Math.max(base.marginX, sisi);
  return {
    ...base,
    marginX,
    marginTop: Math.max(base.marginTop, safeArea.top * base.height),
    captionBottom: Math.max(base.captionBottom, safeArea.bottom * base.height),
    // Lebar caption ikut menyempit; tanpa ini teksnya tetap selebar semula dan
    // menembus rel tombol dari samping meskipun sudah dinaikkan dari bawah.
    captionMaxWidth: Math.min(base.captionMaxWidth, base.width - marginX * 2),
  };
};
