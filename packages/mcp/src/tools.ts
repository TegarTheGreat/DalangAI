import { dirname, join } from "node:path";
import {
  applyPatch,
  computeTimeline,
  critiquePlan,
  type PatchOp,
  type PatchOpInput,
  primaryClip,
  resolveSceneDurationSec,
  type ScenePlan,
  sceneAsset,
} from "@dalang/core";
import { buildEditTimeline, otioToJson, toFcpxml } from "@dalang/interop";
import { atomicWriteFile } from "@dalang/pipeline";
import { templatesPublicDir } from "@dalang/templates/paths";
import {
  displayPath,
  listProjects,
  readPlan,
  readPlanWithHash,
  resolvePlanPath,
  type Workspace,
  writePlanIfUnchanged,
} from "./workspace";

/**
 * Isi tool server MCP, sebagai fungsi biasa.
 *
 * Dipisah dari pendaftaran tool-nya supaya bisa diuji tanpa transport dan
 * tanpa protokol: yang berharga di sini adalah keputusannya (apa yang boleh,
 * apa yang ditolak, apa yang dilaporkan), bukan pembungkus JSON-RPC-nya.
 */

export type RenderStillPort = (options: {
  planPath: string;
  frames: number[];
  outDir: string;
  scale: number;
}) => Promise<string[]>;

export interface ToolContext {
  workspace: Workspace;
  /**
   * Port render still. Sengaja DISUNTIKKAN, bukan diimpor: tanpa ini paket
   * server MCP menyeret Remotion dan Chromium ke dalam pohon dependensinya,
   * dan server yang berat adalah server yang tidak jadi dipasang orang.
   * Tidak diberikan = tool rendernya tidak didaftarkan sama sekali.
   */
  renderStill?: RenderStillPort;
}

/** Riwayat pembalik per plan, supaya `dalang_undo` punya sesuatu untuk dipakai. */
const undoStacks = new Map<string, PatchOp[][]>();

export interface PlanSummary {
  proyek: string;
  judul: string;
  aspectRatio: string;
  format: string;
  bahasa: string;
  totalDetik: number;
  scenes: Array<{
    id: string;
    mulaiDetik: number;
    durasiDetik: number;
    terkunci: boolean;
    naskah: string;
    visual: string;
    asetSiap: boolean;
    suaraSiap: boolean;
    /** Potongan gambar di dalam scene ini — hanya saat lebih dari satu (ADR-0033). */
    klip?: Array<{ id: string; durasiDetik: number; dariDetik: number; visual: string }>;
  }>;
}

/**
 * Ringkasan garis waktu — bentuk yang dibaca agent lain.
 *
 * Sengaja BUKAN plan.json mentah: plan lengkap satu proyek 60 detik sudah
 * puluhan kilobyte penuh field bawaan, dan menyuapkannya utuh ke jendela
 * konteks agent lain adalah cara termahal untuk menyampaikan "ada 8 scene".
 * Yang mentah tetap tersedia lewat tool tersendiri kalau memang dibutuhkan.
 */
export const summarizePlan = (workspace: Workspace, planPath: string): PlanSummary => {
  const plan = readPlan(planPath);
  const { timings, totalSec } = computeTimeline(plan);
  return {
    proyek: displayPath(workspace, dirname(planPath)),
    judul: plan.meta.title,
    aspectRatio: plan.meta.aspectRatio,
    format: plan.meta.format,
    bahasa: plan.meta.language,
    totalDetik: Number(totalSec.toFixed(2)),
    scenes: plan.scenes.map((scene, index) => ({
      id: scene.id,
      mulaiDetik: Number((timings[index]?.startSec ?? 0).toFixed(2)),
      durasiDetik: Number(resolveSceneDurationSec(scene, plan).toFixed(2)),
      terkunci: scene.locked,
      naskah: scene.narration,
      visual:
        primaryClip(scene).query ?? primaryClip(scene).variant ?? primaryClip(scene).type,
      asetSiap: sceneAsset(plan, scene) !== undefined,
      suaraSiap: plan.renderState.narrationAudio[scene.id] !== undefined,
      // Potongan (ADR-0033) ikut ke ringkasan dengan alasan yang sama dengan
      // lapisan di bawah: agent pemanggil yang cuma melihat satu baris
      // "visual" akan mengira scene wawancara dua belas potongan ini satu
      // gambar utuh, lalu menyarankan memotongnya lagi.
      ...(scene.clips.length > 1
        ? {
            klip: scene.clips.map((clip) => ({
              id: clip.id,
              durasiDetik: Number((clip.durationSec ?? 0).toFixed(2)),
              dariDetik: clip.trimStartSec,
              visual: clip.query ?? clip.variant ?? clip.type,
            })),
          }
        : {}),
      // Lapisan (ADR-0025) ikut ke ringkasan: agent pemanggil yang tidak
      // melihatnya akan mengira scene ini punya satu gambar, lalu menyarankan
      // menambah sisipan yang sudah ada di sana.
      ...(scene.layers.length > 0
        ? {
            lapisan: scene.layers.map((layer) => ({
              id: layer.id,
              tampilDari: layer.startFrac,
              tampilSampai: layer.endFrac,
              asetSiap: plan.renderState.layerAssets[layer.id] !== undefined,
            })),
          }
        : {}),
    })),
  };
};

export const toolListProjects = (context: ToolContext) => ({
  akar: context.workspace.root,
  hanyaBaca: context.workspace.readOnly,
  proyek: listProjects(context.workspace),
});

export const toolGetPlan = (
  context: ToolContext,
  { proyek, mentah = false }: { proyek: string; mentah?: boolean },
): unknown => {
  const planPath = resolvePlanPath(context.workspace, proyek);
  return mentah ? readPlan(planPath) : summarizePlan(context.workspace, planPath);
};

export const toolCritique = (context: ToolContext, { proyek }: { proyek: string }) => {
  const planPath = resolvePlanPath(context.workspace, proyek);
  const notes = critiquePlan(readPlan(planPath));
  return {
    jumlah: notes.length,
    catatan: notes.map((note) => ({
      tingkat: note.level,
      kode: note.code,
      scene: note.sceneId ?? null,
      pesan: note.message,
    })),
    // Dinyatakan tiap kali, bukan sekali di deskripsi tool: pemanggilnya
    // adalah model yang bisa saja hanya membaca hasilnya.
    catatanPenting:
      "Ini pemeriksaan STRUKTUR dari plan, bukan dari gambar hasil render. Draft yang lolos di sini masih bisa jelek saat dilihat.",
  };
};

export interface PatchResult {
  ok: true;
  ringkasan: string;
  scenes: number;
  bisaUndo: boolean;
}

/**
 * Baca → ubah → tulis dengan bandingkan-dan-tukar (koherensi Studio–MCP,
 * ADR-0023). Bila berkasnya berubah di antara baca dan tulis — Studio sedang
 * dipakai pada proyek yang sama — plan dibaca ulang dan perubahannya
 * diterapkan lagi pada plan yang segar. Patch op adalah niat, bukan salinan
 * berkas, jadi menerapkannya ulang adalah penggabungan yang benar.
 */
const commitWithRetry = <T extends { plan: ScenePlan }>(
  context: ToolContext,
  planPath: string,
  change: (plan: ScenePlan) => T,
): T => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { plan, hash } = readPlanWithHash(planPath);
    const result = change(plan);
    if (writePlanIfUnchanged(context.workspace, planPath, hash, result.plan))
      return result;
  }
  throw new Error(
    "plan.json terus berubah selagi server ini menulis — ada proses lain yang menulis tanpa henti; coba lagi sebentar lagi.",
  );
};

export const toolApplyPatch = (
  context: ToolContext,
  { proyek, ops }: { proyek: string; ops: PatchOpInput[] },
): PatchResult => {
  const planPath = resolvePlanPath(context.workspace, proyek);
  // origin "agent": pemanggilnya memang agent, dan pagar scene terkunci
  // berlaku untuknya persis seperti untuk agent Dalang sendiri.
  const { plan: next, applied } = commitWithRetry(context, planPath, (plan) =>
    applyPatch(plan, ops, { origin: "agent" }),
  );

  const stack = undoStacks.get(planPath) ?? [];
  stack.push(applied.inverse);
  // Riwayat dibatasi: server ini bisa hidup berhari-hari di dalam sesi agent
  // lain, dan tumpukan yang tumbuh selamanya adalah kebocoran memori.
  if (stack.length > 50) stack.shift();
  undoStacks.set(planPath, stack);

  return {
    ok: true,
    ringkasan: applied.summary,
    scenes: next.scenes.length,
    bisaUndo: true,
  };
};

export const toolUndo = (context: ToolContext, { proyek }: { proyek: string }) => {
  const planPath = resolvePlanPath(context.workspace, proyek);
  const stack = undoStacks.get(planPath) ?? [];
  const inverse = stack.pop();
  if (!inverse) {
    return {
      ok: false as const,
      pesan:
        "Tidak ada yang bisa diurungkan lewat server ini. Riwayat undo hanya mencakup perubahan yang dibuat sesi server ini sendiri — bukan yang dibuat Studio atau CLI.",
    };
  }
  // enforce: false — kunci yang DIPASANG setelah sebuah editan tidak boleh
  // menghalangi pengurungan editan itu (kaidah yang sama dengan undo Studio).
  const { applied } = commitWithRetry(context, planPath, (plan) =>
    applyPatch(plan, inverse, { origin: "agent", enforce: false }),
  );
  undoStacks.set(planPath, stack);
  return { ok: true as const, ringkasan: applied.summary, sisaRiwayat: stack.length };
};

export const EXPORT_FORMATS = ["otio", "fcpxml"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const toolExportTimeline = (
  context: ToolContext,
  { proyek, format = "otio" }: { proyek: string; format?: ExportFormat },
) => {
  const planPath = resolvePlanPath(context.workspace, proyek);
  const plan: ScenePlan = readPlan(planPath);
  const timeline = buildEditTimeline(plan, {
    planPath,
    siteAssetDir: templatesPublicDir,
  });
  const target = join(
    dirname(planPath),
    format === "otio" ? "timeline.otio" : "timeline.fcpxml",
  );
  if (context.workspace.readOnly) {
    return {
      ok: false as const,
      pesan: "Server hanya-baca: ekspor menulis berkas ke folder proyek.",
    };
  }
  atomicWriteFile(target, format === "otio" ? otioToJson(timeline) : toFcpxml(timeline));
  return {
    ok: true as const,
    berkas: displayPath(context.workspace, target),
    trek: timeline.tracks.length,
    klip: timeline.tracks.reduce(
      (sum, track) => sum + track.items.filter((item) => item.kind === "clip").length,
      0,
    ),
    // Laporan ini WAJIB ikut ke pemanggil. Agent yang mengira ekspornya utuh
    // akan meyakinkan penggunanya soal hal yang tidak benar.
    tidakIkut: timeline.notes.map((note) => note.detail),
  };
};

export const toolRenderStill = async (
  context: ToolContext,
  { proyek, detik }: { proyek: string; detik: number[] },
) => {
  if (!context.renderStill) {
    return {
      ok: false as const,
      pesan: "Render tidak diaktifkan di server ini. Jalankan dengan --izinkan-render.",
    };
  }
  const planPath = resolvePlanPath(context.workspace, proyek);
  const outDir = join(dirname(planPath), ".dalang", "mcp-still");
  const frames = detik.map((sec) => Math.max(0, Math.round(sec * 30)));
  const files = await context.renderStill({ planPath, frames, outDir, scale: 0.5 });
  return {
    ok: true as const,
    berkas: files.map((file) => displayPath(context.workspace, file)),
  };
};
