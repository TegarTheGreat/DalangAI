import { describe, expect, it } from "vitest";
import {
  AGENTS,
  type AgentId,
  GUIDE_END,
  GUIDE_START,
  type LaunchCommand,
  MCP_TOOLS,
  mcpServerCommand,
  type PlannedEdit,
  planAgentSetup,
  renderAgentGuide,
  shellLine,
  shellQuote,
  withGuideBlock,
} from "../src/index";

const ROOT = "/kerja/video";
const LAUNCH: LaunchCommand = {
  command: "/usr/bin/node",
  args: [
    "--import",
    "file:///dalang/node_modules/tsx/dist/esm/index.mjs",
    "/dalang/packages/cli/src/main.ts",
  ],
};

/** "Disk" tiruan: peta path -> isi. */
const disk = (files: Record<string, string> = {}) => {
  const store = new Map(Object.entries(files));
  return {
    read: (path: string) => store.get(path),
    apply: (edits: PlannedEdit[]) => {
      for (const edit of edits) {
        if (
          (edit.action === "buat" || edit.action === "perbarui") &&
          edit.path &&
          edit.content
        ) {
          store.set(edit.path, edit.content);
        }
      }
    },
    get: (path: string) => store.get(path),
  };
};

const plan = (
  agents: AgentId[],
  files: Record<string, string> = {},
  extra: { readOnly?: boolean; allowRender?: boolean; guide?: boolean } = {},
) => {
  const fs = disk(files);
  const edits = planAgentSetup({
    root: ROOT,
    agents,
    launch: LAUNCH,
    read: fs.read,
    ...extra,
  });
  return { fs, edits };
};

const parsed = (text: string | undefined) =>
  JSON.parse(text ?? "null") as Record<string, unknown>;

describe("perintah server dan kutipan shell", () => {
  it("menyusun argumen server dengan bendera yang diminta", () => {
    expect(mcpServerCommand({ root: ROOT, launch: LAUNCH })).toEqual({
      command: LAUNCH.command,
      args: [...LAUNCH.args, "mcp", ROOT],
    });
    expect(
      mcpServerCommand({
        root: ROOT,
        launch: LAUNCH,
        readOnly: true,
        allowRender: true,
      }).args.slice(-2),
    ).toEqual(["--hanya-baca", "--izinkan-render"]);
  });

  it("shellQuote hanya mengutip yang perlu; apostrof dilindungi", () => {
    expect(shellQuote("/usr/bin/node")).toBe("/usr/bin/node");
    expect(shellQuote("/kerja/video saya")).toBe("'/kerja/video saya'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellLine({ command: "node", args: ["a b", "c"] })).toBe("node 'a b' c");
  });
});

describe("konfigurasi per klien", () => {
  it("Claude Code: bentuk .mcp.json yang dihasilkan `claude mcp add --scope project`", () => {
    const { edits } = plan(["claude-code"], {}, { guide: false });
    const edit = edits[0] as PlannedEdit;
    expect(edit).toMatchObject({
      agent: "claude-code",
      action: "buat",
      path: `${ROOT}/.mcp.json`,
    });
    expect(parsed(edit.content)).toEqual({
      mcpServers: {
        dalang: {
          type: "stdio",
          command: LAUNCH.command,
          args: [...LAUNCH.args, "mcp", ROOT],
        },
      },
    });
  });

  it("VS Code memakai kunci `servers`, opencode memakai `mcp` dengan command berupa larik", () => {
    const { edits } = plan(["vscode", "opencode"], {}, { guide: false });
    const vscode = parsed(edits.find((e) => e.agent === "vscode")?.content);
    expect(vscode).toEqual({
      servers: {
        dalang: {
          type: "stdio",
          command: LAUNCH.command,
          args: [...LAUNCH.args, "mcp", ROOT],
        },
      },
    });
    const opencode = parsed(edits.find((e) => e.agent === "opencode")?.content);
    expect(opencode.$schema).toBe("https://opencode.ai/config.json");
    expect(opencode.mcp).toEqual({
      dalang: {
        type: "local",
        command: [LAUNCH.command, ...LAUNCH.args, "mcp", ROOT],
        enabled: true,
      },
    });
  });

  it("Gemini CLI dan Cursor: mcpServers di lokasinya masing-masing", () => {
    const { edits } = plan(["gemini", "cursor"], {}, { guide: false });
    expect(edits.map((e) => e.path)).toEqual([
      `${ROOT}/.gemini/settings.json`,
      `${ROOT}/.cursor/mcp.json`,
    ]);
    for (const edit of edits) {
      expect(parsed(edit.content).mcpServers).toEqual({
        dalang: { command: LAUNCH.command, args: [...LAUNCH.args, "mcp", ROOT] },
      });
    }
  });

  it("Codex: tidak menyentuh berkas pengguna; memberi perintah dan cuplikan TOML", () => {
    const { edits } = plan(["codex"], {}, { guide: false });
    const edit = edits[0] as PlannedEdit;
    expect(edit.action).toBe("manual");
    expect(edit.path).toBeUndefined();
    const text = (edit.manual ?? []).join("\n");
    expect(text).toContain(`codex mcp add dalang -- ${LAUNCH.command}`);
    expect(text).toContain("[mcp_servers.dalang]");
    expect(text).toContain(`command = ${JSON.stringify(LAUNCH.command)}`);
    expect(text).toContain(`args = ${JSON.stringify([...LAUNCH.args, "mcp", ROOT])}`);
  });

  it("IDEMPOTEN: menerapkan lalu merencanakan ulang menghasilkan 'sama' untuk semuanya", () => {
    const all = AGENTS.map((a) => a.id);
    const first = plan(all);
    first.fs.apply(first.edits);
    const second = planAgentSetup({
      root: ROOT,
      agents: all,
      launch: LAUNCH,
      read: first.fs.read,
    });
    expect(second.map((e) => `${e.agent}:${e.action}`)).toEqual(
      second.map((e) => (e.agent === "codex" ? "codex:manual" : `${e.agent}:sama`)),
    );
  });

  it("menggabung ke berkas yang sudah ada tanpa menyentuh server lain", () => {
    const existing = JSON.stringify({
      theme: "gelap",
      mcpServers: {
        lain: { command: "npx", args: ["server-lain"], env: { A: "1" } },
      },
    });
    const { edits } = plan(
      ["claude-code"],
      { [`${ROOT}/.mcp.json`]: existing },
      { guide: false },
    );
    const edit = edits[0] as PlannedEdit;
    expect(edit.action).toBe("perbarui");
    const doc = parsed(edit.content) as {
      theme: string;
      mcpServers: Record<string, unknown>;
    };
    expect(doc.theme).toBe("gelap");
    expect(doc.mcpServers.lain).toEqual({
      command: "npx",
      args: ["server-lain"],
      env: { A: "1" },
    });
    expect(Object.keys(doc.mcpServers)).toEqual(["lain", "dalang"]);
  });

  it("entri dalang lama diperbarui, kunci tambahan milik pengguna dipertahankan", () => {
    const existing = JSON.stringify({
      mcpServers: {
        dalang: {
          type: "stdio",
          command: "/lama/node",
          args: ["x"],
          env: { TOKEN: "rahasia" },
        },
      },
    });
    const { edits } = plan(
      ["claude-code"],
      { [`${ROOT}/.mcp.json`]: existing },
      { guide: false },
    );
    const edit = edits[0] as PlannedEdit;
    expect(edit.action).toBe("perbarui");
    const dalang = (
      parsed(edit.content).mcpServers as Record<string, Record<string, unknown>>
    ).dalang;
    expect(dalang?.command).toBe(LAUNCH.command);
    expect(dalang?.env).toEqual({ TOKEN: "rahasia" });
  });

  it("berkas yang tidak bisa dibaca dengan pasti DILEWATI dengan cuplikan, bukan ditimpa", () => {
    for (const bad of [
      "{ // komentar\n}",
      "[]",
      '{"mcpServers": "salah"}',
      "bukan json",
    ]) {
      const { edits } = plan(
        ["claude-code"],
        { [`${ROOT}/.mcp.json`]: bad },
        { guide: false },
      );
      const edit = edits[0] as PlannedEdit;
      expect(edit.action, bad).toBe("lewati");
      expect(edit.content, bad).toBeUndefined();
      expect((edit.manual ?? []).join("\n"), bad).toContain('"dalang"');
    }
  });

  it("akar relatif ditolak: path di konfigurasi harus absolut", () => {
    expect(() =>
      planAgentSetup({
        root: "relatif/video",
        agents: ["cursor"],
        launch: LAUNCH,
        read: () => undefined,
      }),
    ).toThrow(/absolut/);
  });
});

describe("panduan agent", () => {
  const block = (extra: Partial<Parameters<typeof renderAgentGuide>[0]> = {}) =>
    renderAgentGuide({
      root: ROOT,
      cli: LAUNCH,
      readOnly: false,
      allowRender: false,
      ...extra,
    });

  it("menyebut SETIAP tool katalog, dan render still hanya bila diizinkan", () => {
    const tanpa = block();
    for (const tool of MCP_TOOLS.filter((t) => !t.butuhRender)) {
      expect(tanpa, tool.name).toContain(`\`${tool.name}\``);
    }
    expect(tanpa).not.toContain("dalang_render_still");
    expect(block({ allowRender: true })).toContain("dalang_render_still");
  });

  it("mode hanya-baca tertulis jelas, dan tool penulis ditandai ditolak", () => {
    const text = block({ readOnly: true });
    expect(text).toContain("HANYA-BACA");
    expect(text).toContain("ditolak (hanya-baca)");
  });

  it("memuat awalan CLI yang bisa disalin, tidak ada emoji, dan berpenanda lengkap", () => {
    const text = block();
    expect(text).toContain(shellLine(LAUNCH));
    expect(text.startsWith(GUIDE_START)).toBe(true);
    expect(text.trimEnd().endsWith(GUIDE_END)).toBe(true);
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });

  it("tidak menjanjikan bendera yang tidak ada di CLI (tidak ada --dry-run di generate)", () => {
    expect(block()).not.toContain("--dry-run");
  });

  it("berkas baru diberi blok; berkas ada diberi blok DI AKHIR tanpa mengubah isinya", () => {
    const { edits } = plan(["codex"]);
    const created = edits.find((e) => e.agent === "panduan") as PlannedEdit;
    expect(created).toMatchObject({ action: "buat", path: `${ROOT}/AGENTS.md` });

    const milikOrang = "# Catatan saya\n\nJangan sentuh ini.\n";
    const appended = plan(["codex"], { [`${ROOT}/AGENTS.md`]: milikOrang }).edits.find(
      (e) => e.agent === "panduan",
    ) as PlannedEdit;
    expect(appended.action).toBe("perbarui");
    expect(appended.content?.startsWith(milikOrang.trimEnd())).toBe(true);
    expect(appended.content).toContain(GUIDE_START);
  });

  it("menjalankan lagi menimpa HANYA blok di antara penanda, teks sekitarnya utuh", () => {
    const sebelum = "# Atas\n\nteks sebelum\n\n";
    const sesudah = "\n\n## Catatan bawah\nteks sesudah\n";
    const existing = `${sebelum}${block()}${sesudah}`;
    const next = withGuideBlock(existing, block({ readOnly: true })) as string;
    expect(next.startsWith(sebelum)).toBe(true);
    expect(next.endsWith(sesudah)).toBe(true);
    expect(next).toContain("HANYA-BACA");
    expect(next.match(new RegExp(GUIDE_START, "g"))).toHaveLength(1);
  });

  it("satu berkas panduan dipakai bersama; CLAUDE.md dan GEMINI.md terpisah", () => {
    const { edits } = plan(["codex", "cursor", "opencode", "claude-code", "gemini"]);
    const guides = edits.filter((e) => e.agent === "panduan");
    expect(guides.map((e) => e.path?.replace(`${ROOT}/`, "")).sort()).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
    ]);
  });

  it("penanda rusak: dilewati dengan petunjuk, isi berkas tidak ditebak", () => {
    const rusak = `# Punya orang\n${GUIDE_START}\nsetengah jalan`;
    const edit = plan(["codex"], { [`${ROOT}/AGENTS.md`]: rusak }).edits.find(
      (e) => e.agent === "panduan",
    ) as PlannedEdit;
    expect(edit.action).toBe("lewati");
    expect(edit.content).toBeUndefined();
  });

  it("--tanpa-panduan: tidak ada suntingan panduan", () => {
    expect(
      plan(["claude-code"], {}, { guide: false }).edits.some(
        (e) => e.agent === "panduan",
      ),
    ).toBe(false);
  });
});

describe("daftar agent", () => {
  it("setiap agent punya jalur konfigurasi ATAU instruksi manual, dan hanya Claude Code 'binari'", () => {
    for (const agent of AGENTS) {
      expect(agent.configPath !== undefined || agent.id === "codex", agent.id).toBe(true);
      expect(agent.next.length, agent.id).toBeGreaterThan(20);
    }
    expect(AGENTS.filter((a) => a.verified === "binari").map((a) => a.id)).toEqual([
      "claude-code",
    ]);
  });
});
