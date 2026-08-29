import type { ScenePlan } from "@dalang/core";
import { FONT_STACK_BODY, FONT_STACK_DISPLAY } from "../../fonts";

/**
 * documentary-01 visual language. Design tokens from the plan override the
 * defaults so users personalize without breaking the design (PRD §8.3).
 */

export interface DocTheme {
  /** Deep background behind everything. */
  bg: string;
  /** Primary text color (warm paper white). */
  ink: string;
  inkSoft: string;
  /** Highlight color: captions' active word, rules, progress. */
  accent: string;
  fontDisplay: string;
  fontBody: string;
  /** Duotone gradient bases for procedural backdrops. */
  duotones: Array<[string, string]>;
}

export const themeFromPlan = (plan: ScenePlan): DocTheme => {
  const tokens = plan.meta.tokens ?? {};
  return {
    bg: tokens.primary ?? "#0B0E17",
    ink: "#F5F0E6",
    inkSoft: "rgba(245, 240, 230, 0.72)",
    accent: tokens.accent ?? "#E4A64C",
    fontDisplay: tokens.fontDisplay
      ? `${tokens.fontDisplay}, ${FONT_STACK_DISPLAY}`
      : FONT_STACK_DISPLAY,
    fontBody: tokens.fontBody
      ? `${tokens.fontBody}, ${FONT_STACK_BODY}`
      : FONT_STACK_BODY,
    duotones: [
      ["#131A33", "#3A2A18"],
      ["#0E1B2E", "#41210F"],
      ["#171226", "#2E3A1F"],
      ["#0F2233", "#3A1B22"],
    ],
  };
};
