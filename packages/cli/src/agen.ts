import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AGENTS,
  type AgentId,
  agentById,
  type LaunchCommand,
  mcpServerCommand,
  type PlannedEdit,
  planAgentSetup,
  shellLine,
} from "@dalang/mcp";
import { atomicWriteFile } from "@dalang/pipeline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { type Command, InvalidArgumentError } from "commander";

/**
 * `dalang agen` — memakai Dalang dari Claude Code, Codex, Gemini CLI, Cursor,
 * VS Code, atau opencode (ADR-0045).
 *
 * Gunanya satu: pengguna yang sudah berlangganan salah satunya tidak butuh API
 * key model untuk Dalang. Agent-nya yang berpikir dan langganannya yang
 * membayar; Dalang memberinya garis waktu lewat MCP dan perintah CLI lewat
 * shell-nya. Perintah ini hanya menyambungkan keduanya, dan `uji` membuktikan
 * sambungannya hidup tanpa perlu membuka agent mana pun.
 */

/** Akar repo ini: packages/cli/src -> tiga tingkat ke atas. */
const repoRoot = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Cara menjalankan CLI ini dari proses lain, tanpa bergantung pada PATH, pnpm,
 * atau folder kerja klien: biner node yang SEDANG berjalan + pemuat tsx + main.ts.
 * Jalur tsx diambil dari tautan tingkat-akar (stabil antar-versi tsx), dengan
 * resolusi paket sebagai cadangan.
 */
export const defaultLaunch = (): LaunchCommand => {
  const stable = join(repoRoot(), "node_modules", "tsx", "dist", "esm", "index.mjs");
  const loader = existsSync(stable)
    ? pathToFileURL(stable).href
    : import.meta.resolve("tsx/esm");
  return {
    command: process.execPath,
    args: ["--import", loader, fileURLToPath(new URL("./main.ts", import.meta.url))],
  };
};

/** Apakah biner ada di PATH (dan bisa dijalankan). */
const onPath = (binary: string, env: NodeJS.ProcessEnv = process.env): boolean => {
  const extensions =
    process.platform === "win32"
      ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")]
      : [""];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      try {
        accessSync(join(dir, `${binary}${extension}`), constants.X_OK);
        return true;
      } catch {
        // coba kandidat berikutnya
      }
    }
  }
  return false;
};

const readIfExists = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const parseAgents = (value: string): AgentId[] => {
  if (value === "semua") return AGENTS.map((agent) => agent.id);
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = ids.filter((id) => !agentById(id));
  if (ids.length === 0 || unknown.length > 0) {
    throw new InvalidArgumentError(
      `agen tidak dikenal: ${unknown.join(", ") || "(kosong)"} — pilih dari ${AGENTS.map((a) => a.id).join(", ")}, atau "semua"`,
    );
  }
  return ids as AgentId[];
};

const printEdit = (edit: PlannedEdit, root: string): void => {
  const where = edit.path ? edit.path.replace(`${root}/`, "") : "-";
  console.log(`  ${edit.agent.padEnd(12)} ${edit.action.padEnd(9)} ${where}`);
  console.log(`      ${edit.note}`);
  for (const line of edit.manual ?? []) console.log(`        ${line}`);
};

const applyEdits = (edits: PlannedEdit[]): void => {
  for (const edit of edits) {
    if (
      (edit.action !== "buat" && edit.action !== "perbarui") ||
      !edit.path ||
      !edit.content
    ) {
      continue;
    }
    mkdirSync(dirname(edit.path), { recursive: true });
    atomicWriteFile(edit.path, edit.content);
  }
};

export const registerAgenCommand = (program: Command): void => {
  const agen = program
    .command("agen")
    .description(
      "Pakai Dalang dari Claude Code, Codex, Gemini CLI, Cursor, VS Code, atau opencode — tanpa API key model",
    );

  agen
    .command("daftar", { isDefault: true })
    .argument("[akar]", "ruang kerja yang diperiksa (bawaan: folder saat ini)", ".")
    .description(
      "Agent yang didukung, mana yang terpasang di mesin ini, dan sudah tersambung atau belum",
    )
    .action((akar: string) => {
      const root = resolve(akar);
      const edits = planAgentSetup({
        root,
        agents: AGENTS.map((agent) => agent.id),
        launch: defaultLaunch(),
        guide: false,
        read: readIfExists,
      });
      const state = (id: AgentId): string => {
        const edit = edits.find((item) => item.agent === id);
        switch (edit?.action) {
          case "sama":
            return "tersambung";
          case "buat":
            return "belum";
          case "perbarui":
            return "perlu diperbarui";
          case "lewati":
            return "berkas tak terbaca";
          default:
            return "manual";
        }
      };

      console.log(`Ruang kerja: ${root}\n`);
      console.log(
        `${"AGEN".padEnd(13)}${"NAMA".padEnd(25)}${"DI PATH".padEnd(9)}${"STATUS".padEnd(19)}BENTUK KONFIGURASI`,
      );
      for (const agent of AGENTS) {
        const found = agent.binary ? (onPath(agent.binary) ? "ya" : "tidak") : "-";
        console.log(
          `${agent.id.padEnd(13)}${agent.name.padEnd(25)}${found.padEnd(9)}${state(agent.id).padEnd(19)}${
            agent.verified === "binari"
              ? "diperiksa dengan biner aslinya"
              : "menurut dokumentasi klien (belum diuji dengan binernya)"
          }`,
        );
      }
      console.log(
        "\nTanpa API key model: agent-nya yang berpikir (langganan atau akunmu sendiri); " +
          "Dalang memberinya garis waktu lewat MCP dan perintah CLI lewat shell-nya.\n" +
          "  dalang agen siapkan [akar] --untuk claude-code,codex   pasang konfigurasi + panduan\n" +
          "  dalang agen uji [akar]                                 buktikan server MCP-nya hidup",
      );
    });

  agen
    .command("siapkan")
    .argument("[akar]", "ruang kerja yang dilayani (bawaan: folder saat ini)", ".")
    .option(
      "--untuk <daftar>",
      `agen dipisah koma (${AGENTS.map((a) => a.id).join(", ")}) atau "semua"; bawaan: yang ditemukan di PATH`,
      parseAgents,
    )
    .option("--hanya-baca", "server hanya boleh membaca dan mengekspor")
    .option(
      "--izinkan-render",
      "daftarkan juga tool render still (lambat; menyalakan peramban)",
    )
    .option("--tanpa-panduan", "jangan tulis AGENTS.md / CLAUDE.md / GEMINI.md")
    .option("--cetak", "hanya tampilkan rencananya, tidak menulis apa pun")
    .description(
      "Tulis konfigurasi MCP dan panduan agent untuk ruang kerja ini (idempoten; tidak menimpa isi lain)",
    )
    .action(
      (
        akar: string,
        options: {
          untuk?: AgentId[];
          hanyaBaca?: boolean;
          izinkanRender?: boolean;
          tanpaPanduan?: boolean;
          cetak?: boolean;
        },
      ) => {
        const root = resolve(akar);
        const chosen =
          options.untuk ??
          AGENTS.filter((agent) => agent.binary && onPath(agent.binary)).map(
            (agent) => agent.id,
          );
        if (chosen.length === 0) {
          throw new Error(
            "Tidak ada agent yang ditemukan di PATH. Sebutkan sendiri: --untuk " +
              `${AGENTS.map((a) => a.id).join(",")} (atau "semua").`,
          );
        }
        const launch = defaultLaunch();
        const edits = planAgentSetup({
          root,
          agents: chosen,
          launch,
          readOnly: options.hanyaBaca === true,
          allowRender: options.izinkanRender === true,
          guide: options.tanpaPanduan !== true,
          read: readIfExists,
        });

        console.log(`Ruang kerja : ${root}`);
        console.log(
          `Server MCP  : ${shellLine(
            mcpServerCommand({
              root,
              launch,
              readOnly: options.hanyaBaca === true,
              allowRender: options.izinkanRender === true,
            }),
          )}\n`,
        );
        for (const edit of edits) printEdit(edit, root);

        if (options.cetak) {
          console.log("\n(--cetak: tidak ada yang ditulis)");
          return;
        }
        mkdirSync(root, { recursive: true });
        applyEdits(edits);

        console.log("\nBerikutnya:");
        for (const id of chosen) {
          const spec = agentById(id);
          if (spec) console.log(`  ${spec.name}: ${spec.next}`);
        }
        console.log(
          "\nBentuk konfigurasi Claude Code sudah diperiksa terhadap biner aslinya; klien lain mengikuti " +
            "dokumentasinya masing-masing dan belum diuji dengan binernya. Perintah di atas memuat path absolut " +
            "checkout ini — bila checkout dipindah, jalankan perintah ini lagi.\n" +
            "Pastikan server-nya sehat dengan: dalang agen uji " +
            (akar === "." ? "" : akar),
        );
        if (edits.some((edit) => edit.action === "lewati")) process.exitCode = 1;
      },
    );

  agen
    .command("uji")
    .argument("[akar]", "ruang kerja yang dilayani (bawaan: folder saat ini)", ".")
    .option(
      "--detik <n>",
      "batas waktu menunggu server (detik)",
      (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 1) {
          throw new InvalidArgumentError(`"${value}" bukan jumlah detik yang valid`);
        }
        return parsed;
      },
      60,
    )
    .description(
      "Jalankan server MCP persis seperti yang dilakukan agent, lalu daftar tool dan proyeknya — tanpa agent mana pun",
    )
    .action(async (akar: string, options: { detik: number }) => {
      const root = resolve(akar);
      const server = mcpServerCommand({ root, launch: defaultLaunch() });
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        stderr: "pipe",
      });
      const client = new Client({ name: "dalang-agen-uji", version: "0.1.0" });
      const stderr: string[] = [];
      transport.stderr?.on("data", (chunk: Buffer) =>
        stderr.push(chunk.toString("utf8")),
      );

      const started = Date.now();
      const timer = setTimeout(() => {
        void transport.close();
      }, options.detik * 1000);
      try {
        await client.connect(transport);
        const tools = (await client.listTools()).tools.map((tool) => tool.name);
        const projects = (await client.callTool({
          name: "dalang_list_projects",
          arguments: {},
        })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
        const listing = JSON.parse(
          projects.content.map((part) => part.text ?? "").join(""),
        ) as {
          proyek: Array<{ path: string; title: string; scenes: number }>;
          hanyaBaca: boolean;
        };
        console.log(
          `Server hidup dalam ${((Date.now() - started) / 1000).toFixed(1)} detik.`,
        );
        console.log(`Tool (${tools.length}): ${tools.join(", ")}`);
        console.log(
          `Proyek di ${root} (${listing.proyek.length}): ` +
            (listing.proyek.length === 0
              ? "belum ada — agent bisa membuatnya dengan dalang_new_project"
              : listing.proyek.map((p) => `${p.path} (${p.scenes} scene)`).join(", ")),
        );
        console.log(`Mode: ${listing.hanyaBaca ? "hanya-baca" : "bisa menulis"}`);
      } catch (error) {
        console.error(
          `Server tidak menjawab dalam ${options.detik} detik atau gagal start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        const tail = stderr.join("").trim();
        if (tail) console.error(`stderr server:\n${tail}`);
        process.exitCode = 1;
      } finally {
        clearTimeout(timer);
        await client.close().catch(() => undefined);
      }
    });
};
