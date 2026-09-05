import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  defaultPublishMetadata,
  PUBLISH_DESCRIPTION_MAX,
  PUBLISH_PRIVACIES,
  PUBLISH_PRIVACY_LABEL,
  PUBLISH_TITLE_MAX,
  type PublishMetadata,
} from "@dalang/core";
import { publishRender } from "@dalang/pipeline";
import { PUBLISH_SETUP_HINT } from "@dalang/providers";
import type { Hono } from "hono";
import { z } from "zod";
import type {
  NeedsConfirmation,
  PublishJobLite,
  PublishTargetLite,
  StudioEvent,
} from "../shared/api-types";
import type { StudioContext, StudioDeps } from "./context";

/**
 * Publikasi langsung (ADR-0030): satu berkas render -> satu tujuan
 * (YouTube). Tiga hal yang membedakannya dari render:
 *  - TIDAK BISA DIURUNGKAN, jadi selalu lewat gerbang 428 — dialog
 *    judul/deskripsi/privasi di UI adalah konfirmasinya, dan bawaannya privat;
 *  - jalan di latar seperti render: 202 segera, kemajuan lewat SSE `publish`,
 *    bisa dibatalkan di antara potongan unggahan;
 *  - dikunci di ledger: berkas yang sama ke tujuan yang sama tidak diunggah
 *    dua kali kecuali `force` — dua video di kanal orang bukan hal sepele.
 */

const publishBody = z.object({
  file: z.string().min(1),
  targetId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(PUBLISH_TITLE_MAX).optional(),
  description: z.string().max(PUBLISH_DESCRIPTION_MAX).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  privacy: z.enum(PUBLISH_PRIVACIES).optional(),
  force: z.boolean().optional(),
  confirm: z.boolean().optional(),
});

export const RENDERS_URL_PREFIX = "/.dalang/renders/";

/**
 * Nama berkas render dari nama polos atau URL web-nya (`/.dalang/renders/x`).
 * null bila mencoba keluar folder render — path traversal ditolak di sini,
 * bukan diandalkan pada existsSync.
 */
export const renderFileName = (raw: string): string | null => {
  const stripped = raw.startsWith(RENDERS_URL_PREFIX)
    ? raw.slice(RENDERS_URL_PREFIX.length)
    : raw;
  const name = basename(stripped);
  if (name === "" || name === "." || name === ".." || name !== stripped) return null;
  return name;
};

/** Daftar tujuan untuk UI, dengan petunjuk jujur bila kosong. */
export const publishTargetsOf = (
  deps: StudioDeps,
): { targets: PublishTargetLite[]; hint: string | null } => {
  const targets = (deps.publishTargets?.() ?? []).map((target) => ({
    id: target.id,
    label: target.label,
  }));
  return { targets, hint: targets.length === 0 ? PUBLISH_SETUP_HINT : null };
};

type PublishEventBody = Omit<
  Extract<StudioEvent, { type: "publish" }>,
  "type" | "file" | "target"
>;

export const registerPublishRoutes = (app: Hono, ctx: StudioContext): void => {
  const { store, deps } = ctx;
  const { session } = store;
  let active: AbortController | null = null;

  app.get("/api/publish/targets", (c) => c.json({ ok: true, ...publishTargetsOf(deps) }));

  app.post("/api/publish/cancel", (c) => {
    const cancelled = active !== null;
    active?.abort();
    return c.json({ ok: true, cancelled });
  });

  app.post("/api/publish", async (c) => {
    const body = publishBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(
        {
          error:
            "Body tidak valid: { file, targetId?, title?, description?, tags?, privacy?, force?, confirm? }",
        },
        400,
      );
    }
    const targets = deps.publishTargets?.() ?? [];
    if (targets.length === 0) return c.json({ error: PUBLISH_SETUP_HINT }, 400);
    const target = body.data.targetId
      ? targets.find((candidate) => candidate.id === body.data.targetId)
      : targets[0];
    if (!target) {
      return c.json(
        { error: `Tujuan publikasi tidak dikenal: ${body.data.targetId}` },
        400,
      );
    }
    const name = renderFileName(body.data.file);
    if (!name) return c.json({ error: "Nama berkas render tidak valid" }, 400);
    const filePath = join(session.paths.dalangDir, "renders", name);
    if (!existsSync(filePath)) {
      return c.json({ error: `Berkas render tidak ditemukan: ${name}` }, 404);
    }
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);

    const { title, description, tags, privacy, force = false } = body.data;
    const metadata: PublishMetadata = {
      ...defaultPublishMetadata(plan),
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(privacy !== undefined ? { privacy } : {}),
    };
    const detail = `Unggah ${name} ke ${target.label} sebagai ${PUBLISH_PRIVACY_LABEL[metadata.privacy]}: "${metadata.title}"`;
    if (!body.data.confirm) {
      const payload: NeedsConfirmation = {
        needsConfirmation: true,
        detail,
        estimatedUsd: null,
      };
      return c.json(payload, 428);
    }
    if (store.publishJob) {
      return c.json(
        { error: `Sedang mengunggah ${store.publishJob.file} — tunggu sampai selesai` },
        409,
      );
    }

    const controller = new AbortController();
    active = controller;
    const job: PublishJobLite = { file: name, target: target.id, fraction: 0 };
    store.publishJob = job;
    const emit = (event: PublishEventBody) =>
      store.bus.emit({ type: "publish", file: name, target: target.id, ...event });
    emit({ status: "started", fraction: 0 });

    let lastFraction = 0;
    const startedAt = Date.now();
    void publishRender({
      paths: session.paths,
      db: session.db,
      projectId: session.projectId,
      target,
      filePath,
      metadata,
      force,
      signal: controller.signal,
      onProgress: (fraction) => {
        // Potongan 8 MiB pada berkas besar = ratusan event; cukup tiap 2%.
        if (fraction < 1 && fraction - lastFraction < 0.02) return;
        lastFraction = fraction;
        store.publishJob = { ...job, fraction };
        emit({ status: "progress", fraction });
      },
    })
      .then((outcome) => {
        session.events.record({
          turn: session.turn,
          kind: "tool",
          name: "ui:publish",
          input: { file: name, target: target.id, privacy: metadata.privacy, force },
          output:
            outcome.status === "error"
              ? { error: outcome.reason }
              : { status: outcome.status, url: outcome.record.url },
          costUsd: 0,
          durationMs: Date.now() - startedAt,
        });
        if (outcome.status === "error") {
          emit({ status: "error", error: outcome.reason });
          return;
        }
        emit({
          status: "done",
          fraction: 1,
          url: outcome.record.url,
          cached: outcome.status === "cached",
        });
      })
      .catch((error: unknown) => {
        emit({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        store.publishJob = null;
        if (active === controller) active = null;
      });

    return c.json(
      { ok: true, started: true, file: name, target: target.id, detail },
      202,
    );
  });
};
