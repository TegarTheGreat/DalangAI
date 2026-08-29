import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Locate a usable Chromium for @remotion/renderer without downloading one.
 * Order: explicit env override → Playwright-managed browsers (headless shell
 * preferred — it is the same artifact Remotion itself would download) →
 * common system locations. Returns undefined to let Remotion download its own
 * headless shell as a last resort.
 */

const playwrightCandidates = (root: string): string[] => {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root).sort().reverse();
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith("chromium_headless_shell-")) {
      found.push(join(root, entry, "chrome-linux", "headless_shell"));
    }
  }
  for (const entry of entries) {
    if (/^chromium-\d+$/.test(entry)) {
      found.push(join(root, entry, "chrome-linux", "chrome"));
    }
  }
  return found;
};

export const findBrowserExecutable = (): string | undefined => {
  const candidates = [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    ...playwrightCandidates(process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers"),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return undefined;
};
