import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScenePlanInput } from "@dalang/core";
import type { InteropNote } from "./report";

/**
 * Bagian impor yang TIDAK bergantung pada formatnya.
 *
 * OTIO dan FCPXML berbeda jauh di permukaan — JSON berskema versus XML dengan
 * lusinan bentuk sah — tapi keduanya berakhir pada pertanyaan yang sama: klip
 * apa saja, berapa lama, dari berkas mana, mulai detik ke berapa di dalamnya.
 * Begitu dua pembaca menjawab itu, sisanya (jadi scene, memutuskan aset mana
 * yang boleh dirujuk, menyusun catatan) persis sama — dan menuliskannya dua
 * kali berarti dua tempat yang bisa menyimpang.
 */

/** Satu klip hasil baca, sudah dalam satuan detik. */
export interface ImportedClip {
  name: string;
  durationSec: number;
  /** Titik masuk di dalam berkas sumber. */
  sourceStartSec: number;
  /** file:// URL berkas sumber; undefined kalau berkasnya tidak diketahui. */
  url?: string;
  /** Panjang berkas sumber kalau dilaporkan berkasnya. */
  sourceDurationSec?: number;
}

export interface ImportResult {
  plan: ScenePlanInput;
  notes: InteropNote[];
}

export interface ClipsToPlanOptions {
  /** Folder proyek tujuan — penentu aset mana yang boleh dirujuk plan. */
  projectDir: string;
  title: string;
  /** Catatan yang sudah dikumpulkan pembaca formatnya. */
  notes: InteropNote[];
  /** Nama format asal, untuk field `source` di renderState. */
  source: string;
}

const MEDIA_EXT: Record<string, "image" | "video" | "audio"> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  svg: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  m4v: "video",
  wav: "audio",
  mp3: "audio",
  m4a: "audio",
  aac: "audio",
};

export const mediaKindOf = (file: string): "image" | "video" | "audio" =>
  MEDIA_EXT[file.split(".").pop()?.toLowerCase() ?? ""] ?? "video";

/** Nama berkas jadi id scene yang sah; nomor urut kalau namanya tidak menyisakan apa pun. */
export const slugId = (text: string, index: number): string => {
  const cleaned = text
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned
    ? `sc-${cleaned}`.slice(0, 40)
    : `sc-${String(index + 1).padStart(3, "0")}`;
};

export const clipsToPlan = (
  clips: ImportedClip[],
  { projectDir, title, notes, source }: ClipsToPlanOptions,
): ImportResult => {
  if (clips.length === 0) {
    throw new Error("Tidak ada satu klip pun yang bisa dipakai di berkas ini.");
  }
  const root = resolve(projectDir);
  const scenes: NonNullable<ScenePlanInput["scenes"]> = [];
  const resolvedAssets: Record<string, unknown> = {};
  const luarProyek: string[] = [];
  const dipakai = new Set<string>();

  clips.forEach((clip, index) => {
    let file: string | undefined;
    if (clip.url?.startsWith("file://")) {
      const absolute = fileURLToPath(clip.url);
      const rel = relative(root, absolute);
      // Aset di LUAR folder proyek tidak dirujuk: path relatif yang keluar dari
      // proyek akan gagal saat render dan saat proyeknya dipindah. Yang
      // ditawarkan adalah kebenarannya, bukan tautan yang rusak.
      if (rel && !rel.startsWith("..")) file = rel;
      else luarProyek.push(absolute);
    }

    // Id harus unik: satu rekaman yang dipakai lima kali menghasilkan lima
    // klip bernama sama, dan skema menolak scene berid kembar.
    let id = slugId(clip.name, index);
    if (dipakai.has(id)) {
      let n = 2;
      while (dipakai.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    dipakai.add(id);

    const kind = file ? mediaKindOf(file) : "image";
    const trimStartSec = Math.max(0, clip.sourceStartSec);
    scenes.push({
      id,
      narration: "",
      duration: Number(clip.durationSec.toFixed(3)),
      visual: file
        ? {
            type: kind === "video" ? "stock" : "image",
            assetId: id,
            pinned: true,
            ...(kind === "video" && trimStartSec > 0
              ? { trimStartSec: Number(trimStartSec.toFixed(3)) }
              : {}),
          }
        : { type: "image", assetId: null },
      caption: { enabled: false, style: "klasik", size: "m", position: "bottom" },
    });
    if (file) {
      resolvedAssets[id] = {
        file,
        kind,
        source,
        ...(clip.sourceDurationSec !== undefined && clip.sourceDurationSec > 0
          ? { durationSec: Number(clip.sourceDurationSec.toFixed(3)) }
          : {}),
      };
    }
  });

  const allNotes = [...notes];
  if (luarProyek.length > 0) {
    allNotes.push({
      code: "impor-aset-luar",
      detail: `${luarProyek.length} aset berada di luar folder proyek dan TIDAK dirujuk; scene-nya kosong. Salin berkasnya ke dalam proyek lalu pasang lewat panel Aset.`,
    });
  }
  allNotes.push({
    code: "impor-kerangka",
    detail:
      "Hasil impor adalah kerangka: urutan dan durasi benar, tapi naskah, caption, gaya, dan gerak kosong — berkas interchange memang tidak menyimpannya.",
  });

  return {
    plan: {
      version: 1,
      projectId: `impor-${Date.now().toString(36)}`,
      meta: {
        title,
        aspectRatio: "16:9",
        language: "id",
        stylePreset: "documentary-01",
      },
      audio: {},
      scenes,
      renderState: {
        narrationAudio: {},
        resolvedAssets: resolvedAssets as never,
      },
    },
    notes: allNotes,
  };
};
