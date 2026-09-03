import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_LAYERS, type ScenePlanInput } from "@dalang/core";
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
  /**
   * Letak klip di garis waktu SUMBER, detik. Wajib untuk sisipan (lihat
   * `ClipsToPlanOptions.overlays`); untuk klip jalur utama boleh kosong dan
   * urutannya yang menentukan.
   */
  timelineStartSec?: number;
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
  /**
   * Klip di trek/lane VIDEO tambahan — connected clip FCPXML, trek video kedua
   * OTIO. Masing-masing jadi LAPISAN (ADR-0025) pada scene yang paling banyak
   * bertindih dengannya di garis waktu sumber, jadi tiap sisipan WAJIB punya
   * `timelineStartSec`.
   */
  overlays?: ImportedClip[];
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
  { projectDir, title, notes, source, overlays = [] }: ClipsToPlanOptions,
): ImportResult => {
  if (clips.length === 0) {
    throw new Error("Tidak ada satu klip pun yang bisa dipakai di berkas ini.");
  }
  const root = resolve(projectDir);
  const scenes: NonNullable<ScenePlanInput["scenes"]> = [];
  const clipAssets: Record<string, unknown> = {};
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
    // Satu klip OTIO/FCPXML jadi satu scene berklip-satu (ADR-0033). Pemetaan
    // satu-ke-satu ke `clips[]` — beberapa klip dalam satu scene — menunggu op
    // klipnya ada; sampai itu, memecahnya jadi scene tetap yang paling jujur.
    const clipId = `${id}-k1`;
    scenes.push({
      id,
      narration: "",
      duration: Number(clip.durationSec.toFixed(3)),
      clips: [
        file
          ? {
              id: clipId,
              type: kind === "video" ? "stock" : "image",
              assetId: id,
              pinned: true,
              ...(kind === "video" && trimStartSec > 0
                ? { trimStartSec: Number(trimStartSec.toFixed(3)) }
                : {}),
            }
          : { id: clipId, type: "image", assetId: null },
      ],
      caption: { enabled: false, style: "klasik", size: "m", position: "bottom" },
    });
    if (file) {
      clipAssets[clipId] = {
        file,
        kind,
        source,
        ...(clip.sourceDurationSec !== undefined && clip.sourceDurationSec > 0
          ? { durationSec: Number(clip.sourceDurationSec.toFixed(3)) }
          : {}),
      };
    }
  });

  // --- Sisipan (lane / trek video kedua) jadi LAPISAN (ADR-0025) ----------
  //
  // Scene dipasangkan lewat rentang waktu SUMBER, bukan lewat urutan hasil:
  // gap di spine tidak jadi scene, jadi garis waktu hasil impor lebih pendek
  // daripada aslinya, dan mencocokkan pakai indeks akan menaruh sisipan di
  // scene yang salah begitu ada satu lubang saja.
  const sceneSpans = clips.map((clip, index) => {
    const start =
      clip.timelineStartSec ??
      clips.slice(0, index).reduce((sum, earlier) => sum + earlier.durationSec, 0);
    return { start, end: start + clip.durationSec, index };
  });
  const layerAssets: Record<string, unknown> = {};
  let tanpaScene = 0;
  let kelebihan = 0;
  for (const overlay of overlays) {
    const start = overlay.timelineStartSec ?? 0;
    const end = start + overlay.durationSec;
    let best: { index: number; overlap: number } | null = null;
    for (const span of sceneSpans) {
      const overlap = Math.min(end, span.end) - Math.max(start, span.start);
      if (overlap > 0 && (!best || overlap > best.overlap)) {
        best = { index: span.index, overlap };
      }
    }
    if (!best) {
      tanpaScene++;
      continue;
    }
    const scene = scenes[best.index];
    const span = sceneSpans[best.index];
    if (!scene || !span) {
      tanpaScene++;
      continue;
    }
    if (scene.layers && scene.layers.length >= MAX_LAYERS) {
      kelebihan++;
      continue;
    }

    let file: string | undefined;
    if (overlay.url?.startsWith("file://")) {
      const absolute = fileURLToPath(overlay.url);
      const rel = relative(root, absolute);
      if (rel && !rel.startsWith("..")) file = rel;
      else luarProyek.push(absolute);
    }

    let layerId = slugId(overlay.name, dipakai.size).replace(/^sc-/, "lap-");
    if (dipakai.has(layerId)) {
      let n = 2;
      while (dipakai.has(`${layerId}-${n}`)) n++;
      layerId = `${layerId}-${n}`;
    }
    dipakai.add(layerId);

    const kind = file ? mediaKindOf(file) : "image";
    const sceneLength = Math.max(0.001, span.end - span.start);
    const clampFrac = (value: number) => Math.min(1, Math.max(0, value));
    // Jendela tampil harus punya panjang, dan tetap di dalam [0,1] — skema
    // menolak keduanya kalau dilanggar. Sisipan yang mulai persis di detik
    // terakhir scene (setelah pembulatan empat angka) akan menghasilkan
    // startFrac 1 dan endFrac 1,01: sah secara aritmetika, ditolak skema, dan
    // impor gagal seluruhnya hanya karena satu klip di ujung.
    const startFrac = Math.min(0.99, clampFrac((start - span.start) / sceneLength));
    const endFrac = Math.min(
      1,
      Math.max(startFrac + 0.01, clampFrac((end - span.start) / sceneLength)),
    );
    const trimStartSec = Math.max(0, overlay.sourceStartSec);

    scene.layers = [
      ...(scene.layers ?? []),
      {
        id: layerId,
        visual: {
          type: kind === "video" ? "stock" : "image",
          ...(file ? { assetId: layerId, pinned: true } : {}),
          ...(kind === "video" && trimStartSec > 0
            ? { trimStartSec: Number(trimStartSec.toFixed(3)) }
            : {}),
        },
        startFrac: Number(startFrac.toFixed(4)),
        endFrac: Number(endFrac.toFixed(4)),
      },
    ];
    if (file) {
      layerAssets[layerId] = {
        file,
        kind,
        source,
        ...(overlay.sourceDurationSec !== undefined && overlay.sourceDurationSec > 0
          ? { durationSec: Number(overlay.sourceDurationSec.toFixed(3)) }
          : {}),
      };
    }
  }

  const allNotes = [...notes];
  if (overlays.length > 0) {
    allNotes.push({
      code: "impor-lapisan",
      detail: `${overlays.length - tanpaScene - kelebihan} klip lane/trek video kedua dipulihkan sebagai lapisan video. Letak, ukuran, dan bentuknya TIDAK ada di berkas interchange — semuanya memakai kotak bawaan dan perlu ditata ulang.`,
    });
  }
  if (tanpaScene > 0) {
    allNotes.push({
      code: "impor-lapisan-tanpa-scene",
      detail: `${tanpaScene} klip lane tidak bertindih dengan scene mana pun (menempel di gap) dan dilewati.`,
    });
  }
  if (kelebihan > 0) {
    allNotes.push({
      code: "impor-lapisan-kelebihan",
      detail: `${kelebihan} klip lane dilewati: satu scene menampung paling banyak ${MAX_LAYERS} lapisan.`,
    });
  }
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
      version: 2,
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
        clipAssets: clipAssets as never,
        layerAssets: layerAssets as never,
      },
    },
    notes: allNotes,
  };
};
