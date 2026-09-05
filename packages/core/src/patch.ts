import { z } from "zod";
import {
  type ClipRefusal,
  isRefusal,
  removeClipAt,
  reorderClipsTo,
  splitClipAt,
  type TrimEdge,
  type TrimMode,
  trimClipEdge,
} from "./clips";
import {
  allClips,
  annotationSchema,
  aspectRatioSchema,
  audioTrackSchema,
  type Clip,
  captionPositionSchema,
  clipAudioSchema,
  clipSchema,
  designTokensSchema,
  getSceneIndex,
  graphicSchema,
  MAX_CLIPS,
  MAX_LAYERS,
  type Meta,
  metaSchema,
  motionSchema,
  musicSchema,
  primaryClip,
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
 * `id` is immutable; `locked` only changes via lockScene; `clip.assetId` /
 * `clip.pinned` only change via replaceAsset — one invariant per op.
 * `null` clears an optional field.
 */
export const sceneUpdateSchema = z.strictObject({
  narration: z.string().optional(),
  duration: z.union([z.literal("auto"), finitePositive]).optional(),
  /**
   * Properti satu KLIP (ADR-0033). Dulu bernama `visual`, waktu satu scene
   * hanya punya satu gambar; namanya ikut berganti bersama op klip supaya
   * tidak ada dua kosakata untuk satu benda. Klip mana yang disasar ditentukan
   * `updateScene.clipId` — tanpa itu, klip pertama.
   */
  clip: z
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
      /** ADR-0026: amplop audio klip (volume, fade, ducking, normalisasi). */
      audio: clipAudioSchema.optional(),
      /**
       * Transisi KELUAR ke klip berikutnya di dalam scene (ADR-0033 §6);
       * `null` mengembalikannya ke potong keras, yang jadi bawaannya.
       *
       * Ada di sini, bukan sebagai op sendiri, karena ini properti sebuah
       * klip — sama seperti `motion` dan `filter`. Op klip (belah, geser,
       * buang, urut) mengubah SUSUNAN potongan; yang ini mengubah salah satu
       * potongannya. Tanpa jalan masuk ini, satu-satunya cara menyilangkan
       * dua potongan adalah menulis ulang seluruh daftar lewat `setClips`,
       * dan menuntut pemanggilnya menyusun ulang daftar utuh demi satu field
       * adalah cara termudah kehilangan klip di ujungnya.
       */
      transition: transitionSchema.nullable().optional(),
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
  /** ADR-0026: sasaran kenyaringan klip (LUFS); null mematikan normalisasi. */
  loudnessTarget: z.number().min(-40).max(-5).nullable().optional(),
  tokens: designTokensSchema.nullable().optional(),
});
export type MetaUpdate = z.infer<typeof metaUpdateSchema>;

export const audioUpdateSchema = z.strictObject({
  voice: voiceSchema.nullable().optional(),
  music: musicSchema.nullable().optional(),
  /** Menggantikan seluruh larik cue efek suara (ADR-0018). */
  sfx: z.array(sfxCueSchema).max(24).optional(),
  /** Menggantikan seluruh larik trek audio tambahan (ADR-0026). */
  tracks: z.array(audioTrackSchema).max(8).optional(),
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
    /**
     * Klip yang disasar `patch.clip`; tanpa ini klip PERTAMA (ADR-0033).
     *
     * Duduk di op, bukan di dalam `patch`: `patch` berisi field-field scene,
     * dan "klip yang mana" bukan salah satunya. Invers sebuah updateScene
     * membawa id ini apa adanya — undo yang mendarat di klip lain adalah
     * kerusakan yang jauh lebih sulit dilihat daripada undo yang gagal.
     */
    clipId: z.string().optional(),
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
  // -------------------------------------------------------------------------
  // Op klip (ADR-0033 §5). Aritmetikanya hidup di `clips.ts`; yang di bawah ini
  // cuma jalur masuk, penjagaan kunci, dan invers.
  //
  // INVERS KEEMPATNYA SAMA: `setClips` yang membawa daftar klip SEBELUMNYA apa
  // adanya. Bukan operasi kebalikan yang dihitung ulang — ripple menyentuh
  // banyak klip sekaligus, dan membalikkannya dengan aritmetika terbalik adalah
  // cara halus kehilangan satu klip di ujung. Daftar sebelum-dan-sesudah selalu
  // benar, dan biayanya beberapa ratus byte per langkah undo.
  // -------------------------------------------------------------------------
  z.strictObject({
    op: z.literal("setClips"),
    sceneId: z.string(),
    clips: z.array(clipSchema).min(1).max(MAX_CLIPS),
    /**
     * Durasi scene yang menyertai daftar ini; tanpa ini scene jadi "auto".
     *
     * Keduanya satu fakta (§2): begitu ada dua klip, durasi scene adalah
     * jumlah klipnya, dan begitu klipnya kembali tinggal satu, durasi itu
     * kembali milik scene. Kalau invers cuma membawa daftar klipnya, undo dari
     * belahan pertama akan mengembalikan klipnya tapi kehilangan angka durasi
     * yang dipaku belahan itu.
     */
    duration: z.union([z.literal("auto"), finitePositive]).optional(),
  }),
  z.strictObject({
    op: z.literal("splitClip"),
    sceneId: z.string(),
    clipId: z.string(),
    /** Titik belah, detik dari AWAL KLIP (bukan dari awal scene). */
    atSec: finitePositive,
    /** Id potongan kedua; wajib unik se-plan, sama seperti id klip lain. */
    newClipId: z.string().min(1),
  }),
  z.strictObject({
    op: z.literal("trimClip"),
    sceneId: z.string(),
    clipId: z.string(),
    edge: z.enum(["masuk", "keluar"]),
    /** Bawaannya ripple: yang menyerap adalah panjang scene, bukan tetangga. */
    mode: z.enum(["ripple", "roll"]).default("ripple"),
    /** Geseran tepi di LINIMASA; positif = ke kanan. */
    deltaSec: z.number().finite(),
  }),
  z.strictObject({
    op: z.literal("removeClip"),
    sceneId: z.string(),
    clipId: z.string(),
  }),
  z.strictObject({
    op: z.literal("reorderClips"),
    sceneId: z.string(),
    /** Wajib permutasi dari semua id klip scene itu. */
    order: z.array(z.string()).min(1),
  }),
  z.strictObject({
    op: z.literal("replaceAsset"),
    sceneId: z.string(),
    /**
     * Menyasar satu LAPISAN di dalam scene, bukan visual dasarnya (ADR-0025).
     * Kosong/null = visual dasar, persis perilaku sebelum lapisan ada.
     */
    layerId: z.string().nullable().optional(),
    /**
     * Menyasar satu KLIP di dalam scene (ADR-0033); kosong/null = klip
     * pertama, persis perilaku sebelum klip ada. Diabaikan bila `layerId`
     * diisi — lapisan punya asetnya sendiri, bukan aset salah satu klip.
     */
    clipId: z.string().nullable().optional(),
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
  /** ADR-0033. `CLIP_REFUSED` = aritmetika klipnya menolak; pesannya menyebut kenapa. */
  | "CLIP_NOT_FOUND"
  | "CLIP_EXISTS"
  | "CLIP_REFUSED"
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

const requireClip = (scene: Scene, clipId: string, opIndex: number): Clip => {
  const clip = scene.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw new PatchError(
      "CLIP_NOT_FOUND",
      `Klip "${clipId}" tidak ada di scene "${scene.id}"`,
      opIndex,
    );
  }
  return clip;
};

/**
 * Pasang daftar klip hasil satu op klip, dan kembalikan inversnya (ADR-0033).
 *
 * `scene.duration` selalu jadi "auto" sesudahnya, dan itu bukan penyederhanaan:
 * scene berklip banyak memang wajib "auto" (§2), dan scene yang kembali
 * berklip satu memang kembali mengikuti narasi. Angka yang tadinya ada dibawa
 * utuh oleh inversnya, jadi undo mengembalikan keduanya sekaligus.
 */
const commitClips = (
  scene: Scene,
  result: Clip[] | ClipRefusal,
  code: PatchErrorCode,
  opIndex: number,
  duration: "auto" | number = "auto",
): PatchOp => {
  if (isRefusal(result)) throw new PatchError(code, result, opIndex);
  const inverse: PatchOp = {
    op: "setClips",
    sceneId: scene.id,
    clips: clone(scene.clips),
    duration: scene.duration,
  };
  scene.clips = result;
  scene.duration = duration;
  return inverse;
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
      const { clip: clipPatch, caption, ...rest } = op.patch;

      for (const [key, value] of Object.entries(rest)) {
        if (value === undefined) continue;
        inversePatch[key] = clone((scene as unknown as Record<string, unknown>)[key]);
        (scene as unknown as Record<string, unknown>)[key] = clone(value);
      }
      if (clipPatch) {
        const target =
          op.clipId === undefined
            ? primaryClip(scene)
            : requireClip(scene, op.clipId, opIndex);
        const record = target as unknown as Record<string, unknown>;
        inversePatch.clip = priorOf(record, clipPatch);
        mergeDefined(record, clipPatch);
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
        ...(op.clipId === undefined ? {} : { clipId: op.clipId }),
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

    case "setClips": {
      const { scene } = requireScene(plan, op.sceneId, opIndex);
      assertNotLockedForAgent(scene, origin, enforce, opIndex);
      return commitClips(
        scene,
        clone(op.clips),
        "CLIP_REFUSED",
        opIndex,
        op.duration ?? "auto",
      );
    }

    case "splitClip": {
      const { scene } = requireScene(plan, op.sceneId, opIndex);
      assertNotLockedForAgent(scene, origin, enforce, opIndex);
      requireClip(scene, op.clipId, opIndex);
      // Id klip wajib unik SE-PLAN, bukan cuma se-scene (§4). Skema akhirnya
      // juga menangkap ini, tapi dengan pesan tentang larik yang jauh dari
      // kata "belah" — dan yang membaca pesan itu sedang membelah klip.
      if (allClips(plan).some(({ clip }) => clip.id === op.newClipId)) {
        throw new PatchError(
          "CLIP_EXISTS",
          `Id klip "${op.newClipId}" sudah dipakai di plan ini`,
          opIndex,
        );
      }
      const inverse = commitClips(
        scene,
        splitClipAt(plan, scene, op.clipId, op.atSec, op.newClipId),
        "CLIP_REFUSED",
        opIndex,
      );
      // Potongan kedua memakai BERKAS yang sama persis. Menyalin entri
      // `clipAssets`-nya bukan kelonggaran: tanpa itu, belahan yang seharusnya
      // tidak mengubah apa pun justru membuat paruh kedua kehilangan gambarnya
      // sampai tahap aset dijalankan lagi. Sisa entri yatim sesudah undo
      // dibersihkan `pruneRenderState`, sama seperti sesudah removeScene.
      const asset = plan.renderState.clipAssets[op.clipId];
      if (asset) plan.renderState.clipAssets[op.newClipId] = clone(asset);
      return inverse;
    }

    case "trimClip": {
      const { scene } = requireScene(plan, op.sceneId, opIndex);
      assertNotLockedForAgent(scene, origin, enforce, opIndex);
      requireClip(scene, op.clipId, opIndex);
      return commitClips(
        scene,
        trimClipEdge(
          plan,
          scene,
          op.clipId,
          op.edge as TrimEdge,
          op.mode as TrimMode,
          op.deltaSec,
        ),
        "CLIP_REFUSED",
        opIndex,
      );
    }

    case "removeClip": {
      const { scene } = requireScene(plan, op.sceneId, opIndex);
      assertNotLockedForAgent(scene, origin, enforce, opIndex);
      requireClip(scene, op.clipId, opIndex);
      return commitClips(scene, removeClipAt(scene, op.clipId), "CLIP_REFUSED", opIndex);
    }

    case "reorderClips": {
      const { scene } = requireScene(plan, op.sceneId, opIndex);
      assertNotLockedForAgent(scene, origin, enforce, opIndex);
      return commitClips(scene, reorderClipsTo(scene, op.order), "BAD_REORDER", opIndex);
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
          ? op.clipId == null
            ? primaryClip(scene)
            : scene.clips.find((clip) => clip.id === op.clipId)
          : scene.layers.find((layer) => layer.id === op.layerId)?.visual;
      if (!target) {
        if (op.layerId == null) {
          throw new PatchError(
            "CLIP_NOT_FOUND",
            `Klip "${op.clipId}" tidak ada di scene "${op.sceneId}"`,
            opIndex,
          );
        }
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
        // Invers membawa `clipId` apa adanya: undo yang mendarat di klip lain
        // adalah kerusakan yang jauh lebih sulit dilihat daripada undo gagal.
        ...(op.clipId == null ? {} : { clipId: op.clipId }),
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
 * Op untuk "tampilkan PERSIS rentang rekaman ini di potongan ini".
 *
 * Ada di sini, bukan di pemanggilnya, karena panjang sebuah potongan disimpan
 * di TEMPAT YANG BERBEDA tergantung jumlah klip scene (ADR-0033 §2): di
 * `scene.duration` saat klipnya satu, dan di `clip.durationSec` saat lebih —
 * dan menulis angka ke `scene.duration` scene berklip banyak DITOLAK skema.
 * Aturan itu sudah pernah dilanggar dua kali oleh dua pemanggil yang berbeda
 * (tool `cutByWords` milik agent dan tombol "Potong ke sini" di tab Transkrip
 * Studio), masing-masing gagal merah persis di scene hasil pembelahan. Dua
 * salinan aturan yang sama akan menyimpang, dan yang menyimpang duluan pasti
 * yang jarang dibaca.
 *
 * Klip yang lebih dari satu digeser lewat `trimClip` ripple, bukan lewat
 * penulisan `durationSec` langsung: batas ujung rekaman dan durasi minimum
 * dijaga di sana, dan inversnya (daftar klip sebelumnya) membuat undo
 * mengembalikan titik masuk SEKALIGUS panjangnya.
 *
 * `toSec` yang melewati akhir rekaman TIDAK dijepit di sini — penjepitan butuh
 * panjang aset, yang cuma diketahui pemanggilnya, dan menjepit diam-diam pada
 * nilai yang tidak diketahui adalah cara termudah memindahkan kesalahan ke
 * tempat yang tidak bisa dilacak.
 */
export const cutClipOps = (
  scene: Scene,
  clip: Clip,
  range: { fromSec: number; toSec: number },
): PatchOpInput[] => {
  const speed = clip.speed > 0 ? clip.speed : 1;
  const durationSec = Number(((range.toSec - range.fromSec) / speed).toFixed(3));
  const banyak = scene.clips.length > 1;
  const ops: PatchOpInput[] = [
    {
      op: "updateScene",
      id: scene.id,
      ...(banyak ? { clipId: clip.id } : {}),
      patch: {
        clip: { trimStartSec: range.fromSec },
        ...(banyak ? {} : { duration: durationSec }),
      },
    },
  ];
  if (!banyak) return ops;

  // Titik masuk digeser oleh op di atas, jadi batas tepi keluar dihitung
  // terhadap sisa rekaman SETELAH titik masuk baru — bukan terhadap yang lama.
  const deltaSec = Number((durationSec - (clip.durationSec ?? 0)).toFixed(3));
  if (Math.abs(deltaSec) < 0.001) return ops;
  ops.push({
    op: "trimClip",
    sceneId: scene.id,
    clipId: clip.id,
    edge: "keluar",
    mode: "ripple",
    deltaSec,
  });
  return ops;
};

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
      const where = op.clipId === undefined ? "" : ` klip ${op.clipId}`;
      return `mengubah scene ${op.id}${where} (${fields.join(", ") || "tanpa field"})`;
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
    case "setClips":
      return `menetapkan ${op.clips.length} klip di scene ${op.sceneId}`;
    case "splitClip":
      return `membelah klip ${op.clipId} di ${op.atSec} dtk → ${op.newClipId}`;
    case "trimClip": {
      const arah = op.deltaSec >= 0 ? "kanan" : "kiri";
      return (
        `menggeser tepi ${op.edge} klip ${op.clipId} ${Math.abs(op.deltaSec)} dtk ` +
        `ke ${arah} (${op.mode})`
      );
    }
    case "removeClip":
      return `menghapus klip ${op.clipId} dari scene ${op.sceneId}`;
    case "reorderClips":
      return `mengurutkan ulang klip scene ${op.sceneId} (${op.order.join(" → ")})`;
    case "lockScene":
      return op.locked ? `mengunci scene ${op.id}` : `membuka kunci scene ${op.id}`;
    case "replaceAsset": {
      const where =
        op.layerId == null
          ? op.clipId == null
            ? `scene ${op.sceneId}`
            : `klip ${op.clipId} (scene ${op.sceneId})`
          : `lapisan ${op.layerId} (scene ${op.sceneId})`;
      return op.assetId === null
        ? `melepas aset ${where}`
        : `mengganti aset ${where} → ${op.assetId}`;
    }
  }
};

export const describeOps = (ops: PatchOp[], origin: PatchOrigin): string =>
  `${origin}: ${ops.map(describeOp).join("; ")}`;
