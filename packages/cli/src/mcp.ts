import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDalangMcpServer, type RenderStillPort } from "@dalang/mcp";
import { renderPlanStills } from "@dalang/renderer";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Command } from "commander";

/**
 * `dalang mcp` — menyajikan garis waktu Dalang ke agent lain (ADR-0023).
 *
 * Transportnya stdio, jadi klien MCP mana pun bisa memasangnya dengan satu
 * baris konfigurasi. Konsekuensi yang harus dipatuhi seluruh perintah ini:
 * STDOUT ADALAH PROTOKOL. Satu `console.log` yang lolos ke sana akan merusak
 * bingkai JSON-RPC dan membuat kliennya putus tanpa pesan yang berguna.
 * Semua yang untuk dibaca manusia pergi ke stderr.
 */
export const registerMcpCommand = (program: Command): void => {
  program
    .command("mcp")
    .argument("[akar]", "folder yang dilayani (bawaan: folder saat ini)", ".")
    .option("--hanya-baca", "tolak semua perubahan; hanya membaca dan mengekspor")
    .option(
      "--izinkan-render",
      "daftarkan juga tool render still (lambat; menyalakan peramban)",
    )
    .description(
      "Jalankan server MCP: garis waktu Dalang sebagai tool untuk agent lain (stdio)",
    )
    .action(
      async (akar: string, options: { hanyaBaca?: boolean; izinkanRender?: boolean }) => {
        const root = resolve(akar);
        const renderStill: RenderStillPort = async ({
          planPath,
          frames,
          outDir,
          scale,
        }) => {
          mkdirSync(outDir, { recursive: true });
          await renderPlanStills({
            planPath,
            frames,
            outputLocationFor: (frame) => join(outDir, `mcp-${frame}.png`),
            scale,
          });
          return frames.map((frame) => join(outDir, `mcp-${frame}.png`));
        };

        const server = createDalangMcpServer({
          workspace: { root, readOnly: options.hanyaBaca === true },
          ...(options.izinkanRender ? { renderStill } : {}),
        });

        // stderr, bukan stdout — lihat catatan di atas.
        console.error(
          `Dalang MCP siap · akar ${root}` +
            (options.hanyaBaca ? " · hanya-baca" : "") +
            (options.izinkanRender ? " · render diizinkan" : " · tanpa render"),
        );
        await server.connect(new StdioServerTransport());
      },
    );
};
