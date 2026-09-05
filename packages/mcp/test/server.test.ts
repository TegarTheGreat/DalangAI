import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScenePlan, type ScenePlanInput } from "@dalang/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createDalangMcpServer } from "../src/server";
import type { ToolContext } from "../src/tools";

/**
 * Server MCP diuji lewat KLIEN MCP sungguhan di atas transport in-memory,
 * bukan dengan memanggil fungsinya langsung.
 *
 * Alasannya: yang paling mudah salah di server MCP bukan logikanya melainkan
 * kontraknya — skema input yang tidak bisa diserialkan ke JSON Schema, tool
 * yang terdaftar padahal tidak seharusnya, galat yang dilempar alih-alih
 * dikembalikan. Semua itu hanya kelihatan lewat protokolnya.
 */

const planInput = (): ScenePlanInput => ({
  version: 2,
  projectId: "uji-mcp",
  meta: { title: "Proyek MCP", aspectRatio: "16:9", language: "id" },
  audio: {},
  scenes: [
    {
      id: "sc-satu",
      narration: "Kalimat pertama.",
      clips: [{ id: "sc-satu-k1", type: "image" }],
    },
    {
      id: "sc-dua",
      narration: "Kalimat kedua.",
      clips: [{ id: "sc-dua-k1", type: "image" }],
      locked: true,
    },
  ],
  renderState: { narrationAudio: {}, clipAssets: {} },
});

const makeWorkspace = () => {
  const root = mkdtempSync(join(tmpdir(), "dalang-mcp-"));
  const dir = join(root, "proyekku");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plan.json"),
    `${JSON.stringify(parseScenePlan(planInput()), null, 2)}\n`,
  );
  return { root, dir, planPath: join(dir, "plan.json") };
};

const connect = async (context: ToolContext) => {
  const server = createDalangMcpServer(context);
  const client = new Client({ name: "uji", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => await client.close() };
};

interface ToolText {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

const callJson = async (
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string; value: unknown }> => {
  const result = (await client.callTool({
    name,
    arguments: args,
  })) as unknown as ToolText;
  const text = result.content.map((part) => part.text ?? "").join("");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  return { isError: result.isError === true, text, value };
};

describe("server MCP Dalang", () => {
  it("tidak mendaftarkan satu pun tool yang memanggil model atau membelanjakan uang", async () => {
    // Kaidah inti ADR-0023: pemanggil server ini SUDAH agent. Memberinya otak
    // kedua hanya menambah biaya dan satu tempat lagi yang bisa berhalusinasi.
    const { root } = makeWorkspace();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("dalang_apply_patch");
    expect(names).toContain("dalang_export_timeline");
    for (const forbidden of ["tts", "voice", "suara", "stock", "aset", "chat", "model"]) {
      expect(names.filter((name) => name.includes(forbidden))).toEqual([]);
    }
    await close();
  });

  it("tool render TIDAK didaftarkan tanpa port, bukan didaftarkan lalu menolak", async () => {
    // Klien merencanakan langkahnya dari daftar tool; tool yang selalu menolak
    // adalah rencana yang selalu gagal di tengah jalan.
    const { root } = makeWorkspace();
    const tanpa = await connect({ workspace: { root, readOnly: false } });
    expect((await tanpa.client.listTools()).tools.map((t) => t.name)).not.toContain(
      "dalang_render_still",
    );
    await tanpa.close();

    const dengan = await connect({
      workspace: { root, readOnly: false },
      renderStill: async ({ frames, outDir }) =>
        frames.map((f) => join(outDir, `${f}.png`)),
    });
    expect((await dengan.client.listTools()).tools.map((t) => t.name)).toContain(
      "dalang_render_still",
    );
    await dengan.close();
  });

  it("membaca ringkasan garis waktu, bukan plan mentah, kecuali diminta", async () => {
    const { root } = makeWorkspace();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });

    const ringkas = await callJson(client, "dalang_get_plan", { proyek: "proyekku" });
    const summary = ringkas.value as {
      scenes: Array<Record<string, unknown>>;
      judul: string;
    };
    expect(summary.judul).toBe("Proyek MCP");
    expect(summary.scenes[0]).toMatchObject({ id: "sc-satu", asetSiap: false });
    expect(ringkas.text).not.toContain("renderState");

    const mentah = await callJson(client, "dalang_get_plan", {
      proyek: "proyekku",
      mentah: true,
    });
    expect(mentah.text).toContain("renderState");
    await close();
  });

  /**
   * Zona aman platform (ADR-0034) di ringkasan MCP.
   *
   * Agent pemanggil hanya melihat ringkasan ini. Kalau ia diam soal tepi yang
   * sudah dipesan, agent itu akan menaruh teks di pita yang justru
   * dikosongkan — dan kesalahannya akan terlihat seperti kesalahan agent-nya
   * sendiri, bukan seperti ringkasan yang tidak lengkap.
   */
  it("zona aman ikut ke ringkasan saat menyala, dan DIAM saat mati", async () => {
    const { root, planPath } = makeWorkspace();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });

    const mati = await callJson(client, "dalang_get_plan", { proyek: "proyekku" });
    expect((mati.value as Record<string, unknown>).zonaAman).toBeUndefined();

    const dengan = parseScenePlan({
      ...planInput(),
      meta: {
        ...planInput().meta,
        safeArea: { top: 0.06, bottom: 0.18, left: 0, right: 0.12 },
      },
    });
    writeFileSync(planPath, JSON.stringify(dengan, null, 2));
    const nyala = await callJson(client, "dalang_get_plan", { proyek: "proyekku" });
    expect((nyala.value as Record<string, unknown>).zonaAman).toEqual({
      atas: 0.06,
      bawah: 0.18,
      kiri: 0,
      kanan: 0.12,
    });
    await close();
  });

  /**
   * Ringkasan untuk scene BERKLIP BANYAK (ADR-0033).
   *
   * Agent pemanggil hanya melihat ringkasan ini. "asetSiap: true" pada scene
   * yang dua dari tiga potongannya masih kosong bukan sekadar kurang tepat —
   * ia menyuruh agent itu langsung merender.
   */
  it("asetSiap scene berklip banyak menuntut SEMUA potongannya punya berkas", async () => {
    const { root, planPath } = makeWorkspace();
    const berklip = parseScenePlan({
      ...planInput(),
      scenes: [
        {
          id: "sc-satu",
          narration: "Satu kalimat, tiga potongan.",
          clips: [
            { id: "k1", type: "stock", durationSec: 3 },
            { id: "k2", type: "stock", durationSec: 3 },
            { id: "k3", type: "stock", durationSec: 3 },
          ],
        },
      ],
      renderState: {
        narrationAudio: {},
        clipAssets: {
          k1: { file: "media/a.mp4", kind: "video", source: "local" },
        },
      },
    });
    writeFileSync(
      planPath,
      `${JSON.stringify(berklip, null, 2)}
`,
    );

    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const ringkas = await callJson(client, "dalang_get_plan", { proyek: "proyekku" });
    const scene = (
      ringkas.value as {
        scenes: Array<{
          asetSiap: boolean;
          klip?: Array<{ id: string; asetSiap: boolean }>;
        }>;
      }
    ).scenes[0];
    expect(scene?.asetSiap).toBe(false);
    expect(scene?.klip?.map((clip) => [clip.id, clip.asetSiap])).toEqual([
      ["k1", true],
      ["k2", false],
      ["k3", false],
    ]);
    await close();
  });

  it("menolak path di luar akar dengan HASIL bertanda error, bukan koneksi putus", async () => {
    const { root } = makeWorkspace();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });

    const keluar = await callJson(client, "dalang_get_plan", { proyek: "../../etc" });
    expect(keluar.isError).toBe(true);
    expect(keluar.text).toContain("pagar ruang kerja");

    // Koneksinya harus tetap hidup: model perlu tahu kenapa panggilannya
    // ditolak supaya bisa memperbaikinya.
    const lanjut = await callJson(client, "dalang_list_projects", {});
    expect(lanjut.isError).toBe(false);
    await close();
  });

  it("menolak plan.json yang symlink ke luar akar", async () => {
    // Path argumennya aman ("liar"), yang menunjuk keluar adalah berkasnya.
    const { root } = makeWorkspace();
    const luar = mkdtempSync(join(tmpdir(), "dalang-luar-"));
    writeFileSync(join(luar, "rahasia.json"), "{}");
    const liar = join(root, "liar");
    mkdirSync(liar, { recursive: true });
    symlinkSync(join(luar, "rahasia.json"), join(liar, "plan.json"));

    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const hasil = await callJson(client, "dalang_get_plan", { proyek: "liar" });
    expect(hasil.isError).toBe(true);
    expect(hasil.text).toContain("luar ruang kerja");
    await close();
  });

  it("apply_patch menulis plan.json, dan undo mengembalikannya", async () => {
    const { root, planPath } = makeWorkspace();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });

    const patched = await callJson(client, "dalang_apply_patch", {
      proyek: "proyekku",
      ops: [{ op: "updateScene", id: "sc-satu", patch: { narration: "Kalimat baru." } }],
    });
    expect(patched.isError).toBe(false);
    expect(readFileSync(planPath, "utf8")).toContain("Kalimat baru.");

    const undone = await callJson(client, "dalang_undo", { proyek: "proyekku" });
    expect(undone.isError).toBe(false);
    expect(readFileSync(planPath, "utf8")).toContain("Kalimat pertama.");
    await close();
  });

  it("scene terkunci ditolak — pagar yang sama seperti untuk agent Dalang sendiri", async () => {
    const { root, planPath } = makeWorkspace();
    const before = readFileSync(planPath, "utf8");
    const { client, close } = await connect({ workspace: { root, readOnly: false } });

    const hasil = await callJson(client, "dalang_apply_patch", {
      proyek: "proyekku",
      ops: [{ op: "updateScene", id: "sc-dua", patch: { narration: "Dipaksa." } }],
    });
    expect(hasil.isError).toBe(true);
    expect(readFileSync(planPath, "utf8")).toBe(before);
    await close();
  });

  it("undo tanpa riwayat mengatakan sebabnya, bukan diam-diam sukses", async () => {
    const { root } = makeWorkspace();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const hasil = await callJson(client, "dalang_undo", { proyek: "proyekku" });
    const value = hasil.value as { ok: boolean; pesan: string };
    expect(value.ok).toBe(false);
    expect(value.pesan).toContain("bukan yang dibuat Studio atau CLI");
    await close();
  });

  it("mode hanya-baca menolak tulisan, dan tetap melayani bacaan", async () => {
    const { root, planPath } = makeWorkspace();
    const before = readFileSync(planPath, "utf8");
    const { client, close } = await connect({ workspace: { root, readOnly: true } });

    const tulis = await callJson(client, "dalang_apply_patch", {
      proyek: "proyekku",
      ops: [{ op: "updateScene", id: "sc-satu", patch: { narration: "x" } }],
    });
    expect(tulis.isError).toBe(true);
    expect(readFileSync(planPath, "utf8")).toBe(before);

    expect(
      (await callJson(client, "dalang_critique", { proyek: "proyekku" })).isError,
    ).toBe(false);
    await close();
  });

  it("ekspor selalu membawa daftar yang TIDAK ikut menyeberang", async () => {
    // Agent yang mengira ekspornya utuh akan meyakinkan penggunanya soal hal
    // yang tidak benar.
    const { root } = makeWorkspace();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const hasil = await callJson(client, "dalang_export_timeline", {
      proyek: "proyekku",
    });
    const value = hasil.value as { ok: boolean; berkas: string; tidakIkut: string[] };
    expect(value.ok).toBe(true);
    expect(value.berkas).toBe("proyekku/timeline.otio");
    expect(value.tidakIkut.length).toBeGreaterThan(0);
    await close();
  });

  it("op patch yang tidak valid ditolak skema, bukan diterima separuh", async () => {
    const { root, planPath } = makeWorkspace();
    const before = readFileSync(planPath, "utf8");
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const hasil = await callJson(client, "dalang_apply_patch", {
      proyek: "proyekku",
      ops: [{ op: "opYangTidakAda", id: "sc-satu" }],
    });
    expect(hasil.isError).toBe(true);
    expect(readFileSync(planPath, "utf8")).toBe(before);
    await close();
  });

  it("daftar proyek memakai path relatif akar, tidak membocorkan path absolut", async () => {
    const { root } = makeWorkspace();
    const { client, close } = await connect({ workspace: { root, readOnly: false } });
    const hasil = await callJson(client, "dalang_list_projects", {});
    const value = hasil.value as { proyek: Array<{ path: string; title: string }> };
    expect(value.proyek).toEqual([
      expect.objectContaining({ path: "proyekku", title: "Proyek MCP" }),
    ]);
    await close();
  });
});

describe("tulis bandingkan-dan-tukar (koherensi Studio–MCP, ADR-0023)", () => {
  it("menolak menulis bila berkas berubah sejak dibaca, dan menerima setelah dibaca ulang", async () => {
    const { readPlanWithHash, writePlanIfUnchanged } = await import("../src/workspace");
    const { root, planPath } = makeWorkspace();
    const workspace = { root, readOnly: false } as Parameters<
      typeof writePlanIfUnchanged
    >[0];
    const first = readPlanWithHash(planPath);
    // "Studio" menulis di antara baca dan tulis.
    const external = structuredClone(first.plan);
    external.meta.title = "Diubah Studio";
    writeFileSync(planPath, `${JSON.stringify(external, null, 2)}\n`);
    const mine = structuredClone(first.plan);
    mine.meta.title = "Diubah MCP";
    expect(writePlanIfUnchanged(workspace, planPath, first.hash, mine)).toBe(false);
    expect(JSON.parse(readFileSync(planPath, "utf8")).meta.title).toBe("Diubah Studio");

    const fresh = readPlanWithHash(planPath);
    fresh.plan.meta.title = "Diubah MCP di atas Studio";
    expect(writePlanIfUnchanged(workspace, planPath, fresh.hash, fresh.plan)).toBe(true);
    expect(JSON.parse(readFileSync(planPath, "utf8")).meta.title).toBe(
      "Diubah MCP di atas Studio",
    );
  });
});
