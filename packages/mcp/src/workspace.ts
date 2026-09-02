import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseScenePlan, type ScenePlan } from "@dalang/core";
import { atomicWriteFile } from "@dalang/pipeline";

/**
 * Pagar ruang kerja untuk server MCP (ADR-0023).
 *
 * Pemanggil server ini adalah AGENT LAIN — Claude Code, atau apa pun yang
 * bicara MCP. Ia tidak jahat, tapi ia juga tidak tahu batas: kalau sebuah tool
 * menerima path, cepat atau lambat ia akan mengirim path yang di luar dugaan.
 * Setiap path yang masuk lewat tool WAJIB lewat `resolveProject`, dan tidak
 * ada satu pun jalur tulis yang melewatinya.
 *
 * Yang dijaga bukan cuma keamanan. Server yang bisa menimpa plan.json mana pun
 * di disk adalah server yang tidak bisa dipercaya menjalankan apa pun tanpa
 * diawasi — dan seluruh gunanya justru supaya tidak perlu diawasi.
 */

export class WorkspaceError extends Error {}

/** True kalau `child` benar-benar di dalam `root` (bukan sekadar berawalan sama). */
export const isInside = (root: string, child: string): boolean => {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export interface Workspace {
  root: string;
  /** Boleh menulis plan.json, atau hanya membaca. */
  readOnly: boolean;
}

/**
 * Path proyek dari sisi klien -> path plan.json yang sah.
 *
 * Menerima folder proyek maupun plan.json langsung, relatif terhadap root
 * maupun absolut. Absolut pun tetap diperiksa: berada di dalam root adalah
 * syarat, bukan bentuk penulisannya.
 */
export const resolvePlanPath = (workspace: Workspace, proyek: string): string => {
  const root = resolve(workspace.root);
  const target = isAbsolute(proyek) ? resolve(proyek) : resolve(root, proyek);
  if (!isInside(root, target)) {
    throw new WorkspaceError(
      `Path "${proyek}" di luar ruang kerja server (${root}). Server ini hanya melayani proyek di dalamnya.`,
    );
  }
  const planPath = target.endsWith(".json") ? target : join(target, "plan.json");
  if (!existsSync(planPath)) {
    throw new WorkspaceError(`Tidak ada scene-plan di ${planPath}.`);
  }
  // Diperiksa DUA KALI dengan sengaja: `proyek` bisa berupa "proyekku" yang
  // aman, sementara plan.json di dalamnya adalah symlink ke luar root.
  //
  // `resolve()` TIDAK cukup di sini — ia hanya menormalkan string dan tidak
  // pernah menyentuh disk, jadi symlink lolos begitu saja. Versi pertama pagar
  // ini memakainya, dan tesnya menemukan lubangnya: plan.json yang menunjuk
  // ke luar akar terbaca. `realpathSync` yang benar-benar mengikuti tautan.
  // Akarnya ikut di-realpath karena /tmp sendiri lazim berupa symlink.
  const realRoot = realpathSync(root);
  const real = realpathSync(planPath);
  if (!isInside(realRoot, real)) {
    throw new WorkspaceError(`Berkas ${planPath} menunjuk ke luar ruang kerja server.`);
  }
  return real;
};

export const readPlan = (planPath: string): ScenePlan =>
  parseScenePlan(JSON.parse(readFileSync(planPath, "utf8")));

const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Plan beserta hash isi berkasnya — untuk tulis bandingkan-dan-tukar. */
export const readPlanWithHash = (planPath: string): { plan: ScenePlan; hash: string } => {
  const raw = readFileSync(planPath, "utf8");
  return { plan: parseScenePlan(JSON.parse(raw)), hash: hashOf(raw) };
};

/**
 * Tulis HANYA bila berkasnya masih persis seperti yang dibaca (`expectedHash`).
 *
 * Studio bisa memegang proyek yang sama (koherensi ADR-0023): antara "baca"
 * dan "tulis" server ini, Studio mungkin sudah menulis. Menimpanya berarti
 * membuang editan orang tanpa suara; mengembalikan false berarti pemanggil
 * membaca ulang dan menerapkan patch-nya lagi pada plan yang segar — patch
 * op memang dirancang untuk bisa diterapkan ulang.
 */
export const writePlanIfUnchanged = (
  workspace: Workspace,
  planPath: string,
  expectedHash: string,
  plan: ScenePlan,
): boolean => {
  if (workspace.readOnly) {
    throw new WorkspaceError(
      "Server MCP ini dijalankan hanya-baca. Jalankan ulang tanpa --hanya-baca untuk mengizinkan perubahan.",
    );
  }
  const current = existsSync(planPath) ? hashOf(readFileSync(planPath, "utf8")) : null;
  if (current !== expectedHash) return false;
  atomicWriteFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return true;
};

export const writePlan = (
  workspace: Workspace,
  planPath: string,
  plan: ScenePlan,
): void => {
  if (workspace.readOnly) {
    throw new WorkspaceError(
      "Server MCP ini dijalankan hanya-baca. Jalankan ulang tanpa --hanya-baca untuk mengizinkan perubahan.",
    );
  }
  atomicWriteFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
};

export interface ProjectEntry {
  /** Path relatif terhadap root — bentuk yang dipakai klien di tool lain. */
  path: string;
  title: string;
  scenes: number;
}

/**
 * Proyek di dalam ruang kerja: folder yang berisi plan.json, satu tingkat
 * (plus root itu sendiri kalau ia memang proyek).
 */
export const listProjects = (workspace: Workspace): ProjectEntry[] => {
  const root = resolve(workspace.root);
  const candidates: string[] = [];
  if (existsSync(join(root, "plan.json"))) candidates.push(root);
  if (existsSync(root) && statSync(root).isDirectory()) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const planPath = join(root, entry.name, "plan.json");
      if (existsSync(planPath)) candidates.push(join(root, entry.name));
    }
  }
  return candidates.map((dir) => {
    const rel = relative(root, dir);
    try {
      const plan = readPlan(join(dir, "plan.json"));
      return {
        path: rel === "" ? "." : rel,
        title: plan.meta.title,
        scenes: plan.scenes.length,
      };
    } catch (error) {
      // Plan rusak tetap DIDAFTAR, dengan sebabnya. Menyembunyikannya membuat
      // klien mengira proyeknya tidak ada dan membuat yang baru di atasnya.
      return {
        path: rel === "" ? "." : rel,
        title: `(tidak bisa dibaca: ${error instanceof Error ? error.message : String(error)})`,
        scenes: 0,
      };
    }
  });
};

/** Path relatif root untuk ditampilkan ke klien; tidak pernah path absolut. */
export const displayPath = (workspace: Workspace, absolute: string): string =>
  relative(resolve(workspace.root), absolute).split(sep).join("/") || ".";
