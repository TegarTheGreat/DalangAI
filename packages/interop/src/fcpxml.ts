import type { EditClip, EditTimeline, EditTrack } from "./timeline";

/**
 * Penulis FCPXML 1.8.
 *
 * Bentuknya disalin dari berkas contoh yang dipakai adapter resmi
 * OpenTimelineIO (`otio-fcpx-xml-adapter`), bukan dari ingatan — FCPXML punya
 * banyak atribut yang kelihatan opsional tapi membuat Final Cut menolak
 * berkasnya tanpa pesan yang berguna.
 *
 * Kenapa 1.8 dan bukan versi terbaru: pada 1.9 letak berkas sumber pindah dari
 * atribut `src` ke elemen `<media-rep>`. Versi 1.8 dibaca oleh SEMUA yang jadi
 * sasaran ekspor ini (Final Cut, DaVinci Resolve, Premiere lewat konverter),
 * sedangkan yang lebih baru belum tentu. Ekspor yang bisa dibuka lebih berguna
 * daripada ekspor yang paling mutakhir.
 *
 * Yang SENGAJA tidak ditulis:
 *  - transisi. Transisi FCP butuh sumber daya `<effect>` yang menunjuk berkas
 *    .motn di dalam bundel aplikasi Final Cut; id-nya berbeda antar versi dan
 *    tidak ada artinya di Resolve. Klipnya diekspor adu-tumpul dan transisinya
 *    dicatat di laporan. Adapter resmi OTIO pun menandai transisi "tidak
 *    didukung" di matriks fiturnya.
 *  - `<title>` untuk teks overlay, dengan alasan yang sama: judul FCP juga
 *    menunjuk .motn milik aplikasi.
 * Naskah tiap scene tetap ikut, sebagai `<marker>` dan `<note>`.
 */

const FCPXML_VERSION = "1.8";

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Waktu rasional FCPXML.
 *
 * Penyebutnya sengaja TIDAK disederhanakan: Final Cut sendiri menulis
 * `frameDuration="100/3000s"` untuk 30fps, dan menjaga penyebut kelipatan
 * basis waktu menjamin tiap nilai jatuh persis di batas frame. Pecahan yang
 * "rapi" seperti 11/2s sah secara matematika tapi bisa mendarat di antara dua
 * frame setelah dibulatkan pembacanya.
 */
const rational = (frames: number, fps: number): string => {
  if (frames === 0) return "0s";
  return `${frames * 100}/${fps * 100}s`;
};

interface AssetRef {
  id: string;
  url: string;
  media: "image" | "video" | "audio";
  /** Panjang sumber dalam frame; null = tidak diketahui. */
  sourceFrames: number | null;
  name: string;
}

/** Satu sumber daya per BERKAS, bukan per klip — satu rekaman bisa dipakai berkali-kali. */
const collectAssets = (timeline: EditTimeline): Map<string, AssetRef> => {
  const assets = new Map<string, AssetRef>();
  let next = 2; // r1 dipakai <format>
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      if (item.kind !== "clip" || assets.has(item.url)) continue;
      assets.set(item.url, {
        id: `r${next++}`,
        url: item.url,
        media: item.media,
        sourceFrames:
          item.sourceDurationSec === null
            ? null
            : Math.max(1, Math.round(item.sourceDurationSec * timeline.fps)),
        name: item.name,
      });
    }
  }
  return assets;
};

const assetElement = (asset: AssetRef, fps: number): string => {
  const attrs: string[] = [
    `id="${asset.id}"`,
    `name="${escapeXml(asset.name)}"`,
    `src="${escapeXml(asset.url)}"`,
    `start="0s"`,
    // Gambar diam: FCP memperlakukan aset tanpa panjang sebagai stills dan
    // membiarkan klipnya menentukan durasi, jadi "0s" di sini benar — bukan
    // panjang karangan.
    `duration="${asset.sourceFrames === null ? "0s" : rational(asset.sourceFrames, fps)}"`,
    `format="r1"`,
  ];
  if (asset.media === "audio") {
    attrs.push('hasAudio="1"', 'audioSources="1"');
  } else {
    attrs.push('hasVideo="1"');
  }
  return `        <asset ${attrs.join(" ")}/>`;
};

const clipElement = (
  clip: EditClip,
  asset: AssetRef,
  fps: number,
  lane: number | null,
): string => {
  const attrs: string[] = [
    `name="${escapeXml(clip.name)}"`,
    `ref="${asset.id}"`,
    `offset="${rational(clip.startFrame, fps)}"`,
    `duration="${rational(clip.durationFrames, fps)}"`,
  ];
  const startFrames = Math.round(clip.sourceStartSec * fps);
  if (startFrames > 0) attrs.push(`start="${rational(startFrames, fps)}"`);
  if (lane !== null) attrs.push(`lane="${lane}"`);
  if (clip.media === "audio") attrs.push('audioRole="dialogue"');

  const children = clip.markers.map(
    (marker) =>
      `                    <marker start="${rational(marker.startFrame, fps)}" duration="${rational(
        Math.max(1, marker.durationFrames),
        fps,
      )}" value="${escapeXml(marker.value)}"/>`,
  );
  if (children.length === 0) {
    return `                <asset-clip ${attrs.join(" ")}/>`;
  }
  return [
    `                <asset-clip ${attrs.join(" ")}>`,
    ...children,
    "                </asset-clip>",
  ].join("\n");
};

const gapElement = (startFrame: number, durationFrames: number, fps: number): string =>
  `                <gap name="Gap" offset="${rational(startFrame, fps)}" duration="${rational(
    durationFrames,
    fps,
  )}" start="3600s"/>`;

/**
 * Spine FCP hanya menampung SATU rangkaian utama; trek lain digantung
 * sebagai "connected clips" lewat atribut `lane`. Lane positif di atas
 * (video), negatif di bawah (audio) — konvensi Final Cut, bukan pilihan kami.
 */
const laneFor = (track: EditTrack, index: number): number | null =>
  index === 0 ? null : track.kind === "audio" ? -index : index;

export const toFcpxml = (timeline: EditTimeline): string => {
  const assets = collectAssets(timeline);
  const { fps, width, height } = timeline;

  const spine: string[] = [];
  timeline.tracks.forEach((track, index) => {
    const lane = laneFor(track, index);
    for (const item of track.items) {
      if (item.kind === "gap") {
        // Gap hanya bermakna di rangkaian utama; di lane, ketiadaan klip
        // sudah berarti sunyi.
        if (lane === null)
          spine.push(gapElement(item.startFrame, item.durationFrames, fps));
        continue;
      }
      const asset = assets.get(item.url);
      if (asset) spine.push(clipElement(item, asset, fps, lane));
    }
  });

  const notes = timeline.notes.map((note) => `         ${escapeXml(note.detail)}`);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE fcpxml>",
    "",
    `<fcpxml version="${FCPXML_VERSION}">`,
    "    <resources>",
    `        <format id="r1" name="DalangFormat${height}p${fps}" frameDuration="${rational(1, fps)}" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>`,
    ...[...assets.values()].map((asset) => assetElement(asset, fps)),
    "    </resources>",
    `    <library>`,
    `        <event name="${escapeXml(timeline.name)}">`,
    `            <project name="${escapeXml(timeline.name)}">`,
    `                <sequence format="r1" duration="${rational(timeline.totalFrames, fps)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    "                    <spine>",
    ...spine.map((line) => `        ${line}`),
    "                    </spine>",
    "                </sequence>",
    "            </project>",
    "        </event>",
    "    </library>",
    // Catatan ikut MASUK ke berkasnya: berkas ekspor sering berpindah tangan
    // tanpa log terminal yang menyertainya.
    ...(notes.length > 0
      ? ["    <!-- Tidak ikut menyeberang:", ...notes, "    -->"]
      : []),
    "</fcpxml>",
    "",
  ].join("\n");
};
