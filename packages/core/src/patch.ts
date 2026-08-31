import { z } from "zod";
import {
  annotationSchema,
  aspectRatioSchema,
  captionPositionSchema,
  designTokensSchema,
  getSceneIndex,
  graphicSchema,
  MAX_LAYERS,
  type Meta,
  metaSchema,
  motionSchema,
  musicSchema,
  type Scene,
  type ScenePlan,
  scenePlanSchema,
  sceneSchema,
  sfxCueSchema,
  textOverlaySchema,
  textSizeSchema,
  transitionSchema,
  videoLayerSchema,
  visualFilterSchema,
  visualTypeSchema,
  voiceSchema,
} from "./scene-plan";

/**
 * Patch operations — the ONLY way the creative document is mutated, by agent
 * and UI alike (PRD §5.2). Never a full rewrite.
 *
 * Guard rules are enforced here, at the code level, not via prompt:
 *  - `locked` scenes reject agent-origin updateScene/removeScene/replaceAsset.
 *  - Agent-origin reorder may not move a locked scene to another index.
 *  - `lockScene` is user-only (PRD §5.2: "hanya dari UI/user, bukan agent").
 *
 * Every applied patch carries its inverse ops, which gives undo/redo for free
 * (lightweight event sourcing).
 */

export type PatchOrigin = "user" | "agent";

const finitePositive = z.number().positive().finite();

// ---------------------------------------------------------------------------
// Update payload schemas (explicit partials — deep partials hide typos)
// ---------------------------------------------------------------------------

/**
 * Creative fields of a scene that updateScene may touch.
 * `id` is immutable; `locked` only changes via lockScene; `visual.assetId` /
 * `visual.pinned` only change via replaceAsset — one invariant per op.
 * `null` clears an optional field.
 */
export const sceneUpdateSchema = z.strictObject({
  narration: z.string().optional(),
  duration: z.union([z.literal("auto"), finitePositive]).optional(),
  visual: z
    .strictObject({
      type: visualTypeSchema.optional(),
      query: z.string().nullable().optional(),
      motion: motionSchema.optional(),
      variant: z.string().nullable().optional(),
      /** `null` menghapus filter (kembali netral). */
      filter: visualFilterSchema.nullable().optional(),
      /** ADR-0015. */
      speed: z.number().min(0.25).max(4).optional(),
      /** ADR-0017: titik masuk di aset video sumber. */
      trimStartSec: z.number().min(0).finite().optional(),
      flipH: z.boolean().optional(),
      focusX: z.number().min(0).max(1).optional(),
      focusY: z.number().min(0).max(1).optional(),
      /** ADR-0025: gain audio aset video; 0 = bisu. */
      volume: z.number().min(0).max(1).optional(),
    })
    .optional(),
  caption: z
    .strictObject({
      enabled: z.boolean().optional(),
      style: z.string().optional(),
      /** ADR-0016. */
      size: textSizeSchema.optional(),
      position: captionPositionSchema.optional(),
    })
    .optional(),
  /** Transisi keluar scene (ADR-0011). */
  transition: transitionSchema.optional(),
  /** Replaces the whole array (ADR-0011). */
  texts: z.array(textOverlaySchema).max(3).optional(),
  /** Replaces the whole array. */
  annotations: z.array(annotationSchema).optional(),
  /** Menggantikan seluruh larik grafis tempelan (ADR-0018). */
  graphics: z.array(graphicSchema).max(4).optional(),
  /**
   * Menggantikan seluruh larik lapisan video (ADR-0025).
   *
   * `visual.assetId`/`visual.pinned` di dalam lapisan MEMANG ikut terganti di
   * sini — berbeda dari visual dasar, yang asetnya hanya boleh lewat
   * `replaceAsset`. Alasannya bukan kelonggaran: menambah dan membuang lapisan
   * adalah operasi larik, dan lapisan yang baru dibuat belum punya aset sama
   * sekali, jadi memaksa dua op untuk satu tindakan hanya membuat undo
   * setengah jalan. Untuk MENGGANTI aset lapisan yang sudah ada, `replaceAsset`
   * dengan `layerId` tetap jalur yang benar.
   */
  layers: z.array(videoLayerSchema).max(MAX_LAYERS).optional(),
});
export type SceneUpdate = z.infer<typeof sceneUpdateSchema>;

export const metaUpdateSchema = z.strictObject({
  title: z.string().min(1).optional(),
  aspectRatio: aspectRatioSchema.optional(),
  targetDuration: z.union([z.literal("auto"), finitePositive]).optional(),
  language: z.string().optional(),
  stylePreset: z.string().optional(),
  /** ADR-0017: format konten yang memilih resep struktur. */
  format: z.string().optional(),
  tokens: designTokensSchema.nullable().optional(),
});
export type MetaUpdate = z.infer<typeof metaUpdateSchema>;

export const audioUpdateSchema = z.strictObject({
  voice: voiceSchema.nullable().optional(),
  music: musicSchema.nullable().optional(),
  /** Menggantikan seluruh larik cue efek suara (ADR-0018). */
  sfx: z.array(sfxCueSchema).max(24).optional(),
});
export type AudioUpdate = z.infer<typeof audioUpdateSchema>;

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

export const patchOpSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("addScene"),
    /** Insert after this scene id; `null` inserts at the start. */
    afterId: z.string().nullable(),
    scene: sceneSchema,
  }),
  z.strictObject({ op: z.literal("removeScene"), id: z.string() }),
  z.strictObject({
    op: z.literal("updateScene"),
    id: z.string(),
    patch: sceneUpdateSchema,
  }),
  z.strictObject({
    op: z.literal("reorderScenes"),
    /** Must be a permutation of the current scene ids. */
    order: z.array(z.string()).min(1),
  }),
  z.strictObject({ op: z.literal("setMeta"), patch: metaUpdateSchema }),
  z.strictObject({ op: z.literal("setAudio"), patch: audioUpdateSchema }),
  z.strictObject({
    op: z.literal("lockScene"),
    id: z.string(),
    locked: z.boolean(),
  }),
  z.strictObject({
    op: z.literal("replaceAsset"),
    sceneId: z.string(),
    /**
     * Menyasar satu LAPISAN di dalam scene, bukan visual dasarnya (ADR-0025).
     * Kosong/null = visual dasar, persis perilaku sebelum lapisan ada.
     */
    layerId: z.string().nullable().optional(),
    /** `null` clears the asset (back to unresolved). */
    assetId: z.string().nullable(),
    /** Defaults to true when setting an asset, false when clearing. */
    pinned: z.boolean().optional(),
  }),
]);
export type PatchOp = z.infer<typeof patchOpSchema>;
export type PatchOpInput = z.input<typeof patchOpSchema>;

export type PatchErrorCode =
  | "INVALID_OP"
  | "SCENE_NOT_FOUND"
  | "SCENE_EXISTS"
  | "SCENE_LOCKED"
  | "LOCK_FORBIDDEN"
  | "LAST_SCENE"
  | "BAD_REORDER"
  | "LAYER_NOT_FOUND"
  | "PLAN_INVALID";

export class PatchError extends Error {
  readonly code: PatchErrorCode;
  readonly opIndex: number;

  constructor(code: PatchErrorCode, message: string, opIndex: number) {
    super(message);
    this.name = "PatchError";
    this.code = code;
    this.opIndex = opIndex;
  }
}

export interface AppliedPatch {
  origin: PatchOrigin;
  at: string; // ISO timestamp
  ops: PatchOp[];
  /** Ops that revert this patch, already in application order. */
  inverse: PatchOp[];
  /** Human-readable summary (Bahasa Indonesia) for diff UI & agent context. */
  summary: string;
}

export interface ApplyOptions {
  origin: PatchOrigin;
  /**
   * Guard enforcement. Only undo/redo replay may disable it — a lock added
   * after an edit must never block undoing that edit.
   */
  enforce?: boolean;
  now?: () => Date;
}

export interface ApplyResult {
  plan: ScenePlan;
  applied: AppliedPatch;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clone = <T>(value: T): T => structuredClone(value);

const requireScene = (
  plan: ScenePlan,
  id: string,
  opIndex: number,
): { scene: Scene; index: number } => {
  const index = getSceneIndex(plan, id);
  const scene = plan.scenes[index];
  if (index < 0 || !scene) {
    throw new PatchError("SCENE_NOT_FOUND", `Scene "${id}" tidak ditemukan`, opIndex);
  }
  return { scene, index };
};

const assertNotLockedForAgent = (
  scene: Scene,
  origin: PatchOrigin,
  enforce: boolean,
  opIndex: number,
) => {
  if (enforce && origin === "agent" && scene.locked) {
    throw new PatchError(
      "SCENE_LOCKED",
      `Scene "${scene.id}" terkunci oleh user — agent tidak boleh memodifikasinya`,
      opIndex,
    );
  }
};

/** Merge `patch` keys into `target`; `null` clears optional keys; `undefined` keys are skipped. */
const mergeDefined = <T extends Record<string, unknown>>(
  target: T,
  patch: Record<string, unknown>,
): void => {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      delete (target as Record<string, unknown>)[key];
    } else {
      (target as Record<string, unknown>)[key] = value;
    }
  }
};

/** Prior values of the keys a patch touches, with `null` for keys that were absent. */
const priorOf = (
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> => {
  const prior: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    prior[key] = target[key] === undefined ? null : clone(target[key]);
  }
  return prior;
};

// ---------------------------------------------------------------------------
// Op application (mutates the working copy, returns the inverse op)
// ---------------------------------------------------------------------------

const applyOne = (
  plan: ScenePlan,
  op: PatchOp,
  origin: PatchOrigin,
  enforce: boolean,
  opIndex: number,
): PatchOp => {
  switch (op.op) {
    case "addScene": {
      if (getSceneIndex(plan, op.scene.id) >= 0) {
        throw new PatchError("SCENE_EXISTS", `Scene "${op.scene.id}" sudah ada`, opIndex);
      }
      let insertAt = 0;
      if (op.afterId !== null) {
        insertAt = requireScene(plan, op.afterId, opIndex).index + 1;
      }
      plan.scenes.splice(insertAt, 0, clone(op.scene));
      return { op: "removeScene", id: op.scene.id };
    }

    case "removeScene": {
      const { scene, index } = requireScene(plan, op.id, opIndex);
      assertNotLockedForAgent(scene, origin, enforce, opIndex);
      if (plan.scenes.length === 1) {
        throw new PatchError(
          "LAST_SCENE",
          "Scene terakhir tidak bisa dihapus — sebuah plan minimal punya satu scene",
          opIndex,
        );
      }
      plan.scenes.splice(index, 1);
      const prevId = index > 0 ? (plan.scenes[index - 1]?.id ?? null) : null;
      return { op: "addScene", afterId: prevId, scene: clone(scene) };
    }

    case "updateScene": {
      const { scene } = requireScene(plan, op.id, opIndex);
      assertNotLockedForAgent(scene, origin, enforce, opIndex);

      const inversePatch: Record<string, unknown> = {};
      const { visual, caption, ...rest } = op.patch;

      for (const [key, value] of Object.entries(rest)) {
        if (value === undefined) continue;
        inversePatch[key] = clone((scene as unknown as Record<string, unknown>)[key]);
        (scene as unknown as Record<string, unknown>)[key] = clone(value);
      }
      if (visual) {
        inversePatch.visual = priorOf(
          scene.visual as unknown as Record<string, unknown>,
          visual,
        );
        mergeDefined(scene.visual as unknown as Record<string, unknown>, visual);
      }
      if (caption) {
        inversePatch.caption = priorOf(
          scene.caption as unknown as Record<string, unknown>,
          caption,
        );
        mergeDefined(scene.caption as unknown as Record<string, unknown>, caption);
      }
      return {
        op: "updateScene",
        id: op.id,
        patch: inversePatch as SceneUpdate,
      };
    }

    case "reorderScenes": {
      const currentIds = plan.scenes.map((scene) => scene.id);
      const sameMembers =
        op.order.length === currentIds.length &&
        new Set(op.order).size === op.order.length &&
        op.order.every((id) => currentIds.includes(id));
      if (!sameMembers) {
        throw new PatchError(
          "BAD_REORDER",
          "reorderScenes harus berupa permutasi dari semua scene id yang ada",
          opIndex,
        );
      }
      if (enforce && origin === "agent") {
        for (const scene of plan.scenes) {
          if (!scene.locked) continue;
          const from = currentIds.indexOf(scene.id);
          const to = op.order.indexOf(scene.id);
          if (from !== to) {
            throw new PatchError(
              "SCENE_LOCKED",
              `Scene "${scene.id}" terkunci — agent tidak boleh memindahkannya (posisi ${from + 1} → ${to + 1})`,
              opIndex,
            );
          }
        }
      }
      const byId = new Map(plan.scenes.map((scene) => [scene.id, scene]));
      plan.scenes = op.order.map((id) => byId.get(id) as Scene);
      return { op: "reorderScenes", order: currentIds };
    }

    case "setMeta": {
      const prior = priorOf(plan.meta as unknown as Record<string, unknown>, op.patch);
      mergeDefined(plan.meta as unknown as Record<string, unknown>, op.patch);
      // Required meta keys can never be cleared; re-validate to be safe.
      const check = metaSchema.safeParse(plan.meta);
      if (!check.success) {
        throw new PatchError(
          "PLAN_INVALID",
          `setMeta menghasilkan meta yang tidak valid: ${z.prettifyError(check.error)}`,
          opIndex,
        );
      }
      plan.meta = check.data as Meta;
      return { op: "setMeta", patch: prior as MetaUpdate };
    }

    case "setAudio": {
      const prior = priorOf(plan.audio as unknown as Record<string, unknown>, op.patch);
      mergeDefined(plan.audio as unknown as Record<string, unknown>, op.patch);
      return { op: "setAudio", patch: prior as AudioUpdate };
    }

    case "lockScene": {
      if (enforce && origin === "agent") {
        throw new PatchError(
          "LOCK_FORBIDDEN",
          "lockScene hanya boleh dilakukan user lewat UI, bukan agent",
          opIndex,
        );
      }
      const { scene } = requireScene(plan, op.id, opIndex);
      const prior = scene.locked;
      scene.locked = op.locked;
      return { op: "lockScene", id: op.id, locked: prior };
    }

    case "replaceAsset": {
      const { scene } = requireScene(plan, op.sceneId, opIndex);
      assertNotLockedForAgent(scene, origin, enforce, opIndex);
      // Lapisan dan visual dasar memakai op yang SAMA (ADR-0025): keduanya
      // menjawab pertanyaan identik ("aset mana yang dipakai di sini"), dan
      // op kedua yang isinya sama persis hanya menggandakan aturan pin/lock
      // di dua tempat yang harus tetap seragam selamanya.
      const target =
        op.layerId == null
          ? scene.visual
          : scene.layers.find((layer) => layer.id === op.layerId)?.visual;
      if (!target) {
        throw new PatchError(
          "LAYER_NOT_FOUND",
          `Lapisan "${op.layerId}" tidak ada di scene "${op.sceneId}"`,
          opIndex,
        );
      }
      const priorAssetId = target.assetId;
      const priorPinned = target.pinned;
      target.assetId = op.assetId;
      target.pinned = op.pinned ?? op.assetId !== null;
      return {
        op: "replaceAsset",
        sceneId: op.sceneId,
        ...(op.layerId == null ? {} : { layerId: op.layerId }),
        assetId: priorAssetId,
        pinned: priorPinned,
      };
    }
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate and apply a batch of ops atomically: either every op applies and a
 * new plan is returned, or a PatchError is thrown and the original plan is
 * untouched. Ops are validated against `patchOpSchema` first, so this is safe
 * to expose directly as the agent's `applyPatch` tool.
 */
export const applyPatch = (
  plan: ScenePlan,
  ops: PatchOpInput[],
  options: ApplyOptions,
): ApplyResult => {
  const { origin, enforce = true, now = () => new Date() } = options;

  const parsedOps = ops.map((op, index) => {
    const result = patchOpSchema.safeParse(op);
    if (!result.success) {
      throw new PatchError(
        "INVALID_OP",
        `Op #${index + 1} tidak valid:\n${z.prettifyError(result.error)}`,
        index,
      );
    }
    return result.data;
  });
  if (parsedOps.length === 0) {
    throw new PatchError("INVALID_OP", "Patch kosong (tidak ada op)", 0);
  }

  const working = clone(plan);
  const inverse: PatchOp[] = [];
  parsedOps.forEach((op, index) => {
    inverse.unshift(applyOne(working, op, origin, enforce, index));
  });

  // Final integrity check — a patch may never leave the document invalid.
  const check = scenePlanSchema.safeParse(working);
  if (!check.success) {
    throw new PatchError(
      "PLAN_INVALID",
      `Patch menghasilkan scene-plan tidak valid:\n${z.prettifyError(check.error)}`,
      parsedOps.length - 1,
    );
  }

  return {
    plan: check.data,
    applied: {
      origin,
      at: now().toISOString(),
      ops: parsedOps,
      inverse,
      summary: describeOps(parsedOps, origin),
    },
  };
};

// ---------------------------------------------------------------------------
// Summaries (Bahasa Indonesia — shown in diff UI and injected into agent context)
// ---------------------------------------------------------------------------

const describeOp = (op: PatchOp): string => {
  switch (op.op) {
    case "addScene":
      return op.afterId === null
        ? `menambah scene ${op.scene.id} di awal`
        : `menambah scene ${op.scene.id} setelah ${op.afterId}`;
    case "removeScene":
      return `menghapus scene ${op.id}`;
    case "updateScene": {
      const fields = Object.entries(op.patch)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key);
      return `mengubah scene ${op.id} (${fields.join(", ") || "tanpa field"})`;
    }
    case "reorderScenes":
      return `mengurutkan ulang scene (${op.order.join(" → ")})`;
    case "setMeta": {
      const fields = Object.keys(op.patch).filter(
        (key) => (op.patch as Record<string, unknown>)[key] !== undefined,
      );
      return `mengubah meta (${fields.join(", ")})`;
    }
    case "setAudio": {
      const fields = Object.keys(op.patch).filter(
        (key) => (op.patch as Record<string, unknown>)[key] !== undefined,
      );
      return `mengubah audio (${fields.join(", ")})`;
    }
    case "lockScene":
      return op.locked ? `mengunci scene ${op.id}` : `membuka kunci scene ${op.id}`;
    case "replaceAsset": {
      const where =
        op.layerId == null
          ? `scene ${op.sceneId}`
          : `lapisan ${op.layerId} (scene ${op.sceneId})`;
      return op.assetId === null
        ? `melepas aset ${where}`
        : `mengganti aset ${where} → ${op.assetId}`;
    }
  }
};

export const describeOps = (ops: PatchOp[], origin: PatchOrigin): string =>
  `${origin}: ${ops.map(describeOp).join("; ")}`;
