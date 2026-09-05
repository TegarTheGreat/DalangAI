import {
  computeTimeline,
  estimateNarrationSeconds,
  NARRATION_LEAD_IN_SEC,
  sumClipDurationsSec,
} from "./durations";
import { type FormatRecipe, isBodyScene, recipeFor } from "./format-recipe";
import {
  HEDGING_ID,
  KLISE_ID,
  lexicalOverlap,
  opensWithConnector,
  PENGISI_ID,
  phrasesFound,
  proseStatsOf,
} from "./prose";
import { primaryClip, type Scene, type ScenePlan, sceneAsset } from "./scene-plan";

/**
 * Kritik sutradara otomatis (ADR-0014): heuristik deterministik atas
 * scene-plan yang menandai pola "generic" — gerak kamera monoton, transisi
 * seragam, tanpa musik, hook lemah, narasi terlalu padat. Dipakai dua arah:
 * `dalang validate` menampilkannya ke manusia, dan konteks agent
 * menyuntikkannya supaya model memperbaiki kelemahan tanpa disuruh.
 *
 * Murni membaca plan — tidak pernah mengubah apa pun; keputusan tetap di
 * tangan pengarah (manusia atau agent).
 */

export interface DirectorNote {
  /** Kode stabil untuk test/telemetri, kebab-case. */
  code: string;
  level: "saran" | "perhatian";
  sceneId?: string;
  message: string;
}

const ASSET_TYPES = new Set(["stock", "image", "generated", "screenshot"]);

const wordCount = (text: string): number =>
  text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

/** Durasi efektif scene dalam detik, kalau bisa diketahui. */
const sceneSeconds = (plan: ScenePlan, scene: Scene): number | null => {
  if (typeof scene.duration === "number") return scene.duration;
  const audio = plan.renderState.narrationAudio[scene.id];
  return audio ? audio.durationSec : null;
};

export const critiquePlan = (plan: ScenePlan): DirectorNote[] => {
  const notes: DirectorNote[] = [];
  const scenes = plan.scenes;

  // 1. Musik latar — video tanpa bed musik terasa slideshow.
  if (!plan.audio.music) {
    notes.push({
      code: "musik-hening",
      level: "saran",
      message:
        "Tidak ada musik latar (audio.music). Bed musik pelan + ducking di bawah narasi adalah pembeda terbesar antara slideshow dan film.",
    });
  }

  // 2. Gerak kamera monoton pada scene beraset.
  const assetScenes = scenes.filter((s) => ASSET_TYPES.has(primaryClip(s).type));
  if (assetScenes.length >= 3) {
    const motions = new Set(assetScenes.map((s) => primaryClip(s).motion));
    if (motions.size === 1) {
      notes.push({
        code: "gerak-monoton",
        level: "saran",
        message: `Semua ${assetScenes.length} scene beraset memakai gerak kamera yang sama (${[...motions][0]}). Selang-seling kenburns-in/out dan pan agar mata tidak jenuh.`,
      });
    }
  }

  // 3. Transisi seragam (tipe DAN tempo).
  if (scenes.length >= 4) {
    const signatures = new Set(
      scenes
        .slice(0, -1)
        .map((s) => `${s.transition.type}:${s.transition.durationFrames}`),
    );
    if (signatures.size === 1) {
      notes.push({
        code: "transisi-monoton",
        level: "saran",
        message:
          "Semua transisi bertipe dan bertempo sama. Beri aksen: potongan cepat (durationFrames kecil) di momen energik, larut panjang untuk pergantian babak.",
      });
    }
  }

  // 4. Hook 3 detik pertama.
  const firstBody = scenes.find((s) => primaryClip(s).type !== "template-anim");
  if (firstBody && wordCount(firstBody.narration) > 14 && firstBody.texts.length === 0) {
    notes.push({
      code: "hook-lemah",
      level: "saran",
      sceneId: firstBody.id,
      message: `Scene pembuka ${firstBody.id} bernarasi panjang tanpa teks overlay. Tambahkan satu kalimat hook (headline/kicker) di 3 detik pertama.`,
    });
  }

  // 5. Kepadatan narasi per scene (kata per detik).
  for (const scene of scenes) {
    const seconds = sceneSeconds(plan, scene);
    const words = wordCount(scene.narration);
    if (seconds === null || seconds <= 0 || words === 0) continue;
    const rate = words / seconds;
    if (rate > 3.2) {
      notes.push({
        code: "narasi-padat",
        level: "perhatian",
        sceneId: scene.id,
        message: `Scene ${scene.id}: ${words} kata dalam ${seconds.toFixed(1)} dtk (${rate.toFixed(1)} kata/dtk). Narasi akan terdengar terburu — ringkas naskah atau panjangkan scene.`,
      });
    }
  }

  // 6. Judul terlalu panjang untuk kartu title.
  if (wordCount(plan.meta.title) > 8) {
    notes.push({
      code: "judul-panjang",
      level: "saran",
      message: `Judul ${wordCount(plan.meta.title)} kata — kartu title paling kuat di bawah 8 kata; sisanya pindahkan ke dek (narasi scene title).`,
    });
  }

  // 7. Scene solid polos beruntun tanpa varian seni.
  const plainSolid = scenes.filter(
    (s) => primaryClip(s).type === "solid" && (primaryClip(s).variant ?? null) === null,
  );
  if (plainSolid.length >= 2) {
    notes.push({
      code: "solid-polos",
      level: "saran",
      message: `${plainSolid.length} scene solid tanpa varian seni. Pakai visual.variant (rays/topo/grid) supaya latar prosedural tidak seragam.`,
    });
  }

  // 8. Semua teks overlay datar (tanpa hierarki).
  const allTexts = scenes.flatMap((s) => s.texts);
  if (
    allTexts.length >= 2 &&
    allTexts.every((t) => t.emphasis === "none" && t.size === "m")
  ) {
    notes.push({
      code: "teks-datar",
      level: "saran",
      message:
        "Semua teks overlay berukuran M tanpa penekanan. Beri hierarki: satu headline L ber-emphasis (kotak/garis), pendukung S/M polos.",
    });
  }

  // 9. Tutup dengan outro (kecuali format yang memang tidak memakainya).
  const recipe = recipeFor(plan.meta.format);
  const last = scenes[scenes.length - 1];
  if (recipe.needsOutro && last && primaryClip(last).type !== "template-anim") {
    notes.push({
      code: "outro-hilang",
      level: "saran",
      sceneId: last.id,
      message:
        "Scene terakhir bukan kartu template-anim. Outro (CTA/kredit) membuat video terasa selesai, bukan terpotong.",
    });
  }

  // 10. Aset yang hak pakainya belum jelas (ADR-0018).
  notes.push(...critiqueAssetRights(plan));

  // 11. Lapisan video (ADR-0025).
  notes.push(...critiqueLayers(plan));

  // 12. Audio per klip (ADR-0026).
  notes.push(...critiqueAudio(plan));

  // 13. Potongan gambar di dalam scene (ADR-0033).
  notes.push(...critiqueClips(plan));

  notes.push(...critiqueFormat(plan, recipe));
  notes.push(...critiqueProse(plan, recipe));
  return notes;
};

/**
 * Selisih narasi terhadap gambar yang masih wajar, detik.
 *
 * Bukan nol: suara yang berakhir sepersekian detik setelah potongan terakhir
 * adalah ritme, bukan cacat. Yang dilaporkan adalah selisih yang cukup panjang
 * untuk TERLIHAT sebagai layar yang membeku sementara orangnya masih bicara.
 */
const CLIP_NARRATION_SLACK_SEC = 0.8;

/**
 * Potongan gambar di dalam scene (ADR-0033 §2).
 *
 * Begitu sebuah scene punya dua klip, durasinya datang dari POTONGANNYA — dan
 * narasi yang lebih panjang daripada jumlah potongan itu bukan galat skema:
 * itu keputusan penyuntingan yang mungkin memang disengaja. Yang terjadi di
 * layar tetap perlu dikatakan: gambar terakhir membeku sampai kalimatnya
 * selesai.
 *
 * Diukur terhadap audio narasi yang SUDAH ADA lebih dulu, baru terhadap
 * perkiraan suku kata: menuduh seorang pengarah kekurangan gambar berdasarkan
 * tebakan sementara berkas suaranya tersedia adalah cara tercepat membuat
 * kritik ini diabaikan seluruhnya.
 */
const critiqueClips = (plan: ScenePlan): DirectorNote[] => {
  const notes: DirectorNote[] = [];
  const speed = plan.audio.voice?.speed ?? 1;
  for (const scene of plan.scenes) {
    if (scene.clips.length < 2) continue;
    const gambarSec = sumClipDurationsSec(scene);
    const audio = plan.renderState.narrationAudio[scene.id];
    const narasiSec = audio
      ? audio.durationSec
      : estimateNarrationSeconds(scene.narration, speed);
    if (narasiSec === 0) continue;
    const butuh = NARRATION_LEAD_IN_SEC + narasiSec;
    if (butuh - gambarSec <= CLIP_NARRATION_SLACK_SEC) continue;
    notes.push({
      code: "narasi-lebih-panjang-dari-gambar",
      level: "saran",
      sceneId: scene.id,
      message:
        `Scene ${scene.id}: narasinya ${butuh.toFixed(1)} dtk tapi potongannya cuma ` +
        `${gambarSec.toFixed(1)} dtk, jadi gambar terakhir membeku ` +
        `${(butuh - gambarSec).toFixed(1)} dtk. Panjangkan potongan terakhir, ` +
        "tambah satu potongan, atau potong kalimatnya — kalau memang disengaja, abaikan.",
    });
  }
  return notes;
};

/**
 * Lapisan video (ADR-0025): dua cacat yang tidak terlihat dari JSON-nya.
 *
 * PERTAMA, lapisan yang berkasnya belum ada tidak akan digambar sama sekali —
 * dan tidak ada apa pun di video yang memberi tahu kenapa. Ini `perhatian`,
 * bukan saran: sisipan yang direncanakan lalu hilang diam-diam adalah selisih
 * antara maksud dan hasil.
 *
 * KEDUA, sisipan yang menyala sepanjang scene berhenti jadi sisipan. Kekuatan
 * B-roll ada pada MASUK dan KELUARNYA — ia menunjuk satu kalimat. Yang menetap
 * dari frame pertama sampai terakhir cuma jadi kotak kedua yang menutupi
 * sebagian gambar.
 */
const critiqueLayers = (plan: ScenePlan): DirectorNote[] => {
  const notes: DirectorNote[] = [];
  for (const scene of plan.scenes) {
    for (const layer of scene.layers) {
      if (!plan.renderState.layerAssets[layer.id]) {
        notes.push({
          code: "lapisan-tanpa-aset",
          level: "perhatian",
          sceneId: scene.id,
          message: `Lapisan "${layer.id}" belum punya berkas aset — ia TIDAK akan muncul di video. Isi visual.query lalu jalankan resolve aset, atau hapus lapisannya.`,
        });
      }
      if (layer.startFrac <= 0 && layer.endFrac >= 1) {
        notes.push({
          code: "lapisan-sepanjang-scene",
          level: "saran",
          sceneId: scene.id,
          message: `Lapisan "${layer.id}" menyala sepanjang scene. Sisipan bekerja karena masuk dan keluarnya menunjuk satu kalimat; persempit startFrac/endFrac ke bagian yang memang dibicarakan.`,
        });
      }
    }
  }
  return notes;
};

/**
 * Audio per klip (ADR-0026): dua hal yang hanya terdengar, tidak terlihat.
 *
 * PERTAMA, klip yang volumenya dinaikkan tapi berkasnya belum pernah diukur
 * tidak ikut dinormalisasi. Di JSON semuanya tampak beres; di video, satu klip
 * jauh lebih keras atau lebih pelan daripada yang lain tanpa sebab yang bisa
 * dilihat siapa pun.
 *
 * KEDUA, suara klip yang tidak di-duck akan menabrak narasi. Itu keputusan yang
 * sah — musik pembuka tanpa narasi, misalnya — tapi hampir selalu tidak
 * disengaja, jadi ia disebutkan sebagai saran, bukan dipaksakan.
 */
const critiqueAudio = (plan: ScenePlan): DirectorNote[] => {
  const notes: DirectorNote[] = [];
  const target = plan.meta.loudnessTarget;

  const belumDiukur: string[] = [];
  const tanpaDuck: string[] = [];
  const check = (
    audio: { volume: number; ducking: boolean },
    lufs: number | undefined,
    label: string,
  ) => {
    if (audio.volume <= 0) return;
    if (target !== null && lufs === undefined) belumDiukur.push(label);
    if (!audio.ducking) tanpaDuck.push(label);
  };

  for (const scene of plan.scenes) {
    check(primaryClip(scene).audio, sceneAsset(plan, scene)?.lufs, `aset ${scene.id}`);
    for (const layer of scene.layers) {
      check(
        layer.visual.audio,
        plan.renderState.layerAssets[layer.id]?.lufs,
        `lapisan ${layer.id}`,
      );
    }
  }
  for (const track of plan.audio.tracks) {
    check(track.audio, plan.renderState.trackAssets[track.id]?.lufs, `trek ${track.id}`);
  }

  if (belumDiukur.length > 0) {
    notes.push({
      code: "audio-belum-diukur",
      level: "perhatian",
      message: `Berbunyi tapi kenyaringannya belum terukur: ${belumDiukur.join(", ")}. Jalankan tahap aset supaya keduanya ikut disamakan ke ${target} LUFS — tanpa itu, klip ini dipakai apa adanya dan bisa jauh lebih keras atau pelan daripada sisanya.`,
    });
  }
  if (tanpaDuck.length > 0) {
    notes.push({
      code: "audio-tanpa-ducking",
      level: "saran",
      message: `Berbunyi tanpa mengecil di bawah narasi: ${tanpaDuck.join(", ")}. Kalau itu memang disengaja, biarkan; kalau tidak, suaranya akan menabrak narasi persis saat narasinya paling penting.`,
    });
  }
  return notes;
};

/**
 * Penanda pada lisensi aset yang berarti "boleh dicari lewat API, BELUM tentu
 * boleh dipublikasikan". Provider yang isinya unggahan pihak ketiga (GIPHY,
 * Tenor) menulis penanda ini apa adanya ke plan, sehingga pemeriksaan ini
 * tidak perlu tahu nama providernya — cukup membaca lisensi yang tercatat.
 */
const RIGHTS_REVIEW_MARK = "PERIKSA HAK PAKAI";

/**
 * Aset dari pustaka GIF/stiker adalah karya orang lain. Punya API resmi
 * memberi jalur pencarian yang sah, bukan hak menyiarkan ulang. Kritik ini
 * memastikan keputusan itu diambil sadar oleh manusia, bukan lolos diam-diam
 * karena asetnya kebetulan mudah didapat.
 */
const critiqueAssetRights = (plan: ScenePlan): DirectorNote[] => {
  const needsReview = (license: string | undefined): boolean =>
    (license ?? "").includes(RIGHTS_REVIEW_MARK);

  // KETIGA lumbung diperiksa, bukan hanya aset scene. Stiker dari GIPHY/Tenor
  // masuk lewat `graphicAssets` (ADR-0018) — justru jalur yang paling sering
  // dipakai — jadi memeriksa `clipAssets` saja membuat kritik ini diam
  // persis pada kasus yang paling perlu ditegur.
  const flagged: Array<{ sceneId: string | undefined; source: string }> = [];
  // `clipAssets` dikunci id KLIP (ADR-0033), tapi yang ditegur tetap SCENE:
  // itu satuan yang dipegang orang saat memperbaikinya, dan sebuah id klip
  // tidak bisa dicari di panel mana pun.
  for (const [clipId, asset] of Object.entries(plan.renderState.clipAssets)) {
    if (!needsReview(asset.license)) continue;
    const owner = plan.scenes.find((scene) =>
      scene.clips.some((clip) => clip.id === clipId),
    );
    flagged.push({ sceneId: owner?.id, source: asset.source });
  }
  for (const [graphicId, asset] of Object.entries(plan.renderState.graphicAssets)) {
    if (!needsReview(asset.license)) continue;
    const owner = plan.scenes.find((scene) =>
      scene.graphics.some((graphic) => graphic.id === graphicId),
    );
    // Entri yatim (grafisnya sudah dihapus) tidak ditegur: ia tidak ikut render.
    if (owner) flagged.push({ sceneId: owner.id, source: asset.source });
  }
  for (const [cueId, asset] of Object.entries(plan.renderState.sfxAssets)) {
    if (!needsReview(asset.license)) continue;
    const cue = plan.audio.sfx.find((entry) => entry.id === cueId);
    if (cue) flagged.push({ sceneId: cue.sceneId, source: asset.source });
  }
  if (flagged.length === 0) return [];

  const sources = [...new Set(flagged.map((entry) => entry.source))].sort();
  const firstScene = flagged.find((entry) => entry.sceneId !== undefined)?.sceneId;
  return [
    {
      code: "aset-hak-pakai",
      level: "perhatian",
      ...(firstScene ? { sceneId: firstScene } : {}),
      message:
        `${flagged.length} aset dari ${sources.join(", ")} dipakai. Isinya unggahan pihak ketiga ` +
        "yang hak ciptanya milik pengunggah — API resminya memberi jalur pencarian, BUKAN hak siar ulang. " +
        "Untuk video yang dipublikasikan (apalagi dimonetisasi), pastikan haknya, atau ganti dengan aset berlisensi jelas.",
    },
  ];
};

/** Ambang detektor prosa — lihat catatan kalibrasi di `prose.ts`. */
const MAX_SENTENCE_WORDS = 25;
const MIN_BURSTINESS = 0.18;
const MIN_SENTENCES_FOR_RHYTHM = 6;
const MAX_ADJACENT_OVERLAP = 0.5;

/**
 * Detektor "generic" (ADR-0017): pola PERMUKAAN bahasa yang membuat naskah
 * terdengar seperti mesin — klise, hedging, kalimat seragam, pengulangan
 * gagasan antar scene. Semuanya deterministik dan bebas model.
 */
const critiqueProse = (plan: ScenePlan, recipe: FormatRecipe): DirectorNote[] => {
  const notes: DirectorNote[] = [];
  const body = plan.scenes.filter(isBodyScene);

  // Dua pemeriksaan ini membaca SATU scene, bukan sebaran statistik, jadi
  // keduanya berlaku walau naskahnya masih pendek. Justru klip pendek yang
  // paling rawan dibuka penghubung menggantung.
  notes.push(...critiqueSceneLevel(body, recipe));

  const narrations = plan.scenes.map((scene) => scene.narration);
  // Ukuran sebaran (irama, kepadatan frasa) butuh cukup data untuk berarti.
  if (wordCount(narrations.join(" ")) < 25) return notes;

  const stats = proseStatsOf(narrations);
  const script = narrations.join(" ");

  const kliseHits = phrasesFound(script, KLISE_ID);
  if (kliseHits.length > 0) {
    notes.push({
      code: "naskah-klise",
      level: "perhatian",
      message:
        `Frasa klise terdeteksi: "${kliseHits.slice(0, 3).join('", "')}". ` +
        "Ini penanda paling cepat dikenali bahwa naskah ditulis mesin — ganti dengan pernyataan konkret yang khusus untuk topik ini.",
    });
  }

  const hedgeHits = phrasesFound(script, HEDGING_ID);
  if (stats.hedgingPer100 > 1.2 && hedgeHits.length >= 2) {
    notes.push({
      code: "naskah-ragu",
      level: "saran",
      message:
        `Kata pagar terlalu sering (${stats.hedgingPer100.toFixed(1)} per 100 kata: "${hedgeHits.slice(0, 3).join('", "')}"). ` +
        "Narasi yang terus berjaga-jaga terdengar tidak yakin; sebutkan angka atau syaratnya, atau nyatakan langsung.",
    });
  }

  const fillerHits = phrasesFound(script, PENGISI_ID);
  if (fillerHits.length > 0) {
    notes.push({
      code: "naskah-pengisi",
      level: "saran",
      message:
        `Kata pengisi lisan ikut tertulis: "${fillerHits.slice(0, 3).join('", "')}". ` +
        "TTS akan membacakannya sebagai kata sungguhan — buang dari naskah.",
    });
  }

  if (stats.longestSentenceWords > MAX_SENTENCE_WORDS) {
    notes.push({
      code: "kalimat-panjang",
      level: "saran",
      message:
        `Kalimat terpanjang ${stats.longestSentenceWords} kata (batas nyaman untuk narasi lisan ${MAX_SENTENCE_WORDS}). ` +
        "Penonton tidak bisa mengulang kalimat yang didengar — pecah jadi dua.",
    });
  }

  if (stats.sentences >= MIN_SENTENCES_FOR_RHYTHM && stats.burstiness < MIN_BURSTINESS) {
    notes.push({
      code: "irama-datar",
      level: "saran",
      message:
        `Panjang kalimat nyaris seragam (burstiness ${stats.burstiness.toFixed(2)}, sehat di atas ${MIN_BURSTINESS}). ` +
        "Keseragaman itulah yang membuat narasi terdengar dibacakan mesin. Selingi kalimat sangat pendek di antara yang panjang.",
    });
  }

  return notes;
};

/** Pemeriksaan yang cukup membaca satu scene — tidak butuh sebaran statistik. */
const critiqueSceneLevel = (
  body: readonly Scene[],
  recipe: FormatRecipe,
): DirectorNote[] => {
  const notes: DirectorNote[] = [];

  // Dua scene isi berurutan yang mengatakan hal yang sama dengan kata berbeda.
  for (let index = 1; index < body.length; index += 1) {
    const previous = body[index - 1] as Scene;
    const current = body[index] as Scene;
    const overlap = lexicalOverlap(previous.narration, current.narration);
    if (overlap > MAX_ADJACENT_OVERLAP) {
      notes.push({
        code: "narasi-berulang",
        level: "perhatian",
        sceneId: current.id,
        message:
          `Scene ${current.id} mengulang gagasan ${previous.id} (${Math.round(overlap * 100)}% kata isi sama). ` +
          "Satu ide per scene: gabungkan keduanya, atau majukan argumennya.",
      });
      break;
    }
  }

  // Klip harus berdiri sendiri: pembuka yang menggantung menuntut konteks
  // yang tidak dimiliki penonton.
  if (recipe.format === "klip") {
    const first = body[0];
    const connector = first ? opensWithConnector(first.narration) : null;
    if (first && connector) {
      notes.push({
        code: "klip-menggantung",
        level: "perhatian",
        sceneId: first.id,
        message:
          `Klip dibuka dengan "${connector}" — penghubung yang premisnya ada di luar klip. ` +
          "Mulai dari kalimat yang utuh sendiri; penonton tidak menonton bagian sebelumnya.",
      });
    }
  }

  return notes;
};

/**
 * Kritik terhadap RESEP format (ADR-0017). Hanya berlaku bila `meta.format`
 * diisi selain "bebas" — memaksa struktur yang sesuai jenis konten, bukan
 * satu kerangka untuk semuanya.
 */
const critiqueFormat = (plan: ScenePlan, recipe: FormatRecipe): DirectorNote[] => {
  if (recipe.format === "bebas") return [];
  const notes: DirectorNote[] = [];
  const scenes = plan.scenes;
  const body = scenes.filter(isBodyScene);

  if (scenes.length < recipe.minScenes || scenes.length > recipe.maxScenes) {
    notes.push({
      code: "format-jumlah-scene",
      level: "perhatian",
      message:
        `Format "${recipe.format}" enaknya ${recipe.minScenes}-${recipe.maxScenes} scene, ` +
        `sekarang ${scenes.length}. Kerangkanya: ${recipe.kerangka}`,
    });
  }

  const { totalSec } = computeTimeline(plan);
  if (totalSec < recipe.minTotalSec || totalSec > recipe.maxTotalSec) {
    notes.push({
      code: "format-durasi",
      level: "perhatian",
      message:
        `Durasi ${totalSec.toFixed(0)} detik di luar rentang wajar format "${recipe.format}" ` +
        `(${recipe.minTotalSec}-${recipe.maxTotalSec} detik).`,
    });
  }

  if (recipe.needsTitle && scenes[0] && primaryClip(scenes[0]).type !== "template-anim") {
    notes.push({
      code: "format-tanpa-pembuka",
      level: "saran",
      sceneId: scenes[0].id,
      message: `Format "${recipe.format}" membuka dengan kartu judul (template-anim variant "title").`,
    });
  }

  if (recipe.needsHookText) {
    const firstBody = body[0];
    if (firstBody && firstBody.texts.length === 0) {
      notes.push({
        code: "format-hook-tanpa-teks",
        level: "perhatian",
        sceneId: firstBody.id,
        message:
          `Format "${recipe.format}" hidup dari hook yang TERLIHAT. Beri satu teks penahan ` +
          "di scene isi pertama (kicker/headline), bukan mengandalkan narasi saja.",
      });
    }
  }

  // Kepadatan narasi per scene isi terhadap rentang resep.
  const offenders = body.filter((scene) => {
    const words = wordCount(scene.narration);
    return (
      words > 0 && (words < recipe.minWordsPerScene || words > recipe.maxWordsPerScene)
    );
  });
  if (offenders.length > Math.max(1, Math.floor(body.length / 3))) {
    notes.push({
      code: "format-panjang-narasi",
      level: "saran",
      message:
        `${offenders.length} scene isi di luar ${recipe.minWordsPerScene}-${recipe.maxWordsPerScene} ` +
        `kata yang enak untuk format "${recipe.format}". Satu ide per scene; pecah yang kepanjangan.`,
    });
  }

  // Tutorial: langkah harus terbaca berurutan lewat narasi imperatif.
  if (recipe.format === "tutorial" && body.length >= 2) {
    const imperative = body.filter((scene) =>
      /^(buka|klik|pilih|ketik|isi|tekan|geser|salin|simpan|jalankan|pasang|atur|tambah|hapus|masuk|unduh)/i.test(
        scene.narration.trim(),
      ),
    );
    if (imperative.length < Math.ceil(body.length / 2)) {
      notes.push({
        code: "format-langkah-tidak-imperatif",
        level: "saran",
        message:
          "Tutorial paling mudah diikuti bila tiap langkah dimulai kata kerja perintah " +
          '("Buka…", "Klik…", "Pilih…") — sekarang sebagian besar scene tidak begitu.',
      });
    }
  }

  // Klip: tidak boleh dibuka basa-basi kartu judul.
  if (
    recipe.format === "klip" &&
    scenes[0] !== undefined &&
    primaryClip(scenes[0]).type === "template-anim"
  ) {
    notes.push({
      code: "format-klip-basa-basi",
      level: "perhatian",
      sceneId: scenes[0].id,
      message:
        "Klip pendek tidak punya waktu untuk kartu judul — mulai langsung dari hook, " +
        "penonton memutuskan dalam 3 detik.",
    });
  }

  return notes;
};

/** Format catatan jadi baris teks siap tampil (CLI/konteks agent). */
export const formatDirectorNotes = (notes: DirectorNote[]): string[] =>
  notes.map((n) => `[${n.level === "perhatian" ? "PERHATIAN" : "saran"}] ${n.message}`);
