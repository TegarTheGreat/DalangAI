import { loadFont } from "@remotion/fonts";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

/**
 * Vendored variable fonts (see public/fonts/LICENSE.md). Loaded from the
 * render public dir so rendering works fully offline (local-first, PRD §1).
 * Missing font files fail the render loudly — no silent visual degradation
 * (PRD §10: "tidak ada kegagalan senyap").
 */

export const FONT_DISPLAY = "Fraunces";
export const FONT_BODY = "Inter";

export const FONT_STACK_DISPLAY = `${FONT_DISPLAY}, Georgia, serif`;
export const FONT_STACK_BODY = `${FONT_BODY}, -apple-system, Segoe UI, sans-serif`;

let started = false;

/** Idempotent; call from any component that renders text. */
export const ensureFontsLoaded = (): void => {
  if (started) return;
  started = true;

  const handle = delayRender("Memuat font Dalang (Fraunces, Inter)");
  Promise.all([
    loadFont({
      family: FONT_DISPLAY,
      url: staticFile("fonts/Fraunces-var.woff2"),
      weight: "100 900",
    }),
    loadFont({
      family: FONT_BODY,
      url: staticFile("fonts/Inter-var.woff2"),
      weight: "100 900",
    }),
  ])
    .then(() => continueRender(handle))
    .catch((err) => cancelRender(err));
};
