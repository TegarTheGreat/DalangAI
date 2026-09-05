import { computeClipTimings, resolveSceneDurationSec } from "./durations";
import { type Clip, clipAsset, type Scene, type ScenePlan } from "./scene-plan";

/**
 * Aritmetika penyuntingan klip (ADR-0033 §5).
 *
 * Hidup DI SINI, bukan di Studio dan bukan di agent. Kalau ia hidup di
 * pemanggilnya, Studio dan agent akan menghitungnya sendiri-sendiri, dan suatu
 * saat berbeda — persis kelas cacat yang dihindari resep format dengan memakai
 * satu sumber untuk MENASIHATI dan MEMERIKSA (ADR-0017).
 *
 * Itu juga alasan berkas ini mengekspor BATAS (`trimBounds`, `splitBounds`),
 * bukan cuma hasil: seretan di timeline butuh tahu sampai mana tepi boleh ikut
 * kursor sebelum patch dikirim, sementara op-nya sendiri MENOLAK nilai di luar
 * batas. Satu rumus, dua pemakaian.
 *
 * Semua fungsi di sini MURNI: mereka mengembalikan daftar klip yang baru, atau
 * satu kalimat alasan kenapa tidak bisa. Kalimat, bukan kode galat, karena
 * satu-satunya pembacanya adalah manusia — op melemparkannya apa adanya dan UI
 * menampilkannya apa adanya juga.
 */

/**
 * Panjang klip terpendek yang masih boleh ada, detik.
 *
 * Ini lantai MANIPULASI, bukan kaidah penyuntingan: ia ada supaya seretan
 * tidak melahirkan klip nol detik yang tak bisa ditangkap pointer lagi. Enam
 * bingkai di 30fps.
 */
export const MIN_CLIP_SEC = 0.2;

/** Sisi klip yang diseret: tepi masuk (kiri) atau tepi keluar (kanan). */
export type TrimEdge = "masuk" | "keluar";

/**
 * Apa yang terjadi pada tetangganya.
 *
 * - `ripple` — tidak ada yang menyerap; scene ikut memanjang atau memendek.
 *   Pada klip berurutan ini gratis: posisi klip berikutnya memang dihitung
 *   dari jumlah pendahulunya, jadi tidak ada yang perlu digeser satu per satu.
 * - `roll` — tetangganya menukar durasi sebesar itu juga, jadi panjang scene
 *   TIDAK berubah dan yang bergerak hanya titik potong di antara keduanya.
 */
export type TrimMode = "ripple" | "roll";

/** Alasan sebuah operasi klip ditolak, dalam satu kalimat. */
export type ClipRefusal = string;

export const isRefusal = <T>(result: T | ClipRefusal): result is ClipRefusal =>
  typeof result === "string";

/** Batas geseran tepi yang sah, detik (negatif = ke kiri). */
export interface TrimBounds {
  minDelta: number;
  maxDelta: number;
}

export interface SplitBounds {
  /** Titik belah paling awal, detik dari AWAL KLIP. */
  minSec: number;
  maxSec: number;
}

/** Pembulatan ke milidetik: menjaga JSON tetap rapi dan undo tetap tepat. */
export const roundSec = (value: number): number => Number(value.toFixed(3));

export const findClipIndex = (scene: Scene, clipId: string): number =>
  scene.clips.findIndex((clip) => clip.id === clipId);

/**
 * Titik keluar klip di rekaman sumber, detik (ADR-0033 §3).
 *
 * DIHITUNG, tidak pernah disimpan: menyimpannya di samping `trimStartSec` dan
 * `durationSec` berarti tiga angka untuk dua derajat kebebasan, dan angka
 * ketiga itu akan bertentangan begitu salah satunya disunting.
 */
export const clipOutPointSec = (clip: Clip, durationSec: number): number =>
  clip.trimStartSec + durationSec * clip.speed;

/**
 * Panjang rekaman sumber sebuah klip, kalau memang diketahui.
 *
 * Gambar diam TIDAK punya batas: ia bisa ditahan selama apa pun. Yang
 * dikembalikan hanya panjang berkas VIDEO yang sudah di-resolve dan sudah
 * diperiksa panjangnya; sisanya `undefined`, dan `undefined` di sini berarti
 * "tidak ada batas yang bisa ditegakkan", bukan "batasnya nol".
 */
export const clipSourceSec = (plan: ScenePlan, clip: Clip): number | undefined => {
  const asset = clipAsset(plan, clip.id);
  return asset?.kind === "video" ? asset.durationSec : undefined;
};

/** Durasi satu klip di linimasa, memakai aturan §2 (satu klip = seluruh scene). */
export const clipDurationSec = (
  plan: ScenePlan,
  scene: Scene,
  clipId: string,
): number | undefined =>
  computeClipTimings(scene, resolveSceneDurationSec(scene, plan)).find(
    (timing) => timing.id === clipId,
  )?.durationSec;

const requireMultiClip = (scene: Scene): ClipRefusal | null =>
  scene.clips.length < 2
    ? `Scene "${scene.id}" cuma punya satu klip: panjangnya datang dari ` +
      `"scene.duration" dan titik masuknya dari updateScene.visual.trimStartSec — ` +
      `belah klipnya dulu kalau ingin menyeret tepi potongan.`
    : null;

/**
 * Sampai mana tepi sebuah klip boleh digeser.
 *
 * Batas dinyatakan sebagai geseran tepi di LINIMASA: positif = ke kanan
 * (belakangan), negatif = ke kiri. Itu satu-satunya kerangka acuan yang sama
 * bagi kursor pengguna dan bagi aritmetika di bawahnya; berpindah ke "berapa
 * detik rekaman" di pertengahan jalan adalah cara termudah menukar `speed`
 * dengan 1 tanpa sadar.
 */
export const trimBounds = (
  plan: ScenePlan,
  scene: Scene,
  clipId: string,
  edge: TrimEdge,
  mode: TrimMode,
): TrimBounds | ClipRefusal => {
  const single = requireMultiClip(scene);
  if (single) return single;

  const index = findClipIndex(scene, clipId);
  const clip = scene.clips[index];
  if (!clip) return `Klip "${clipId}" tidak ada di scene "${scene.id}"`;

  const timings = computeClipTimings(scene, resolveSceneDurationSec(scene, plan));
  const own = timings[index]?.durationSec ?? 0;
  const neighborIndex = edge === "masuk" ? index - 1 : index + 1;
  const neighbor = scene.clips[neighborIndex];
  if (mode === "roll" && !neighbor) {
    return (
      `Tepi ${edge} klip "${clipId}" tidak punya tetangga yang bisa menyerap ` +
      `perubahannya — pakai ripple.`
    );
  }
  const neighborDur = timings[neighborIndex]?.durationSec ?? 0;

  let minDelta = Number.NEGATIVE_INFINITY;
  let maxDelta = Number.POSITIVE_INFINITY;
  const atLeast = (value: number) => {
    minDelta = Math.max(minDelta, value);
  };
  const atMost = (value: number) => {
    maxDelta = Math.min(maxDelta, value);
  };

  if (edge === "masuk") {
    // Klip ini: memendek sebesar delta, dan titik masuknya maju delta*speed
    // detik REKAMAN. Titik keluarnya tidak ikut bergerak, jadi sisi ini tidak
    // pernah bisa melewati ujung rekaman — hanya awalnya.
    atMost(own - MIN_CLIP_SEC);
    atLeast(-clip.trimStartSec / clip.speed);
  } else {
    atLeast(MIN_CLIP_SEC - own);
    const source = clipSourceSec(plan, clip);
    if (source !== undefined) {
      atMost((source - clip.trimStartSec) / clip.speed - own);
    }
  }

  // Tetangganya hanya mengikat kalau ia yang menyerap. Ripple tidak menyentuh
  // siapa pun; yang berubah cuma panjang scene.
  if (mode === "roll" && neighbor) {
    if (edge === "masuk") {
      // Tetangga kiri MEMANJANG sebesar delta: titik masuknya tetap, titik
      // keluarnya maju — jadi rekamannya yang membatasi.
      atLeast(MIN_CLIP_SEC - neighborDur);
      const source = clipSourceSec(plan, neighbor);
      if (source !== undefined) {
        atMost((source - neighbor.trimStartSec) / neighbor.speed - neighborDur);
      }
    } else {
      // Tetangga kanan MEMENDEK sebesar delta dan titik masuknya maju.
      atMost(neighborDur - MIN_CLIP_SEC);
      atLeast(-neighbor.trimStartSec / neighbor.speed);
    }
  }

  return {
    minDelta: Number.isFinite(minDelta) ? roundSec(minDelta) : minDelta,
    maxDelta: Number.isFinite(maxDelta) ? roundSec(maxDelta) : maxDelta,
  };
};

/**
 * Geseran yang sudah dijepit ke batasnya — yang dipakai seretan pointer.
 *
 * Mengembalikan 0 (bukan melempar) saat tepinya tidak bisa bergerak sama
 * sekali: seretan yang mentok harus DIAM, bukan meledak di tengah gerakan jari.
 */
export const clampTrimDelta = (
  plan: ScenePlan,
  scene: Scene,
  clipId: string,
  edge: TrimEdge,
  mode: TrimMode,
  deltaSec: number,
): number => {
  const bounds = trimBounds(plan, scene, clipId, edge, mode);
  if (isRefusal(bounds) || bounds.maxDelta < bounds.minDelta) return 0;
  return roundSec(Math.min(bounds.maxDelta, Math.max(bounds.minDelta, deltaSec)));
};

/** Titik belah yang sah di dalam satu klip, detik dari awal klip. */
export const splitBounds = (
  plan: ScenePlan,
  scene: Scene,
  clipId: string,
): SplitBounds | ClipRefusal => {
  if (findClipIndex(scene, clipId) < 0) {
    return `Klip "${clipId}" tidak ada di scene "${scene.id}"`;
  }
  // Kartu judul/outro memakai SELURUH scene, jadi membelahnya menghasilkan
  // plan yang ditolak skema. Ditolak di sini supaya alasannya terbaca sebagai
  // kalimat, bukan sebagai kegagalan validasi di ujung penerapan patch.
  const clip = scene.clips[findClipIndex(scene, clipId)] as Clip;
  if (clip.type === "template-anim") {
    return (
      `Klip "${clipId}" adalah kartu judul/outro, dan kartu itu memakai seluruh ` +
      `scene — ia tidak bisa dibelah jadi beberapa potongan. Pisahkan isinya ke ` +
      `scene tersendiri.`
    );
  }
  const total = clipDurationSec(plan, scene, clipId) ?? 0;
  if (total < MIN_CLIP_SEC * 2) {
    return (
      `Klip "${clipId}" cuma ${roundSec(total)} dtk — terlalu pendek untuk ` +
      `dibelah jadi dua potongan minimal ${MIN_CLIP_SEC} dtk.`
    );
  }
  return { minSec: MIN_CLIP_SEC, maxSec: roundSec(total - MIN_CLIP_SEC) };
};

const withDurations = (clips: Clip[], durations: number[]): Clip[] =>
  clips.map((clip, index) => ({ ...clip, durationSec: roundSec(durations[index] ?? 0) }));

/**
 * Belah satu klip di `atSec`, dihitung dari awal klip.
 *
 * Potongan kedua mewarisi seluruh isi potongan pertama, termasuk asetnya, dan
 * titik masuknya maju sebesar bagian yang sudah lewat — dikali `speed`, karena
 * yang dilewati adalah detik REKAMAN, bukan detik linimasa.
 *
 * Transisi keluar milik klip aslinya ikut ke potongan KEDUA: transisi itu
 * menjaga batas dengan apa pun yang datang sesudahnya, dan sesudah belahan
 * yang datang adalah potongan kedua. Potongan pertama mendapat potong keras —
 * bawaan di dalam scene (§6).
 */
export const splitClipAt = (
  plan: ScenePlan,
  scene: Scene,
  clipId: string,
  atSec: number,
  newClipId: string,
): Clip[] | ClipRefusal => {
  const bounds = splitBounds(plan, scene, clipId);
  if (isRefusal(bounds)) return bounds;
  if (atSec < bounds.minSec || atSec > bounds.maxSec) {
    return (
      `Titik belah ${roundSec(atSec)} dtk di luar batas klip "${clipId}" ` +
      `(${bounds.minSec}-${bounds.maxSec} dtk).`
    );
  }

  const index = findClipIndex(scene, clipId);
  const clip = scene.clips[index] as Clip;
  const timings = computeClipTimings(scene, resolveSceneDurationSec(scene, plan));
  const total = timings[index]?.durationSec ?? 0;

  const { transition, ...shared } = clip;
  const first: Clip = { ...shared, durationSec: roundSec(atSec) };
  const second: Clip = {
    ...shared,
    ...(transition ? { transition } : {}),
    id: newClipId,
    trimStartSec: roundSec(clip.trimStartSec + atSec * clip.speed),
    durationSec: roundSec(total - atSec),
  };

  const clips = [...scene.clips];
  clips.splice(index, 1, first, second);
  // Klip yang tadinya sendirian belum tentu punya `durationSec`; begitu scene
  // punya dua klip, SEMUANYA wajib punya. Angka yang dipakai adalah panjangnya
  // saat ini, jadi belahan tidak menggeser satu bingkai pun.
  return clips.map((candidate, candidateIndex) =>
    candidate.durationSec === undefined
      ? { ...candidate, durationSec: roundSec(timings[candidateIndex]?.durationSec ?? 0) }
      : candidate,
  );
};

/** Geser tepi satu klip; `deltaSec` positif menggeser tepi itu ke KANAN. */
export const trimClipEdge = (
  plan: ScenePlan,
  scene: Scene,
  clipId: string,
  edge: TrimEdge,
  mode: TrimMode,
  deltaSec: number,
): Clip[] | ClipRefusal => {
  const bounds = trimBounds(plan, scene, clipId, edge, mode);
  if (isRefusal(bounds)) return bounds;
  if (deltaSec < bounds.minDelta || deltaSec > bounds.maxDelta) {
    return (
      `Geseran ${roundSec(deltaSec)} dtk di luar batas tepi ${edge} klip ` +
      `"${clipId}" (${bounds.minDelta} sampai ${bounds.maxDelta} dtk).`
    );
  }

  const index = findClipIndex(scene, clipId);
  const clips = scene.clips.map((clip) => ({ ...clip }));
  const clip = clips[index] as Clip;
  const durations = computeClipTimings(scene, resolveSceneDurationSec(scene, plan)).map(
    (timing) => timing.durationSec,
  );

  if (edge === "masuk") {
    durations[index] = (durations[index] ?? 0) - deltaSec;
    clip.trimStartSec = roundSec(clip.trimStartSec + deltaSec * clip.speed);
    if (mode === "roll") {
      durations[index - 1] = (durations[index - 1] ?? 0) + deltaSec;
    }
  } else {
    durations[index] = (durations[index] ?? 0) + deltaSec;
    if (mode === "roll") {
      const next = clips[index + 1] as Clip;
      durations[index + 1] = (durations[index + 1] ?? 0) - deltaSec;
      next.trimStartSec = roundSec(next.trimStartSec + deltaSec * next.speed);
    }
  }

  return withDurations(clips, durations);
};

/**
 * Buang satu klip; celahnya tertutup sendiri karena klipnya berurutan.
 *
 * Saat klipnya kembali tinggal SATU, `durationSec` yang tersisa dilepas dan
 * scene kembali mengikuti narasi persis seperti sebelum ada belahan — bukan
 * menahan angka yang sejak itu tidak dibaca siapa pun. Field yang ada tapi
 * diabaikan adalah field yang berbohong, dan undo tetap mengembalikannya utuh
 * karena inversnya membawa daftar klip sebelumnya apa adanya.
 */
export const removeClipAt = (scene: Scene, clipId: string): Clip[] | ClipRefusal => {
  if (findClipIndex(scene, clipId) < 0) {
    return `Klip "${clipId}" tidak ada di scene "${scene.id}"`;
  }
  if (scene.clips.length === 1) {
    return (
      `Klip "${clipId}" satu-satunya di scene "${scene.id}" — sebuah scene ` +
      `selalu punya minimal satu klip. Hapus scene-nya kalau memang itu maunya.`
    );
  }
  const clips = scene.clips.filter((clip) => clip.id !== clipId);
  if (clips.length === 1) {
    const { durationSec: _lepas, ...only } = clips[0] as Clip;
    return [only];
  }
  return clips.map((clip) => ({ ...clip }));
};

/** Susun ulang klip di dalam scene; `order` wajib permutasi id yang ada. */
export const reorderClipsTo = (scene: Scene, order: string[]): Clip[] | ClipRefusal => {
  const current = scene.clips.map((clip) => clip.id);
  const sameMembers =
    order.length === current.length &&
    new Set(order).size === order.length &&
    order.every((id) => current.includes(id));
  if (!sameMembers) {
    return (
      `Urutan klip harus berupa permutasi dari semua id klip scene ` +
      `"${scene.id}" (${current.join(", ")}).`
    );
  }
  const byId = new Map(scene.clips.map((clip) => [clip.id, clip]));
  return order.map((id) => ({ ...(byId.get(id) as Clip) }));
};
