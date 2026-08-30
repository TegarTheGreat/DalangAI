import type { TransitionType } from "@dalang/core";
import type { TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { none } from "@remotion/transitions/none";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";

/**
 * Peta transisi keluar scene (ADR-0011) → presentation @remotion/transitions.
 * Dipakai SEMUA preset agar bahasa transisi konsisten lintas gaya.
 */

export type AnyPresentation = TransitionPresentation<Record<string, unknown>>;

export const presentationFor = (type: TransitionType): AnyPresentation => {
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
    case "none":
      return none() as AnyPresentation;
    case "cross-fade":
      return fade() as AnyPresentation;
  }
};
