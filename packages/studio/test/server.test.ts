import { rmSync } from "node:fs";
import type { ScenePlan } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import type { Studio } from "../src/server/index";
import type {
  NeedsConfirmation,
  ProjectStatePayload,
  StockSearchResponse,
} from "../src/shared/api-types";
import { call, callJson, collectSse, makeStudio, makeTempProject } from "./helpers";

/**
 * Tes integrasi HTTP: seluruh stack server (Hono app + ProjectSession +
 * stage Fase 1 + agent mock) tanpa TCP — Request masuk, Response keluar.
 */

const cleanups: Array<() => void> = [];
const boot = (overrides?: Parameters<typeof makeStudio>[1]) => {
  const { dir, planPath } = makeTempProject();
  const studio = makeStudio(planPath, overrides);
  cleanups.push(() => {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { studio, dir, planPath };
};

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const getProject = async (studio: Studio) =>
  (await callJson<ProjectStatePayload>(studio, "/api/project")).body;

describe("state & patch", () => {
  it("GET /api/project memuat plan, model, dan patch log kosong", async () => {
    const { studio } = boot();
    const project = await getProject(studio);
    expect(project.plan?.scenes).toHaveLength(3);
    expect(project.models.orchestrator).toBe("mock/echo");
    expect(project.patchLog.canUndo).toBe(false);
    expect(project.busy).toEqual({ mutation: null, render: null });
    expect(project.ttsEstimate).toEqual({ scenes: 2, chars: expect.any(Number), usd: 0 });
  });

  it("patch user tercatat origin user, bisa di-undo/redo lewat endpoint", async () => {
    const { studio } = boot();
    const patched = await callJson<{ summary: string }>(studio, "/api/patch", {
      method: "POST",
      body: JSON.stringify({
        ops: [{ op: "updateScene", id: "sc-batu", patch: { narration: "Narasi baru." } }],
      }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.summary).toContain("user:");

    let project = await getProject(studio);
    expect(project.plan?.scenes.find((scene) => scene.id === "sc-batu")?.narration).toBe(
      "Narasi baru.",
    );
    expect(project.patchLog.recent.at(-1)?.origin).toBe("user");

    const undone = await callJson<{ summary: string | null }>(studio, "/api/undo", {
      method: "POST",
    });
    expect(undone.body.summary).toContain("mengubah scene sc-batu");
    project = await getProject(studio);
    expect(project.plan?.scenes[1]?.narration).toContain("dua belas abad");

    await call(studio, "/api/redo", { method: "POST" });
    project = await getProject(studio);
    expect(project.plan?.scenes[1]?.narration).toBe("Narasi baru.");
  });

  it("lockScene dari UI diperbolehkan (user-only op) dan PatchError → 400", async () => {
    const { studio } = boot();
    const locked = await callJson<{ summary: string }>(studio, "/api/patch", {
      method: "POST",
      body: JSON.stringify({
        ops: [{ op: "lockScene", id: "sc-batu", locked: true }],
      }),
    });
    expect(locked.status).toBe(200);

    const missing = await callJson<{ error: string; code?: string }>(
      studio,
      "/api/patch",
      {
        method: "POST",
        body: JSON.stringify({
          ops: [{ op: "removeScene", id: "sc-tidak-ada" }],
        }),
      },
    );
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("SCENE_NOT_FOUND");
  });

  it("broadcast SSE plan-updated terpancar saat patch", async () => {
    const { studio } = boot();
    const response = await call(studio, "/api/events");
    const wait = collectSse(response, (events) =>
      events.some((event) => event.event === "plan-updated"),
    );
    await call(studio, "/api/patch", {
      method: "POST",
      body: JSON.stringify({
        ops: [{ op: "lockScene", id: "sc-peta", locked: true }],
      }),
    });
    const events = await wait;
    expect(events[0]?.event).toBe("hello");
    const update = events.find((event) => event.event === "plan-updated");
    expect(JSON.parse(update?.data ?? "{}").reason).toBe("patch-user");
  });
});

describe("media", () => {
  it("menyajikan file plan dan menolak traversal & file privat .dalang", async () => {
    const { studio } = boot();
    // tulis aset lokal di folder plan
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const project = await getProject(studio);
    const assetPath = join(dirname(project.planPath), "assets", "uji.svg");
    mkdirSync(dirname(assetPath), { recursive: true });
    writeFileSync(assetPath, "<svg xmlns='http://www.w3.org/2000/svg'/>");

    const ok = await call(studio, "/assets/uji.svg");
    expect(ok.status).toBe(200);

    const db = await call(studio, "/.dalang/pipeline.db");
    expect(db.status).toBe(404);
    const history = await call(studio, "/.dalang/chat-history.json");
    expect(history.status).toBe(404);
    const traversal = await call(studio, "/assets/../plan.json");
    expect([400, 404]).toContain(traversal.status);
  });

  it("mendukung Range 206 (seek audio/video)", async () => {
    const { studio } = boot();
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const project = await getProject(studio);
    const filePath = join(dirname(project.planPath), "assets", "range.bin");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.alloc(1000, 7));

    const partial = await call(studio, "/assets/range.bin", {
      headers: { range: "bytes=100-199" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect((await partial.arrayBuffer()).byteLength).toBe(100);
  });
});

describe("pipeline & render", () => {
  it("TTS via endpoint mengisi renderState + stage runs + log ui:*", async () => {
    const { studio } = boot();
    const result = await callJson<{ ok: boolean; results: { status: string }[] }>(
      studio,
      "/api/pipeline/tts",
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(result.status).toBe(200);
    expect(result.body.results.map((r) => r.status)).toEqual(["done", "done"]);

    const project = await getProject(studio);
    const plan = project.plan as ScenePlan;
    expect(plan.renderState.narrationAudio["sc-batu"]?.file).toMatch(/^\.dalang\/tts\//);
    expect(project.stageRuns.filter((run) => run.stage === "tts")).toHaveLength(2);
  });

  it("gate TTS: 428 needsConfirmation lalu jalan dengan confirm:true", async () => {
    const { studio } = boot({ guardrails: { ttsSceneGate: 1 } });
    const blocked = await callJson<NeedsConfirmation>(studio, "/api/pipeline/tts", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(blocked.status).toBe(428);
    expect(blocked.body.needsConfirmation).toBe(true);
    expect(blocked.body.detail).toContain("2 scene");

    const confirmed = await callJson<{ ok: boolean }>(studio, "/api/pipeline/tts", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
    expect(confirmed.status).toBe(200);
  });

  it("render final butuh confirm; draft langsung 202 + event done + terdaftar", async () => {
    const { studio } = boot();
    const finalBlocked = await callJson<NeedsConfirmation>(studio, "/api/render", {
      method: "POST",
      body: JSON.stringify({ profile: "final" }),
    });
    expect(finalBlocked.status).toBe(428);

    const events = call(studio, "/api/events").then((response) =>
      collectSse(response, (list) =>
        list.some(
          (event) => event.event === "render" && JSON.parse(event.data).status === "done",
        ),
      ),
    );
    const started = await callJson<{ started: boolean }>(studio, "/api/render", {
      method: "POST",
      body: JSON.stringify({ profile: "draft" }),
    });
    expect(started.status).toBe(202);
    const seen = await events;
    const done = seen
      .filter((event) => event.event === "render")
      .map((event) => JSON.parse(event.data));
    expect(done.at(-1)).toMatchObject({
      status: "done",
      label: "mp4 540p cepat",
      url: "/.dalang/renders/preview.mp4",
    });

    const project = await getProject(studio);
    expect(project.renders[0]?.url).toBe("/.dalang/renders/preview.mp4");
    const served = await call(studio, "/.dalang/renders/preview.mp4");
    expect(served.status).toBe(200);

    // ADR-0014: pengaturan eksplisit ringan -> 202 tanpa confirm, nama file
    // per pengaturan; resolusi 1080/terbaik/mov tetap butuh confirm.
    const heavy = await callJson<NeedsConfirmation>(studio, "/api/render", {
      method: "POST",
      body: JSON.stringify({ format: "mp4", resolution: 1080 }),
    });
    expect(heavy.status).toBe(428);
    const webmEvents = call(studio, "/api/events").then((response) =>
      collectSse(response, (list) =>
        list.some(
          (event) => event.event === "render" && JSON.parse(event.data).status === "done",
        ),
      ),
    );
    const webm = await callJson<{ started: boolean; label: string }>(
      studio,
      "/api/render",
      {
        method: "POST",
        body: JSON.stringify({ format: "webm", resolution: 720, quality: "cepat" }),
      },
    );
    expect(webm.status).toBe(202);
    expect(webm.body.label).toBe("webm 720p cepat");
    await webmEvents;
    const listed = (await getProject(studio)).renders.map((r) => r.url);
    expect(listed).toContain("/.dalang/renders/ekspor-webm-720p-cepat.webm");
  });

  it("busy lock: patch ditolak 409 selama stage berjalan", async () => {
    const { studio } = boot({ ttsDelayMs: 150 });
    const stage = callJson(studio, "/api/pipeline/tts", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const patched = await callJson<{ error: string }>(studio, "/api/patch", {
      method: "POST",
      body: JSON.stringify({
        ops: [{ op: "lockScene", id: "sc-batu", locked: true }],
      }),
    });
    expect(patched.status).toBe(409);
    expect(patched.body.error).toContain("tts");
    await stage;
  });
});

describe("stock search & pick (grid aset §8.2)", () => {
  it("search → pick = aset terpasang + ter-pin lewat patch user; pick ulang tetap boleh", async () => {
    const { studio } = boot();
    const search = await callJson<StockSearchResponse>(
      studio,
      "/api/stock/search?query=temple&kind=image",
    );
    expect(search.status).toBe(200);
    expect(search.body.candidates).toHaveLength(3);
    expect(search.body.candidates[0]?.thumbnailUrl).toContain("thumb-0");

    const picked = await callJson<{ ok: boolean; file: string }>(
      studio,
      "/api/stock/pick",
      {
        method: "POST",
        body: JSON.stringify({ sceneId: "sc-batu", query: "temple", index: 0 }),
      },
    );
    expect(picked.status).toBe(200);
    expect(picked.body.file).toMatch(/^\.dalang\/assets\//);

    let project = await getProject(studio);
    let scene = project.plan?.scenes.find((s) => s.id === "sc-batu");
    expect(scene?.visual.pinned).toBe(true);
    expect(scene?.visual.assetId).toBe("fake:image:0");
    expect(project.plan?.renderState.resolvedAssets["sc-batu"]?.license).toBe(
      "Uji License",
    );
    expect(project.patchLog.recent.at(-1)?.origin).toBe("user");

    // pilihan ulang user pada scene yang sudah ter-pin harus tetap bisa
    const repick = await callJson<{ ok: boolean }>(studio, "/api/stock/pick", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", query: "temple", index: 2 }),
    });
    expect(repick.status).toBe(200);
    project = await getProject(studio);
    scene = project.plan?.scenes.find((s) => s.id === "sc-batu");
    expect(scene?.visual.assetId).toBe("fake:image:2");
  });

  it("auto-resolve stage tetap melewati scene ter-pin", async () => {
    const { studio } = boot();
    await call(studio, "/api/stock/pick", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", query: "x", index: 0 }),
    });
    // pick di atas gagal (belum search) — lakukan alur benar:
    await call(studio, "/api/stock/search?query=temple&kind=image");
    await call(studio, "/api/stock/pick", {
      method: "POST",
      body: JSON.stringify({ sceneId: "sc-batu", query: "temple", index: 1 }),
    });
    const auto = await callJson<{
      results: { sceneId: string; status: string; detail: string }[];
    }>(studio, "/api/pipeline/assets", { method: "POST", body: JSON.stringify({}) });
    const row = auto.body.results.find((r) => r.sceneId === "sc-batu");
    expect(row?.status).toBe("skipped");
    expect(row?.detail).toContain("pin");
  });
});

describe("chat", () => {
  it("mock/echo: stream done + konteks proyek sampai ke model", async () => {
    const { studio } = boot();
    const response = await call(studio, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ text: "halo dalang" }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await collectSse(response, (list) =>
      list.some((event) => event.event === "done"),
    );
    const done = JSON.parse(events.find((e) => e.event === "done")?.data ?? "{}");
    // Echo memantulkan awal pesan → bukti blok konteks dinamis sampai ke model.
    expect(done.result.text).toContain("[mock/echo]");
    expect(done.result.text).toContain("KEADAAN PROYEK");
    expect(done.result.text).toContain("Uji Studio");
    expect(done.result.steps).toBe(1);
    expect(done.result.patches).toEqual([]);
  });

  it("approval di luar giliran chat: endpoint menjawab 404 utk id asing", async () => {
    const { studio } = boot();
    const answer = await callJson<{ error: string }>(studio, "/api/approvals/tidak-ada", {
      method: "POST",
      body: JSON.stringify({ approved: true }),
    });
    expect(answer.status).toBe(404);
  });

  it("tanpa orkestrator: studio hidup, chat 503 dengan alasan, panel manual jalan", async () => {
    const { studio } = boot({ noOrchestrator: true });
    const project = await getProject(studio);
    expect(project.models.orchestrator).toBeNull();
    expect(project.models.chatDisabled).toContain("API key");

    const chat = await callJson<{ error: string }>(studio, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ text: "halo" }),
    });
    expect(chat.status).toBe(503);

    const patched = await call(studio, "/api/patch", {
      method: "POST",
      body: JSON.stringify({ ops: [{ op: "lockScene", id: "sc-batu", locked: true }] }),
    });
    expect(patched.status).toBe(200);
  });

  it("chat ditolak 409 saat job lain berjalan", async () => {
    const { studio } = boot({ ttsDelayMs: 150 });
    const stage = call(studio, "/api/pipeline/tts", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const chat = await callJson<{ error: string }>(studio, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ text: "halo" }),
    });
    expect(chat.status).toBe(409);
    await stage;
  });
});
