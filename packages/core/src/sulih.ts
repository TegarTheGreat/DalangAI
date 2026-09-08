import { estimateNarrationSeconds } from "./durations";
import {
  LANGUAGE_CODE_RE,
  type NarrationAudio,
  type Scene,
  type ScenePlan,
} from "./scene-plan";

/**
 * Sulih suara — narasi banyak bahasa dalam SATU plan (ADR-0040).
 *
 * Seluruh fitur ini berdiri di atas satu fungsi: `planInLanguage`. Ia menukar
 * narasi dan berkas audionya, lalu mengembalikan sebuah SCENE-PLAN BIASA.
 * Dengan begitu tidak ada satu pun jalur di hilir yang perlu tahu soal sulih
 * suara — durasi, tata letak bingkai, caption, subtitle, ducking, campuran
 * akhir, ekspor interop, dan gerbang paritas semuanya bekerja apa adanya.
 *
 * Alternatifnya — menyalurkan parameter `language` ke setiap fungsi yang
 * menyentuh narasi — akan menyentuh puluhan pemanggil, dan yang satu terlewat
 * akan merender gambar bahasa A dengan suara bahasa B tanpa satu pun galat.
 */

/** Kode bahasa yang bentuknya sah. Dipakai sebelum menyentuh berkas. */
export const isLanguageCode = (value: string): boolean => LANGUAGE_CODE_RE.test(value);

/**
 * Semua bahasa yang ADA di plan ini — bahasa utama lebih dulu.
 *
 * "Ada" berarti ada teksnya, bukan sekadar ada kuncinya: bahasa yang cuma
 * punya kunci kosong akan tampil di daftar sebagai pilihan yang menghasilkan
 * video bisu, dan pilihan yang tidak bisa dipakai lebih buruk daripada
 * pilihan yang tidak ada.
 */
export const planLanguages = (plan: ScenePlan): string[] => {
  const lain = new Set<string>();
  // `?? {}`, bukan asumsi: kolom sulih punya default di skema, tapi
  // `critiquePlan` juga dipanggil atas plan yang dirakit tangan di tes dan di
  // alat bantu. Fungsi kaidah sutradara yang MELEDAK jauh lebih buruk
  // daripada yang membaca "tidak ada sulihan" dari kolom yang memang kosong.
  const catat = (peta: Record<string, string> | undefined) => {
    for (const [lang, text] of Object.entries(peta ?? {})) {
      if (text.trim() !== "") lain.add(lang);
    }
  };
  catat(plan.meta.dubTitles);
  for (const scene of plan.scenes) {
    catat(scene.dubs);
    for (const text of scene.texts ?? []) catat(text.dubs);
  }
  lain.delete(plan.meta.language);
  return [plan.meta.language, ...[...lain].sort()];
};

/**
 * Teks LAYAR yang belum disulih di sebuah bahasa: judul proyek dan overlay.
 *
 * Terpisah dari `dubCoverage`, yang mengukur narasi. Keduanya bisa timpang —
 * narasi lengkap tapi kartu judul masih bahasa asli adalah keadaan yang
 * paling sering terjadi, dan yang paling terlihat oleh penonton.
 */
export const untranslatedScreenText = (
  plan: ScenePlan,
  lang: string,
): Array<{ where: string; content: string }> => {
  if (lang === plan.meta.language) return [];
  const kurang: Array<{ where: string; content: string }> = [];
  if ((plan.meta.dubTitles?.[lang] ?? "").trim() === "") {
    kurang.push({ where: "meta.title", content: plan.meta.title });
  }
  for (const scene of plan.scenes) {
    for (const text of scene.texts ?? []) {
      if ((text.dubs?.[lang] ?? "").trim() === "") {
        kurang.push({ where: `${scene.id}/${text.id}`, content: text.content });
      }
    }
  }
  return kurang;
};

/** Narasi scene ini dalam `lang` — kosong kalau belum disulih. */
export const narrationIn = (scene: Scene, plan: ScenePlan, lang: string): string =>
  lang === plan.meta.language ? scene.narration : (scene.dubs[lang] ?? "");

/** Audio narasi scene ini dalam `lang` — undefined kalau TTS belum jalan. */
export const narrationAudioIn = (
  plan: ScenePlan,
  sceneId: string,
  lang: string,
): NarrationAudio | undefined =>
  lang === plan.meta.language
    ? plan.renderState.narrationAudio[sceneId]
    : plan.renderState.dubAudio[lang]?.[sceneId];

export interface DubCoverage {
  language: string;
  /** Scene yang PUNYA narasi di bahasa utama — penyebut yang benar. */
  perlu: number;
  /** Dari `perlu`, yang sudah ada teks sulihannya. */
  diterjemahkan: number;
  /** Dari `perlu`, yang sudah ada berkas suaranya. */
  bersuara: number;
  /** Id scene yang belum punya teks sulihan. */
  belumDiterjemahkan: string[];
  /** Id scene yang teksnya ada tapi suaranya belum. */
  belumBersuara: string[];
}

/**
 * Sejauh mana sebuah bahasa sudah siap.
 *
 * Penyebutnya scene yang PUNYA NARASI di bahasa utama — bukan jumlah scene.
 * Kartu judul tanpa narasi tidak perlu disulih, dan menghitungnya sebagai
 * "belum selesai" akan membuat proyek yang sebenarnya lengkap tidak pernah
 * mencapai 100%, yang berarti angkanya berhenti dipercaya.
 */
export const dubCoverage = (plan: ScenePlan, lang: string): DubCoverage => {
  const perlu = plan.scenes.filter((scene) => scene.narration.trim() !== "");
  const belumDiterjemahkan: string[] = [];
  const belumBersuara: string[] = [];
  let diterjemahkan = 0;
  let bersuara = 0;
  for (const scene of perlu) {
    const teks = narrationIn(scene, plan, lang).trim();
    if (teks === "") {
      belumDiterjemahkan.push(scene.id);
      continue;
    }
    diterjemahkan++;
    if (narrationAudioIn(plan, scene.id, lang)) bersuara++;
    else belumBersuara.push(scene.id);
  }
  return {
    language: lang,
    perlu: perlu.length,
    diterjemahkan,
    bersuara,
    belumDiterjemahkan,
    belumBersuara,
  };
};

/**
 * Plan yang sama, dibaca dalam bahasa `lang`.
 *
 * Yang ditukar cuma tiga: `meta.language`, `scene.narration`, dan
 * `renderState.narrationAudio`. `audio.voice` ikut berganti kalau bahasa itu
 * punya suaranya sendiri di `audio.dubVoices` — tanpa itu, sulih suara cuma
 * berarti suara yang sama membaca teks bahasa lain.
 *
 * `dubs` dan `dubAudio` DIKOSONGKAN di hasilnya, dan itu disengaja: hasilnya
 * adalah plan satu-bahasa yang utuh, jadi apa pun yang menerimanya —
 * renderer, pengekspor interop, penulis subtitle — tidak bisa keliru membaca
 * bahasa yang salah dari sisa data yang ikut terbawa.
 *
 * Scene yang belum disulih TIDAK dibuang. Narasinya jadi kosong, jadi
 * scene-nya tetap ada sebagai gambar tanpa suara, dan durasinya menyusut ke
 * durasi scene bisu. Membuangnya akan mengubah SUSUNAN video antar bahasa,
 * dan dua video yang susunannya berbeda bukan lagi satu video yang disulih.
 */
export const planInLanguage = (plan: ScenePlan, lang: string): ScenePlan => {
  if (lang === plan.meta.language) return plan;
  const suara = plan.audio.dubVoices[lang];
  const audioBahasa = plan.renderState.dubAudio[lang] ?? {};
  const narrationAudio: Record<string, NarrationAudio> = {};
  for (const scene of plan.scenes) {
    const audio = audioBahasa[scene.id];
    if (audio) narrationAudio[scene.id] = audio;
  }
  return {
    ...plan,
    meta: {
      ...plan.meta,
      language: lang,
      // Judul yang belum disulih DIPAKAI apa adanya, tidak dikosongkan: bilah
      // atas tanpa judul terlihat seperti preset yang rusak, sedangkan judul
      // bahasa asli terlihat seperti judul yang belum diterjemahkan — dan yang
      // kedua itu yang benar.
      title: plan.meta.dubTitles[lang]?.trim() || plan.meta.title,
      dubTitles: {},
    },
    audio: {
      ...plan.audio,
      ...(suara ? { voice: suara } : {}),
      dubVoices: {},
    },
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      narration: scene.dubs[lang] ?? "",
      dubs: {},
      // Teks layar: sama seperti judul, yang belum disulih dipakai apa adanya.
      // Mengosongkannya akan MENGHILANGKAN elemen dari bingkai, dan itu
      // mengubah tata letak video antar bahasa.
      texts: scene.texts.map((text) => ({
        ...text,
        content: text.dubs[lang]?.trim() || text.content,
        dubs: {},
      })),
    })),
    renderState: { ...plan.renderState, narrationAudio, dubAudio: {} },
  };
};

/**
 * Selisih panjang ucapan antara bahasa utama dan sulihannya, per scene.
 *
 * Ini angka yang paling menentukan mutu sulih suara, dan yang paling mudah
 * diabaikan: terjemahan yang 40% lebih panjang memaksa scene melar, dan
 * gambar yang sudah dipotong pas jadi menggantung. Diukur dari TAKSIRAN suku
 * kata kalau TTS belum jalan, dan dari durasi berkas kalau sudah — keduanya
 * dilaporkan apa adanya supaya yang membaca tahu angkanya berasal dari mana.
 */
export interface DubDrift {
  sceneId: string;
  utamaSec: number;
  sulihSec: number;
  /** `sulihSec / utamaSec`; 1 = sama panjang. */
  rasio: number;
  /** True kalau kedua sisi diukur dari berkas TTS, bukan ditaksir. */
  terukur: boolean;
}

export const dubDrift = (plan: ScenePlan, lang: string): DubDrift[] => {
  const speed = plan.audio.voice?.speed ?? 1;
  const speedSulih = plan.audio.dubVoices[lang]?.speed ?? speed;
  const hasil: DubDrift[] = [];
  for (const scene of plan.scenes) {
    if (scene.narration.trim() === "") continue;
    const teks = narrationIn(scene, plan, lang).trim();
    if (teks === "") continue;
    const audioUtama = plan.renderState.narrationAudio[scene.id];
    const audioSulih = narrationAudioIn(plan, scene.id, lang);
    const utamaSec = audioUtama
      ? audioUtama.durationSec
      : estimateNarrationSeconds(scene.narration, speed);
    const sulihSec = audioSulih
      ? audioSulih.durationSec
      : estimateNarrationSeconds(teks, speedSulih);
    if (utamaSec <= 0) continue;
    hasil.push({
      sceneId: scene.id,
      utamaSec,
      sulihSec,
      rasio: sulihSec / utamaSec,
      terukur: audioUtama !== undefined && audioSulih !== undefined,
    });
  }
  return hasil;
};

/**
 * Ambang selisih yang pantas dikeluhkan.
 *
 * 1,25 bukan angka keramat: di bawah itu selisihnya terserap padding scene,
 * di atasnya gambar mulai terasa menggantung menunggu kalimat selesai. Yang
 * penting angkanya SATU dan dipakai di semua permukaan, bukan tiap permukaan
 * menebak sendiri.
 */
export const DUB_DRIFT_LIMIT = 1.25;
