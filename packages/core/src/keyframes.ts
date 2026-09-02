import {
  ANIMATABLE_RANGE,
  type AnimatableProperty,
  type Keyframe,
  type KeyframeEasing,
  type KeyframeTrack,
  MAX_KEYFRAMES_PER_TRACK,
} from "./scene-plan";

/**
 * Penyuntingan track keyframe (ADR-0027, roadmap §9.3).
 *
 * Fungsi MURNI atas larik track: masuk track lama, keluar track baru. Tidak
 * ada yang menyentuh plan di sini — pemanggilnya membungkus hasilnya dalam
 * patch op biasa (`updateScene`), sehingga menambah keyframe tercatat, bisa
 * di-undo, dan terlihat agent persis seperti perubahan lain.
 *
 * Kalau modul ini menulis ke plan sendiri, ia akan jadi jalur kedua yang
 * mengubah kebenaran — dan jalur kedua itu tidak akan punya undo.
 */

/** Dua keyframe pada waktu yang lebih dekat dari ini dianggap titik yang sama. */
export const KEYFRAME_EPSILON = 0.001;

const clampToRange = (property: AnimatableProperty, value: number): number => {
  const range = ANIMATABLE_RANGE[property];
  if (!range) return value;
  return Math.min(range[1], Math.max(range[0], value));
};

/**
 * Pasang (atau ganti) satu keyframe pada waktu `at`.
 *
 * Track yang belum ada dibuat dengan DUA titik — nilai sekarang di ujung yang
 * berseberangan, lalu nilai baru di `at`. Skema menuntut minimal dua titik,
 * dan membuatnya di sini berarti "klik keyframe pertama" langsung menghasilkan
 * track yang sah alih-alih galat validasi yang harus dijelaskan ke pengguna.
 */
export const setKeyframe = (
  tracks: readonly KeyframeTrack[],
  property: AnimatableProperty,
  at: number,
  value: number,
  options: { easing?: KeyframeEasing; current?: number } = {},
): KeyframeTrack[] => {
  const easing = options.easing ?? "settle";
  const time = Math.min(1, Math.max(0, at));
  const nilai = clampToRange(property, value);
  const existing = tracks.find((track) => track.property === property);

  if (!existing) {
    // Titik pasangan ditaruh di ujung TERJAUH supaya keyframe pertama benar-
    // benar menghasilkan gerak; menaruhnya berdampingan membuat track yang
    // sah tapi diam, dan pengguna mengira fiturnya rusak.
    const other: Keyframe = {
      at: time <= 0.5 ? 1 : 0,
      value: clampToRange(property, options.current ?? nilai),
      easing,
    };
    const baru: Keyframe = { at: time, value: nilai, easing };
    const points = time <= 0.5 ? [baru, other] : [other, baru];
    return [...tracks, { property, points }];
  }

  const points = existing.points.filter(
    (point) => Math.abs(point.at - time) > KEYFRAME_EPSILON,
  );
  points.push({ at: time, value: nilai, easing });
  points.sort((a, b) => a.at - b.at);
  const dipotong = points.slice(0, MAX_KEYFRAMES_PER_TRACK);

  return tracks.map((track) =>
    track.property === property ? { ...track, points: dipotong } : track,
  );
};

/**
 * Hapus satu keyframe. Track yang tersisa kurang dari dua titik DIBUANG
 * seluruhnya — track satu titik tidak sah menurut skema, dan menyimpannya
 * berarti plan yang tidak bisa di-parse lagi setelah satu klik hapus.
 */
export const removeKeyframe = (
  tracks: readonly KeyframeTrack[],
  property: AnimatableProperty,
  at: number,
): KeyframeTrack[] =>
  tracks.flatMap((track) => {
    if (track.property !== property) return [track];
    const points = track.points.filter(
      (point) => Math.abs(point.at - at) > KEYFRAME_EPSILON,
    );
    return points.length >= 2 ? [{ ...track, points }] : [];
  });

/** Buang seluruh track sebuah properti — properti itu kembali statis. */
export const clearTrack = (
  tracks: readonly KeyframeTrack[],
  property: AnimatableProperty,
): KeyframeTrack[] => tracks.filter((track) => track.property !== property);

/** Track sebuah properti, kalau ada. */
export const trackOf = (
  tracks: readonly KeyframeTrack[],
  property: AnimatableProperty,
): KeyframeTrack | undefined => tracks.find((track) => track.property === property);

/**
 * Geser satu keyframe ke waktu lain (berlian diseret di timeline).
 *
 * Nilai dan easing-nya ikut; hanya `at` yang berubah, lalu titik diurutkan
 * ulang. Dua pagar: waktu dipangkas ke 0..1, dan seretan yang mendarat tepat
 * di atas titik LAIN pada track yang sama ditolak karena dua keyframe pada
 * waktu yang sama tidak bisa dibedakan lagi dan skema pun menolaknya. Titik
 * yang tidak ditemukan juga tidak mengubah apa pun.
 *
 * Penolakan mengembalikan LARIK YANG SAMA (identitas, bukan salinan), sama
 * seperti `substituteProxies` mengembalikan plan yang sama tanpa proxy. Itu
 * kontrak, bukan kebetulan: pemanggil memakai `hasil === tracks` untuk tahu
 * tidak ada yang berubah. Versi yang mengembalikan salinan pernah membuat
 * seretan yang ditolak tetap mengirim patch kosong — tercatat di log, memakan
 * satu langkah undo, dan tidak mengubah apa pun.
 */
export const moveKeyframe = (
  tracks: readonly KeyframeTrack[],
  property: AnimatableProperty,
  fromAt: number,
  toAt: number,
): KeyframeTrack[] => {
  const unchanged = tracks as KeyframeTrack[];
  const time = Math.min(1, Math.max(0, toAt));
  const track = tracks.find((item) => item.property === property);
  if (!track) return unchanged;
  const index = track.points.findIndex(
    (point) => Math.abs(point.at - fromAt) <= KEYFRAME_EPSILON,
  );
  if (index < 0) return unchanged;
  if (Math.abs(time - track.points[index]!.at) <= KEYFRAME_EPSILON) return unchanged;
  const collides = track.points.some(
    (point, i) => i !== index && Math.abs(point.at - time) <= KEYFRAME_EPSILON,
  );
  if (collides) return unchanged;
  const moved = track.points.map((point, i) =>
    i === index ? { ...point, at: time } : point,
  );
  moved.sort((a, b) => a.at - b.at);
  return tracks.map((item) =>
    item.property === property ? { ...item, points: moved } : item,
  );
};
