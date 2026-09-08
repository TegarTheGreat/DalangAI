import type { ScenePlan } from "@dalang/core";
import { NARRATION_LEAD_IN_SEC } from "@dalang/core";
import { sceneCaptionWords } from "./captions-model";
import { computeFrameLayout, FPS } from "./layout";

/**
 * Berkas subtitle (ADR-0039): `.srt` dan `.vtt` yang bisa diunggah ke YouTube.
 *
 * Murni — masuk plan, keluar teks. Tidak menyentuh React, tidak menyentuh
 * disk, jadi seluruh aturannya bisa diuji sebagai string alih-alih diperiksa
 * dengan mengunggah berkas ke YouTube lalu melihat hasilnya.
 *
 * KENAPA PENGELOMPOKANNYA BERBEDA dari caption yang dibakar ke gambar.
 * Caption layar dirancang untuk dibaca SAMBIL menonton: potongan tiga-empat
 * kata, kata aktif menyala, berganti cepat. Itu benar untuk pekerjaannya.
 * Subtitle sidecar dibaca oleh pemutar YouTube dengan gayanya sendiri, dan
 * kebiasaan subtitle sudah mapan sejak sebelum ada video daring: satu sampai
 * dua baris, sekitar 42 karakter per baris, satu sampai tujuh detik. Berkas
 * yang meniru potongan tiga kata akan berkedip lima kali per kalimat.
 *
 * Yang DIBAGI dengan caption layar bukan pengelompokannya, melainkan
 * KEBENARANNYA: kata apa, pada milidetik ke berapa. Itu datang dari
 * `sceneCaptionWords` yang sama — termasuk jalur transkrip per potongan untuk
 * scene yang bersumber rekaman (ADR-0033).
 */

/** Satu kartu subtitle. */
export interface SubtitleCue {
  /** Milidetik dari awal VIDEO, bukan dari awal scene. */
  startMs: number;
  endMs: number;
  /** Sudah dipatah; paling banyak `SUBTITLE_MAX_LINES` baris. */
  lines: string[];
}

/** Kebiasaan subtitle yang sudah mapan; bukan angka karangan. */
export const SUBTITLE_MAX_CHARS_PER_LINE = 42;
export const SUBTITLE_MAX_LINES = 2;
/**
 * Kartu yang lebih pendek dari ini berkedip sebelum sempat dibaca. Ujungnya
 * dipanjangkan, TIDAK pernah awalnya dimajukan: awal kartu harus tetap
 * bertemu kata pertamanya, atau teksnya muncul sebelum orangnya diucapkan.
 */
export const SUBTITLE_MIN_MS = 1200;
/** Kartu yang lebih panjang dari ini berhenti terbaca sebagai satu gagasan. */
export const SUBTITLE_MAX_MS = 7000;
/** Jeda sebesar ini di antara dua kata sudah terdengar sebagai batas kalimat. */
export const SUBTITLE_GAP_MS = 700;

const MAX_CHARS = SUBTITLE_MAX_CHARS_PER_LINE * SUBTITLE_MAX_LINES;

/** Kata yang mengakhiri kalimat — batas paling alami untuk memotong kartu. */
const endsSentence = (word: string): boolean => /[.!?…]["')\]]*$/.test(word.trim());

/** Kata yang mengakhiri anak kalimat — batas terbaik KEDUA. */
const endsClause = (word: string): boolean => /[,;:—–)]["')\]]*$/.test(word.trim());

/**
 * Seberapa jauh ke belakang boleh mencari titik potong yang lebih baik saat
 * kartu terpaksa dipotong karena kelebaran.
 *
 * Batasnya ada supaya perbaikan ini tidak berubah jadi kerusakan: mundur
 * terlalu jauh menghasilkan kartu pertama yang nyaris kosong dan kartu kedua
 * yang kembali kepenuhan, lalu keduanya dipotong lagi.
 */
const CLAUSE_LOOKBACK = 0.45;

/**
 * Patah jadi paling banyak dua baris, dibagi di spasi yang PALING SEIMBANG.
 *
 * Seimbang, bukan "isi baris pertama sampai penuh": baris pertama penuh dan
 * baris kedua berisi satu kata adalah bentuk yang paling sering membuat mata
 * melompat balik. Kalau tidak ada spasi sama sekali (satu kata sangat
 * panjang), teksnya dibiarkan utuh — satu baris kepanjangan masih jauh lebih
 * baik daripada kata yang dipotong di tengah.
 */
export const wrapSubtitleText = (text: string): string[] => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= SUBTITLE_MAX_CHARS_PER_LINE) return [clean];

  const tengah = clean.length / 2;
  let best = -1;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== " ") continue;
    if (best < 0 || Math.abs(i - tengah) < Math.abs(best - tengah)) best = i;
  }
  if (best < 0) return [clean];
  return [clean.slice(0, best).trim(), clean.slice(best + 1).trim()];
};

interface TimedWord {
  word: string;
  startMs: number;
  endMs: number;
}

/**
 * Kelompokkan kata jadi kartu.
 *
 * Empat sebab memotong, dan urutannya tidak penting karena keempatnya
 * memotong di tempat yang sama-sama masuk akal: jeda panjang (orangnya
 * berhenti bicara), kartu jadi terlalu lebar, kartu jadi terlalu lama, dan
 * kata sebelumnya mengakhiri kalimat.
 */
const groupWords = (words: readonly TimedWord[]): SubtitleCue[] => {
  const cues: SubtitleCue[] = [];
  let current: TimedWord[] = [];

  const emit = (chunk: TimedWord[]) => {
    if (chunk.length === 0) return;
    const text = chunk.map((item) => item.word).join(" ");
    const startMs = chunk[0]?.startMs ?? 0;
    const endMs = chunk[chunk.length - 1]?.endMs ?? startMs;
    if (text.trim() !== "") cues.push({ startMs, endMs, lines: wrapSubtitleText(text) });
  };

  /**
   * Potong kartu, dan kalau sebabnya KELEBARAN — bukan jeda atau akhir
   * kalimat — cari dulu titik potong yang lebih enak dibaca.
   *
   * Tanpa ini, potongannya jatuh persis di tempat karakter ke-84 kebetulan
   * mendarat, dan frasa terbelah di tengah: "…candi Buddha" / "terbesar yang
   * pernah dibangun manusia." Mata membaca kartu pertama sebagai kalimat
   * selesai, lalu harus mengoreksi diri di kartu berikutnya. Batas anak
   * kalimat — koma, titik koma, tanda pisah — hampir selalu ada di dekat
   * situ, dan memotong di sana membuat kedua kartu berdiri sendiri.
   */
  const potong = (karenaLebar: boolean) => {
    if (!karenaLebar || current.length < 4) {
      emit(current);
      current = [];
      return;
    }
    const paling = Math.ceil(current.length * CLAUSE_LOOKBACK);
    let titik = -1;
    for (let i = paling; i < current.length - 1; i++) {
      if (endsClause(current[i]?.word ?? "")) titik = i;
    }
    if (titik < 0) {
      emit(current);
      current = [];
      return;
    }
    emit(current.slice(0, titik + 1));
    current = current.slice(titik + 1);
  };

  for (const word of words) {
    const last = current[current.length - 1];
    if (last) {
      const teks = current.map((item) => item.word).join(" ");
      const jeda = word.startMs - last.endMs;
      const lebar = teks.length + 1 + word.word.length;
      const lama = word.endMs - (current[0]?.startMs ?? word.startMs);
      if (jeda > SUBTITLE_GAP_MS || endsSentence(last.word)) potong(false);
      else if (lebar > MAX_CHARS || lama > SUBTITLE_MAX_MS) potong(true);
    }
    current.push(word);
  }
  emit(current);
  return cues;
};

/**
 * Rapikan waktu kartu supaya bisa dibaca DAN sah menurut pembaca subtitle.
 *
 * Dua hal yang membuat berkas ditolak atau tampil kacau, dan keduanya mudah
 * muncul dari data nyata: kartu berdurasi nol (dua kata dengan cap waktu yang
 * sama) dan kartu yang bertindihan (kartu pendek yang dipanjangkan menabrak
 * kartu berikutnya). Keduanya diperbaiki di sini, bukan diserahkan ke pemutar.
 */
const tidy = (cues: SubtitleCue[]): SubtitleCue[] => {
  const out: SubtitleCue[] = [];
  cues.forEach((cue, index) => {
    const next = cues[index + 1];
    const startMs = Math.max(0, Math.round(cue.startMs));
    let endMs = Math.round(cue.endMs);
    if (endMs - startMs < SUBTITLE_MIN_MS) endMs = startMs + SUBTITLE_MIN_MS;
    if (next) endMs = Math.min(endMs, Math.round(next.startMs) - 1);
    // Kartu yang bahkan tidak muat satu milidetik tetap harus punya durasi:
    // pembaca subtitle memperlakukan end <= start sebagai berkas rusak.
    if (endMs <= startMs) endMs = startMs + 1;
    out.push({ startMs, endMs, lines: cue.lines });
  });
  return out;
};

/**
 * Seluruh kartu subtitle sebuah plan, dalam waktu VIDEO.
 *
 * Waktunya diambil dari `computeFrameLayout` — tata letak yang SAMA dengan
 * yang dipakai renderer — bukan dari `computeTimeline` core. Bedanya bukan
 * detail: transisi membuat scene bertumpuk, sehingga jumlah durasi scene
 * (17,2 dtk pada contoh klip-borobudur) tidak sama dengan panjang videonya
 * (16,0 dtk). Subtitle yang dihitung dari jumlah durasi akan melenceng
 * beberapa detik di akhir video, dan melencengnya bertambah tiap transisi.
 *
 * Scene yang caption layarnya DIMATIKAN tetap dapat subtitle. Mematikan
 * caption adalah keputusan tampilan; subtitle sidecar adalah keterjangkauan —
 * dan alasan paling sering mematikan caption bakar justru karena berkas
 * subtitle-nya akan diunggah terpisah.
 */
export const buildSubtitleCues = (plan: ScenePlan): SubtitleCue[] => {
  const layout = computeFrameLayout(plan);
  const words: TimedWord[] = [];

  plan.scenes.forEach((scene, index) => {
    const sceneFrames = layout.sceneFrames[index] ?? 0;
    if (sceneFrames <= 0) return;
    const sceneStartMs = ((layout.sceneStarts[index] ?? 0) / FPS) * 1000;
    const { words: kata, offsetMs } = sceneCaptionWords(scene, plan, sceneFrames, FPS);
    for (const item of kata) {
      const text = item.word.trim();
      if (text === "") continue;
      words.push({
        word: text,
        startMs: sceneStartMs + offsetMs + item.startSec * 1000,
        endMs: sceneStartMs + offsetMs + item.endSec * 1000,
      });
    }
  });

  // Diurutkan ulang: scene bertumpuk saat transisi, jadi kata terakhir sebuah
  // scene bisa jatuh SESUDAH kata pertama scene berikutnya. Berkas subtitle
  // yang waktunya mundur ditolak sebagian pembaca dan diabaikan sisanya.
  words.sort((a, b) => a.startMs - b.startMs);
  return tidy(groupWords(words));
};

/** `HH:MM:SS<pemisah>mmm` — SRT memakai koma, WebVTT memakai titik. */
export const timestamp = (ms: number, separator: "," | "."): string => {
  const total = Math.max(0, Math.round(ms));
  const jam = Math.floor(total / 3_600_000);
  const menit = Math.floor((total % 3_600_000) / 60_000);
  const detik = Math.floor((total % 60_000) / 1000);
  const mili = total % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(jam)}:${pad(menit)}:${pad(detik)}${separator}${pad(mili, 3)}`;
};

/**
 * SubRip (`.srt`) — format yang diterima YouTube, Premiere, Resolve, dan
 * hampir semua pemutar.
 *
 * Baris baru LF, tanpa BOM. Beberapa pemutar Windows lama menuntut CRLF dan
 * BOM; YouTube tidak, dan menambahkan keduanya membuat berkasnya lebih sulit
 * dibaca perkakas lain. Ini keputusan, bukan kelalaian.
 */
export const toSrt = (cues: readonly SubtitleCue[]): string =>
  cues
    .map(
      (cue, index) =>
        `${index + 1}\n${timestamp(cue.startMs, ",")} --> ${timestamp(cue.endMs, ",")}\n${cue.lines.join("\n")}\n`,
    )
    .join("\n");

/**
 * WebVTT (`.vtt`) — format subtitle web, dan yang dipakai `<track>` HTML.
 *
 * Wajib diawali `WEBVTT`; tanpa baris itu berkasnya bukan VTT, betapa pun
 * benar sisanya.
 */
export const toVtt = (cues: readonly SubtitleCue[]): string =>
  `WEBVTT\n\n${cues
    .map(
      (cue) =>
        `${timestamp(cue.startMs, ".")} --> ${timestamp(cue.endMs, ".")}\n${cue.lines.join("\n")}\n`,
    )
    .join("\n")}`;

export const SUBTITLE_FORMATS = ["srt", "vtt"] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

/** Berkas subtitle lengkap dari sebuah plan, siap ditulis ke disk. */
export const renderSubtitle = (plan: ScenePlan, format: SubtitleFormat): string => {
  const cues = buildSubtitleCues(plan);
  return format === "srt" ? toSrt(cues) : toVtt(cues);
};

/** Detik lead-in narasi, diekspor ulang supaya tes bisa menghitung harapannya. */
export { NARRATION_LEAD_IN_SEC };
