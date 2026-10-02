import { dubCoverage, planInLanguage } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools, SYSTEM_PROMPT } from "../src/index";
import {
  basicPlan,
  execOptions,
  makeDeps,
  resolvedScripted,
  tempProject,
  textStep,
} from "./helpers";

/**
 * Sulih suara dari agent (ADR-0040).
 *
 * Yang dijaga di sini bukan mutu terjemahannya — itu urusan model — melainkan
 * hal-hal yang salahnya membuat proyek RUSAK diam-diam: jawaban yang tidak
 * bisa diurai tidak boleh menghasilkan plan yang tersulih separuh, id scene
 * karangan tidak boleh menyelinap masuk, dan scene yang melar harus DISEBUT
 * dengan angkanya alih-alih diserahkan sebagai video yang menggantung.
 */

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});
const open = () => {
  const project = tempProject(basicPlan());
  cleanups.push(project.cleanup);
  return project;
};

type AnyTool = { execute: (input: unknown, options: unknown) => Promise<unknown> };
const exec = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as AnyTool).execute(input, execOptions) as Promise<
    Record<string, unknown>
  >;

const modelSaying = (text: string) => resolvedScripted(() => textStep(text));

const JAWABAN_BAIK = JSON.stringify({
  judul: "Agent Test",
  scenes: [
    { id: "sc-001", narasi: "First sentence for the agent." },
    { id: "sc-002", narasi: "A second, slightly longer sentence." },
  ],
});

describe("translateNarration (ADR-0040)", () => {
  it("menyimpan terjemahan sebagai patch yang bisa di-undo, dan judul ikut", async () => {
    const project = open();
    const { deps } = makeDeps({ volumeModel: modelSaying(JAWABAN_BAIK) });
    const tools = buildAgentTools(project.session, deps);

    const out = await exec(tools, "translateNarration", { bahasa: "en" });
    expect(out.ok).toBe(true);
    expect(out.bahasa).toBe("en");

    const plan = project.session.plan;
    if (!plan) throw new Error("plan hilang");
    expect(plan.scenes[0]?.dubs.en).toBe("First sentence for the agent.");
    expect(plan.meta.dubTitles.en).toBe("Agent Test");
    expect(dubCoverage(plan, "en").diterjemahkan).toBe(2);

    // Dan hasilnya benar-benar bisa dibaca sebagai plan bahasa Inggris.
    const en = planInLanguage(plan, "en");
    expect(en.meta.language).toBe("en");
    expect(en.scenes[0]?.narration).toBe("First sentence for the agent.");
  });

  it("jawaban yang tidak bisa diurai TIDAK mengubah plan sama sekali", async () => {
    // Plan yang tersulih separuh lebih buruk daripada yang belum sama sekali:
    // separuhnya tampil BISU tanpa satu pun pesan.
    const project = open();
    const { deps } = makeDeps({ volumeModel: modelSaying("Tentu! Ini terjemahannya:") });
    const tools = buildAgentTools(project.session, deps);

    const out = await exec(tools, "translateNarration", { bahasa: "en" });
    expect(out.ok).toBe(false);
    expect(String(out.pesan)).toContain("tidak ada yang diubah");
    expect(project.session.plan?.scenes[0]?.dubs).toEqual({});
  });

  it("id scene karangan diabaikan, bukan membuat scene baru", async () => {
    const project = open();
    const { deps } = makeDeps({
      volumeModel: modelSaying(
        JSON.stringify({
          scenes: [
            { id: "sc-001", narasi: "Real one." },
            { id: "sc-hantu", narasi: "Ghost scene." },
          ],
        }),
      ),
    });
    const tools = buildAgentTools(project.session, deps);
    await exec(tools, "translateNarration", { bahasa: "en" });

    const plan = project.session.plan;
    expect(plan?.scenes).toHaveLength(2);
    expect(plan?.scenes.map((scene) => scene.id)).toEqual(["sc-001", "sc-002"]);
    expect(plan?.scenes[0]?.dubs.en).toBe("Real one.");
  });

  it("scene yang MELAR dilaporkan dengan angkanya, bukan didiamkan", async () => {
    const project = open();
    const { deps } = makeDeps({
      volumeModel: modelSaying(
        JSON.stringify({
          scenes: [
            {
              id: "sc-001",
              narasi:
                "This is a considerably longer English rendering of the first sentence, one that would take a great deal more time to actually say out loud than the original ever did.",
            },
          ],
        }),
      ),
    });
    const tools = buildAgentTools(project.session, deps);
    const out = await exec(tools, "translateNarration", { bahasa: "en" });

    expect(out.ok).toBe(true);
    expect(Array.isArray(out.melar)).toBe(true);
    expect(String((out.melar as string[])[0])).toMatch(/sc-001: \d+% lebih panjang/);
  });

  it("bahasa utama ditolak — tidak ada yang perlu disulih", async () => {
    const project = open();
    const { deps } = makeDeps({ volumeModel: modelSaying(JAWABAN_BAIK) });
    const out = await exec(buildAgentTools(project.session, deps), "translateNarration", {
      bahasa: "id",
    });
    expect(out.ok).toBe(false);
    expect(String(out.pesan)).toContain("bahasa utama");
  });

  it("kode bahasa ngawur ditolak sebelum model dipanggil", async () => {
    const project = open();
    const { deps } = makeDeps({ volumeModel: modelSaying(JAWABAN_BAIK) });
    const out = await exec(buildAgentTools(project.session, deps), "translateNarration", {
      bahasa: "bahasa inggris",
    });
    expect(out.ok).toBe(false);
    expect(String(out.pesan)).toContain("bukan kode bahasa");
  });

  it("system prompt menyebut bahwa TEKS bukan SUARA — dan langkah berikutnya", () => {
    // Agent yang mengira terjemahan sudah berarti video berbahasa lain akan
    // menjanjikan sesuatu yang belum ada.
    expect(SYSTEM_PROMPT).toContain("translateNarration");
    expect(SYSTEM_PROMPT).toContain("SUARANYA belum ada");
  });
});
