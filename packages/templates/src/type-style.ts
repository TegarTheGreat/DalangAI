import type { Scene, TextOverlay } from "@dalang/core";
import { CAPTION_STYLES } from "@dalang/core";
import { easeSettle, kf } from "./anim";

/**
 * ADR-0016: tipografi bergerak — semantik yang SAMA lintas preset.
 * Semua fungsi murni (diuji unit); warna konkret milik theme masing-masing.
 */

export type CaptionStyle = (typeof CAPTION_STYLES)[number];

/**
 * Normalisasi `caption.style`. Field ini `string` sejak v0 (nilai lama
 * "inherit") sehingga plan lama tetap valid; nilai tak dikenal jatuh ke
 * "klasik" — pola yang sama dengan `visual.variant`.
 */
export const captionStyleOf = (scene: Scene): CaptionStyle =>
  (CAPTION_STYLES as readonly string[]).includes(scene.caption.style)
    ? (scene.caption.style as CaptionStyle)
    : "klasik";

export interface CaptionPalette {
  ink: string;
  inkSoft: string;
  accent: string;
  /** Warna teks di atas chip aksen (kontras terhadap accent). */
  onAccent: string;
  /**
   * Latar PITA di belakang seluruh baris (ADR-0041).
   *
   * Terpisah dari `accent`: pita harus GELAP dan netral supaya teks di atasnya
   * terbaca, sedangkan aksen adalah warna yang menarik perhatian. Memakai satu
   * warna untuk keduanya memaksa memilih antara pita yang menyilaukan atau
   * aksen yang tidak terlihat.
   */
  plate: string;
}

export interface CaptionStyleSpec {
  /** Gaya blok halaman caption. */
  block: React.CSSProperties;
  /** Gaya per token, bergantung status kata. */
  token: (state: "past" | "active" | "future") => React.CSSProperties;
  /** Pengali ukuran font halaman (di atas caption.size). */
  sizeFactor: number;
}

/**
 * Pisahkan spasi pemisah di depan token dari katanya. Token caption membawa
 * spasinya sendiri (" soal"), sementara gaya seperti "tegas" membungkus kata
 * dalam kotak `inline-block` yang MENGEMPISKAN spasi di tepinya. Spasi
 * karenanya dirender di LUAR kotak — deterministik, tidak bergantung pada
 * seluk-beluk white-space.
 */
export const splitToken = (text: string): { lead: string; word: string } => {
  const match = /^(\s*)([\s\S]*)$/.exec(text);
  return { lead: match?.[1] ?? "", word: match?.[2] ?? text };
};

/** Garis luar teks lewat text-shadow berlapis — konsisten di Chromium render. */
export const strokeShadow = (px: number, color: string): string =>
  px <= 0
    ? ""
    : [
        `${px}px 0 0 ${color}`,
        `-${px}px 0 0 ${color}`,
        `0 ${px}px 0 ${color}`,
        `0 -${px}px 0 ${color}`,
        `${px}px ${px}px 0 ${color}`,
        `-${px}px ${px}px 0 ${color}`,
        `${px}px -${px}px 0 ${color}`,
        `-${px}px -${px}px 0 ${color}`,
      ].join(", ");

/**
 * Enam gaya caption:
 *  - klasik  : kata aktif berganti warna aksen (perilaku sejak Fase 0)
 *  - tegas   : KAPITAL tebal ber-garis-luar, kata aktif membesar (gaya klip
 *              media sosial yang padat energi)
 *  - chip    : kata aktif duduk di dalam kotak aksen
 *  - halus   : tanpa karaoke — satu warna tenang untuk konten formal
 *  - pita    : SELURUH baris duduk di atas pita solid (ADR-0041) — gaya
 *              berita yang tetap terbaca di footage seramai apa pun, karena
 *              keterbacaannya tidak bergantung pada gambar di belakangnya
 *  - karaoke : kata yang SUDAH lewat diwarnai aksen dan yang belum diredupkan
 *              kuat — jejaknya terlihat, jadi penonton bisa mengejar kalimat
 *              yang terlewat sekilas
 */
export const captionStyleSpec = (
  style: CaptionStyle,
  palette: CaptionPalette,
): CaptionStyleSpec => {
  switch (style) {
    case "tegas":
      return {
        sizeFactor: 1.14,
        block: {
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "-0.005em",
          lineHeight: 1.16,
          textShadow: strokeShadow(4, "rgba(0,0,0,0.92)"),
        },
        token: (state) => ({
          color: state === "active" ? palette.accent : palette.ink,
          display: "inline-block",
          whiteSpace: "pre",
          // `scale` adalah transform: TIDAK menambah lebar layout, sehingga
          // kata aktif yang membesar akan MENUTUPI spasi tetangganya. Padding
          // memberi ruang nyata supaya pembesaran tidak menelan jarak kata.
          padding: "0 0.09em",
          scale: state === "active" ? "1.09" : "1",
        }),
      };
    case "chip":
      return {
        sizeFactor: 1.04,
        block: { fontWeight: 780, lineHeight: 1.34 },
        token: (state) =>
          state === "active"
            ? {
                color: palette.onAccent,
                background: palette.accent,
                padding: "0.06em 0.22em",
                borderRadius: "0.16em",
                textShadow: "none",
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }
            : { color: state === "past" ? palette.ink : palette.inkSoft },
      };
    case "halus":
      return {
        sizeFactor: 0.94,
        block: { fontWeight: 560, lineHeight: 1.4 },
        token: () => ({ color: palette.ink }),
      };
    case "pita":
      return {
        sizeFactor: 1.02,
        block: {
          fontWeight: 700,
          lineHeight: 1.5,
          // Pita menempel pada BARISNYA, bukan pada blok: baris kedua yang
          // lebih pendek harus punya pita yang lebih pendek juga, kalau tidak
          // bentuknya jadi kotak besar dengan ruang kosong di kanan.
          display: "inline",
          background: palette.plate,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
          padding: "0.1em 0.34em",
          borderRadius: "0.06em",
          textShadow: "none",
        },
        token: (state) => ({
          color: state === "active" ? palette.accent : palette.ink,
          fontWeight: state === "active" ? 820 : 700,
        }),
      };
    case "karaoke":
      return {
        sizeFactor: 1.06,
        block: {
          fontWeight: 720,
          lineHeight: 1.3,
          textShadow: strokeShadow(3, "rgba(0,0,0,0.8)"),
        },
        token: (state) => ({
          // Yang SUDAH lewat tetap beraksen — itu bedanya dari klasik, yang
          // mengembalikannya ke warna biasa. Jejak inilah yang membuat orang
          // bisa mengejar kalimat yang terlewat sekilas.
          color: state === "future" ? palette.inkSoft : palette.accent,
          opacity: state === "future" ? 0.55 : 1,
          fontWeight: state === "active" ? 860 : 720,
        }),
      };
    case "klasik":
      return {
        sizeFactor: 1,
        block: { fontWeight: 640, lineHeight: 1.28 },
        token: (state) => ({
          color:
            state === "active"
              ? palette.accent
              : state === "past"
                ? palette.ink
                : palette.inkSoft,
          fontWeight: state === "active" ? 760 : 640,
        }),
      };
  }
};

// ---------------------------------------------------------------------------
// Animasi masuk teks overlay (per kata / per karakter)
// ---------------------------------------------------------------------------

/** Jeda antar potongan (frame) untuk animasi berjenjang. */
export const STAGGER_FRAMES = 3;
const PIECE_FRAMES = 12;

/**
 * Pecah konten sesuai jenis animasi: `typewriter` per karakter, `pop`/`rise`
 * per kata, `fade` tidak dipecah (satu blok).
 */
export const splitForAnim = (content: string, anim: TextOverlay["anim"]): string[] => {
  if (anim === "fade") return [content];
  if (anim === "typewriter") return Array.from(content);
  return content.split(/(\s+)/).filter((piece) => piece !== "");
};

/** Potongan yang hanya spasi dirender polos (di luar kotak inline-block). */
export const isSpacer = (piece: string): boolean => /^\s+$/.test(piece);

/**
 * Gaya potongan ke-`index` pada `frame` relatif mulainya teks.
 * Mengembalikan null bila potongan belum boleh tampil (typewriter).
 */
export const animPieceStyle = (
  anim: TextOverlay["anim"],
  index: number,
  frame: number,
): React.CSSProperties | null => {
  const start = index * STAGGER_FRAMES;
  const t = kf(
    frame,
    [
      [start, 0],
      [start + PIECE_FRAMES, 1],
    ],
    easeSettle,
  );
  switch (anim) {
    case "pop":
      return {
        display: "inline-block",
        whiteSpace: "pre",
        opacity: t,
        scale: (0.72 + t * 0.28).toFixed(3),
      };
    case "rise":
      return {
        display: "inline-block",
        whiteSpace: "pre",
        opacity: t,
        translate: `0 ${((1 - t) * 0.5).toFixed(3)}em`,
      };
    case "typewriter":
      // Karakter muncul utuh saat gilirannya tiba (tanpa fade) — mesin ketik.
      return frame >= start ? {} : null;
    case "blur-in":
      // Kabur ke tajam (ADR-0041): pintu masuk yang TENANG untuk teks panjang,
      // sementara pop dan rise selalu terasa energik. Blur dipatok 0 saat
      // selesai — sisa 0,04px yang tertinggal membuat teks tidak pernah
      // benar-benar tajam, dan itu terlihat pada judul besar.
      return {
        display: "inline-block",
        whiteSpace: "pre",
        opacity: t,
        filter: t >= 1 ? "none" : `blur(${((1 - t) * 0.34).toFixed(3)}em)`,
      };
    case "slide-in":
      return {
        display: "inline-block",
        whiteSpace: "pre",
        opacity: t,
        translate: `${((1 - t) * -0.6).toFixed(3)}em 0`,
      };
    case "fade":
      return {};
  }
};

/** Gaya rupa teks overlay dari kontrol ADR-0016 (warna/garis/kapital/kerapatan). */
export const textLookStyle = (
  text: Pick<TextOverlay, "color" | "stroke" | "uppercase" | "tracking">,
  opts: { strokeColor: string; baseTracking?: string },
): React.CSSProperties => {
  const stroke = strokeShadow(text.stroke, opts.strokeColor);
  return {
    ...(text.color ? { color: text.color } : {}),
    ...(text.uppercase ? { textTransform: "uppercase" as const } : {}),
    ...(text.tracking !== 0
      ? {
          letterSpacing: `${(text.tracking + Number(opts.baseTracking ?? 0)).toFixed(3)}em`,
        }
      : {}),
    ...(stroke ? { textShadow: stroke } : {}),
  };
};
