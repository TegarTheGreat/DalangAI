import { patchOpSchema } from "@dalang/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  EXPORT_FORMATS,
  type ToolContext,
  toolApplyPatch,
  toolCritique,
  toolExportTimeline,
  toolGetPlan,
  toolListProjects,
  toolRenderStill,
  toolUndo,
} from "./tools";
import { WorkspaceError } from "./workspace";

/**
 * Server MCP Dalang (roadmap §8.4, ADR-0023) — Dalang sebagai KEMAMPUAN.
 *
 * Yang diberikan ke agent lain adalah GARIS WAKTU: membaca rencana, mengubahnya
 * lewat patch op tervalidasi, memeriksanya, dan mengekspornya. Yang SENGAJA
 * tidak diberikan, dan alasannya:
 *
 *  - Tidak ada tool yang memanggil model. Pemanggil server ini SUDAH agent;
 *    memberinya otak kedua hanya menambah biaya, latensi, dan satu tempat lagi
 *    yang bisa berhalusinasi. Yang tidak dipunyainya adalah timeline.
 *  - Tidak ada tool yang mengunduh aset atau menyintesis suara. Keduanya
 *    berbiaya nyata dan tidak ada manusia di lingkaran ini untuk menyetujui
 *    tagihannya. Perintah CLI (`dalang generate`) tetap ada untuk itu, dan
 *    yang menjalankannya tahu apa yang ia belanjakan.
 *  - Render hanya kalau pemanggil server MEMBERIKAN portnya (`--izinkan-render`
 *    di CLI). Tanpa itu tool-nya tidak didaftarkan sama sekali — bukan
 *    didaftarkan lalu menolak, supaya klien tidak merencanakan langkah yang
 *    tidak akan pernah bisa dijalankan.
 *
 * Semua path lewat pagar ruang kerja (lihat workspace.ts).
 */

/** Nilai balik tool MCP: JSON di dalam blok teks, bentuk yang paling luas didukung. */
const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/**
 * Galat pagar dikembalikan sebagai HASIL bertanda error, bukan dilempar.
 * Klien MCP menampilkan hasil ke modelnya; melempar akan memutus panggilan
 * dan model tidak pernah tahu mengapa — padahal "path di luar ruang kerja"
 * adalah persis yang perlu ia ketahui untuk memperbaiki panggilannya.
 */
const guard = async (run: () => unknown | Promise<unknown>) => {
  try {
    return json(await run());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            error instanceof WorkspaceError
              ? `Ditolak pagar ruang kerja: ${message}`
              : `Gagal: ${message}`,
        },
      ],
    };
  }
};

const proyekArg = z
  .string()
  .describe(
    "Folder proyek relatif terhadap akar server, atau '.' untuk akar itu sendiri.",
  );

export const createDalangMcpServer = (context: ToolContext): McpServer => {
  const server = new McpServer(
    { name: "dalang", version: "0.1.0" },
    {
      instructions:
        "Dalang adalah editor video ber-scene-plan. Satu-satunya sumber kebenaran adalah plan.json, " +
        "dan ia HANYA boleh diubah lewat dalang_apply_patch — jangan pernah menulis berkasnya langsung. " +
        "Mulailah dengan dalang_list_projects, lalu dalang_get_plan untuk melihat garis waktunya. " +
        "Server ini tidak memanggil model, tidak mengunduh aset, dan tidak menyintesis suara.",
    },
  );

  server.registerTool(
    "dalang_list_projects",
    {
      title: "Daftar proyek Dalang",
      description:
        "Proyek yang dilayani server ini (folder berisi plan.json), beserta akar dan status hanya-baca.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guard(() => toolListProjects(context)),
  );

  server.registerTool(
    "dalang_get_plan",
    {
      title: "Baca garis waktu",
      description:
        "Ringkasan garis waktu: scene, waktu mulai, durasi, naskah, dan kesiapan aset/suara. " +
        "Pakai mentah=true hanya kalau benar-benar butuh scene-plan utuh — ukurannya jauh lebih besar.",
      inputSchema: {
        proyek: proyekArg,
        mentah: z
          .boolean()
          .optional()
          .describe("Kembalikan scene-plan JSON apa adanya, bukan ringkasan."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ proyek, mentah }) =>
      guard(() =>
        toolGetPlan(context, { proyek, ...(mentah !== undefined ? { mentah } : {}) }),
      ),
  );

  server.registerTool(
    "dalang_critique",
    {
      title: "Kritik struktur draft",
      description:
        "Pemeriksaan mesin atas struktur plan (irama, panjang narasi, musik, klise) menurut format kontennya. " +
        "Deterministik dan gratis; TIDAK melihat hasil render.",
      inputSchema: { proyek: proyekArg },
      annotations: { readOnlyHint: true },
    },
    async ({ proyek }) => guard(() => toolCritique(context, { proyek })),
  );

  server.registerTool(
    "dalang_apply_patch",
    {
      title: "Ubah garis waktu",
      description:
        "SATU-SATUNYA cara mengubah plan.json. Op divalidasi skema, scene terkunci ditolak, " +
        "dan plan yang dihasilkan diperiksa ulang sebelum ditulis. Perubahan bisa diurungkan dengan dalang_undo.",
      inputSchema: {
        proyek: proyekArg,
        ops: z
          .array(patchOpSchema)
          .min(1)
          .describe("Daftar patch op; dijalankan berurutan sebagai satu kesatuan."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ proyek, ops }) => guard(() => toolApplyPatch(context, { proyek, ops })),
  );

  server.registerTool(
    "dalang_undo",
    {
      title: "Urungkan perubahan terakhir",
      description:
        "Membalik patch terakhir yang dibuat lewat server INI. Perubahan dari Studio atau CLI tidak ada di riwayatnya.",
      inputSchema: { proyek: proyekArg },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ proyek }) => guard(() => toolUndo(context, { proyek })),
  );

  server.registerTool(
    "dalang_export_timeline",
    {
      title: "Ekspor ke OTIO/FCPXML",
      description:
        "Menulis garis waktu ke timeline.otio atau timeline.fcpxml di folder proyek, untuk difinishing di Resolve/Premiere/Final Cut. " +
        "Hasilnya SELALU menyertakan daftar 'tidakIkut' — caption, teks, gerak kamera, dan filter tidak punya padanan di format interchange. " +
        "Sampaikan daftar itu ke penggunamu; jangan melaporkan ekspornya utuh.",
      inputSchema: {
        proyek: proyekArg,
        format: z.enum(EXPORT_FORMATS).optional().describe("Bawaan: otio."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ proyek, format }) =>
      guard(() => toolExportTimeline(context, { proyek, ...(format ? { format } : {}) })),
  );

  // Didaftarkan HANYA kalau portnya ada: klien yang melihat daftar tool akan
  // merencanakan langkah berdasarkan apa yang terlihat, dan tool yang selalu
  // menolak adalah rencana yang selalu gagal di tengah jalan.
  if (context.renderStill) {
    server.registerTool(
      "dalang_render_still",
      {
        title: "Render frame untuk dilihat",
        description:
          "Merender frame pada detik-detik tertentu jadi PNG di dalam folder proyek, lalu mengembalikan pathnya. " +
          "Lambat (menyalakan peramban) — pakai seperlunya, dan sebutkan detiknya secara spesifik.",
        inputSchema: {
          proyek: proyekArg,
          detik: z.array(z.number().min(0)).min(1).max(6),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ proyek, detik }) =>
        guard(() => toolRenderStill(context, { proyek, detik })),
    );
  }

  return server;
};
