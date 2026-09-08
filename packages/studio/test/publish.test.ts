import { rmSync } from "node:fs";
import type { PublishRequest, PublishTarget } from "@dalang/pipeline";
import { afterEach, describe, expect, it } from "vitest";
import type { Studio } from "../src/server/index";
import type { NeedsConfirmation, ProjectStatePayload } from "../src/shared/api-types";
import { call, callJson, collectSse, makeStudio, makeTempProject } from "./helpers";

/**
 * Publikasi langsung (ADR-0030) lewat Studio: gerbang 428, 202 + event
 * sampai `done` dengan tautan, ledger mencegah unggahan ganda, dan tanpa
 * tujuan server berkata apa adanya — bukan pura-pura mengunggah.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const fakeTarget = (options: { delayMs?: number; fail?: boolean } = {}) => {
  const calls: PublishRequest[] = [];
  const target: PublishTarget & { calls: PublishRequest[] } = {
    id: "youtube-palsu",
    label: "YouTube (uji)",
    calls,
    publish: async (request) => {
      calls.push(request);
      for (const step of [0.25, 0.5, 0.75, 1]) {
        if (options.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        if (request.signal?.aborted) throw new Error("dibatalkan");
        request.onProgress?.(step);
      }
      if (options.fail) throw new Error("kuota unggah habis (uji)");
      return {
        providerId: "youtube-palsu",
        videoId: `vid-${calls.length}`,
        url: `https://youtu.be/vid-${calls.length}`,
      };
    },
  };
  return target;
};

const boot = (target?: PublishTarget) => {
  const { dir, planPath } = makeTempProject();
  const studio = makeStudio(planPath, target ? { publishTargets: () => [target] } : {});
  cleanups.push(() => {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { studio, dir, planPath };
};

const getProject = async (studio: Studio) =>
  (await callJson<ProjectStatePayload>(studio, "/api/project")).body;

const post = (studio: Studio, path: string, body: unknown) =>
  callJson<Record<string, unknown>>(studio, path, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** Render draf palsu (fakeDeps menulis berkasnya) dan tunggu event done. */
const renderDraft = async (studio: Studio) => {
  const done = call(studio, "/api/events").then((response) =>
    collectSse(response, (list) =>
      list.some(
        (event) => event.event === "render" && JSON.parse(event.data).status === "done",
      ),
    ),
  );
  const started = await post(studio, "/api/render", { profile: "draft" });
  expect(started.status).toBe(202);
  await done;
};

type PublishEvent = {
  status: string;
  file: string;
  fraction?: number;
  url?: string;
  cached?: boolean;
  error?: string;
};

/** Langganan SSE sampai event publish terakhir (done/error) tiba. */
const publishEvents = (studio: Studio): Promise<PublishEvent[]> =>
  call(studio, "/api/events")
    .then((response) =>
      collectSse(response, (list) =>
        list.some(
          (event) =>
            event.event === "publish" &&
            ["done", "error"].includes(JSON.parse(event.data).status),
        ),
      ),
    )
    .then((list) =>
      list
        .filter((event) => event.event === "publish")
        .map((event) => JSON.parse(event.data) as PublishEvent),
    );

describe("/api/publish (ADR-0030)", () => {
  it("tanpa tujuan: daftar kosong dengan petunjuk, dan unggah ditolak 400 — bukan pura-pura", async () => {
    const { studio } = boot();
    await renderDraft(studio);
    const targets = await callJson<{ targets: unknown[]; hint: string | null }>(
      studio,
      "/api/publish/targets",
    );
    expect(targets.body.targets).toEqual([]);
    expect(targets.body.hint).toContain("YOUTUBE_ACCESS_TOKEN");

    const project = await getProject(studio);
    expect(project.publish).toEqual({
      targets: [],
      hint: expect.stringContaining("YOUTUBE_ACCESS_TOKEN"),
      job: null,
    });
    expect(project.renders[0]?.published).toBeUndefined();

    const refused = await post(studio, "/api/publish", {
      file: "preview.mp4",
      confirm: true,
    });
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toContain("YOUTUBE_ACCESS_TOKEN");
  });

  it("gerbang 428 -> 202 + event progress/done bertautan; metadata bawaan dari plan; ledger: kedua kali cached, force mengunggah lagi", async () => {
    const target = fakeTarget();
    const { studio } = boot(target);
    await renderDraft(studio);

    const blocked = await callJson<NeedsConfirmation>(studio, "/api/publish", {
      method: "POST",
      body: JSON.stringify({ file: "/.dalang/renders/preview.mp4" }),
    });
    expect(blocked.status).toBe(428);
    expect(blocked.body.detail).toContain("preview.mp4");
    expect(blocked.body.detail).toContain("Privat");
    expect(target.calls).toHaveLength(0);

    const events = publishEvents(studio);
    const started = await post(studio, "/api/publish", {
      file: "preview.mp4",
      confirm: true,
    });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({
      started: true,
      file: "preview.mp4",
      target: "youtube-palsu",
    });
    const seen = await events;
    expect(seen[0]).toMatchObject({ status: "started", file: "preview.mp4" });
    expect(seen.some((event) => event.status === "progress")).toBe(true);
    expect(seen.at(-1)).toMatchObject({
      status: "done",
      url: "https://youtu.be/vid-1",
      cached: false,
      fraction: 1,
    });

    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]).toMatchObject({
      title: "Uji Studio",
      privacy: "private",
      tags: ["bebas", "dalang"],
      language: "id",
    });
    expect(target.calls[0]?.description).toContain("Candi batu berdiri");
    expect(target.calls[0]?.filePath.endsWith("preview.mp4")).toBe(true);

    const project = await getProject(studio);
    expect(project.renders[0]?.published).toMatchObject({
      targetId: "youtube-palsu",
      url: "https://youtu.be/vid-1",
      privacy: "private",
    });
    expect(project.publish.job).toBeNull();

    const again = publishEvents(studio);
    const second = await post(studio, "/api/publish", {
      file: "preview.mp4",
      confirm: true,
    });
    expect(second.status).toBe(202);
    expect((await again).at(-1)).toMatchObject({
      status: "done",
      cached: true,
      url: "https://youtu.be/vid-1",
    });
    expect(target.calls).toHaveLength(1);

    const forced = publishEvents(studio);
    await post(studio, "/api/publish", {
      file: "preview.mp4",
      confirm: true,
      force: true,
      privacy: "unlisted",
      title: "Judul baru",
      tags: ["uji", "dalang"],
    });
    expect((await forced).at(-1)).toMatchObject({
      status: "done",
      cached: false,
      url: "https://youtu.be/vid-2",
    });
    expect(target.calls[1]).toMatchObject({
      title: "Judul baru",
      privacy: "unlisted",
      tags: ["uji", "dalang"],
    });
    expect((await getProject(studio)).renders[0]?.published).toMatchObject({
      url: "https://youtu.be/vid-2",
      privacy: "unlisted",
    });
  });

  it("berkas di luar folder render ditolak 400, yang tidak ada 404, tujuan tak dikenal 400", async () => {
    const { studio } = boot(fakeTarget());
    const traversal = await post(studio, "/api/publish", {
      file: "../plan.json",
      confirm: true,
    });
    expect(traversal.status).toBe(400);
    const missing = await post(studio, "/api/publish", {
      file: "tidak-ada.mp4",
      confirm: true,
    });
    expect(missing.status).toBe(404);
    await renderDraft(studio);
    const unknown = await post(studio, "/api/publish", {
      file: "preview.mp4",
      targetId: "tiktok",
      confirm: true,
    });
    expect(unknown.status).toBe(400);
    expect(String(unknown.body.error)).toContain("tiktok");
  });

  it("satu unggahan pada satu waktu (409), bisa dibatalkan, dan kegagalan jadi event error tanpa tautan", async () => {
    const target = fakeTarget({ delayMs: 40 });
    const { studio } = boot(target);
    await renderDraft(studio);
    const events = publishEvents(studio);
    const first = await post(studio, "/api/publish", {
      file: "preview.mp4",
      confirm: true,
    });
    expect(first.status).toBe(202);
    const busy = await post(studio, "/api/publish", {
      file: "preview.mp4",
      confirm: true,
    });
    expect(busy.status).toBe(409);
    expect((await getProject(studio)).publish.job).toMatchObject({ file: "preview.mp4" });

    const cancel = await callJson<{ cancelled: boolean }>(studio, "/api/publish/cancel", {
      method: "POST",
    });
    expect(cancel.body.cancelled).toBe(true);
    expect((await events).at(-1)).toMatchObject({ status: "error", error: "dibatalkan" });
    const after = await getProject(studio);
    expect(after.publish.job).toBeNull();
    expect(after.renders[0]?.published).toBeUndefined();

    const other = boot(fakeTarget({ fail: true }));
    await renderDraft(other.studio);
    const failEvents = publishEvents(other.studio);
    await post(other.studio, "/api/publish", { file: "preview.mp4", confirm: true });
    const failed = (await failEvents).at(-1);
    expect(failed).toMatchObject({ status: "error" });
    expect(failed?.error).toContain("kuota");
    expect(failed?.url).toBeUndefined();
  });
});
