import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  ASPECT_RATIOS,
  type AspectRatio,
  parseScenePlan,
  type ScenePlanInput,
} from "@dalang/core";
import { atomicWriteFile } from "@dalang/pipeline";
import { computeFrameLayout, FPS } from "@dalang/templates/layout";
import type { WorkspaceProjectLite } from "../shared/api-types";

/**
 * Workspace: satu folder yang berisi banyak folder proyek (lobi).
 *
 * Sebuah proyek adalah folder dengan `plan.json` di dalamnya. Aturan itu
 * sengaja dibuat sesederhana mungkin: proyek Dalang harus tetap berupa folder
 * biasa yang bisa disalin, di-zip, dan di-commit — bukan entri di sebuah
 * database yang hanya bisa dibaca aplikasinya sendiri.
 */

export interface WorkspaceProject extends WorkspaceProjectLite {
  dir: string;
  planPath: string;
}

const RENDER_DIR = join(".dalang", "renders");
const RENDER_FILE = /\.(mp4|webm|mov)$/i;

/** Aksen bawaan tiap preset — disalin dari theme.ts masing-masing. */
const PRESET_ACCENT: Record<string, string> = {
  "documentary-01": "#E4A64C",
  "tutorial-01": "#2E5FD7",
};
const FALLBACK_ACCENT = "#8A93A6";

/** Ekspor terbaru proyek + jumlahnya, untuk sampul kartu di lobi. */
const renderSummary = (
  root: string,
  id: string,
): { count: number; posterUrl: string | null } => {
  const renderDir = join(root, id, RENDER_DIR);
  if (!existsSync(renderDir)) return { count: 0, posterUrl: null };
  try {
    const files = readdirSync(renderDir)
      .filter((file) => RENDER_FILE.test(file))
      .map((file) => ({ file, at: statSync(join(renderDir, file)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    const newest = files[0];
    return {
      count: files.length,
      posterUrl: newest
        ? `/api/workspace/render/${encodeURIComponent(id)}/.dalang/renders/${encodeURIComponent(newest.file)}`
        : null,
    };
  } catch {
    return { count: 0, posterUrl: null };
  }
};

const readProject = (root: string, id: string): WorkspaceProject | null => {
  const dir = join(root, id);
  const planPath = join(dir, "plan.json");
  if (!existsSync(planPath)) return null;

  const renders = renderSummary(root, id);
  const base: WorkspaceProject = {
    id,
    dir,
    planPath,
    title: id,
    aspectRatio: "9:16",
    stylePreset: "documentary-01",
    format: "bebas",
    scenes: 0,
    durationSec: 0,
    updatedAt: new Date(statSync(planPath).mtimeMs).toISOString(),
    renders: renders.count,
    accent: FALLBACK_ACCENT,
    posterUrl: renders.posterUrl,
    valid: false,
  };

  try {
    const plan = parseScenePlan(JSON.parse(readFileSync(planPath, "utf8")));
    // Durasi yang SAMA dengan preview dan berkas hasil ekspor: transisi
    // saling menindih, jadi menjumlahkan durasi scene begitu saja
    // melebih-lebihkan videonya (8 scene ber-transisi: 58,9 dtk vs 54,9 dtk
    // yang sesungguhnya). Lobi tidak boleh menyebut angka yang tidak akan
    // pernah dilihat pengguna di mana pun lagi.
    const totalSec = computeFrameLayout(plan).totalFrames / FPS;
    return {
      ...base,
      title: plan.meta.title,
      aspectRatio: plan.meta.aspectRatio,
      stylePreset: plan.meta.stylePreset,
      format: plan.meta.format,
      scenes: plan.scenes.length,
      durationSec: Number(totalSec.toFixed(1)),
      accent:
        plan.meta.tokens?.accent ??
        PRESET_ACCENT[plan.meta.stylePreset] ??
        FALLBACK_ACCENT,
      valid: true,
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/** Semua proyek di workspace, terbaru di atas. */
export const listProjects = (root: string): WorkspaceProject[] => {
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return []; // folder tanpa izin baca: lobi kosong, bukan server tumbang
  }
  return entries
    .map((id) => readProject(root, id))
    .filter((project): project is WorkspaceProject => project !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

/**
 * Nama folder dari judul. Dipakai sebagai id, jadi ia harus aman untuk path
 * DAN untuk URL — dua hal yang berbeda, dan yang paling ketat yang menang.
 */
export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "proyek";

/** Slug yang belum dipakai folder lain di workspace. */
export const uniqueSlug = (root: string, title: string): string => {
  const base = slugify(title);
  if (!existsSync(join(root, base))) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!existsSync(join(root, candidate))) return candidate;
  }
};

export interface NewProjectInput {
  title: string;
  aspectRatio: AspectRatio;
  stylePreset: string;
  format: string;
}

/**
 * Plan awal proyek baru.
 *
 * Sengaja BUKAN plan kosong: satu kartu judul membuat preview langsung
 * menampilkan sesuatu dan timeline langsung punya klip. Proyek baru yang
 * membuka ke layar hitam terasa seperti aplikasi yang belum jadi, dan
 * menyembunyikan bahwa semuanya sudah siap dipakai.
 */
export const newProjectPlan = (input: NewProjectInput): ScenePlanInput => ({
  version: 1,
  projectId: slugify(input.title),
  meta: {
    title: input.title,
    aspectRatio: input.aspectRatio,
    stylePreset: input.stylePreset,
    format: input.format,
    language: "id",
  },
  audio: { voice: { provider: "silence", voiceId: "id-standar", speed: 1 } },
  scenes: [
    {
      id: "sc-judul",
      narration: "",
      visual: { type: "template-anim", variant: "title" },
      duration: 4,
    },
  ],
  renderState: { narrationAudio: {}, resolvedAssets: {} },
});

export const createProject = (root: string, input: NewProjectInput): WorkspaceProject => {
  const title = input.title.trim();
  if (title === "") throw new Error("Judul proyek tidak boleh kosong");
  if (!(ASPECT_RATIOS as readonly string[]).includes(input.aspectRatio)) {
    throw new Error(`Rasio "${input.aspectRatio}" tidak dikenal`);
  }
  mkdirSync(root, { recursive: true });
  const id = uniqueSlug(root, title);
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  // Divalidasi lewat parse sebelum ditulis: proyek baru tidak boleh pernah
  // lahir dalam keadaan tidak sah.
  const plan = parseScenePlan(newProjectPlan({ ...input, title }));
  atomicWriteFile(join(dir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

  const created = readProject(root, id);
  if (!created) throw new Error(`Proyek ${id} gagal dibuat`);
  return created;
};

/**
 * Tentukan mode dari satu argumen path: folder berisi plan.json = buka proyek
 * itu; folder lain = workspace (lobi). Aturan ini menjaga
 * `dalang studio proyekku/` tetap bekerja seperti sebelumnya.
 */
export const resolveEntry = (
  pathArg: string,
): { mode: "project"; planPath: string } | { mode: "workspace"; root: string } => {
  const abs = resolve(pathArg);
  const isDir = existsSync(abs) && statSync(abs).isDirectory();
  if (!isDir) return { mode: "project", planPath: abs };
  if (existsSync(join(abs, "plan.json"))) {
    return { mode: "project", planPath: join(abs, "plan.json") };
  }
  return { mode: "workspace", root: abs };
};

export const projectIdOf = (planPath: string): string =>
  basename(resolve(planPath, ".."));

/** Ganti judul proyek yang SEDANG TERTUTUP (yang terbuka lewat patch sesi). */
export const renameClosedProject = (
  root: string,
  id: string,
  title: string,
): WorkspaceProject => {
  const trimmed = title.trim();
  if (trimmed === "") throw new Error("Judul proyek tidak boleh kosong");
  const planPath = join(root, id, "plan.json");
  if (!existsSync(planPath)) throw new Error(`Proyek "${id}" tidak ditemukan`);
  const plan = parseScenePlan(JSON.parse(readFileSync(planPath, "utf8")));
  const next = { ...plan, meta: { ...plan.meta, title: trimmed } };
  atomicWriteFile(planPath, `${JSON.stringify(next, null, 2)}\n`);
  const updated = readProject(root, id);
  if (!updated) throw new Error(`Proyek "${id}" tidak terbaca setelah ganti judul`);
  return updated;
};

/**
 * Salinan proyek. `.dalang` sengaja TIDAK ikut: cache pipeline, ledger biaya,
 * riwayat patch, dan hasil render milik proyek asal. Salinan yang membawa
 * ledger orang lain akan berbohong soal biaya sejak detik pertama.
 */
export const duplicateProject = (root: string, id: string): WorkspaceProject => {
  const source = join(root, id);
  if (!existsSync(join(source, "plan.json"))) {
    throw new Error(`Proyek "${id}" tidak ditemukan`);
  }
  const plan = parseScenePlan(
    JSON.parse(readFileSync(join(source, "plan.json"), "utf8")),
  );
  const title = `${plan.meta.title} (salinan)`;
  const nextId = uniqueSlug(root, title);
  const target = join(root, nextId);
  cpSync(source, target, {
    recursive: true,
    filter: (src) => basename(src) !== ".dalang",
  });
  const copied = { ...plan, projectId: nextId, meta: { ...plan.meta, title } };
  atomicWriteFile(join(target, "plan.json"), `${JSON.stringify(copied, null, 2)}\n`);
  const created = readProject(root, nextId);
  if (!created) throw new Error(`Salinan "${nextId}" gagal dibuat`);
  return created;
};

export const TRASH_DIR = ".trash";

/**
 * Buang proyek ke `<workspace>/.trash/` — BUKAN hapus permanen. Sebuah tombol
 * di layar tidak boleh bisa memusnahkan pekerjaan berhari-hari; memindahkan
 * folder memberi jalan pulang yang tidak butuh aplikasi ini sama sekali.
 */
export const trashProject = (root: string, id: string): { trashedTo: string } => {
  const source = join(root, id);
  if (!existsSync(join(source, "plan.json"))) {
    throw new Error(`Proyek "${id}" tidak ditemukan`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(root, TRASH_DIR, `${id}-${stamp}`);
  mkdirSync(join(root, TRASH_DIR), { recursive: true });
  renameSync(source, target);
  return { trashedTo: target };
};
