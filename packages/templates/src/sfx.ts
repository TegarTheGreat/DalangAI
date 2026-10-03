import type { ScenePlan, TextOverlay } from "@dalang/core";
import type { FrameLayout } from "./layout";
import { isSpacer, splitForAnim, typewriterRevealFrame } from "./typewriter";

/**
 * Pustaka efek suara BAWAAN (ADR-0041).
 *
 * Sebelum ini `audio.sfx` hanya bisa memakai berkas yang sudah diunduh dari
 * Openverse — artinya efek suara tidak bekerja sama sekali tanpa jaringan,
 * padahal seluruh sisa Dalang dirancang berjalan offline. Delapan bunyi ini
 * menutup lubang itu.
 *
 * Semuanya DISINTESIS oleh `scripts/buat-sfx.mjs` yang ikut di-commit — bukan
 * diunduh. Itu keputusan lisensi sebelum jadi keputusan teknis: efek suara
 * "gratis" di internet punya syarat atribusi yang berbeda-beda, dan pustaka
 * yang syaratnya tidak seragam adalah pustaka yang tidak bisa dipakai tanpa
 * membaca satu per satu. Yang lahir dari angka jadi CC0 tanpa syarat.
 */
export interface BundledSfx {
  id: string;
  /** Path relatif public dir templates (dipakai staticFile). */
  file: string;
  label: string;
  /** Panjang bunyinya, detik — dipakai UI untuk menampilkan durasi. */
  durationSec: number;
  /**
   * Kenyaringan terintegrasi, LUFS — ADA hanya untuk bunyi yang lebih panjang
   * dari satu blok 400 ms.
   *
   * Ketiadaannya bukan data yang belum diisi: kenyaringan TERINTEGRASI tidak
   * punya arti untuk bunyi 60 milidetik, dan angka yang dipaksa keluar dari
   * sana akan dipakai orang seolah-olah berarti. Bunyi pendek dijamin setara
   * lewat normalisasi PUNCAK ke -1 dBFS, sama untuk kedelapannya.
   */
  lufs?: number;
  /** Semua bunyi pustaka MONO — lihat catatan kanal di `BundledMusic`. */
  channels: number;
}

export const BUNDLED_SFX: readonly BundledSfx[] = [
  {
    id: "whoosh",
    file: "sfx/whoosh.wav",
    label: "Whoosh (sapuan udara, untuk transisi)",
    durationSec: 0.55,
    lufs: -10.33,
    channels: 1,
  },
  {
    id: "pop",
    file: "sfx/pop.wav",
    label: "Pop (letup pendek, untuk teks masuk)",
    durationSec: 0.12,
    channels: 1,
  },
  {
    id: "klik",
    file: "sfx/klik.wav",
    label: "Klik (antarmuka, untuk tutorial)",
    durationSec: 0.06,
    channels: 1,
  },
  {
    id: "ding",
    file: "sfx/ding.wav",
    label: "Ding (dentang lembut, penanda selesai)",
    durationSec: 0.9,
    lufs: -15.86,
    channels: 1,
  },
  {
    id: "tap",
    file: "sfx/tap.wav",
    label: "Tap (ketukan kayu, aksen ritmis)",
    durationSec: 0.14,
    channels: 1,
  },
  {
    id: "swipe",
    file: "sfx/swipe.wav",
    label: "Swipe (geser layar, potongan cepat)",
    durationSec: 0.32,
    channels: 1,
  },
  {
    id: "impact",
    file: "sfx/impact.wav",
    label: "Impact (hentakan rendah, judul menghentak)",
    durationSec: 1.1,
    lufs: -16.66,
    channels: 1,
  },
  {
    id: "riser",
    file: "sfx/riser.wav",
    label: "Riser (naikan tegangan sebelum reveal)",
    durationSec: 1.6,
    lufs: -14.93,
    channels: 1,
  },
] as const;

/** Prefiks yang sama dengan musik pustaka — satu kosakata untuk satu gagasan. */
export const SFX_LIBRARY_PREFIX = "pustaka:";

export interface ResolvedSfx {
  file: string;
  /** True = aset SITUS (ikut bundel komposisi), false = aset PLAN. */
  bundled: boolean;
  lufs?: number;
  channels?: number;
}

/**
 * assetId efek suara -> berkas + asalnya.
 *
 * Mengembalikan null untuk id pustaka yang tidak dikenal, supaya render tetap
 * jalan tanpa bunyi itu dan `validate` yang memberi tahu — pola yang sama
 * dengan musik pustaka.
 */
export const resolveSfxFile = (assetId: string): ResolvedSfx | null => {
  if (!assetId.startsWith(SFX_LIBRARY_PREFIX)) return null;
  const id = assetId.slice(SFX_LIBRARY_PREFIX.length);
  const found = BUNDLED_SFX.find((sfx) => sfx.id === id);
  return found
    ? { file: found.file, bundled: true, lufs: found.lufs, channels: found.channels }
    : null;
};

/**
 * Penempatan efek suara pada garis waktu render (ADR-0018).
 *
 * Cue ditulis relatif terhadap SCENE ("1,5 detik setelah scene b mulai"),
 * bukan terhadap garis waktu global. Fungsi ini yang menerjemahkannya jadi
 * frame absolut. Akibatnya menggeser, memotong, atau memanjangkan scene
 * membuat bunyinya ikut pindah tanpa satu pun angka perlu disunting ulang —
 * dan cue yang scene-nya sudah dihapus otomatis hilang, tidak jadi yatim.
 *
 * Murni: hanya angka, jadi bisa diuji tanpa merender.
 */

export interface PlacedSfx {
  cueId: string;
  /** Berkas relatif terhadap public dir render. */
  file: string;
  /** Frame absolut mulai berbunyi. */
  fromFrame: number;
  volume: number;
  /**
   * True untuk bunyi PUSTAKA (aset situs) — komponen mengalamatkannya lewat
   * `staticFile` di mana pun render berjalan, sedangkan bunyi unduhan ikut
   * jalur aset plan (ADR-0019).
   */
  bundled: boolean;
  /**
   * Batas hidup elemen audio, frame. Diisi untuk bunyi yang SANGAT pendek
   * (ketukan tuts): tanpa batas, tiap ketukan tetap terpasang sampai video
   * habis, dan teks 40 huruf berarti 40 elemen audio hidup sepanjang sisa
   * video. Kosong = tidak dibatasi (perilaku cue biasa).
   */
  durationInFrames?: number;
}

export const placeSfxCues = (
  plan: ScenePlan,
  layout: FrameLayout,
  fps: number,
): PlacedSfx[] => {
  const startOf = new Map<string, number>();
  plan.scenes.forEach((scene, index) => {
    startOf.set(scene.id, layout.sceneStarts[index] ?? 0);
  });

  const placed: PlacedSfx[] = [];
  for (const cue of plan.audio.sfx) {
    const sceneStart = startOf.get(cue.sceneId);
    // Cue yatim (scene-nya sudah tidak ada) dilewati diam-diam: plan tetap
    // sah, render tetap jalan, dan Studio yang menampilkan statusnya.
    if (sceneStart === undefined) continue;
    // Bunyi PUSTAKA tidak butuh `sfxAssets` sama sekali: berkasnya ikut
    // bundel komposisi, jadi tidak ada yang perlu diunduh, di-stage, atau
    // dicatat di renderState. Itulah yang membuatnya bekerja offline.
    const pustaka = resolveSfxFile(cue.assetId);
    if (pustaka) {
      placed.push({
        cueId: cue.id,
        file: pustaka.file,
        fromFrame: sceneStart + Math.round(cue.atSec * fps),
        volume: cue.volume,
        bundled: true,
      });
      continue;
    }
    const asset = plan.renderState.sfxAssets[cue.id];
    if (!asset) continue;
    placed.push({
      cueId: cue.id,
      file: asset.file,
      fromFrame: sceneStart + Math.round(cue.atSec * fps),
      volume: cue.volume,
      bundled: false,
    });
  }
  // Bunyi ketik diturunkan dari teksnya, bukan dari `plan.audio.sfx` (batas 24
  // cue tidak berlaku, dan tak ada cue yatim): ia ikut daftar yang sama supaya
  // SEMUA preset yang memutar efek suara otomatis memutarnya juga.
  return [...placed, ...placeTypingSounds(plan, layout, fps)];
};

/**
 * Bunyi ketik (ADR-0043): satu ketukan tuts per karakter pada teks `typewriter`.
 *
 * Bahan bunyinya BUKAN bagian pustaka yang dipilih orang (tidak muncul di
 * `BUNDLED_SFX`): empat ketukan huruf dan satu ketukan spasi, disintesis oleh
 * `scripts/buat-sfx.mjs`. Empat varian dipakai bergantian supaya rentetan
 * ketukan tidak terdengar seperti satu sampel yang diulang.
 */
export const TYPING_KEYS = {
  huruf: [
    { file: "sfx/ketik-1.wav", durationSec: 0.11 },
    { file: "sfx/ketik-2.wav", durationSec: 0.11 },
    { file: "sfx/ketik-3.wav", durationSec: 0.11 },
    { file: "sfx/ketik-4.wav", durationSec: 0.11 },
  ],
  spasi: { file: "sfx/ketik-spasi.wav", durationSec: 0.14 },
} as const;

/** Varian ketukan huruf ke-`index`: deterministik, dan tak pernah sama dengan sebelumnya. */
export const keyVariant = (index: number, char: string, previous: number): number => {
  const raw = (index * 5 + (char.codePointAt(0) ?? 0)) % TYPING_KEYS.huruf.length;
  return raw === previous ? (raw + 1) % TYPING_KEYS.huruf.length : raw;
};

/**
 * Variasi volume per ketukan, 0,82-1,0: deterministik, jadi render yang sama
 * menghasilkan bunyi yang sama byte per byte.
 */
export const keyGain = (index: number): number =>
  0.82 + 0.18 * (((index * 37) % 11) / 10);

/**
 * Menempatkan ketukan tuts untuk semua teks `typewriter` ber-`sound`.
 *
 * Posisinya dihitung dari jadwal animasi yang SAMA dengan yang menampilkan
 * hurufnya (`typewriterRevealFrame`): ketukan ke-i jatuh tepat di bingkai
 * huruf ke-i tampil. Karena diturunkan dari teksnya sendiri — bukan disimpan
 * sebagai cue — memindahkan teks, menyunting isinya, atau memanjangkan scene
 * membuat bunyinya ikut tanpa satu angka pun perlu disunting ulang, dan tidak
 * ada bunyi usang yang tertinggal.
 *
 * Huruf yang baru akan tampil SETELAH teksnya hilang (jendela terlalu pendek)
 * tidak berbunyi: bunyi tanpa huruf yang bisa dilihat adalah cacat yang lebih
 * mencolok daripada huruf yang terpotong.
 */
export const placeTypingSounds = (
  plan: ScenePlan,
  layout: FrameLayout,
  fps: number,
): PlacedSfx[] => {
  const placed: PlacedSfx[] = [];
  plan.scenes.forEach((scene, sceneIndex) => {
    const sceneStart = layout.sceneStarts[sceneIndex] ?? 0;
    const sceneFrames = layout.sceneFrames[sceneIndex] ?? 0;
    for (const text of scene.texts) {
      if (!bersuaraKetik(text)) continue;
      // Persis rumus jendela di TextsOverlay: awal dibulatkan, akhir minimal
      // satu bingkai setelah awal.
      const start = Math.round(text.startFrac * sceneFrames);
      const end = Math.max(start + 1, Math.round(text.endFrac * sceneFrames));
      let previous = -1;
      splitForAnim(text.content, "typewriter").forEach((piece, index) => {
        const frame = start + typewriterRevealFrame(index);
        if (frame > end || frame >= sceneFrames) return;
        const spasi = isSpacer(piece);
        let file: string;
        let durationSec: number;
        if (spasi) {
          ({ file, durationSec } = TYPING_KEYS.spasi);
        } else {
          previous = keyVariant(index, piece, previous);
          ({ file, durationSec } = TYPING_KEYS.huruf[previous] ?? TYPING_KEYS.huruf[0]);
        }
        placed.push({
          cueId: `ketik:${scene.id}:${text.id}:${index}`,
          file,
          fromFrame: sceneStart + frame,
          volume: Math.min(1, text.soundVolume * keyGain(index)),
          bundled: true,
          durationInFrames: Math.ceil(durationSec * fps) + 1,
        });
      });
    }
  });
  return placed;
};

/** Teks ini harus berbunyi ketik: `sound` menyala DAN animasinya `typewriter`. */
export const bersuaraKetik = (text: Pick<TextOverlay, "sound" | "anim">): boolean =>
  text.sound === "ketik" && text.anim === "typewriter";
