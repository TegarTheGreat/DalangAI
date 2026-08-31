import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScenePlanInput } from "@dalang/core";
import { FPS } from "@dalang/templates/layout";
import type { InteropNote } from "./report";

/**
 * Impor OTIO menjadi scene-plan (roadmap §8.3).
 *
 * Arah ini secara mendasar lebih miskin daripada arah keluar, dan itu bukan
 * kekurangan implementasi: berkas OTIO hanya tahu klip, waktu, dan berkas.
 * Ia tidak tahu naskah, gaya, format konten, atau maksud — semua yang membuat
 * scene-plan berguna bagi agent. Jadi hasil impor adalah KERANGKA: urutan
 * scene dengan durasi dan aset yang benar, siap diisi.
 *
 * OTIO saja, bukan FCPXML. Alasannya bukan kemalasan: OTIO berbentuk JSON
 * dengan skema bernomor yang bisa divalidasi, sedangkan FCPXML adalah XML
 * dengan lusinan bentuk sah yang sama (`clip`, `asset-clip`, `ref-clip`,
 * `spine` bersarang, `lane`) yang perlu ditafsirkan satu per satu. Membaca
 * separuhnya lalu diam soal sisanya lebih berbahaya daripada tidak membacanya
 * sama sekali — lihat "Batas yang dinyatakan" di ADR-0023.
 */

export interface ImportResult {
  plan: ScenePlanInput;
  notes: InteropNote[];
}

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

/** Nama berkas tanpa ekstensi, dipakai sebagai id scene cadangan. */
const slug = (text: string, index: number): string => {
  const cleaned = text
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned
    ? `sc-${cleaned}`.slice(0, 40)
    : `sc-${String(index + 1).padStart(3, "0")}`;
};

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
  wav: "audio",
  mp3: "audio",
  m4a: "audio",
  aac: "audio",
};

const mediaKindOf = (file: string): "image" | "video" | "audio" =>
  MEDIA_EXT[file.split(".").pop()?.toLowerCase() ?? ""] ?? "video";

export interface ImportOtioOptions {
  /** Folder proyek tujuan — penentu aset mana yang bisa dirujuk plan. */
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

  const videoTrack = trackList.find(
    (track) => isRecord(track) && track.kind === "Video" && Array.isArray(track.children),
  );
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

  const root = resolve(projectDir);
  const scenes: NonNullable<ScenePlanInput["scenes"]> = [];
  const resolvedAssets: Record<string, unknown> = {};
  const luarProyek: string[] = [];
  let dilewati = 0;

  for (const child of videoTrack.children as unknown[]) {
    const schema = schemaOf(child);
    if (schema.startsWith("Transition")) continue;
    if (!isRecord(child)) continue;
    if (schema.startsWith("Gap")) {
      // Lubang di trek sumber bukan scene: tidak ada yang bisa ditampilkan.
      dilewati++;
      continue;
    }
    if (!schema.startsWith("Clip")) {
      dilewati++;
      continue;
    }

    const sourceRange = isRecord(child.source_range) ? child.source_range : {};
    const durationSec = seconds(sourceRange.duration);
    if (durationSec <= 0) {
      dilewati++;
      continue;
    }
    const reference = isRecord(child.media_reference) ? child.media_reference : {};
    const targetUrl =
      typeof reference.target_url === "string" ? reference.target_url : undefined;

    const index = scenes.length;
    const name =
      typeof child.name === "string" && child.name ? child.name : `clip-${index + 1}`;
    const id = slug(name, index);

    let file: string | undefined;
    if (targetUrl?.startsWith("file://")) {
      const absolute = fileURLToPath(targetUrl);
      const rel = relative(root, absolute);
      // Aset di LUAR folder proyek tidak dirujuk: path relatif yang keluar
      // dari proyek akan gagal saat render dan saat proyeknya dipindah. Yang
      // ditawarkan adalah kebenarannya, bukan tautan yang rusak.
      if (rel && !rel.startsWith("..")) file = rel;
      else luarProyek.push(absolute);
    }

    // Titik masuk di dalam sumber — satu-satunya keputusan penyuntingan yang
    // benar-benar terbawa dari berkas OTIO, jadi sayang kalau dibuang.
    const trimStartSec = Math.max(0, seconds(sourceRange.start_time));
    const kind = file ? mediaKindOf(file) : "image";
    scenes.push({
      id,
      narration: "",
      duration: Number(durationSec.toFixed(3)),
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
      const available = isRecord(reference.available_range)
        ? reference.available_range
        : null;
      const sourceDurationSec = available ? seconds(available.duration) : 0;
      resolvedAssets[id] = {
        file,
        kind,
        source: "otio",
        // Hanya ditulis kalau berkasnya memang melaporkannya; `available_range`
        // null di OTIO berarti "tidak diketahui", dan itu harus tetap begitu.
        ...(sourceDurationSec > 0
          ? { durationSec: Number(sourceDurationSec.toFixed(3)) }
          : {}),
      };
    }
  }

  if (scenes.length === 0) {
    throw new Error(
      "Trek video di berkas OTIO ini tidak berisi satu klip pun yang bisa dipakai.",
    );
  }
  if (dilewati > 0) {
    notes.push({
      code: "impor-item-dilewati",
      detail: `${dilewati} item non-klip (gap atau bentuk yang tidak dikenal) dilewati.`,
    });
  }
  if (luarProyek.length > 0) {
    notes.push({
      code: "impor-aset-luar",
      detail: `${luarProyek.length} aset berada di luar folder proyek dan TIDAK dirujuk; scene-nya kosong. Salin berkasnya ke dalam proyek lalu pasang lewat panel Aset.`,
    });
  }
  notes.push({
    code: "impor-kerangka",
    detail:
      "Hasil impor adalah kerangka: urutan dan durasi benar, tapi naskah, caption, gaya, dan gerak kosong — berkas OTIO memang tidak menyimpannya.",
  });

  return {
    plan: {
      version: 1,
      projectId: `impor-${Date.now().toString(36)}`,
      meta: {
        title:
          title ?? (typeof doc.name === "string" && doc.name ? doc.name : "Impor OTIO"),
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
    notes,
  };
};
