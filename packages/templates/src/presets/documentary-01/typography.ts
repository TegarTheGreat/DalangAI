/**
 * Pure typography helpers for documentary-01 (unit-tested).
 */

/**
 * Display-title size: full base size up to 18 chars, then shrink with the
 * square root of the length so long titles stay dramatic without overflowing.
 */
export const titleFontSize = (title: string, base: number): number => {
  const chars = title.length;
  if (chars <= 18) return base;
  return Math.max(Math.round(base * Math.sqrt(18 / chars)), 62);
};
