import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools, Guardrails } from "../src/index";
import {
  basicPlan,
  execOptions,
  fakeTts,
  makeDeps,
  resolvedScripted,
  tempProject,
  textStep,
} from "./helpers";

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

const open = (plan: Parameters<typeof tempProject>[0]) => {
  const project = tempProject(plan);
  cleanups.push(project.cleanup);
  return project;
};

type AnyTool = { execute: (input: unknown, options: unknown) => Promise<unknown> };
const exec = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as AnyTool).execute(input, execOptions);

describe("tools §6.2", () => {
  it("getProjectState mengembalikan ringkasan + biaya", async () => {
    const { session } = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);
    const output = (await exec(tools, "getProjectState", {})) as Record<string, unknown>;
    expect(output.ok).toBe(true);
    expect(String(output.ringkasan)).toContain("sc-001");
  });

  it("applyPatch sukses & lock ditolak sebagai data (bukan exception)", async () => {
    const { session } = open(
      basicPlan({
        scenes: [
          { id: "sc-001", narration: "Bebas.", visual: { type: "solid" } },
          {
            id: "sc-002",
            locked: true,
            narration: "Terkunci.",
            visual: { type: "solid" },
          },
        ],
      }),
    );
    const { deps } = makeDeps({});
    const tools = buildAgentTools(session, deps);

    const ok = (await exec(tools, "applyPatch", {
      ops: [{ op: "updateScene", id: "sc-001", patch: { narration: "Baru." } }],
    })) as Record<string, unknown>;
    expect(ok.ok).toBe(true);
    expect(String(ok.ringkasanPerubahan)).toContain("sc-001");

    const rejected = (await exec(tools, "applyPatch", {
      ops: [{ op: "updateScene", id: "sc-002", patch: { narration: "Hack." } }],
    })) as Record<string, unknown>;
    expect(rejected.ok).toBe(false);
    expect(String(rejected.error)).toContain("terkunci");
    // Kedua panggilan tercatat di event log (PRD §6.3).
    const events = session.events.recent();
    expect(events.filter((event) => event.name === "applyPatch")).toHaveLength(2);
    expect(events.at(-1)?.error).toContain("terkunci");
  });

  it("writeScenePlan hanya untuk proyek kosong", async () => {
    const empty = open(null);
    const { deps } = makeDeps({});
    const tools = buildAgentTools(empty.session, deps);
    const created = (await exec(tools, "writeScenePlan", {
      plan: basicPlan(),
    })) as Record<string, unknown>;
    expect(created.ok).toBe(true);
    expect(created.jumlahScene).toBe(2);

    const again = (await exec(tools, "writeScenePlan", {
      plan: basicPlan(),
    })) as Record<string, unknown>;
    expect(again.ok).toBe(false);
    expect(String(again.error)).toContain("applyPatch");
  });

  it("generateVoiceover: tanpa voice → arahan setAudio; gate massal memanggil approval", async () => {
    const noVoice = open(basicPlan({ audio: {} }));
    const { deps } = makeDeps({});
    const output = (await exec(
      buildAgentTools(noVoice.session, deps),
      "generateVoiceover",
      {},
    )) as Record<string, unknown>;
    expect(output.ok).toBe(false);
    expect(String(output.error)).toContain("setAudio");

    // Gate: turunkan ambang massal ke 1 scene → approval terpanggil; jawaban false → ditolak.
    const project = open(basicPlan());
    const denied = makeDeps({ approvalAnswer: false });
    denied.deps.guards = new Guardrails({ ttsSceneGate: 1 }, denied.approvals.approve);
    const rejected = (await exec(
      buildAgentTools(project.session, denied.deps),
      "generateVoiceover",
      {},
    )) as Record<string, unknown>;
    expect(rejected.ok).toBe(false);
    expect(denied.approvals.requests[0]?.action).toBe("tts-massal");

    // Disetujui → berjalan dan mengisi renderState.
    const approved = makeDeps({ approvalAnswer: true });
    approved.deps.guards = new Guardrails(
      { ttsSceneGate: 1 },
      approved.approvals.approve,
    );
    const okOutput = (await exec(
      buildAgentTools(project.session, approved.deps),
      "generateVoiceover",
      { sceneIds: ["sc-001"] },
    )) as Record<string, unknown>;
    expect(okOutput.ok).toBe(true);
    expect(project.session.plan?.renderState.narrationAudio["sc-001"]).toBeDefined();
    expect(project.session.plan?.renderState.narrationAudio["sc-002"]).toBeUndefined();
  });

  it("generateVoiceover meneruskan error chain (mis. key hilang)", async () => {
    const project = open(
      basicPlan({
        audio: { voice: { provider: "elevenlabs", voiceId: "v", speed: 1 } },
      }),
    );
    const { deps } = makeDeps({
      ttsChainFor: () => {
        throw new Error("ELEVENLABS_API_KEY tidak diset");
      },
    });
    const output = (await exec(
      buildAgentTools(project.session, deps),
      "generateVoiceover",
      {},
    )) as Record<string, unknown>;
    expect(output.ok).toBe(false);
    expect(String(output.error)).toContain("ELEVENLABS_API_KEY");
  });

  it("searchAssets menyimpan kandidat; pickAsset memasang aset", async () => {
    const project = open(basicPlan());
    const { deps } = makeDeps({});
    const tools = buildAgentTools(project.session, deps);

    const search = (await exec(tools, "searchAssets", {
      query: "borobudur sunrise",
      kind: "video",
    })) as Record<string, unknown>;
    expect(search.ok).toBe(true);
    expect((search.kandidat as unknown[]).length).toBeGreaterThan(0);

    const picked = (await exec(tools, "pickAsset", {
      sceneId: "sc-001",
      query: "borobudur sunrise",
      index: 0,
    })) as Record<string, unknown>;
    expect(picked.ok).toBe(true);
    expect(project.session.plan?.scenes[0]?.visual.assetId).toBe("stock-palsu:video:7");
    expect(project.session.plan?.renderState.resolvedAssets["sc-001"]?.license).toBe(
      "Uji License",
    );

    const missing = (await exec(tools, "pickAsset", {
      sceneId: "sc-001",
      query: "tidak pernah dicari",
      index: 0,
    })) as Record<string, unknown>;
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toContain("searchAssets");
  });

  it("renderFinal wajib approval; renderPreview langsung jalan", async () => {
    const project = open(basicPlan());
    const denied = makeDeps({ approvalAnswer: false });
    const tools = buildAgentTools(project.session, denied.deps);

    const preview = (await exec(tools, "renderPreview", {})) as Record<string, unknown>;
    expect(preview.ok).toBe(true);
    expect(denied.render.calls[0]?.profile).toBe("draft");

    const final = (await exec(tools, "renderFinal", {})) as Record<string, unknown>;
    expect(final.ok).toBe(false);
    expect(denied.render.calls).toHaveLength(1); // final TIDAK dirender

    const approved = makeDeps({ approvalAnswer: true });
    const tools2 = buildAgentTools(project.session, approved.deps);
    const finalOk = (await exec(tools2, "renderFinal", {})) as Record<string, unknown>;
    expect(finalOk.ok).toBe(true);
    expect(approved.render.calls[0]?.profile).toBe("final");
  });

  it("researchTopic memakai model tier-volume; tanpa model → error jelas", async () => {
    const project = open(basicPlan());
    const withVolume = makeDeps({
      volumeModel: resolvedScripted([
        textStep("FAKTA: dibangun abad ke-9.\nTIDAK PASTI: jumlah pekerja."),
      ]),
    });
    const tools = buildAgentTools(project.session, withVolume.deps);
    const output = (await exec(tools, "researchTopic", {
      query: "sejarah borobudur",
    })) as Record<string, unknown>;
    expect(output.ok).toBe(true);
    expect(String(output.catatan)).toContain("FAKTA");
    expect(withVolume.deps.guards.llmCostTurn).toBeGreaterThan(0);

    const noVolume = makeDeps({});
    const failed = (await exec(
      buildAgentTools(project.session, noVolume.deps),
      "researchTopic",
      { query: "apa saja" },
    )) as Record<string, unknown>;
    expect(failed.ok).toBe(false);
  });

  it("TTS placeholder fake menandai biaya tool ke guardrails", async () => {
    const project = open(basicPlan());
    const { deps } = makeDeps({ ttsChainFor: () => [fakeTts()] });
    const tools = buildAgentTools(project.session, deps);
    await exec(tools, "generateVoiceover", { sceneIds: ["sc-001"] });
    expect(deps.guards.toolCostTurn).toBeCloseTo(0.01, 5);
  });
});
