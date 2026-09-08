import type { TransitionType } from "@dalang/core";
import { linearTiming, type TransitionPresentation } from "@remotion/transitions";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { fade } from "@remotion/transitions/fade";
import { flip } from "@remotion/transitions/flip";
import { none } from "@remotion/transitions/none";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Easing } from "remotion";

/**
 * Peta transisi keluar scene (ADR-0011) → presentation @remotion/transitions.
 * Dipakai SEMUA preset agar bahasa transisi konsisten lintas gaya.
 */

/**
 * Timing transisi ber-easing kubik (ADR-0014): potongan linear terasa
 * mekanis; kurva lambat-cepat-lambat membuat geser/sapu terasa "ditangan".
 */
export const timingFor = (durationInFrames: number) =>
  linearTiming({ durationInFrames, easing: Easing.bezier(0.45, 0.05, 0.25, 1) });

export type AnyPresentation = TransitionPresentation<Record<string, unknown>>;

/**
 * Sebagian presentation @remotion/transitions menuntut UKURAN BINGKAI
 * (clock-wipe menggambar sapuan radial, jadi ia perlu tahu radiusnya). Karena
 * itu pemetaannya menerima ukuran — bukan karena semua butuh, melainkan karena
 * satu fungsi yang kadang butuh argumen lebih mudah dipakai benar daripada dua
 * fungsi yang pemanggilnya harus memilih.
 */
export interface FrameSize {
  width: number;
  height: number;
}

export const presentationFor = (
  type: TransitionType,
  size: FrameSize = { width: 1080, height: 1920 },
): AnyPresentation => {
  switch (type) {
    case "slide-left":
      return slide({ direction: "from-right" }) as AnyPresentation;
    case "slide-right":
      return slide({ direction: "from-left" }) as AnyPresentation;
    case "slide-up":
      return slide({ direction: "from-bottom" }) as AnyPresentation;
    case "wipe-right":
      return wipe({ direction: "from-left" }) as AnyPresentation;
    case "wipe-down":
      return wipe({ direction: "from-top" }) as AnyPresentation;
    // ADR-0041. Ketiganya sudah terpasang di @remotion/transitions sejak lama;
    // yang ditambahkan repo ini cuma KOSAKATA untuk menyebutnya. Presentation
    // berbasis shader (dissolve, zoom-blur, swap, linear-blur) sengaja TIDAK
    // dipetakan: Chromium renderer ini menolak HTML-in-Canvas, dan itu
    // ketahuan dengan merender — bukan dari tipenya.
    case "clock-wipe":
      // Cast lewat unknown: ClockWipeProps punya field WAJIB (width/height),
      // jadi ia bukan subtipe dari Record<string, unknown> yang semua
      // fieldnya opsional. Ini keterbatasan tipe, bukan tanda ada yang salah.
      return clockWipe({
        width: size.width,
        height: size.height,
      }) as unknown as AnyPresentation;
    case "flip-left":
      return flip({ direction: "from-right" }) as AnyPresentation;
    case "flip-up":
      return flip({ direction: "from-bottom" }) as AnyPresentation;
    case "none":
      return none() as AnyPresentation;
    case "cross-fade":
      return fade() as AnyPresentation;
  }
};
