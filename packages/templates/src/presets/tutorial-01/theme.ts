import type { ScenePlan } from "@dalang/core";
import { FONT_STACK_BODY, FONT_STACK_DISPLAY } from "../../fonts";

/**
 * tutorial-01 — bahasa visual "dokumentasi produk": kertas terang, kartu
 * screenshot dengan bayangan lembut, aksen biru tegas untuk anotasi.
 * Design tokens plan menimpa default (PRD §8.3).
 */

export interface TutTheme {
  /** Kertas latar (di belakang kartu screenshot). */
  paper: string;
  /** Titik-titik grid halus di kertas. */
  paperDot: string;
  ink: string;
  inkSoft: string;
  /** Aksen anotasi & kata aktif caption. */
  accent: string;
  /** Aksen sekunder (chip langkah, rule). */
  warm: string;
  card: string;
  cardBorder: string;
  fontDisplay: string;
  fontBody: string;
}

export const themeFromPlan = (plan: ScenePlan): TutTheme => {
  const tokens = plan.meta.tokens ?? {};
  return {
    paper: tokens.primary ?? "#F4F2EC",
    paperDot: "rgba(29, 33, 41, 0.09)",
    ink: "#1D2129",
    inkSoft: "rgba(29, 33, 41, 0.62)",
    accent: tokens.accent ?? "#2E5FD7",
    warm: "#B9822E",
    card: "#FFFFFF",
    cardBorder: "rgba(29, 33, 41, 0.14)",
    fontDisplay: tokens.fontDisplay
      ? `${tokens.fontDisplay}, ${FONT_STACK_DISPLAY}`
      : FONT_STACK_DISPLAY,
    fontBody: tokens.fontBody
      ? `${tokens.fontBody}, ${FONT_STACK_BODY}`
      : FONT_STACK_BODY,
  };
};
