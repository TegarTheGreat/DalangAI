import { renameSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { mixCorrection } from "@dalang/pipeline";
import { applyGain, measureMediaLoudness } from "./ffmpeg";

/**
 * Koreksi campuran akhir (ADR-0028 §9).
 *
 * Normalisasi per klip (ADR-0026) menjanjikan sumber yang setara, bukan program
 * yang tepat sasaran: ducking, amplop, dan musik yang ditumpuk bisa menggeser
 * hasil akhirnya beberapa LU. Di sini berkas HASIL render diukur, digeser
 * dengan penguatan rata ke `meta.loudnessTarget` (dipangkas oleh langit-langit
 * puncak, lihat `mixCorrection`), lalu diukur lagi — angka yang dilaporkan
 * adalah angka berkas yang benar-benar ditulis.
 *
 * Yang tidak pernah terjadi di sini: render yang sudah jadi digagalkan. Setiap
 * jalan buntu (tidak terukur, format yang audionya tidak bisa dienkode ulang,
 * ffmpeg gagal) meninggalkan berkas aslinya utuh dan mengatakan kenapa.
 */

export interface MixAudioSpec {
  /** Kodek audio profil ekspor (lihat `encoderArgs`). */
  codec: "aac" | "opus" | "pcm-16";
  bitrate?: string;
}

export interface MixReport {
  /** Kenyaringan berkas SEKARANG, LUFS; null = tidak terukur. */
  lufs: number | null;
  /** Kenyaringan sebelum koreksi; sama dengan `lufs` bila tidak dikoreksi. */
  lufsBefore: number | null;
  /** Penguatan yang diterapkan, dB; 0 = berkas tidak disentuh. */
  gainDb: number;
  /** Kalimat keadaan untuk CLI dan Studio. */
  note: string;
}

const untouched = (lufs: number | null, note: string): MixReport => ({
  lufs,
  lufsBefore: lufs,
  gainDb: 0,
  note,
});

export const finalizeMix = async (
  outputLocation: string,
  audio: MixAudioSpec,
  target: number | null,
): Promise<MixReport> => {
  const measured = await measureMediaLoudness(outputLocation);
  if (!measured) return untouched(null, "campuran tidak terukur");
  const before = measured.lufs;
  const decision = mixCorrection(measured, target);
  if (decision.gainDb === 0) return untouched(before, decision.reason);

  // Build ramping ffmpeg Remotion punya enkoder aac dan pcm, tidak punya opus:
  // WebM dilaporkan apa adanya, bukan dienkode ulang ke kodek yang salah.
  const codec =
    audio.codec === "aac" ? "aac" : audio.codec === "pcm-16" ? "pcm_s16le" : null;
  if (!codec) {
    return untouched(
      before,
      `tidak dikoreksi: audio ${audio.codec} tidak bisa dienkode ulang oleh ffmpeg bawaan Remotion (${decision.reason})`,
    );
  }

  const ext = extname(outputLocation);
  const temp = `${outputLocation.slice(0, outputLocation.length - ext.length)}.koreksi${ext}`;
  const applied = await applyGain(outputLocation, temp, decision.gainDb, {
    codec,
    ...(audio.bitrate ? { bitrate: audio.bitrate } : {}),
  });
  if (!applied.ok) {
    rmSync(temp, { force: true });
    return untouched(before, `koreksi gagal: ${applied.reason}`);
  }
  renameSync(temp, outputLocation);
  const after = await measureMediaLoudness(outputLocation);
  return {
    lufs: after?.lufs ?? null,
    lufsBefore: before,
    gainDb: decision.gainDb,
    note: `${decision.reason} dari ${before === null ? "?" : before.toFixed(1)} LUFS`,
  };
};
