/**
 * Gerbang agen luar (ADR-0045).
 *
 * `dalang agen siapkan` menulis perintah yang akan dijalankan agent lain, dan
 * tes unit hanya bisa membuktikan bahwa perintah itu BERBENTUK benar. Yang
 * tidak bisa dibuktikannya: bahwa perintah tersebut, dijalankan dari nol oleh
 * proses lain, benar-benar menghidupkan server yang bisa dipakai. Perintahnya
 * memuat path absolut node, pemuat tsx, dan main.ts — satu yang bergeser dan
 * konfigurasi semua klien jadi menunjuk ke ketiadaan, tanpa tes yang merah.
 *
 * Gerbang ini menjalankan `siapkan` sungguhan ke folder kosong, lalu MEMBACA
 * perintah server dari .mcp.json yang ia tulis (bukan menyusunnya ulang di
 * sini) dan menjalankannya lewat klien MCP di atas stdio — seperti yang
 * dilakukan Claude Code. Di atasnya satu alur kerja agent utuh: proyek baru,
 * ubah naskah lewat patch, urungkan, tulis subtitle, ekspor, dan tiga
 * penolakan pagar. Tanpa jaringan, tanpa model, tanpa peramban.
 *
 * Jalankan: pnpm --filter @dalang/cli gate:agen
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_TOOLS } from "@dalang/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defaultLaunch } from "../src/agen";

let checks = 0;
const check = (condition: unknown, message: string): void => {
  checks += 1;
  if (!condition) {
    console.error(`GAGAL: ${message}`);
    process.exit(1);
  }
};

const launch = defaultLaunch();
const root = mkdtempSync(join(tmpdir(), "dalang-agen-gate-"));
// Cache registry & home Dalang diarahkan ke folder sementara: gerbang tidak
// boleh bergantung pada, atau menulis ke, keadaan mesin yang menjalankannya.
const env = {
  ...process.env,
  DALANG_HOME: join(root, ".home"),
  DALANG_CACHE_DIR: join(root, ".cache"),
};

const dalang = (args: string[]) =>
  spawnSync(launch.command, [...launch.args, ...args], { encoding: "utf8", env });

try {
  // 1. siapkan sungguhan, untuk semua klien -------------------------------------------------
  const first = dalang(["agen", "siapkan", root, "--untuk", "semua"]);
  check(
    first.status === 0,
    `siapkan gagal (${first.status}): ${first.stderr || first.stdout}`,
  );
  for (const file of [
    ".mcp.json",
    ".gemini/settings.json",
    ".cursor/mcp.json",
    ".vscode/mcp.json",
    "opencode.json",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
  ]) {
    check(existsSync(join(root, file)), `${file} tidak ditulis`);
  }
  check(/codex mcp add dalang --/.test(first.stdout), "instruksi Codex tidak dicetak");

  // 2. idempoten: rencana kedua tidak ingin mengubah apa pun -----------------------------------
  const again = dalang(["agen", "siapkan", root, "--untuk", "semua", "--cetak"]);
  check(again.status === 0, "siapkan --cetak gagal");
  const changing = again.stdout
    .split("\n")
    .filter((line) => /^\s{2}\S+\s+(buat|perbarui|lewati)\s/.test(line));
  check(
    changing.length === 0,
    `tidak idempoten, masih ingin mengubah:\n${changing.join("\n")}`,
  );

  // 3. jalankan server dari .mcp.json, persis seperti klien MCP ------------------------------------
  const entry = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers
    .dalang as {
    command: string;
    args: string[];
  };
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: Object.fromEntries(
      Object.entries(env).filter(
        (pair): pair is [string, string] => pair[1] !== undefined,
      ),
    ),
    stderr: "pipe",
  });
  const client = new Client({ name: "agen-gate", version: "0.0.0" });
  const serverStderr: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) =>
    serverStderr.push(chunk.toString("utf8")),
  );
  try {
    await client.connect(transport);
  } catch (error) {
    check(
      false,
      `server tidak hidup dari perintah di .mcp.json (${entry.command} ${entry.args.join(" ")}): ${
        error instanceof Error ? error.message : String(error)
      }\nstderr server:\n${serverStderr.join("").trim()}`,
    );
  }

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ text?: string }>;
      isError?: boolean;
    };
    const text = result.content.map((part) => part.text ?? "").join("");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = undefined;
    }
    return { isError: result.isError === true, text, value };
  };

  const served = (await client.listTools()).tools.map((tool) => tool.name).sort();
  const catalog = MCP_TOOLS.filter((tool) => !tool.butuhRender)
    .map((tool) => tool.name)
    .sort();
  check(
    JSON.stringify(served) === JSON.stringify(catalog),
    `tool yang dilayani (${served.join(",")}) berbeda dari katalog panduan (${catalog.join(",")})`,
  );

  // 4. alur kerja agent utuh -------------------------------------------------------------------
  const created = await call("dalang_new_project", {
    nama: "uji-agen",
    template: "klip-tiga-detik",
    judul: "Uji Agen",
  });
  check(!created.isError, `new_project: ${created.text}`);
  const summary = (
    created.value as { ringkasan: { scenes: Array<{ id: string; naskah: string }> } }
  ).ringkasan;
  const first1 = summary.scenes[0];
  check(first1 !== undefined, "proyek baru tanpa scene");
  const sceneId = (first1 as { id: string }).id;
  const original = (first1 as { naskah: string }).naskah;

  const patched = await call("dalang_apply_patch", {
    proyek: "uji-agen",
    ops: [
      { op: "updateScene", id: sceneId, patch: { narration: "Naskah dari agen luar." } },
    ],
  });
  check(!patched.isError, `apply_patch: ${patched.text}`);
  const after = (await call("dalang_get_plan", { proyek: "uji-agen" })).value as {
    scenes: Array<{ naskah: string }>;
  };
  check(
    after.scenes[0]?.naskah === "Naskah dari agen luar.",
    "patch tidak sampai ke plan",
  );
  check(
    JSON.parse(readFileSync(join(root, "uji-agen", "plan.json"), "utf8")).scenes[0]
      .narration === "Naskah dari agen luar.",
    "patch tidak tertulis ke plan.json di disk",
  );

  check(!(await call("dalang_undo", { proyek: "uji-agen" })).isError, "undo gagal");
  const undone = (await call("dalang_get_plan", { proyek: "uji-agen" })).value as {
    scenes: Array<{ naskah: string }>;
  };
  check(undone.scenes[0]?.naskah === original, "undo tidak mengembalikan naskah asli");

  const subtitle = await call("dalang_write_subtitle", {
    proyek: "uji-agen",
    format: "srt",
  });
  check(!subtitle.isError, `write_subtitle: ${subtitle.text}`);
  const exported = await call("dalang_export_timeline", {
    proyek: "uji-agen",
    format: "otio",
  });
  check(!exported.isError, `export_timeline: ${exported.text}`);
  check(
    Array.isArray((exported.value as { tidakIkut?: unknown }).tidakIkut) &&
      ((exported.value as { tidakIkut: unknown[] }).tidakIkut.length ?? 0) > 0,
    "ekspor tidak menyertakan daftar tidakIkut",
  );
  check(
    existsSync(join(root, "uji-agen", "timeline.otio")),
    "timeline.otio tidak ditulis",
  );

  // 5. pagar --------------------------------------------------------------------------------------
  const overwrite = await call("dalang_new_project", { nama: "uji-agen" });
  check(
    overwrite.isError && /sudah ada/.test(overwrite.text),
    "proyek yang ada tertimpa",
  );
  const traversal = await call("dalang_new_project", { nama: "../keluar" });
  check(traversal.isError && /tidak sah/.test(traversal.text), "nama berisi .. diterima");
  const outside = await call("dalang_get_plan", { proyek: "/etc" });
  check(
    outside.isError && /luar ruang kerja/.test(outside.text),
    "path di luar akar diterima",
  );
  check(!existsSync(join(root, "..", "keluar")), "folder tercipta di luar akar");

  await client.close();
  console.log(
    `gate agen: OK (${checks} pemeriksaan; server dari .mcp.json hidup dan bekerja)`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
