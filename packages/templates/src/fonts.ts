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

/**
 * Keluarga font ter-bundle yang boleh dirujuk design tokens
 * (meta.tokens.fontDisplay/fontBody) — ADR-0013. UI studio menawarkan
 * daftar ini; string lain tetap sah (fallback stack menjaga render).
 */
export const FONT_CHOICES = [
  {
    family: "Fraunces",
    file: "fonts/Fraunces-var.woff2",
    label: "Fraunces (serif editorial)",
  },
  { family: "Inter", file: "fonts/Inter-var.woff2", label: "Inter (sans netral)" },
  {
    family: "Space Grotesk",
    file: "fonts/SpaceGrotesk-var.ttf",
    label: "Space Grotesk (sans teknis)",
  },
  { family: "Lora", file: "fonts/Lora-var.ttf", label: "Lora (serif hangat)" },
] as const;

let started = false;

/** Idempotent; call from any component that renders text. */
export const ensureFontsLoaded = (): void => {
  if (started) return;
  started = true;

  const handle = delayRender("Memuat font Dalang (4 keluarga ter-bundle)");
  Promise.all(
    FONT_CHOICES.map((choice) =>
      loadFont({
        family: choice.family,
        url: staticFile(choice.file),
        weight: "100 900",
      }),
    ),
  )
    .then(() => continueRender(handle))
    .catch((err) => cancelRender(err));
};
