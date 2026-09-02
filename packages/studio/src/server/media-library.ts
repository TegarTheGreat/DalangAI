import { stickerKey } from "@dalang/agent";
import {
  GRAPHIC_ANCHORS,
  GRAPHIC_ANIMS,
  idSlug,
  setGraphicAsset,
  setSfxAsset,
  uniqueGraphicId,
  uniqueSfxCueId,
} from "@dalang/core";
import type { Hono } from "hono";
import { z } from "zod";
import type {
  IconCandidateLite,
  SfxCandidateLite,
  StickerCandidateLite,
} from "../shared/api-types";
import type { StudioContext } from "./context";
import { StudioBusyError } from "./store";

/**
 * Rute pustaka media (ADR-0018): ikon, stiker, dan efek suara untuk panel
 * manual Studio.
 *
 * Kenapa ada sama sekali, padahal agent sudah punya tool untuk ketiganya:
 * tool agent butuh API key model. Tanpa key, chat mati — dan kalau pustaka
 * media hanya hidup di sana, seluruh fitur ini ikut mati bersamanya. Ikon dan
 * efek suara justru TIDAK butuh kunci apa pun, jadi menguncinya di balik chat
 * akan menjadikannya berbayar tanpa alasan.
 *
 * Pemasangannya memakai jalur yang sama persis dengan panel manual lain:
 * berkas ditulis ke folder proyek, renderState diisi lewat helper, lalu SATU
 * patch USER — sehingga bisa di-undo dan terlihat agent di giliran berikutnya
 * (PRD §5.2 dua arah).
 */

const MAX_ICON_RESULTS = 24;
const MAX_STICKER_RESULTS = 12;
const MAX_SFX_RESULTS = 10;

/** Bagian penempatan yang dipakai ikon maupun stiker. */
const placementBody = {
  sceneId: z.string().min(1),
  anchor: z.enum(GRAPHIC_ANCHORS).default("kanan-bawah"),
  size: z.number().min(0.02).max(0.6).default(0.14),
  anim: z.enum(GRAPHIC_ANIMS).default("pop"),
};

const iconAddBody = z.object({
  ...placementBody,
  iconId: z.string().min(3),
  /** null = warna aksen preset. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
});

const stickerAddBody = z.object({
  ...placementBody,
  query: z.string().min(2),
  index: z.number().int().min(0),
  size: z.number().min(0.02).max(0.6).default(0.2),
});

const sfxAddBody = z.object({
  sceneId: z.string().min(1),
  assetId: z.string().min(1),
  atSec: z.number().min(0).default(0),
  volume: z.number().min(0).max(1).default(0.6),
});

const errorPayload = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
});

export const registerMediaLibraryRoutes = (app: Hono, ctx: StudioContext): void => {
  const { store, deps } = ctx;
  const { session } = store;

  const requireScene = (sceneId: string) => {
    const plan = session.plan;
    if (!plan) return { error: "Proyek belum punya scene-plan" } as const;
    const scene = plan.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) return { error: `Scene ${sceneId} tidak ada` } as const;
    if (scene.locked) return { error: "Scene terkunci" } as const;
    if (scene.graphics.length >= 4) {
      return { error: "Scene sudah punya 4 grafis (batas maksimum)" } as const;
    }
    return { plan, scene } as const;
  };

  // -------------------------------------------------------------------------
  // Ikon (Iconify) — tanpa kunci API
  // -------------------------------------------------------------------------

  app.get("/api/icons/search", async (c) => {
    const query = c.req.query("query")?.trim() ?? "";
    if (query.length < 2) return c.json({ error: "query terlalu pendek" }, 400);
    try {
      const found = await deps.iconProvider().search(query, MAX_ICON_RESULTS);
      const icons: IconCandidateLite[] = found.map((icon) => ({
        iconId: icon.iconId,
        setName: icon.setName,
        license: icon.license,
        needsAttribution: icon.needsAttribution,
      }));
      return c.json({ ok: true, provider: "iconify", query, icons });
    } catch (error) {
      return c.json(errorPayload(error), 502);
    }
  });

  /**
   * Pratinjau ikon. Diproksi lewat server, bukan diambil langsung browser:
   * satu jalur jaringan untuk seluruh aplikasi, dan pratinjau tetap bekerja di
   * lingkungan yang membatasi permintaan lintas-asal dari halaman.
   */
  app.get("/api/icons/svg", async (c) => {
    const id = c.req.query("id")?.trim() ?? "";
    const color = c.req.query("color")?.trim();
    if (!/^[a-z0-9-]+:[a-z0-9-]+$/i.test(id)) {
      return c.json({ error: "id ikon tidak sah" }, 400);
    }
    try {
      const svg = await deps
        .iconProvider()
        .fetchSvg(id, { ...(color ? { color } : {}), height: 96 });
      return c.body(svg, 200, {
        "content-type": "image/svg+xml; charset=utf-8",
        // Ikon tidak berubah; cache pendek sudah cukup meredam scroll grid.
        "cache-control": "public, max-age=600",
      });
    } catch (error) {
      return c.json(errorPayload(error), 502);
    }
  });

  app.post("/api/graphics/icon", async (c) => {
    const body = iconAddBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const found = requireScene(body.data.sceneId);
    if ("error" in found) return c.json({ error: found.error }, 400);

    const startedAt = Date.now();
    try {
      const svg = await deps.iconProvider().fetchSvg(body.data.iconId, {
        ...(body.data.color ? { color: body.data.color } : {}),
      });
      const result = await store.runExclusive("pick", async () => {
        const plan = store.freshPlan();
        if (!plan) throw new Error("Plan hilang di tengah pemasangan ikon");
        const scene = plan.scenes.find((s) => s.id === body.data.sceneId);
        if (!scene) throw new Error(`Scene ${body.data.sceneId} tidak ada`);
        const file = await deps.saveMedia(session.paths.planPath, {
          url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
          folder: "icons",
          // Warna ikut nama: SVG yang diwarnai berbeda ISI-nya per warna.
          name: idSlug(
            `${body.data.iconId}${body.data.color ? `-${body.data.color}` : ""}`,
          ),
          fileExt: "svg",
        });
        const graphicId = uniqueGraphicId(plan, `ikon-${body.data.iconId}`);
        session.plan = setGraphicAsset(plan, graphicId, {
          file,
          kind: "image",
          source: "iconify",
          license: "pustaka ikon terbuka (disaring aman-komersial)",
        });
        const { summary } = session.applyUserPatch([
          {
            op: "updateScene",
            id: body.data.sceneId,
            patch: {
              graphics: [
                ...scene.graphics,
                {
                  id: graphicId,
                  ref: `iconify:${body.data.iconId}`,
                  anchor: body.data.anchor,
                  size: body.data.size,
                  offsetX: 0,
                  offsetY: 0,
                  rotate: 0,
                  opacity: 1,
                  color: body.data.color,
                  anim: body.data.anim,
                  startFrac: 0,
                  endFrac: 1,
                },
              ],
            },
          },
        ]);
        return { graphicId, file, summary };
      });
      session.events.record({
        turn: session.turn,
        kind: "tool",
        name: "ui:addIcon",
        input: { sceneId: body.data.sceneId, iconId: body.data.iconId },
        output: { graphicId: result.graphicId, file: result.file },
        costUsd: 0,
        durationMs: Date.now() - startedAt,
      });
      store.notifyPlan("pick");
      return c.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 400);
    }
  });

  // -------------------------------------------------------------------------
  // Stiker (GIPHY/Tenor) — butuh kunci; hak pakainya perlu diperiksa
  // -------------------------------------------------------------------------

  app.get("/api/stickers/search", async (c) => {
    const query = c.req.query("query")?.trim() ?? "";
    if (query.length < 2) return c.json({ error: "query terlalu pendek" }, 400);
    const chain = deps.stickerChain();
    if (chain.length === 0) {
      return c.json(
        {
          error:
            "Tidak ada provider stiker — set GIPHY_API_KEY atau TENOR_API_KEY. Ikon (Iconify) tidak butuh kunci dan lisensinya jelas.",
        },
        400,
      );
    }
    for (const provider of chain) {
      try {
        const candidates = await provider.search({
          query,
          kind: "image",
          orientation: "square",
          perPage: MAX_STICKER_RESULTS,
        });
        if (candidates.length === 0) continue;
        // Ingatan pencarian dibagi dengan agent: apa yang dicari di UI bisa
        // dipasang agent, dan sebaliknya.
        session.lastSearches.set(stickerKey(query), candidates);
        const stickers: StickerCandidateLite[] = candidates.map((candidate, index) => ({
          index,
          assetId: candidate.assetId,
          width: candidate.width,
          height: candidate.height,
          license: candidate.license,
          thumbnailUrl: candidate.thumbnailUrl ?? null,
        }));
        return c.json({ ok: true, provider: provider.id, query, stickers });
      } catch {
        // provider gagal -> coba berikutnya (pola chain yang sama dengan stock)
      }
    }
    return c.json({ error: `Tidak ada stiker untuk "${query}"` }, 404);
  });

  app.post("/api/graphics/sticker", async (c) => {
    const body = stickerAddBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const found = requireScene(body.data.sceneId);
    if ("error" in found) return c.json({ error: found.error }, 400);

    const candidates = session.lastSearches.get(stickerKey(body.data.query));
    const candidate = candidates?.[body.data.index];
    if (!candidate) {
      return c.json(
        { error: `Stiker untuk "${body.data.query}" tidak ada lagi — cari ulang` },
        400,
      );
    }

    const startedAt = Date.now();
    try {
      const result = await store.runExclusive("pick", async () => {
        const plan = store.freshPlan();
        if (!plan) throw new Error("Plan hilang di tengah pemasangan stiker");
        const scene = plan.scenes.find((s) => s.id === body.data.sceneId);
        if (!scene) throw new Error(`Scene ${body.data.sceneId} tidak ada`);
        const graphicId = uniqueGraphicId(plan, `stiker-${body.data.sceneId}`);
        const file = await deps.saveMedia(session.paths.planPath, {
          url: candidate.downloadUrl,
          folder: "stickers",
          name: graphicId,
          fileExt: candidate.fileExt,
        });
        session.plan = setGraphicAsset(plan, graphicId, {
          file,
          kind: "image",
          source: candidate.providerId,
          license: candidate.license,
          ...(candidate.author ? { author: candidate.author } : {}),
          ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
        });
        const { summary } = session.applyUserPatch([
          {
            op: "updateScene",
            id: body.data.sceneId,
            patch: {
              graphics: [
                ...scene.graphics,
                {
                  id: graphicId,
                  ref: candidate.assetId,
                  anchor: body.data.anchor,
                  size: body.data.size,
                  offsetX: 0,
                  offsetY: 0,
                  rotate: 0,
                  opacity: 1,
                  color: null,
                  anim: body.data.anim,
                  startFrac: 0,
                  endFrac: 1,
                },
              ],
            },
          },
        ]);
        return { graphicId, file, summary };
      });
      session.events.record({
        turn: session.turn,
        kind: "tool",
        name: "ui:addSticker",
        input: { sceneId: body.data.sceneId, assetId: candidate.assetId },
        output: { graphicId: result.graphicId, license: candidate.license },
        costUsd: 0,
        durationMs: Date.now() - startedAt,
      });
      store.notifyPlan("pick");
      return c.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 400);
    }
  });

  // -------------------------------------------------------------------------
  // Efek suara (Openverse) — tanpa kunci
  // -------------------------------------------------------------------------

  app.get("/api/sfx/search", async (c) => {
    const query = c.req.query("query")?.trim() ?? "";
    if (query.length < 2) return c.json({ error: "query terlalu pendek" }, 400);
    const chain = deps.sfxChain();
    if (chain.length === 0)
      return c.json({ error: "Tidak ada provider efek suara" }, 400);
    for (const provider of chain) {
      try {
        const found = await provider.search(query, MAX_SFX_RESULTS);
        if (found.length === 0) continue;
        // assetId Openverse adalah UUID — tidak bisa dicari ulang sebagai kata
        // kunci, jadi kandidatnya HARUS diingat agar pemasangan punya URL-nya.
        for (const sfx of found) session.lastSfxCandidates.set(sfx.assetId, sfx);
        const sounds: SfxCandidateLite[] = found.map((sfx) => ({
          assetId: sfx.assetId,
          title: sfx.title,
          durationSec: sfx.durationSec ?? null,
          license: sfx.license,
          author: sfx.author ?? null,
        }));
        return c.json({ ok: true, provider: provider.id, query, sounds });
      } catch {
        // provider gagal -> coba berikutnya
      }
    }
    return c.json({ error: `Tidak ada efek suara untuk "${query}"` }, 404);
  });

  app.post("/api/sfx/add", async (c) => {
    const body = sfxAddBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan0 = session.plan;
    if (!plan0) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    if (!plan0.scenes.some((scene) => scene.id === body.data.sceneId)) {
      return c.json({ error: `Scene ${body.data.sceneId} tidak ada` }, 400);
    }
    if (plan0.audio.sfx.length >= 24) {
      return c.json({ error: "Sudah ada 24 efek suara (batas maksimum)" }, 400);
    }
    const candidate = session.lastSfxCandidates.get(body.data.assetId);
    if (!candidate) {
      return c.json(
        {
          error: `Efek suara ${body.data.assetId} tidak ada di hasil pencarian — cari ulang`,
        },
        400,
      );
    }

    const startedAt = Date.now();
    try {
      const result = await store.runExclusive("pick", async () => {
        const plan = store.freshPlan();
        if (!plan) throw new Error("Plan hilang di tengah pemasangan efek suara");
        const cueId = uniqueSfxCueId(plan, `sfx-${body.data.sceneId}`);
        const file = await deps.saveMedia(session.paths.planPath, {
          url: candidate.downloadUrl,
          folder: "sfx",
          name: cueId,
          fileExt: candidate.fileExt,
        });
        session.plan = setSfxAsset(plan, cueId, {
          file,
          kind: "audio",
          source: candidate.providerId,
          license: candidate.license,
          ...(candidate.author ? { author: candidate.author } : {}),
          ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
        });
        const { summary } = session.applyUserPatch([
          {
            op: "setAudio",
            patch: {
              sfx: [
                ...plan.audio.sfx,
                {
                  id: cueId,
                  assetId: candidate.assetId,
                  sceneId: body.data.sceneId,
                  atSec: body.data.atSec,
                  volume: body.data.volume,
                },
              ],
            },
          },
        ]);
        return { cueId, file, summary };
      });
      session.events.record({
        turn: session.turn,
        kind: "tool",
        name: "ui:addSfx",
        input: { sceneId: body.data.sceneId, assetId: body.data.assetId },
        output: { cueId: result.cueId, license: candidate.license },
        costUsd: 0,
        durationMs: Date.now() - startedAt,
      });
      store.notifyPlan("pick");
      return c.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 400);
    }
  });
};
