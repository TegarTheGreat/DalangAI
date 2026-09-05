import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  allClips,
  type Clip,
  clipAsset,
  DIMENSIONS,
  NARRATION_LEAD_IN_SEC,
  type ResolvedAsset,
  type ScenePlan,
} from "@dalang/core";
import { clipFrameSpans, computeFrameLayout, FPS } from "@dalang/templates/layout";
import { resolveMusicFile } from "@dalang/templates/music";
import type { InteropNote } from "./report";

/**
 * Garis waktu perantara — SATU model, dua format.
 *
 * OTIO dan FCPXML sama-sama butuh jawaban atas pertanyaan yang sama: klip apa,
 * di trek mana, mulai frame berapa, dari berkas mana, potongannya dari detik
 * ke berapa. Menghitungnya dua kali berarti dua kesempatan untuk menyimpang —
 * dan penyimpangan pada garis waktu adalah cacat yang baru ketahuan setelah
 * seseorang membuka hasilnya di Resolve.
 *
 * Model ini juga tempat kejujurannya tinggal. Scene-plan Dalang menyimpan
 * jauh lebih banyak daripada yang bisa diwakili format interchange mana pun:
 * caption karaoke, teks bergaya, Ken Burns, filter, anotasi, ducking musik.
 * Yang tidak bisa dibawa TIDAK dibuang diam-diam — ia dicatat sebagai
 * `notes`, dan setiap permukaan (CLI, Studio) wajib menampilkannya.
 */

/** Satu klip di garis waktu, dalam domain FRAME komposisi. */
export interface EditClip {
  kind: "clip";
  /** Scene asal; null untuk musik yang membentang seluruh video. */
  sceneId: string | null;
  name: string;
  startFrame: number;
  durationFrames: number;
  /** URL berkas absolut (file://). */
  url: string;
  media: "image" | "video" | "audio";
  /** Titik masuk di dalam berkas sumber, detik. */
  sourceStartSec: number;
  /** Panjang berkas sumber, detik; null = tidak diketahui (mis. gambar diam). */
  sourceDurationSec: number | null;
  /** Penanda yang dibawa ke format tujuan (naskah, id scene). */
  markers: EditMarker[];
}

/** Lubang kosong di trek — dibutuhkan OTIO, dan FCPXML memakai `<gap>`. */
export interface EditGap {
  kind: "gap";
  startFrame: number;
  durationFrames: number;
}

/**
 * Peralihan ANTAR dua klip bersebelahan di trek yang sama.
 *
 * Dimodelkan seperti OTIO memodelkannya: klipnya dipotong adu-tumpul di titik
 * potong, lalu peralihannya menjulur `offsetFrames` ke kiri dan ke kanan dari
 * titik itu. Inilah alasan klip video Dalang dipotong di TENGAH tumpang-tindih
 * transisi, bukan di awalnya — titik itu yang dianggap "pindah scene" oleh
 * `activeSceneIndex`, jadi itu pula yang dilihat penonton sebagai potongan.
 */
export interface EditTransition {
  /** Indeks klip di trek yang mendahului peralihan ini. */
  afterClipIndex: number;
  /** Julur ke tiap arah dari titik potong, frame. */
  offsetFrames: number;
  /** Tipe Dalang apa adanya ("cross-fade", "slide-left", …). */
  dalangType: string;
  /** True kalau format tujuan punya padanan sungguhan (hanya dissolve). */
  dissolve: boolean;
}

export interface EditTrack {
  name: string;
  kind: "video" | "audio";
  items: (EditClip | EditGap)[];
  transitions: EditTransition[];
}

export interface EditMarker {
  startFrame: number;
  durationFrames: number;
  value: string;
}

export interface EditTimeline {
  name: string;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  tracks: EditTrack[];
  /** Apa yang TIDAK ikut menyeberang. Wajib ditampilkan pemanggilnya. */
  notes: InteropNote[];
}

export interface BuildTimelineOptions {
  /** Path plan.json — akar untuk semua path aset relatif. */
  planPath: string;
  /**
   * Folder aset situs (public/ paket templates). Diperlukan hanya untuk musik
   * ter-bundle; tanpa itu musiknya dilaporkan sebagai tidak ikut, bukan
   * ditunjuk ke path yang tidak ada.
   */
  siteAssetDir?: string;
}

const secToFrames = (sec: number): number => Math.round(sec * FPS);

/** file:// absolut dan ter-encode; path relatif dihitung dari folder plan. */
const fileUrlFor = (planDir: string, file: string): string =>
  pathToFileURL(isAbsolute(file) ? file : resolve(planDir, file)).href;

/**
 * Titik potong yang TERLIHAT antara scene i dan i+1, dalam frame.
 *
 * Sengaja tengah tumpang-tindih, bukan awalnya: itu ambang yang dipakai
 * `activeSceneIndex`, jadi memakai yang lain akan menggeser seluruh garis
 * waktu ekspor setengah transisi terhadap videonya sendiri.
 */
const cutPoints = (
  sceneStarts: number[],
  boundaryFrames: number[],
  totalFrames: number,
): number[] => {
  const cuts: number[] = [];
  for (let i = 0; i < sceneStarts.length - 1; i++) {
    const nextStart = sceneStarts[i + 1] ?? 0;
    const overlap = boundaryFrames[i] ?? 0;
    cuts.push(Math.round(nextStart + overlap / 2));
  }
  cuts.push(totalFrames);
  return cuts;
};

/**
 * Menaruh klip ke trek pertama yang masih longgar.
 *
 * Narasi dan efek suara ditambatkan ke scene, dan scene BOLEH lebih pendek
 * daripada audionya (durasi tetap yang dipasang tangan). Tanpa pengalokasi
 * ini dua klip akan bertindihan di satu trek — sah di Dalang (keduanya memang
 * berbunyi bersamaan), mustahil di trek NLE mana pun.
 */
const layOnLanes = (
  clips: EditClip[],
  baseName: string,
  kind: "video" | "audio",
): EditTrack[] => {
  const lanes: EditClip[][] = [];
  for (const clip of [...clips].sort((a, b) => a.startFrame - b.startFrame)) {
    const lane = lanes.find((items) => {
      const last = items[items.length - 1];
      return !last || last.startFrame + last.durationFrames <= clip.startFrame;
    });
    if (lane) lane.push(clip);
    else lanes.push([clip]);
  }
  return lanes.map((items, index) => ({
    name: lanes.length > 1 ? `${baseName} ${index + 1}` : baseName,
    kind,
    items: withGaps(items),
    transitions: [],
  }));
};

/** Menyisipkan gap supaya trek jadi rangkaian penuh tanpa lubang implisit. */
const withGaps = (clips: EditClip[]): (EditClip | EditGap)[] => {
  const out: (EditClip | EditGap)[] = [];
  let cursor = 0;
  for (const clip of clips) {
    if (clip.startFrame > cursor) {
      out.push({
        kind: "gap",
        startFrame: cursor,
        durationFrames: clip.startFrame - cursor,
      });
    }
    out.push(clip);
    cursor = clip.startFrame + clip.durationFrames;
  }
  return out;
};

/** Huruf pertama jadi kapital — catatan dirakit dari potongan, bukan ditulis utuh. */
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Ringkasan hitungan untuk catatan "ini tidak ikut". */
const countScenes = (
  plan: ScenePlan,
  predicate: (scene: ScenePlan["scenes"][number]) => boolean,
) => plan.scenes.filter(predicate).length;

export const buildEditTimeline = (
  plan: ScenePlan,
  { planPath, siteAssetDir }: BuildTimelineOptions,
): EditTimeline => {
  const planDir = dirname(resolve(planPath));
  const layout = computeFrameLayout(plan);
  const { width, height } = DIMENSIONS[plan.meta.aspectRatio];
  const notes: InteropNote[] = [];
  const cuts = cutPoints(layout.sceneStarts, layout.boundaryFrames, layout.totalFrames);

  // --- Trek video: satu klip per KLIP, adu-tumpul di titik potong ---------
  //
  // Satu-ke-satu sejak ADR-0033: sebelumnya satu scene selalu jadi satu klip,
  // jadi wawancara berklip dua belas menyeberang sebagai satu blok panjang
  // yang titik potongnya hilang. Kuantisasi bingkainya memakai `clipFrameSpans`
  // yang SAMA dengan renderer — kalau interop membulatkan sendiri, hasil di
  // Resolve akan bergeser satu bingkai dari hasil render Dalang, dan tidak ada
  // yang bisa mengatakan mana yang benar.
  const videoItems: (EditClip | EditGap)[] = [];
  const transitions: EditTransition[] = [];
  const unresolved: string[] = [];
  let cursor = 0;

  plan.scenes.forEach((scene, index) => {
    const end = cuts[index] ?? layout.totalFrames;
    const durationFrames = Math.max(1, end - cursor);
    const spans = clipFrameSpans(scene, durationFrames);

    spans.forEach((span) => {
      const clip = scene.clips[span.index];
      const asset: ResolvedAsset | undefined = clip
        ? clipAsset(plan, clip.id)
        : undefined;
      const startFrame = cursor + span.startFrame;

      if (!asset || !clip) {
        // Klip tanpa aset nyata (template-anim, atau belum diresolusi) tidak
        // bisa jadi klip: tidak ada berkas untuk ditunjuk. Gap yang jujur.
        unresolved.push(spans.length > 1 ? `${scene.id}/${span.id}` : scene.id);
        videoItems.push({ kind: "gap", startFrame, durationFrames: span.frames });
      } else {
        const markers: EditMarker[] = [
          {
            startFrame: 0,
            durationFrames: 1,
            value:
              spans.length > 1
                ? `Dalang: ${scene.id} · klip ${span.index + 1}`
                : `Dalang: ${scene.id}`,
          },
        ];
        // Narasi milik SCENE, jadi ia menempel di potongan pertama saja;
        // menyalinnya ke tiap potongan akan terbaca sebagai kalimat yang
        // diucapkan berkali-kali.
        if (span.index === 0 && scene.narration.trim()) {
          markers.push({
            startFrame: 0,
            durationFrames: 1,
            value: scene.narration.trim(),
          });
        }
        videoItems.push({
          kind: "clip",
          sceneId: scene.id,
          name: spans.length > 1 ? span.id : scene.id,
          startFrame,
          durationFrames: span.frames,
          url: fileUrlFor(planDir, asset.file),
          media: asset.kind,
          // Gambar diam tidak punya titik masuk; hanya video yang dipotong.
          sourceStartSec: asset.kind === "video" ? clip.trimStartSec : 0,
          sourceDurationSec: asset.durationSec ?? null,
          markers,
        });
      }

      // Transisi DI DALAM scene (ADR-0033 §6) ikut menyeberang.
      if (span.transitionFrames > 0 && span.transitionType) {
        transitions.push({
          afterClipIndex: videoItems.length - 1,
          offsetFrames: Math.round(span.transitionFrames / 2),
          dalangType: span.transitionType,
          dissolve: span.transitionType === "cross-fade",
        });
      }
    });

    const boundary = layout.boundaryFrames[index];
    if (index < plan.scenes.length - 1 && boundary && scene.transition.type !== "none") {
      transitions.push({
        afterClipIndex: videoItems.length - 1,
        offsetFrames: Math.round(boundary / 2),
        dalangType: scene.transition.type,
        dissolve: scene.transition.type === "cross-fade",
      });
    }
    cursor = end;
  });

  const tracks: EditTrack[] = [
    { name: "Video", kind: "video", items: videoItems, transitions },
  ];

  // --- Trek lapisan video (ADR-0025) --------------------------------------
  //
  // Waktunya diukur dari AWAL SCENE (`sceneStarts`), bukan dari titik potong
  // yang dipakai trek utama: di render, lapisan hidup di dalam Sequence
  // scene-nya, jadi `startFrac` memang fraksi dari jendela itu. Memakai titik
  // potong akan menggeser tiap sisipan setengah transisi dari tempat
  // sebenarnya.
  const layerClips: EditClip[] = [];
  const lapisanTanpaAset: string[] = [];
  plan.scenes.forEach((scene, index) => {
    const sceneStart = layout.sceneStarts[index] ?? 0;
    const sceneFrames = layout.sceneFrames[index] ?? 0;
    for (const layer of scene.layers) {
      const asset = plan.renderState.layerAssets[layer.id];
      if (!asset) {
        lapisanTanpaAset.push(layer.id);
        continue;
      }
      const from = Math.round(layer.startFrac * sceneFrames);
      const to = Math.round(layer.endFrac * sceneFrames);
      layerClips.push({
        kind: "clip",
        sceneId: scene.id,
        name: layer.id,
        startFrame: sceneStart + from,
        durationFrames: Math.max(1, to - from),
        url: fileUrlFor(planDir, asset.file),
        media: asset.kind,
        sourceStartSec: asset.kind === "video" ? layer.visual.trimStartSec : 0,
        sourceDurationSec: asset.durationSec ?? null,
        markers: [
          {
            startFrame: 0,
            durationFrames: 1,
            value: `Dalang lapisan: ${layer.id} (scene ${scene.id})`,
          },
        ],
      });
    }
  });
  tracks.push(...layOnLanes(layerClips, "Lapisan", "video"));
  if (lapisanTanpaAset.length > 0) {
    notes.push({
      code: "lapisan-tanpa-aset",
      detail: `Lapisan tanpa berkas aset tidak ikut (${lapisanTanpaAset.join(", ")}) — belum di-resolve.`,
    });
  }
  if (layerClips.length > 0) {
    notes.push({
      code: "lapisan-bentuk",
      detail: `${layerClips.length} lapisan video diekspor sebagai klip di trek terpisah (lane), tapi letak, ukuran, bentuk bulat, bingkai, dan animasi masuknya TIDAK ikut — itu transform milik render, bukan properti klip. Klipnya akan tampil layar penuh sampai ditata ulang di editor tujuan.`,
    });
  }

  // --- Trek narasi --------------------------------------------------------
  const narrationClips: EditClip[] = [];
  plan.scenes.forEach((scene, index) => {
    const audio = plan.renderState.narrationAudio[scene.id];
    if (!audio) return;
    narrationClips.push({
      kind: "clip",
      sceneId: scene.id,
      name: `${scene.id} narasi`,
      startFrame: (layout.sceneStarts[index] ?? 0) + secToFrames(NARRATION_LEAD_IN_SEC),
      durationFrames: Math.max(1, secToFrames(audio.durationSec)),
      url: fileUrlFor(planDir, audio.file),
      media: "audio",
      sourceStartSec: 0,
      sourceDurationSec: audio.durationSec,
      markers: [],
    });
  });
  tracks.push(...layOnLanes(narrationClips, "Narasi", "audio"));

  // --- Trek musik ---------------------------------------------------------
  const music = plan.audio.music;
  if (music) {
    const resolved = resolveMusicFile(music.assetId);
    if (!resolved) {
      notes.push({
        code: "musik-tidak-dikenal",
        detail: `Musik "${music.assetId}" tidak ada di pustaka — tidak ikut diekspor.`,
      });
    } else if (resolved.bundled && !siteAssetDir) {
      notes.push({
        code: "musik-pustaka-tanpa-folder",
        detail:
          "Musik pustaka ter-bundle tidak ikut: folder aset situs tidak diberikan ke pengekspor.",
      });
    } else {
      const base = resolved.bundled ? (siteAssetDir as string) : planDir;
      tracks.push({
        name: "Musik",
        kind: "audio",
        items: [
          {
            kind: "clip",
            sceneId: null,
            name: music.assetId,
            startFrame: 0,
            durationFrames: layout.totalFrames,
            url: fileUrlFor(base, resolved.file),
            media: "audio",
            sourceStartSec: 0,
            sourceDurationSec: null,
            markers: [],
          },
        ],
        transitions: [],
      });
      notes.push({
        code: "musik-datar",
        detail:
          "Musik diekspor sebagai satu klip sepanjang video; loop, fade, dan ducking otomatis di bawah narasi TIDAK ikut.",
      });
    }
  }

  // --- Trek efek suara ----------------------------------------------------
  const sfxClips: EditClip[] = [];
  const sfxTanpaDurasi: string[] = [];
  for (const cue of plan.audio.sfx) {
    const asset = plan.renderState.sfxAssets[cue.id];
    const sceneIndex = plan.scenes.findIndex((scene) => scene.id === cue.sceneId);
    if (!asset || sceneIndex < 0) continue;
    if (asset.durationSec === undefined) {
      // Klip NLE WAJIB punya panjang. Mengarang panjangnya berarti menaruh
      // kebohongan di garis waktu; melewatinya dan menyebut namanya tidak.
      sfxTanpaDurasi.push(cue.id);
      continue;
    }
    sfxClips.push({
      kind: "clip",
      sceneId: cue.sceneId,
      name: cue.id,
      startFrame: (layout.sceneStarts[sceneIndex] ?? 0) + secToFrames(cue.atSec),
      durationFrames: Math.max(1, secToFrames(asset.durationSec)),
      url: fileUrlFor(planDir, asset.file),
      media: "audio",
      sourceStartSec: 0,
      sourceDurationSec: asset.durationSec,
      markers: [],
    });
  }
  tracks.push(...layOnLanes(sfxClips, "Efek", "audio"));
  if (sfxTanpaDurasi.length > 0) {
    notes.push({
      code: "sfx-tanpa-durasi",
      detail: `Efek suara tanpa panjang tercatat dilewati (${sfxTanpaDurasi.join(", ")}) — panjang karangan di garis waktu lebih menyesatkan daripada klip yang hilang.`,
    });
  }

  // --- Trek audio tambahan (ADR-0026) -------------------------------------
  const trackClips: EditClip[] = [];
  const trekTanpaDurasi: string[] = [];
  for (const track of plan.audio.tracks) {
    const asset = plan.renderState.trackAssets[track.id];
    if (!asset) continue;
    if (asset.durationSec === undefined) {
      // Alasan yang sama dengan efek suara: klip NLE wajib punya panjang, dan
      // panjang karangan di garis waktu lebih menyesatkan daripada klip hilang.
      trekTanpaDurasi.push(track.id);
      continue;
    }
    const sceneIndex = track.sceneId
      ? plan.scenes.findIndex((scene) => scene.id === track.sceneId)
      : -1;
    if (track.sceneId && sceneIndex < 0) continue;
    const anchor = sceneIndex >= 0 ? (layout.sceneStarts[sceneIndex] ?? 0) : 0;
    trackClips.push({
      kind: "clip",
      sceneId: track.sceneId,
      name: track.id,
      startFrame: anchor + secToFrames(track.atSec),
      durationFrames: Math.max(1, secToFrames(asset.durationSec)),
      url: fileUrlFor(planDir, asset.file),
      media: "audio",
      sourceStartSec: 0,
      sourceDurationSec: asset.durationSec,
      markers: [],
    });
  }
  tracks.push(...layOnLanes(trackClips, "Trek", "audio"));
  if (trekTanpaDurasi.length > 0) {
    notes.push({
      code: "trek-tanpa-durasi",
      detail: `Trek audio tanpa panjang tercatat dilewati (${trekTanpaDurasi.join(", ")}).`,
    });
  }
  if (trackClips.length > 0) {
    notes.push({
      code: "trek-amplop",
      detail: `${trackClips.length} trek audio diekspor sebagai klip, tapi amplopnya (volume, fade, ducking, normalisasi kenyaringan) TIDAK ikut — itu otomatisasi milik render, bukan properti klip. Klipnya akan berbunyi rata di editor tujuan.`,
    });
  }

  // --- Catatan: yang tidak punya padanan di format mana pun ---------------
  if (unresolved.length > 0) {
    notes.push({
      code: "scene-tanpa-aset",
      detail: `Scene tanpa berkas aset jadi lubang kosong: ${unresolved.join(", ")}. Scene template-anim (judul/penutup) memang digambar Dalang sendiri, bukan dari berkas.`,
    });
  }
  const captions = countScenes(
    plan,
    (scene) => scene.caption.enabled && !!scene.narration.trim(),
  );
  if (captions > 0) {
    notes.push({
      code: "caption",
      detail: `Caption karaoke ${captions} scene tidak ikut — tidak ada padanannya di OTIO/FCPXML. Naskahnya dibawa sebagai penanda (marker) di tiap klip.`,
    });
  }
  const texts = plan.scenes.reduce((sum, scene) => sum + scene.texts.length, 0);
  const graphics = plan.scenes.reduce((sum, scene) => sum + scene.graphics.length, 0);
  if (texts + graphics > 0) {
    // Hanya yang ADA yang disebut: "0 grafis" di daftar kehilangan membuat
    // pembacanya berhenti membaca daftarnya.
    const bagian = [
      texts > 0 ? `${texts} teks overlay` : null,
      graphics > 0 ? `${graphics} grafis` : null,
    ].filter((part) => part !== null);
    notes.push({
      code: "overlay",
      detail: `${sentence(bagian.join(" dan "))} tidak ikut — digambar preset Dalang saat render, bukan disimpan sebagai berkas.`,
    });
  }
  /**
   * Hitungan kehilangan dihitung per KLIP, bukan per scene (ADR-0033).
   *
   * Sebelumnya semuanya membaca `primaryClip(scene)` saja, jadi wawancara
   * berklip dua belas yang sebelas potongannya ber-Ken Burns dilaporkan
   * sebagai "0 scene" begitu potongan pertamanya kebetulan diam. Catatan
   * interop adalah permukaan KEJUJURAN ekspor: hitungan yang cuma memandang
   * potongan pertama bukan sekadar kurang tepat, ia meleset ke arah yang
   * paling merugikan pembacanya — mengaku tidak kehilangan apa-apa.
   */
  const clips = allClips(plan).map(({ clip }) => clip);
  const countClips = (predicate: (clip: Clip) => boolean): number =>
    clips.filter(predicate).length;
  const motion = countClips((clip) => clip.motion !== "none");
  const filtered = countClips((clip) => (clip.filter?.preset ?? "none") !== "none");
  if (motion + filtered > 0) {
    const bagian = [
      motion > 0 ? `gerak kamera (${motion} klip)` : null,
      filtered > 0 ? `filter warna (${filtered} klip)` : null,
    ].filter((part) => part !== null);
    notes.push({
      code: "gerak-filter",
      detail: `${sentence(bagian.join(" dan "))} tidak ikut — efek render, bukan properti klip.`,
    });
  }
  const annotations = plan.scenes.reduce(
    (sum, scene) => sum + scene.annotations.length,
    0,
  );
  if (annotations > 0) {
    notes.push({
      code: "anotasi",
      detail: `${annotations} anotasi tutorial (zoom/sorot/panah/blur) tidak ikut.`,
    });
  }
  // ADR-0027: keyframe adalah otomatisasi milik render Dalang. OTIO tidak
  // punya kurva properti sama sekali, dan FCPXML hanya punya milik Final Cut
  // sendiri — memetakan ke sana berarti menebak, dan tebakan yang salah lebih
  // buruk daripada mengaku tidak ikut.
  const berkeyframe = plan.scenes.reduce(
    (sum, scene) =>
      sum +
      scene.graphics.filter((item) => item.tracks.length > 0).length +
      scene.texts.filter((item) => item.tracks.length > 0).length +
      scene.layers.filter((item) => item.tracks.length > 0).length,
    0,
  );
  if (berkeyframe > 0) {
    notes.push({
      code: "keyframe",
      detail: `${berkeyframe} elemen punya keyframe (ADR-0027); kurvanya TIDAK ikut — elemennya diekspor pada nilai tetapnya. Animasinya perlu dibuat ulang di editor tujuan.`,
    });
  }
  const bersuara =
    countClips((clip) => clip.audio.volume > 0) +
    plan.scenes.reduce(
      (sum, scene) =>
        sum + scene.layers.filter((layer) => layer.visual.audio.volume > 0).length,
      0,
    );
  if (bersuara > 0) {
    notes.push({
      code: "audio-klip-amplop",
      detail: `${bersuara} klip bersuara diekspor dengan audionya utuh, tapi volume, fade, ducking di bawah narasi, dan normalisasi kenyaringannya TIDAK ikut — semuanya otomatisasi milik render. Atur ulang levelnya di editor tujuan.`,
    });
  }
  const speedy = countClips((clip) => clip.speed !== 1);
  const flipped = countClips((clip) => clip.flipH);
  if (speedy + flipped > 0) {
    const bagian = [
      speedy > 0 ? `kecepatan putar (${speedy} klip)` : null,
      flipped > 0 ? `cermin horizontal (${flipped} klip)` : null,
    ].filter((part) => part !== null);
    notes.push({
      code: "speed-flip",
      detail: `${sentence(bagian.join(" dan "))} tidak ikut.`,
    });
  }

  return {
    name: plan.meta.title,
    fps: FPS,
    width,
    height,
    totalFrames: layout.totalFrames,
    tracks: tracks.filter((track) => track.items.length > 0),
    notes,
  };
};
