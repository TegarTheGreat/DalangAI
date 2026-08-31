import { FPS } from "@dalang/templates/layout";
import { clipsToPlan, type ImportedClip, type ImportResult } from "./import-model";
import type { InteropNote } from "./report";

/**
 * Impor OTIO menjadi scene-plan (roadmap §8.3).
 *
 * Arah ini secara mendasar lebih miskin daripada arah keluar, dan itu bukan
 * kekurangan implementasi: berkas OTIO hanya tahu klip, waktu, dan berkas. Ia
 * tidak tahu naskah, gaya, format konten, atau maksud — semua yang membuat
 * scene-plan berguna bagi agent. Hasil impor adalah KERANGKA, dan catatannya
 * mengatakan itu.
 *
 * Trek video pertama jadi scene; trek video berikutnya jadi LAPISAN (ADR-0025).
 */

interface OtioTime {
  value?: unknown;
  rate?: unknown;
}

const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Frame -> detik, memakai rate berkasnya sendiri (bukan asumsi 30fps). */
const seconds = (time: unknown): number => {
  if (!time || typeof time !== "object") return 0;
  const { value, rate } = time as OtioTime;
  const r = num(rate, FPS);
  return r > 0 ? num(value) / r : 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const schemaOf = (node: unknown): string =>
  isRecord(node) && typeof node.OTIO_SCHEMA === "string" ? node.OTIO_SCHEMA : "";

export interface ImportOtioOptions {
  projectDir: string;
  title?: string;
}

export const fromOtio = (
  document: unknown,
  { projectDir, title }: ImportOtioOptions,
): ImportResult => {
  if (schemaOf(document) !== "Timeline.1") {
    throw new Error(
      `Bukan berkas OTIO Timeline (OTIO_SCHEMA = "${schemaOf(document) || "tidak ada"}").`,
    );
  }
  const doc = document as Record<string, unknown>;
  const stack = isRecord(doc.tracks) ? doc.tracks : {};
  const trackList = Array.isArray(stack.children) ? stack.children : [];

  const videoTracks = trackList.filter(
    (track) => isRecord(track) && track.kind === "Video" && Array.isArray(track.children),
  );
  const videoTrack = videoTracks[0];
  if (!videoTrack || !isRecord(videoTrack)) {
    throw new Error(
      "Berkas OTIO ini tidak punya trek video — tidak ada yang bisa jadi scene.",
    );
  }

  const notes: InteropNote[] = [];
  const audioTracks = trackList.filter(
    (track) => isRecord(track) && track.kind === "Audio",
  );
  if (audioTracks.length > 0) {
    notes.push({
      code: "impor-audio-dilewati",
      detail: `${audioTracks.length} trek audio dilewati: narasi Dalang dibuat dari naskah lewat TTS, bukan dari berkas audio yang sudah jadi.`,
    });
  }

  let dilewati = 0;

  /**
   * Baca satu trek jadi daftar klip berwaktu MUTLAK.
   *
   * Kursor ikut maju melewati gap: tanpa itu klip sesudah sebuah lubang akan
   * dilaporkan lebih awal daripada tempatnya, dan sisipan di trek kedua akan
   * dipasangkan ke scene yang salah.
   */
  const readTrack = (track: Record<string, unknown>): ImportedClip[] => {
    const out: ImportedClip[] = [];
    let cursorSec = 0;
    for (const child of (track.children as unknown[]) ?? []) {
      const schema = schemaOf(child);
      if (schema.startsWith("Transition")) continue;
      const sourceRange =
        isRecord(child) && isRecord(child.source_range) ? child.source_range : {};
      const durationSec = seconds(sourceRange.duration);
      if (!isRecord(child) || !schema.startsWith("Clip") || durationSec <= 0) {
        // Gap dan bentuk tak dikenal bukan scene: tidak ada yang bisa
        // ditampilkan. Panjangnya tetap dihitung supaya letak klip sesudahnya
        // tidak melenceng.
        dilewati++;
        cursorSec += Math.max(0, durationSec);
        continue;
      }
      const reference = isRecord(child.media_reference) ? child.media_reference : {};
      const available = isRecord(reference.available_range)
        ? reference.available_range
        : null;
      const sourceDurationSec = available ? seconds(available.duration) : 0;

      out.push({
        name:
          typeof child.name === "string" && child.name
            ? child.name
            : `clip-${out.length + 1}`,
        durationSec,
        sourceStartSec: Math.max(0, seconds(sourceRange.start_time)),
        timelineStartSec: cursorSec,
        ...(typeof reference.target_url === "string"
          ? { url: reference.target_url }
          : {}),
        ...(sourceDurationSec > 0 ? { sourceDurationSec } : {}),
      });
      cursorSec += durationSec;
    }
    return out;
  };

  const clips = readTrack(videoTrack);
  // Trek video KEDUA dan seterusnya jadi lapisan (ADR-0025) — inilah bentuk
  // OTIO untuk B-roll dan PiP, dan sampai fase kesembilan Dalang tidak punya
  // tempat untuk menaruhnya.
  const overlays = videoTracks
    .slice(1)
    .flatMap((track) => (isRecord(track) ? readTrack(track) : []));

  if (dilewati > 0) {
    notes.push({
      code: "impor-item-dilewati",
      detail: `${dilewati} item non-klip (gap atau bentuk yang tidak dikenal) dilewati.`,
    });
  }

  return clipsToPlan(clips, {
    projectDir,
    title: title ?? (typeof doc.name === "string" && doc.name ? doc.name : "Impor OTIO"),
    notes,
    source: "otio",
    overlays,
  });
};
