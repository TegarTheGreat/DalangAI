import type { EditClip, EditGap, EditTimeline, EditTrack } from "./timeline";

/**
 * Penulis OpenTimelineIO (skema .1).
 *
 * Bentuknya disalin dari berkas contoh RESMI repo OpenTimelineIO
 * (tests/sample_data/multiple_track.otio), bukan dari ingatan: nama field OTIO
 * seragam sampai membosankan (`source_range`, `available_range`,
 * `media_reference`) dan satu huruf yang salah menghasilkan berkas yang ditolak
 * pembaca mana pun tanpa memberi tahu bagian mana yang salah.
 *
 * OTIO memakai `RationalTime` {rate, value} dengan value dalam FRAME — bukan
 * detik. Itu kebetulan yang menyenangkan: garis waktu Dalang memang sudah
 * hidup di domain frame, jadi tidak ada pembulatan yang perlu ditebak.
 */

interface RationalTime {
  OTIO_SCHEMA: "RationalTime.1";
  rate: number;
  value: number;
}

interface TimeRange {
  OTIO_SCHEMA: "TimeRange.1";
  duration: RationalTime;
  start_time: RationalTime;
}

const time = (frames: number, rate: number): RationalTime => ({
  OTIO_SCHEMA: "RationalTime.1",
  rate,
  value: frames,
});

const range = (startFrames: number, durationFrames: number, rate: number): TimeRange => ({
  OTIO_SCHEMA: "TimeRange.1",
  duration: time(durationFrames, rate),
  start_time: time(startFrames, rate),
});

const otioClip = (clip: EditClip, fps: number): Record<string, unknown> => {
  const startFrames = Math.round(clip.sourceStartSec * fps);
  return {
    OTIO_SCHEMA: "Clip.1",
    metadata: { dalang: { sceneId: clip.sceneId } },
    name: clip.name,
    // Rentang yang DIPAKAI dari sumber. Untuk gambar diam angkanya tetap
    // ditulis: OTIO tidak punya konsep "gambar tanpa durasi", dan pembacanya
    // membutuhkan panjang klip di garis waktu.
    source_range: range(startFrames, clip.durationFrames, fps),
    effects: [],
    markers: clip.markers.map((marker) => ({
      OTIO_SCHEMA: "Marker.2",
      metadata: {},
      name: marker.value,
      color: "GREEN",
      marked_range: range(marker.startFrame, marker.durationFrames, fps),
      comment: "",
    })),
    enabled: true,
    media_reference: {
      OTIO_SCHEMA: "ExternalReference.1",
      metadata: {},
      name: clip.name,
      // Panjang sumber yang SEBENARNYA kalau diketahui. Kalau tidak (gambar
      // diam, atau aset yang belum di-probe), `available_range` null — itu
      // nilai sah di OTIO dan artinya persis "tidak diketahui", jauh lebih
      // baik daripada mengarang panjang.
      available_range:
        clip.sourceDurationSec === null
          ? null
          : range(0, Math.max(1, Math.round(clip.sourceDurationSec * fps)), fps),
      target_url: clip.url,
    },
  };
};

const otioGap = (gap: EditGap, fps: number): Record<string, unknown> => ({
  OTIO_SCHEMA: "Gap.1",
  metadata: {},
  name: "",
  source_range: range(0, gap.durationFrames, fps),
  effects: [],
  markers: [],
  enabled: true,
});

/**
 * Peralihan OTIO duduk DI ANTARA dua klip di dalam trek, bukan sebagai
 * properti salah satunya — makanya klipnya harus sudah adu-tumpul lebih dulu.
 * `in_offset`/`out_offset` adalah julurnya ke tiap arah dari titik potong.
 */
const otioTransition = (
  offsetFrames: number,
  dalangType: string,
  dissolve: boolean,
  fps: number,
): Record<string, unknown> => ({
  OTIO_SCHEMA: "Transition.1",
  metadata: { dalang: { type: dalangType } },
  name: dalangType,
  // Hanya cross-fade yang punya padanan baku. Slide/wipe ditulis "Custom" —
  // pembaca akan menampilkannya sebagai peralihan tak dikenal, dan itu memang
  // keadaan sebenarnya; menyamarkannya jadi dissolve akan mengubah hasilnya.
  transition_type: dissolve ? "SMPTE_Dissolve" : "Custom",
  in_offset: time(offsetFrames, fps),
  out_offset: time(offsetFrames, fps),
});

const otioTrack = (track: EditTrack, fps: number): Record<string, unknown> => {
  const children: Record<string, unknown>[] = [];
  const afterIndex = new Map(track.transitions.map((t) => [t.afterClipIndex, t]));
  track.items.forEach((item, index) => {
    children.push(item.kind === "clip" ? otioClip(item, fps) : otioGap(item, fps));
    const transition = afterIndex.get(index);
    if (transition) {
      children.push(
        otioTransition(
          transition.offsetFrames,
          transition.dalangType,
          transition.dissolve,
          fps,
        ),
      );
    }
  });
  return {
    OTIO_SCHEMA: "Track.1",
    metadata: {},
    name: track.name,
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    children,
    kind: track.kind === "video" ? "Video" : "Audio",
  };
};

/** Dokumen OTIO lengkap sebagai objek biasa; pemanggil yang menuliskannya. */
export const toOtio = (timeline: EditTimeline): Record<string, unknown> => ({
  OTIO_SCHEMA: "Timeline.1",
  metadata: {
    dalang: {
      // Catatan ikut MASUK ke berkasnya, bukan cuma dicetak ke terminal:
      // berkas ekspor sering berpindah tangan tanpa log yang menyertainya.
      tidakIkut: timeline.notes.map((note) => note.detail),
    },
  },
  name: timeline.name,
  global_start_time: time(0, timeline.fps),
  tracks: {
    OTIO_SCHEMA: "Stack.1",
    metadata: {},
    name: "tracks",
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    children: timeline.tracks.map((track) => otioTrack(track, timeline.fps)),
  },
});

export const otioToJson = (timeline: EditTimeline): string =>
  `${JSON.stringify(toOtio(timeline), null, 4)}\n`;
