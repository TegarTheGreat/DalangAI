import { XMLParser } from "fast-xml-parser";
import { clipsToPlan, type ImportedClip, type ImportResult } from "./import-model";
import type { InteropNote } from "./report";

/**
 * Impor FCPXML menjadi scene-plan (roadmap §8.3, arah kedua).
 *
 * FCPXML jauh lebih sulit dibaca daripada OTIO, dan alasannya struktural: satu
 * hal yang sama bisa ditulis dalam beberapa bentuk sah. Klip di spine bisa
 * berupa `<asset-clip>` (satu berkas), `<clip>` (pembungkus berisi `<video>`),
 * `<ref-clip>` (klip majemuk), atau `<gap>` yang di dalamnya justru ada klip
 * bersarang di lane lain. Letak berkas sumber pindah dari atribut `src`
 * (<= 1.8) ke elemen `<media-rep>` (>= 1.9).
 *
 * Karena itu pembaca ini berpegang pada satu kaidah: **yang tidak dimengerti
 * DIHITUNG dan DILAPORKAN, tidak pernah ditebak.** Berkas yang separuh
 * terbaca dengan diam jauh lebih berbahaya daripada berkas yang ditolak — dan
 * itu pula alasan versi pertama fase ini sengaja tidak membaca FCPXML sama
 * sekali (lihat "Alternatif yang ditolak" di ADR-0023, yang kini dicabut).
 *
 * Yang dibaca: spine UTAMA sebuah sequence, plus connected clip di lane
 * POSITIF — sejak ADR-0025 garis waktu Dalang punya lapisan video, jadi
 * sisipan yang dulu hanya dihitung kini benar-benar dipulihkan. Lane negatif
 * (audio tempelan) tetap dilewati dengan hitungannya: narasi Dalang dibuat
 * dari naskah lewat TTS, bukan dari berkas audio yang sudah jadi.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // ELEMEN selalu array, ATRIBUT tidak pernah. FCPXML membedakan satu klip
  // dari banyak klip hanya lewat pengulangan, dan pembaca yang kadang dapat
  // objek kadang dapat array adalah sumber cacat yang cuma muncul pada berkas
  // berklip satu. Argumen keempat wajib dipakai: tanpa itu atribut ikut jadi
  // array, `offset` jadi ["0s"], dan SEMUA klip dianggap tak terbaca —
  // persis yang terjadi di percobaan pertama pembaca ini.
  isArray: (_name, _path, _leaf, isAttribute) => !isAttribute,
  parseAttributeValue: false,
  trimValues: true,
});

type Node = Record<string, unknown>;

const childrenOf = (node: unknown, name: string): Node[] => {
  if (!node || typeof node !== "object") return [];
  const value = (node as Node)[name];
  return Array.isArray(value) ? (value as Node[]) : [];
};

const attr = (node: Node | undefined, name: string): string | undefined => {
  const value = node?.[`@${name}`];
  return typeof value === "string" ? value : undefined;
};

/**
 * Waktu rasional FCPXML -> detik. Bentuknya "0s", "10s", atau "100/3000s".
 * Nilai tanpa akhiran "s" bukan waktu yang sah dan dikembalikan null supaya
 * pemanggilnya bisa melewatinya alih-alih menghitung angka ngawur.
 */
export const parseFcpTime = (value: string | undefined): number | null => {
  if (!value) return null;
  const match = /^(-?\d+)(?:\/(\d+))?s$/.exec(value.trim());
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = match[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
};

/** Elemen spine yang KAMI mengerti sebagai satu klip video. */
const CLIP_TAGS = ["asset-clip", "clip", "video", "ref-clip"] as const;

interface AssetInfo {
  url?: string;
  durationSec?: number;
}

/** id sumber daya -> berkas, dari `<asset src>` (1.8) atau `<media-rep src>` (1.9+). */
const collectAssets = (resources: Node | undefined): Map<string, AssetInfo> => {
  const assets = new Map<string, AssetInfo>();
  for (const asset of childrenOf(resources, "asset")) {
    const id = attr(asset, "id");
    if (!id) continue;
    const rep = childrenOf(asset, "media-rep").find(
      (candidate) => attr(candidate, "src") !== undefined,
    );
    const src = attr(asset, "src") ?? attr(rep, "src");
    const duration = parseFcpTime(attr(asset, "duration"));
    assets.set(id, {
      ...(src ? { url: src } : {}),
      ...(duration !== null && duration > 0 ? { durationSec: duration } : {}),
    });
  }
  return assets;
};

/**
 * Sequence yang dipakai: yang ada di dalam `<project>` (garis waktu yang
 * sebenarnya diedit orang), bukan yang di dalam `<resources><media>` (itu
 * definisi klip majemuk). Kalau tidak ada project sama sekali, sequence
 * pertama mana pun dipakai — beberapa alat mengekspor tanpa library.
 */
const findSequence = (fcpxml: Node): { sequence: Node; title: string } | null => {
  const projects: Array<{ node: Node; name: string }> = [];
  for (const library of childrenOf(fcpxml, "library")) {
    for (const event of childrenOf(library, "event")) {
      for (const project of childrenOf(event, "project")) {
        projects.push({ node: project, name: attr(project, "name") ?? "Impor FCPXML" });
      }
    }
    for (const project of childrenOf(library, "project")) {
      projects.push({ node: project, name: attr(project, "name") ?? "Impor FCPXML" });
    }
  }
  for (const event of childrenOf(fcpxml, "event")) {
    for (const project of childrenOf(event, "project")) {
      projects.push({ node: project, name: attr(project, "name") ?? "Impor FCPXML" });
    }
  }
  for (const project of childrenOf(fcpxml, "project")) {
    projects.push({ node: project, name: attr(project, "name") ?? "Impor FCPXML" });
  }

  for (const project of projects) {
    const sequence = childrenOf(project.node, "sequence")[0];
    if (sequence) return { sequence, title: project.name };
  }
  const bare = childrenOf(fcpxml, "sequence")[0];
  return bare ? { sequence: bare, title: "Impor FCPXML" } : null;
};

export interface ImportFcpxmlOptions {
  projectDir: string;
  title?: string;
}

export const fromFcpxml = (
  xml: string,
  { projectDir, title }: ImportFcpxmlOptions,
): ImportResult => {
  let document: Node;
  try {
    document = parser.parse(xml) as Node;
  } catch (error) {
    throw new Error(
      `Berkas ini tidak bisa diurai sebagai XML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const fcpxml = childrenOf(document, "fcpxml")[0];
  if (!fcpxml) {
    throw new Error("Bukan berkas FCPXML: tidak ada elemen <fcpxml> di akarnya.");
  }

  const notes: InteropNote[] = [];
  const version = attr(fcpxml, "version");
  const assets = collectAssets(childrenOf(fcpxml, "resources")[0]);
  const found = findSequence(fcpxml);
  if (!found) {
    throw new Error(
      "Berkas FCPXML ini tidak punya <sequence> yang bisa dibaca — tidak ada garis waktu di dalamnya.",
    );
  }
  const spine = childrenOf(found.sequence, "spine")[0];
  if (!spine) {
    throw new Error("Sequence di berkas ini tidak punya <spine>.");
  }
  // Basis waktu sequence; hampir selalu "0s", tapi tidak wajib.
  const sequenceStartSec = parseFcpTime(attr(found.sequence, "tcStart")) ?? 0;

  const clips: ImportedClip[] = [];
  const overlays: ImportedClip[] = [];
  let laneAudio = 0;
  let takDikenal = 0;
  let gaps = 0;

  /** Satu node klip -> ImportedClip; null kalau waktunya tidak sah. */
  const readClip = (node: Node, tag: string, index: number): ImportedClip | null => {
    const offsetSec = parseFcpTime(attr(node, "offset"));
    const durationSec = parseFcpTime(attr(node, "duration"));
    if (offsetSec === null || durationSec === null || durationSec <= 0) return null;
    const ref =
      attr(node, "ref") ??
      attr(childrenOf(node, "video")[0], "ref") ??
      attr(childrenOf(node, "asset-clip")[0], "ref");
    const asset = ref ? assets.get(ref) : undefined;
    return {
      name: attr(node, "name") ?? `${tag}-${index + 1}`,
      durationSec,
      sourceStartSec: parseFcpTime(attr(node, "start")) ?? 0,
      timelineStartSec: offsetSec,
      ...(asset?.url ? { url: asset.url } : {}),
      ...(asset?.durationSec !== undefined
        ? { sourceDurationSec: asset.durationSec }
        : {}),
    };
  };

  /**
   * Connected clip: lane POSITIF jadi lapisan video, lane negatif dilewati.
   *
   * WAKTUNYA TIDAK MUTLAK. `offset` sebuah klip bersarang diukur di basis
   * waktu INDUKNYA, dan induk itu punya titik masuknya sendiri (`start`).
   * Letak sebenarnya di garis waktu karenanya:
   *
   *     mutlak = induk.offset + (anak.offset - induk.start)
   *
   * Menjumlahkan begitu saja (`induk.offset + anak.offset`) terlihat benar
   * pada berkas buatan sendiri, karena di sana `start` kebetulan nol — tapi
   * Final Cut menulis `start="3600s"` untuk gap, dan sisipannya akan mendarat
   * satu jam dari tempatnya.
   */
  const takeLane = (
    node: Node,
    tag: string,
    parentOffsetSec: number,
    parentStartSec: number,
  ): void => {
    const lane = Number(attr(node, "lane"));
    if (!Number.isFinite(lane) || lane < 0) {
      laneAudio++;
      return;
    }
    const clip = readClip(node, tag, overlays.length);
    if (!clip) {
      takDikenal++;
      return;
    }
    const absolute = parentOffsetSec + ((clip.timelineStartSec ?? 0) - parentStartSec);
    if (absolute < 0) {
      // Waktu negatif berarti asumsi basis waktunya meleset. Menaruhnya di
      // detik nol akan menyembunyikan kesalahan itu di dalam plan.
      takDikenal++;
      return;
    }
    overlays.push({ ...clip, timelineStartSec: absolute });
  };

  // Anak spine dibaca APA ADANYA per tag; urutan antar-tag di objek hasil
  // parse tidak berarti apa-apa, jadi urutan garis waktu dipulihkan dengan
  // mengurutkan berdasarkan `offset` — atribut yang memang menentukan letak.
  const entries: Array<{ offsetSec: number; clip: ImportedClip }> = [];

  for (const tag of CLIP_TAGS) {
    for (const node of childrenOf(spine, tag)) {
      if (attr(node, "lane") !== undefined) {
        takeLane(node, tag, 0, sequenceStartSec);
        continue;
      }
      const clip = readClip(node, tag, entries.length);
      if (!clip) {
        takDikenal++;
        continue;
      }
      // Klip majemuk menunjuk `<media>`, bukan berkas. Menebak isinya berarti
      // mengarang; namanya tetap jadi scene, asetnya kosong.
      const ref = attr(node, "ref");
      if (tag !== "ref-clip" && ref && !assets.get(ref)) takDikenal++;
      entries.push({ offsetSec: clip.timelineStartSec ?? 0, clip });
      // Connected clip bisa bersarang DI DALAM klip spine; offsetnya relatif
      // terhadap klip induk itu.
      const parentStart = parseFcpTime(attr(node, "start")) ?? 0;
      for (const inner of CLIP_TAGS) {
        for (const child of childrenOf(node, inner)) {
          if (attr(child, "lane") !== undefined) {
            takeLane(child, inner, clip.timelineStartSec ?? 0, parentStart);
          }
        }
      }
    }
  }

  for (const node of childrenOf(spine, "gap")) {
    if (attr(node, "lane") === undefined) gaps++;
    // Klip yang bersarang DI DALAM gap tetap connected clip di lane lain —
    // pola yang dipakai Final Cut untuk sisipan tanpa klip utama di bawahnya.
    const parentOffset = parseFcpTime(attr(node, "offset")) ?? 0;
    const parentStart = parseFcpTime(attr(node, "start")) ?? 0;
    for (const tag of CLIP_TAGS) {
      for (const child of childrenOf(node, tag)) {
        takeLane(child, tag, parentOffset, parentStart);
      }
    }
  }

  entries.sort((a, b) => a.offsetSec - b.offsetSec);
  clips.push(...entries.map((entry) => entry.clip));

  if (version && version !== "1.8") {
    notes.push({
      code: "impor-versi-fcpxml",
      detail: `Berkas ini FCPXML ${version}; pembaca Dalang diuji terhadap 1.8 dan bentuk <media-rep> versi 1.9+. Periksa hasilnya kalau ada klip yang hilang.`,
    });
  }
  if (laneAudio > 0) {
    notes.push({
      code: "impor-lane-audio-dilewati",
      detail: `${laneAudio} klip di lane negatif (audio tempelan) dilewati: narasi Dalang dibuat dari naskah lewat TTS, bukan dari berkas audio yang sudah jadi.`,
    });
  }
  if (gaps > 0) {
    notes.push({
      code: "impor-gap-dilewati",
      detail: `${gaps} gap di spine dilewati: lubang kosong bukan scene.`,
    });
  }
  if (takDikenal > 0) {
    notes.push({
      code: "impor-item-dilewati",
      detail: `${takDikenal} elemen spine tidak dimengerti (waktu tidak sah, atau menunjuk sumber daya yang bukan berkas) dan dilewati.`,
    });
  }

  return clipsToPlan(clips, {
    projectDir,
    title: title ?? found.title,
    notes,
    source: "fcpxml",
    overlays,
  });
};
