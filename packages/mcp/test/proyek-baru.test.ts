import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILT_IN_TEMPLATES, parseScenePlan } from "@dalang/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  createDalangMcpServer,
  MCP_TOOLS,
  type TemplateSource,
  type ToolContext,
} from "../src/index";

const connect = async (context: ToolContext) => {
  const server = createDalangMcpServer(context);
  const client = new Client({ name: "uji", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => await client.close() };
};

const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = (await client.callTool({ name, arguments: args })) as unknown as {
    content: Array<{ type: string; text?: string }>;
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

const emptyRoot = () => mkdtempSync(join(tmpdir(), "dalang-mcp-baru-"));

describe("katalog tool = tool yang DILAYANI server", () => {
  it("sama persis, dengan dan tanpa port render", async () => {
    const root = emptyRoot();
    const tanpa = await connect({ workspace: { root, readOnly: false } });
    const namaTanpa = (await tanpa.client.listTools()).tools.map((t) => t.name).sort();
    await tanpa.close();
    expect(namaTanpa).toEqual(
      MCP_TOOLS.filter((t) => !t.butuhRender)
        .map((t) => t.name)
        .sort(),
    );

    const dengan = await connect({
      workspace: { root, readOnly: false },
      renderStill: async () => [],
    });
    const namaDengan = (await dengan.client.listTools()).tools.map((t) => t.name).sort();
    await dengan.close();
    expect(namaDengan).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });

  it("tool yang menulis ditandai tidak read-only di anotasinya, yang membaca ditandai read-only", async () => {
    const root = emptyRoot();
    const { client, close } = await connect({
      workspace: { root, readOnly: false },
      renderStill: async () => [],
    });
    const { tools } = await client.listTools();
    for (const entry of MCP_TOOLS) {
      const tool = tools.find((t) => t.name === entry.name);
      expect(tool?.annotations?.readOnlyHint === true, entry.name).toBe(!entry.menulis);
    }
    await close();
  });
});

describe("dalang_list_templates dan dalang_new_project", () => {
  it("daftar template memuat semua template bawaan dengan ringkasnya", async () => {
    const { client, close } = await connect({
      workspace: { root: emptyRoot(), readOnly: false },
    });
    const result = await call(client, "dalang_list_templates", {});
    const list = (
      result.value as {
        template: Array<{ id: string; bawaan: boolean; ringkas: string }>;
      }
    ).template;
    expect(list.map((t) => t.id).sort()).toEqual(
      BUILT_IN_TEMPLATES.map((t) => t.manifest.id).sort(),
    );
    expect(list.every((t) => t.bawaan && /scene/.test(t.ringkas))).toBe(true);
    await close();
  });

  it("membuat proyek: plan.json sah di bawah akar, ringkasan langsung dikembalikan", async () => {
    const root = emptyRoot();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const result = await call(client, "dalang_new_project", {
      nama: "video-kopi",
      template: "klip-tiga-detik",
      judul: "Kopi Pagi",
    });
    expect(result.isError).toBe(false);
    const value = result.value as {
      proyek: string;
      template: string;
      ringkasan: { judul: string };
    };
    expect(value).toMatchObject({ proyek: "video-kopi", template: "klip-tiga-detik" });
    expect(value.ringkasan.judul).toBe("Kopi Pagi");

    const planPath = join(root, "video-kopi", "plan.json");
    const plan = parseScenePlan(JSON.parse(readFileSync(planPath, "utf8")));
    expect(plan.projectId).toBe("video-kopi");
    expect(plan.meta.title).toBe("Kopi Pagi");

    // Proyek baru langsung terlihat dan bisa dibaca oleh tool lain.
    const list = await call(client, "dalang_list_projects", {});
    expect(
      (list.value as { proyek: Array<{ path: string }> }).proyek.map((p) => p.path),
    ).toContain("video-kopi");
    expect(
      (await call(client, "dalang_get_plan", { proyek: "video-kopi" })).isError,
    ).toBe(false);
    await close();
  });

  it("template bawaan ketika tidak disebut; judul bawaan = nama template", async () => {
    const root = emptyRoot();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const result = await call(client, "dalang_new_project", { nama: "polos" });
    expect((result.value as { template: string }).template).toBe("esai-video");
    await close();
  });

  it("TIDAK PERNAH menimpa: nama yang sudah ada ditolak, isinya utuh", async () => {
    const root = emptyRoot();
    const dir = join(root, "ada");
    mkdirSync(dir);
    writeFileSync(join(dir, "plan.json"), '{"milik":"orang"}');
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const result = await call(client, "dalang_new_project", { nama: "ada" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("sudah ada");
    expect(readFileSync(join(dir, "plan.json"), "utf8")).toBe('{"milik":"orang"}');
    await close();
  });

  it("symlink menggantung ke luar akar dengan nama itu juga ditolak, tidak ditulisi lewat tautannya", async () => {
    const root = emptyRoot();
    const luar = emptyRoot();
    symlinkSync(join(luar, "belum-ada"), join(root, "tautan"));
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const result = await call(client, "dalang_new_project", { nama: "tautan" });
    expect(result.isError).toBe(true);
    // Pesan pagar, bukan galat mkdir yang kebetulan menolong: keberadaan diperiksa dengan lstat.
    expect(result.text).toContain("sudah ada");
    expect(existsSync(join(luar, "belum-ada"))).toBe(false);
    expect(lstatSync(join(root, "tautan")).isSymbolicLink()).toBe(true);
    await close();
  });

  it("nama yang bukan SATU nama folder ditolak pagar", async () => {
    const root = emptyRoot();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    for (const nama of [
      "../keluar",
      "a/b",
      "/abs/path",
      ".tersembunyi",
      "",
      "spasi di sini",
      "x".repeat(64),
    ]) {
      const result = await call(client, "dalang_new_project", { nama });
      expect(result.isError, JSON.stringify(nama)).toBe(true);
      // Ditolak OLEH PAGAR (nama tidak sah), bukan karena mkdir kebetulan gagal.
      expect(result.text, JSON.stringify(nama)).toContain("tidak sah");
    }
    expect(existsSync(join(root, "..", "keluar"))).toBe(false);
    await close();
  });

  it("template yang tidak ada: galat menyebut yang tersedia", async () => {
    const { client, close } = await connect({
      workspace: { root: emptyRoot(), readOnly: false },
    });
    const result = await call(client, "dalang_new_project", {
      nama: "x",
      template: "tidak-ada",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("esai-video");
    await close();
  });

  it("mode hanya-baca menolak membuat proyek, dan tidak membuat folder", async () => {
    const root = emptyRoot();
    const { client, close } = await connect({ workspace: { root, readOnly: true } });
    const result = await call(client, "dalang_new_project", { nama: "baru" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("hanya-baca");
    expect(existsSync(join(root, "baru"))).toBe(false);
    await close();
  });

  it("sumber template yang disuntikkan (template terpasang pengguna) dipakai", async () => {
    const pack = BUILT_IN_TEMPLATES[0];
    if (!pack) throw new Error("tidak ada template bawaan");
    const custom = {
      ...pack,
      manifest: { ...pack.manifest, id: "milik-saya", name: "Milik Saya" },
    };
    const source: TemplateSource = {
      list: () => [{ pack: custom, builtIn: false }],
      find: (id) => (id === "milik-saya" ? { pack: custom, builtIn: false } : undefined),
    };
    const { client, close } = await connect({
      workspace: { root: emptyRoot(), readOnly: false },
      templates: source,
    });
    const list = await call(client, "dalang_list_templates", {});
    expect(
      (list.value as { template: Array<{ id: string; bawaan: boolean }> }).template,
    ).toEqual([expect.objectContaining({ id: "milik-saya", bawaan: false })]);
    const made = await call(client, "dalang_new_project", {
      nama: "p",
      template: "milik-saya",
    });
    expect(made.isError).toBe(false);
    await close();
  });

  it("akar yang belum ada dibuat saat proyek pertama", async () => {
    const parent = emptyRoot();
    const root = join(parent, "ruang-baru");
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    expect((await call(client, "dalang_new_project", { nama: "satu" })).isError).toBe(
      false,
    );
    expect(existsSync(join(root, "satu", "plan.json"))).toBe(true);
    await close();
  });
});
