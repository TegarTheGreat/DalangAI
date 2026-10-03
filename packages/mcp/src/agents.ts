import { isAbsolute, join } from "node:path";
import { MCP_TOOLS } from "./catalog";

/**
 * Memasang server MCP Dalang ke agent coding yang sudah dipakai orang
 * (ADR-0045): Claude Code, Codex, Gemini CLI, Cursor, VS Code, opencode.
 *
 * Intinya satu: pengguna yang sudah berlangganan salah satunya tidak butuh API
 * key model untuk Dalang. Agent-lah yang berpikir (dan langganannya yang
 * membayar); Dalang memberinya garis waktu lewat MCP dan perintah CLI lewat
 * shell-nya. Modul ini hanya menyusun BERKAS yang menyambungkan keduanya, dan
 * murni: ia merencanakan suntingan, tidak menyentuh disk. Yang menulis adalah
 * `applyEdits` di CLI.
 *
 * Tiga janji yang dijaga:
 *  - IDEMPOTEN: dijalankan dua kali menghasilkan "sama", bukan berkas yang
 *    berubah lagi;
 *  - tidak pernah menimpa kepunyaan orang: yang disentuh hanya entri `dalang`
 *    di berkas konfigurasi dan blok bertanda di berkas panduan;
 *  - berkas yang tidak bisa dibaca dengan pasti (JSON rusak, JSONC berkomentar)
 *    DILEWATI dengan cuplikan untuk disalin tangan, bukan ditebak.
 */

export type AgentId =
  | "claude-code"
  | "codex"
  | "gemini"
  | "cursor"
  | "vscode"
  | "opencode";

/**
 * Seberapa jauh bentuk konfigurasinya dipastikan:
 *  binari      — dihasilkan lalu dibaca balik oleh biner aslinya di mesin ini
 *  dokumentasi — ditulis menurut dokumentasi klien; binernya tidak ada di sini
 */
export type Verification = "binari" | "dokumentasi";

export type GuideFile = "AGENTS.md" | "CLAUDE.md" | "GEMINI.md";

export interface AgentSpec {
  id: AgentId;
  name: string;
  /** Nama biner di PATH, untuk deteksi; kosong bila aplikasi GUI. */
  binary?: string;
  /** Berkas konfigurasi MCP relatif akar; kosong = dipasang lewat perintah klien. */
  configPath?: string;
  guideFile: GuideFile;
  verified: Verification;
  /** Apa yang dilakukan pengguna setelah berkas siap. */
  next: string;
}

export const AGENTS: readonly AgentSpec[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    binary: "claude",
    configPath: ".mcp.json",
    guideFile: "CLAUDE.md",
    verified: "binari",
    next: "Jalankan `claude` di folder ini. Saat pertama, ia menanyakan apakah server `dalang` dari .mcp.json boleh dipakai — setujui.",
  },
  {
    id: "codex",
    name: "Codex CLI",
    binary: "codex",
    guideFile: "AGENTS.md",
    verified: "dokumentasi",
    next: "Jalankan perintah `codex mcp add` di atas sekali, lalu `codex` di folder ini.",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    binary: "gemini",
    configPath: ".gemini/settings.json",
    guideFile: "GEMINI.md",
    verified: "dokumentasi",
    next: "Jalankan `gemini` di folder ini dan periksa bahwa server `dalang` terdaftar (perintah /mcp).",
  },
  {
    id: "cursor",
    name: "Cursor",
    binary: "cursor",
    configPath: ".cursor/mcp.json",
    guideFile: "AGENTS.md",
    verified: "dokumentasi",
    next: "Buka folder ini di Cursor dan nyalakan server `dalang` di Settings > MCP.",
  },
  {
    id: "vscode",
    name: "VS Code (Copilot Chat)",
    binary: "code",
    configPath: ".vscode/mcp.json",
    guideFile: "AGENTS.md",
    verified: "dokumentasi",
    next: "Buka folder ini di VS Code; mode Agent di Copilot Chat memakai server `dalang` (VS Code meminta konfirmasi sebelum menjalankannya).",
  },
  {
    id: "opencode",
    name: "opencode",
    binary: "opencode",
    configPath: "opencode.json",
    guideFile: "AGENTS.md",
    verified: "dokumentasi",
    next: "Jalankan `opencode` di folder ini.",
  },
];

export const agentById = (id: string): AgentSpec | undefined =>
  AGENTS.find((agent) => agent.id === id);

/** Cara menjalankan CLI Dalang: perintah + argumen sebelum subperintah (`mcp`, `generate`, ...). */
export interface LaunchCommand {
  command: string;
  args: string[];
}

export type EditAction = "buat" | "perbarui" | "sama" | "lewati" | "manual";

export interface PlannedEdit {
  /** Agent pemiliknya, atau "panduan" untuk berkas instruksi. */
  agent: AgentId | "panduan";
  action: EditAction;
  /** Path absolut; kosong untuk "manual". */
  path?: string;
  /** Isi lengkap yang akan ditulis (hanya untuk buat/perbarui). */
  content?: string;
  /** Satu baris untuk manusia: apa yang terjadi dan kenapa. */
  note: string;
  /** Baris yang harus disalin tangan (manual/lewati). */
  manual?: string[];
}

export interface SetupOptions {
  /** Akar ruang kerja, ABSOLUT. */
  root: string;
  agents: readonly AgentId[];
  launch: LaunchCommand;
  readOnly?: boolean;
  allowRender?: boolean;
  /** Tulis berkas panduan (AGENTS.md/CLAUDE.md/GEMINI.md). Bawaan: ya. */
  guide?: boolean;
  /** Pembaca berkas; mengembalikan undefined bila tidak ada. */
  read: (path: string) => string | undefined;
}

// ---------------------------------------------------------------------------
// Perintah server
// ---------------------------------------------------------------------------

/** Perintah yang menjalankan SERVER MCP untuk akar ini. */
export const mcpServerCommand = (
  options: Pick<SetupOptions, "root" | "launch" | "readOnly" | "allowRender">,
): LaunchCommand => ({
  command: options.launch.command,
  args: [
    ...options.launch.args,
    "mcp",
    options.root,
    ...(options.readOnly ? ["--hanya-baca"] : []),
    ...(options.allowRender ? ["--izinkan-render"] : []),
  ],
});

export const shellQuote = (value: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

export const shellLine = (command: LaunchCommand): string =>
  [command.command, ...command.args].map(shellQuote).join(" ");

// ---------------------------------------------------------------------------
// Konfigurasi JSON per klien
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface JsonShape {
  /** Kunci akar yang memuat daftar server. */
  rootKey: "mcpServers" | "servers" | "mcp";
  entry: (server: LaunchCommand) => Json;
  /** Kunci tambahan saat berkasnya BARU dibuat. */
  seed?: Json;
}

const JSON_SHAPES: Partial<Record<AgentId, JsonShape>> = {
  // Bentuk yang dihasilkan `claude mcp add --scope project` pada Claude Code 2.1.288.
  "claude-code": {
    rootKey: "mcpServers",
    entry: (server) => ({ type: "stdio", command: server.command, args: server.args }),
  },
  gemini: {
    rootKey: "mcpServers",
    entry: (server) => ({ command: server.command, args: server.args }),
  },
  cursor: {
    rootKey: "mcpServers",
    entry: (server) => ({ command: server.command, args: server.args }),
  },
  vscode: {
    rootKey: "servers",
    entry: (server) => ({ type: "stdio", command: server.command, args: server.args }),
  },
  opencode: {
    rootKey: "mcp",
    entry: (server) => ({
      type: "local",
      command: [server.command, ...server.args],
      enabled: true,
    }),
    seed: { $schema: "https://opencode.ai/config.json" },
  },
};

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const planJsonConfig = (
  spec: AgentSpec,
  shape: JsonShape,
  root: string,
  server: LaunchCommand,
  read: SetupOptions["read"],
): PlannedEdit => {
  const path = join(root, spec.configPath as string);
  const entry = shape.entry(server);
  const snippet = serialize({ [shape.rootKey]: { dalang: entry } });
  const raw = read(path);

  if (raw === undefined || raw.trim() === "") {
    return {
      agent: spec.id,
      action: "buat",
      path,
      content: serialize({ ...(shape.seed ?? {}), [shape.rootKey]: { dalang: entry } }),
      note: `${spec.configPath} dibuat dengan server dalang`,
    };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return {
      agent: spec.id,
      action: "lewati",
      path,
      note: `${spec.configPath} sudah ada tetapi bukan JSON polos (komentar atau salah ketik?) — tidak disentuh`,
      manual: ["Tambahkan sendiri ke berkas itu:", ...snippet.trimEnd().split("\n")],
    };
  }
  if (
    !isObject(doc) ||
    (doc[shape.rootKey] !== undefined && !isObject(doc[shape.rootKey]))
  ) {
    return {
      agent: spec.id,
      action: "lewati",
      path,
      note: `${spec.configPath} tidak berbentuk yang dikenal (kunci "${shape.rootKey}" bukan objek) — tidak disentuh`,
      manual: ["Tambahkan sendiri ke berkas itu:", ...snippet.trimEnd().split("\n")],
    };
  }

  const servers = (doc[shape.rootKey] ?? {}) as Json;
  const existing = servers.dalang;
  // Kunci lain di entri `dalang` (mis. env, timeout) milik pengguna: dipertahankan.
  const merged = isObject(existing) ? { ...existing, ...entry } : entry;
  if (existing !== undefined && sameJson(existing, merged)) {
    return {
      agent: spec.id,
      action: "sama",
      path,
      note: `${spec.configPath} sudah memuat server dalang yang sama`,
    };
  }
  return {
    agent: spec.id,
    action: "perbarui",
    path,
    content: serialize({ ...doc, [shape.rootKey]: { ...servers, dalang: merged } }),
    note:
      existing === undefined
        ? `${spec.configPath}: server dalang ditambahkan, entri lain tidak disentuh`
        : `${spec.configPath}: entri dalang diperbarui (jalur atau argumen berubah), entri lain tidak disentuh`,
  };
};

const planCodex = (server: LaunchCommand): PlannedEdit => ({
  agent: "codex",
  action: "manual",
  note: "Codex menyimpan konfigurasinya di rumah pengguna (~/.codex/config.toml); Dalang tidak menyuntingnya — jalankan salah satu:",
  manual: [
    `codex mcp add dalang -- ${shellLine(server)}`,
    "atau tambahkan ke ~/.codex/config.toml:",
    "[mcp_servers.dalang]",
    `command = ${JSON.stringify(server.command)}`,
    `args = ${JSON.stringify(server.args)}`,
  ],
});

// ---------------------------------------------------------------------------
// Panduan agent
// ---------------------------------------------------------------------------

export const GUIDE_START = "<!-- dalang:mulai -->";
export const GUIDE_END = "<!-- dalang:selesai -->";

export interface GuideOptions {
  root: string;
  cli: LaunchCommand;
  readOnly: boolean;
  allowRender: boolean;
}

export const renderAgentGuide = (options: GuideOptions): string => {
  const cli = shellLine(options.cli);
  const tools = MCP_TOOLS.filter((tool) => !tool.butuhRender || options.allowRender);
  const lines = [
    GUIDE_START,
    "## Dalang — editor video ber-scene-plan",
    "",
    "Folder ini adalah ruang kerja Dalang. Sumber kebenaran sebuah video adalah `plan.json` (scene-plan) di folder proyeknya.",
    "Garis waktunya kamu pegang lewat server MCP `dalang`; pekerjaan berat (aset, suara, render) lewat perintah CLI di shell-mu.",
    "",
    "Bagian di antara penanda ini ditulis oleh `dalang agen siapkan` dan ditimpa saat perintah itu dijalankan lagi. Tulis catatanmu di luarnya.",
    "",
    "### Aturan",
    "1. Jangan pernah menulis `plan.json` langsung. Ubah hanya lewat `dalang_apply_patch`: op divalidasi skema, scene terkunci ditolak, dan `dalang_undo` membalikkannya.",
    "2. Mulai dari `dalang_list_projects`, lalu `dalang_get_plan`. Jangan menebak id scene atau klip.",
    "3. Jangan mengarang berkas aset. Aset dan suara dibuat oleh `dalang generate`, atau disediakan pengguna.",
    '4. Sampaikan apa adanya. Hasil `dalang_export_timeline` selalu memuat `tidakIkut` (hal yang tak punya padanan di format interchange) dan `dalang_write_subtitle` bisa memuat `peringatan` (waktu masih ditaksir). Teruskan keduanya ke pengguna; jangan melapor "ekspor utuh".',
    "5. `dalang_critique` memeriksa struktur, bukan hasil render. Jangan menyebutnya bukti bahwa videonya bagus; lihat framenya dulu.",
    "",
    "### Alur kerja",
    "1. Belum ada proyek? `dalang_list_templates`, lalu `dalang_new_project`.",
    "2. `dalang_get_plan` — pahami scene, naskah, dan kesiapan aset/suara.",
    "3. `dalang_critique` — temuan struktur sebelum mengubah apa pun.",
    "4. `dalang_apply_patch` — ubah, lalu `dalang_get_plan` lagi untuk memeriksa hasilnya.",
    "5. Aset dan suara: `generate <proyek>` (lihat Biaya).",
    "6. Lihat hasil: `still <proyek>` untuk beberapa frame, atau `render <proyek> -o <berkas.mp4>` untuk videonya.",
    "7. Keluaran: `dalang_write_subtitle` (.srt/.vtt), `dalang_export_timeline` (OTIO/FCPXML), atau MP4 dari render.",
    "",
    "### Tool MCP",
    "| Tool | Fungsi | Mengubah berkas |",
    "| --- | --- | --- |",
    ...tools.map(
      (tool) =>
        `| \`${tool.name}\` | ${tool.ringkas} | ${tool.menulis ? (options.readOnly ? "ditolak (hanya-baca)" : "ya") : "tidak"} |`,
    ),
    "",
    "### Perintah CLI (lewat shell)",
    `Awalan: \`${cli}\` — mis. \`${cli} validate <proyek>\`.`,
    "- `validate <proyek>` — periksa plan terhadap skema.",
    "- `generate <proyek>` — suara narasi dan pencarian aset; menulis renderState ke plan.",
    "- `still <proyek>` — render frame (PNG) untuk dilihat.",
    "- `render <proyek> -o <berkas>` — render video (`--profile draft|final`, `--resolution 540|720|1080`, `--bahasa <kode>` untuk sulih suara).",
    "- `transcribe <proyek>` — transkripsi rekaman di plan; `sulih <proyek>` — keadaan sulih suara.",
    "- `doctor` — penyedia suara/aset/model mana yang aktif di mesin ini.",
    "",
    "### Biaya",
    "Server MCP tidak membelanjakan apa pun. `generate` memanggil penyedia suara dan aset yang diatur di `.env` dan plan; sebagian berbayar (mis. ElevenLabs), sebagian gratis (Edge TTS, Openverse).",
    `Jalankan \`${cli} doctor\` untuk melihat mana yang aktif, dan tanyakan pengguna sebelum \`generate\` bila ada yang berbayar. Jangan menambah \`--force\` kecuali diminta: itu mengulang semua stage.`,
    "",
    "### Batas ruang kerja ini",
    `- Akar: \`${options.root}\`. Path di luarnya ditolak server.`,
    `- Server dijalankan ${options.readOnly ? "HANYA-BACA: tool yang mengubah berkas ditolak" : "dengan izin menulis"}; render still ${options.allowRender ? "diizinkan" : "tidak tersedia"}.`,
    "- Caption, teks, gerak kamera, dan filter tidak punya padanan di OTIO/FCPXML; hanya susunan klip yang menyeberang.",
    GUIDE_END,
  ];
  return `${lines.join("\n")}\n`;
};

/** Menyisipkan/menimpa blok panduan di isi berkas; `undefined` bila penandanya rusak. */
export const withGuideBlock = (
  existing: string | undefined,
  block: string,
): string | undefined => {
  if (existing === undefined || existing.trim() === "") return block;
  const start = existing.indexOf(GUIDE_START);
  const end = existing.indexOf(GUIDE_END);
  if (start === -1 && end === -1) {
    return `${existing.replace(/\s+$/, "")}\n\n${block}`;
  }
  if (start === -1 || end === -1 || end < start) return undefined;
  const tail = existing.slice(end + GUIDE_END.length).replace(/^\r?\n/, "");
  return `${existing.slice(0, start)}${block}${tail}`;
};

const planGuide = (
  file: GuideFile,
  owners: readonly string[],
  options: SetupOptions,
  block: string,
): PlannedEdit => {
  const path = join(options.root, file);
  const existing = options.read(path);
  const next = withGuideBlock(existing, block);
  if (next === undefined) {
    return {
      agent: "panduan",
      action: "lewati",
      path,
      note: `${file}: penanda dalang rusak (hanya satu ujung, atau terbalik) — tidak disentuh`,
      manual: [
        `Hapus sisa penanda "${GUIDE_START}" / "${GUIDE_END}" di ${file}, lalu jalankan lagi.`,
      ],
    };
  }
  if (next === existing) {
    return {
      agent: "panduan",
      action: "sama",
      path,
      note: `${file} sudah memuat panduan yang sama (untuk ${owners.join(", ")})`,
    };
  }
  return {
    agent: "panduan",
    action: existing === undefined || existing.trim() === "" ? "buat" : "perbarui",
    path,
    content: next,
    note:
      existing === undefined || existing.trim() === ""
        ? `${file} dibuat (panduan untuk ${owners.join(", ")})`
        : `${file}: blok dalang ${existing.includes(GUIDE_START) ? "diperbarui" : "ditambahkan di akhir"}; isi lain tidak disentuh`,
  };
};

// ---------------------------------------------------------------------------
// Rencana
// ---------------------------------------------------------------------------

export const planAgentSetup = (options: SetupOptions): PlannedEdit[] => {
  if (!isAbsolute(options.root)) {
    throw new Error(`Akar ruang kerja harus path absolut, bukan "${options.root}"`);
  }
  const server = mcpServerCommand(options);
  const edits: PlannedEdit[] = [];
  const guideOwners = new Map<GuideFile, string[]>();

  for (const id of options.agents) {
    const spec = agentById(id);
    if (!spec) throw new Error(`Agent tidak dikenal: ${id}`);
    const shape = JSON_SHAPES[spec.id];
    edits.push(
      shape && spec.configPath
        ? planJsonConfig(spec, shape, options.root, server, options.read)
        : planCodex(server),
    );
    guideOwners.set(spec.guideFile, [
      ...(guideOwners.get(spec.guideFile) ?? []),
      spec.name,
    ]);
  }

  if (options.guide !== false) {
    const block = renderAgentGuide({
      root: options.root,
      cli: options.launch,
      readOnly: options.readOnly === true,
      allowRender: options.allowRender === true,
    });
    for (const [file, owners] of guideOwners) {
      edits.push(planGuide(file, owners, options, block));
    }
  }
  return edits;
};
