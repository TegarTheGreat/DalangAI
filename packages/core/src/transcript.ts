import {
  clipAsset,
  getScene,
  primaryClip,
  type ScenePlan,
  type Transcript,
  type TranscriptWord,
  type WordTimestamp,
} from "./scene-plan";

/**
 * Fungsi murni di atas transkrip (ADR-0021).
 *
 * Transkrip dikunci per BERKAS MEDIA, bukan per scene, karena satu rekaman
 * panjang boleh dipakai banyak scene dengan titik masuk berbeda — dan karena
 * scene bisa berganti aset tanpa membuat transkripnya basi.
 *
 * Semua fungsi di sini bekerja pada waktu REKAMAN (0 = awal berkas), sama
 * seperti keluaran ASR. Penerjemahan ke waktu scene dilakukan pemanggilnya,
 * yang tahu `visual.trimStartSec`.
 */

/** Transkrip untuk berkas sebuah KLIP, kalau ada (ADR-0033). */
export const transcriptForClip = (
  plan: ScenePlan,
  clipId: string,
): Transcript | undefined => {
  const file = clipAsset(plan, clipId)?.file;
  return file ? plan.renderState.transcripts[file] : undefined;
};

/**
 * Transkrip untuk visual DASAR sebuah scene, kalau ada.
 *
 * Sengaja tetap menyasar potongan pertama, bukan menggabungkan semuanya:
 * pemakainya adalah caption karaoke, yang menerjemahkan waktu rekaman ke waktu
 * scene memakai satu `trimStartSec` — dan menyatukan transkrip beberapa
 * rekaman di belakangnya berarti mengarang satu garis waktu yang tidak dimiliki
 * berkas mana pun. Untuk potongan tertentu, pakai `transcriptForClip`.
 */
export const transcriptForScene = (
  plan: ScenePlan,
  sceneId: string,
): Transcript | undefined => {
  const scene = getScene(plan, sceneId);
  return scene ? transcriptForClip(plan, primaryClip(scene).id) : undefined;
};

/** Kata-kata yang jatuh di dalam rentang waktu rekaman, inklusif-tumpang-tindih. */
export const wordsInSpan = (
  transcript: Transcript,
  fromSec: number,
  toSec: number,
): TranscriptWord[] =>
  transcript.words.filter((word) => word.endSec > fromSec && word.startSec < toSec);

/** Teks polos untuk rentang waktu — yang dibaca agent sebelum memutuskan potongan. */
export const textInSpan = (
  transcript: Transcript,
  fromSec: number,
  toSec: number,
): string =>
  wordsInSpan(transcript, fromSec, toSec)
    .map((word) => word.word)
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();

/**
 * Ubah kata transkrip jadi WordTimestamp untuk mesin caption, digeser ke waktu
 * SCENE: `fromSec` (biasanya `visual.trimStartSec`) menjadi nol.
 *
 * `speed` WAJIB ikut dihitung, bukan detail yang bisa diabaikan: scene dengan
 * `visual.speed = 2` memutar rekaman dua kali lebih cepat, jadi kata di detik
 * ke-10 rekaman muncul di detik ke-5 scene. Melewatkan pembagian ini
 * menghasilkan caption yang makin lama makin tertinggal dari suaranya —
 * kesalahan yang tidak menggagalkan tes apa pun dan hanya terlihat kalau ada
 * yang benar-benar menonton sampai habis.
 *
 * Kata yang melewati batas rentang dipotong, bukan dibuang: caption yang
 * kehilangan kata pertama karena potongannya jatuh di tengah kata jauh lebih
 * mengganggu daripada kata yang tampil sepersekian detik lebih cepat.
 */
export const transcriptToWordTimestamps = (
  transcript: Transcript,
  fromSec: number,
  toSec: number,
  { speed = 1 }: { speed?: number } = {},
): WordTimestamp[] => {
  const rate = speed > 0 ? speed : 1;
  return wordsInSpan(transcript, fromSec, toSec).map((word) => ({
    word: word.word,
    startSec: Number((Math.max(0, word.startSec - fromSec) / rate).toFixed(3)),
    endSec: Number(
      (Math.max(0, Math.min(word.endSec, toSec) - fromSec) / rate).toFixed(3),
    ),
  }));
};

/**
 * Kata pengisi bahasa Indonesia lisan — yang dibuang editor sebelum apa pun.
 *
 * Daftar ini SENGAJA pendek dan konservatif. "Kayak", "terus", dan "jadi"
 * memang sering jadi pengisi, tapi ketiganya juga kata biasa yang membawa arti
 * ("kayak gini", "terus dipanaskan", "jadi hasilnya") — membuangnya otomatis
 * merusak kalimat. Yang masuk daftar hanyalah bunyi ragu yang tidak pernah
 * menjadi bagian kalimat, plus dua penegas percakapan yang selalu berdiri
 * sendiri.
 */
export const FILLER_WORDS = [
  "eh",
  "em",
  "emm",
  "ehm",
  "hmm",
  "mm",
  "anu",
  "apa ya",
  "gimana ya",
  "gitu ya",
  "ya kan",
  "uh",
  "um",
  "uhm",
  "er",
] as const;

const normalize = (word: string): string =>
  word
    .toLowerCase()
    .replace(/[.,!?;:"'()[\]]/g, "")
    .trim();

export interface TranscriptSpan {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Rentang berisi kata pengisi atau kata yang langsung terulang.
 *
 * Pengulangan ("saya saya mau") ditangkap juga karena itu pola gagap yang
 * paling sering di rekaman mentah, dan menghapusnya aman: yang dibuang persis
 * salinan kata yang tetap ada sesudahnya.
 */
export const findFillerSpans = (transcript: Transcript): TranscriptSpan[] => {
  const spans: TranscriptSpan[] = [];
  const fillers = new Set<string>(FILLER_WORDS);

  transcript.words.forEach((word, index) => {
    const text = normalize(word.word);
    if (text === "") return;

    const previous = transcript.words[index - 1];
    const isRepeat = previous !== undefined && normalize(previous.word) === text;
    const isFiller = fillers.has(text);
    // Pengisi dua kata ("apa ya") diperiksa sebagai pasangan.
    const pair =
      previous !== undefined ? `${normalize(previous.word)} ${text}` : undefined;
    const isPairFiller = pair !== undefined && fillers.has(pair);

    if (isPairFiller && previous !== undefined) {
      spans.push({
        startSec: previous.startSec,
        endSec: word.endSec,
        text: `${previous.word} ${word.word}`,
      });
      return;
    }
    if (isFiller || isRepeat) {
      spans.push({ startSec: word.startSec, endSec: word.endSec, text: word.word });
    }
  });

  return spans;
};

/**
 * Cari frasa di dalam transkrip; kembalikan rentang waktunya.
 *
 * Pencocokannya sengaja sederhana — beruntun, tanpa peduli huruf besar-kecil
 * dan tanda baca. Penilaian "momen mana yang menarik" adalah pekerjaan agent
 * yang membaca transkripnya, bukan pekerjaan pencari string; yang dibutuhkan
 * di sini hanya jembatan dari kata ke waktu.
 */
export const findPhraseSpans = (
  transcript: Transcript,
  phrase: string,
  { padSec = 0, limit = 20 }: { padSec?: number; limit?: number } = {},
): TranscriptSpan[] => {
  const needle = phrase
    .split(/\s+/)
    .map(normalize)
    .filter((part) => part !== "");
  if (needle.length === 0) return [];

  const words = transcript.words;
  const spans: TranscriptSpan[] = [];
  for (let i = 0; i + needle.length <= words.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (normalize(words[i + j]?.word ?? "") !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;
    const first = words[i] as TranscriptWord;
    const last = words[i + needle.length - 1] as TranscriptWord;
    spans.push({
      startSec: Number(Math.max(0, first.startSec - padSec).toFixed(3)),
      endSec: Number(Math.min(transcript.durationSec, last.endSec + padSec).toFixed(3)),
      text: words
        .slice(i, i + needle.length)
        .map((word) => word.word)
        .join(" "),
    });
    if (spans.length >= limit) break;
  }
  return spans;
};

/**
 * Rentang bicara yang dipisahkan jeda — dasar "potong per kalimat".
 *
 * Jeda dihitung dari CELAH ANTAR KATA, bukan dari energi audio: itu bedanya
 * dengan `detectSilence` yang sudah ada. Jeda 0,6 detik di tengah kalimat
 * hanyalah orang menarik napas; yang menandai batas gagasan adalah jeda yang
 * lebih panjang, dan angkanya bisa disetel pemanggil.
 */
export const speechSpans = (
  transcript: Transcript,
  { gapSec = 0.7 }: { gapSec?: number } = {},
): TranscriptSpan[] => {
  const spans: TranscriptSpan[] = [];
  let start: number | null = null;
  let end = 0;
  let buffer: string[] = [];

  const flush = () => {
    if (start === null || buffer.length === 0) return;
    spans.push({
      startSec: Number(start.toFixed(3)),
      endSec: Number(end.toFixed(3)),
      text: buffer.join(" "),
    });
    start = null;
    buffer = [];
  };

  for (const word of transcript.words) {
    if (start !== null && word.startSec - end >= gapSec) flush();
    start ??= word.startSec;
    end = Math.max(end, word.endSec);
    buffer.push(word.word);
  }
  flush();
  return spans;
};
