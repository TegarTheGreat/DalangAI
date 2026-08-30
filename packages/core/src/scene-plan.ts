import { z } from "zod";

/**
 * Scene-plan schema v0 — the single source of truth for a Dalang video.
 *
 * Follows PRD §5.1. Deviations from the PRD draft are documented in
 * docs/decisions/0003-scene-plan-v0-deviations.md:
 *  - `meta.tokens`     design tokens so presets can be personalized (§8.3)
 *  - `visual.pinned`   set when an asset was explicitly chosen; the pipeline
 *                      must never auto-replace a pinned asset
 *  - `visual.variant`  layout variant for `template-anim` scenes ("title", "outro", …)
 *  - `renderState` entry shapes are fully specified (they were `...` in the PRD)
 *
 * All sizes/positions are normalized (0–1) so aspect ratio changes never
 * break layout (PRD §5.1 rules).
 */

export const SCHEMA_VERSION = 1;

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export const aspectRatioSchema = z.enum(ASPECT_RATIOS);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const VISUAL_TYPES = [
  "stock",
  "image",
  "generated",
  "screenshot",
  "solid",
  "template-anim",
] as const;
export const visualTypeSchema = z.enum(VISUAL_TYPES);
export type VisualType = z.infer<typeof visualTypeSchema>;

export const MOTIONS = [
  "none",
  "kenburns-in",
  "kenburns-out",
  "pan-left",
  "pan-right",
  // ADR-0015: variasi vertikal utk 9:16 + drift orbit pelan.
  "pan-up",
  "pan-down",
  "drift",
] as const;
export const motionSchema = z.enum(MOTIONS);
export type Motion = z.infer<typeof motionSchema>;

const finitePositive = z.number().positive().finite();
const normalized01 = z.number().min(0).max(1);

// ---------------------------------------------------------------------------
// Annotations (executed by presets in tutorial mode, PRD §9)
// ---------------------------------------------------------------------------

export const annotationSchema = z.strictObject({
  type: z.enum(["zoom", "highlight", "arrow", "blur"]),
  /** Normalized rect (0–1) relative to the scene frame. */
  target: z.strictObject({
    x: normalized01,
    y: normalized01,
    w: normalized01,
    h: normalized01,
  }),
  /** Seconds relative to the start of the scene. */
  timing: z.strictObject({
    startSec: z.number().min(0).finite(),
    endSec: finitePositive.optional(),
  }),
});
export type Annotation = z.infer<typeof annotationSchema>;

// ---------------------------------------------------------------------------
// Filter, transisi, dan teks overlay (ADR-0011 — Fase 3 pengayaan editor)
// ---------------------------------------------------------------------------

export const FILTER_PRESETS = ["none", "warm", "cool", "mono", "vivid", "film"] as const;
export const filterPresetSchema = z.enum(FILTER_PRESETS);
export type FilterPreset = z.infer<typeof filterPresetSchema>;

/** Penyesuaian tampilan visual scene; semua default = netral (tanpa efek). */
export const visualFilterSchema = z.strictObject({
  preset: filterPresetSchema.default("none"),
  /** Pengali; 1 = asli. */
  brightness: z.number().min(0.25).max(2).default(1),
  contrast: z.number().min(0.25).max(2).default(1),
  saturation: z.number().min(0).max(2).default(1),
  opacity: normalized01.default(1),
  /** Blur piksel pada basis 1080 (ADR-0015); 0 = tajam. */
  blur: z.number().min(0).max(20).default(0),
});
export type VisualFilter = z.infer<typeof visualFilterSchema>;

export const TRANSITION_TYPES = [
  "cross-fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "wipe-right",
  "wipe-down",
  "none",
] as const;
export const transitionTypeSchema = z.enum(TRANSITION_TYPES);
export type TransitionType = z.infer<typeof transitionTypeSchema>;

/** Batas durasi transisi (frame @30fps) — ADR-0013. */
export const MIN_TRANSITION_FRAMES = 6;
export const MAX_TRANSITION_FRAMES = 24;

/** Transisi KELUAR dari scene ini (batas ke scene berikutnya). */
export const transitionSchema = z.strictObject({
  type: transitionTypeSchema.default("cross-fade"),
  /** Durasi tumpang-tindih transisi; default 15 menjaga plan lama identik. */
  durationFrames: z
    .number()
    .int()
    .min(MIN_TRANSITION_FRAMES)
    .max(MAX_TRANSITION_FRAMES)
    .default(15),
});
export type Transition = z.infer<typeof transitionSchema>;

export const TEXT_ROLES = ["headline", "subline", "kicker", "quote"] as const;
export const textRoleSchema = z.enum(TEXT_ROLES);
export const TEXT_POSITIONS = ["top", "center", "bottom"] as const;
export const textPositionSchema = z.enum(TEXT_POSITIONS);
// ADR-0013: pengayaan gaya teks — semua default mempertahankan render lama.
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export const textAlignSchema = z.enum(TEXT_ALIGNS);
export const TEXT_SIZES = ["s", "m", "l"] as const;
export const textSizeSchema = z.enum(TEXT_SIZES);
// "stabilo" (ADR-0016) = sapuan stabilo yang menyapu di balik teks —
// treatment penekanan yang lazim di konten esai/edukasi Indonesia.
export const TEXT_EMPHASES = ["none", "box", "underline", "stabilo"] as const;
export const textEmphasisSchema = z.enum(TEXT_EMPHASES);

// ADR-0016: tipografi bergerak — animasi masuk per kata/karakter dan
// kontrol rupa (warna, garis luar, kapital, kerapatan huruf).
export const TEXT_ANIMS = ["fade", "pop", "rise", "typewriter"] as const;
export const textAnimSchema = z.enum(TEXT_ANIMS);
/** Warna CSS heksadesimal (#rgb / #rrggbb); null = warna peran dari theme. */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);

/** Teks overlay di atas visual (di bawah caption); gaya dari theme preset. */
export const textOverlaySchema = z.strictObject({
  id: z.string().min(1),
  content: z.string().min(1),
  role: textRoleSchema.default("headline"),
  position: textPositionSchema.default("center"),
  /** Perataan horizontal blok teks (ADR-0013). */
  align: textAlignSchema.default("center"),
  /** Skala relatif terhadap ukuran dasar peran (ADR-0013). */
  size: textSizeSchema.default("m"),
  /** Penekanan: kotak berlatar atau garis bawah aksen (ADR-0013). */
  emphasis: textEmphasisSchema.default("none"),
  /** Animasi masuk (ADR-0016): fade blok, atau pop/rise per KATA, ketik per karakter. */
  anim: textAnimSchema.default("fade"),
  /** Warna teks; null = warna bawaan peran di theme preset. */
  color: hexColorSchema.nullable().default(null),
  /** Garis luar (outline) px pada basis 1080 — keterbacaan di footage ramai. */
  stroke: z.number().min(0).max(8).default(0),
  /** Paksa HURUF KAPITAL. */
  uppercase: z.boolean().default(false),
  /** Kerapatan huruf tambahan dalam em (relatif terhadap gaya peran). */
  tracking: z.number().min(-0.05).max(0.5).default(0),
  /** Jendela tampil, fraksi 0–1 dari durasi scene. */
  startFrac: normalized01.default(0),
  endFrac: normalized01.default(1),
});
export type TextOverlay = z.infer<typeof textOverlaySchema>;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export const visualSchema = z.strictObject({
  type: visualTypeSchema,
  /** Search query (stock) or generation prompt (generated). */
  query: z.string().optional(),
  /**
   * Reference into the asset store; resolved to a file by the pipeline via
   * renderState.resolvedAssets. `null` = not chosen yet.
   */
  assetId: z.string().nullable().default(null),
  motion: motionSchema.default("none"),
  /**
   * True when the asset was explicitly chosen (by the user via the asset grid,
   * or by an explicit replaceAsset op). The pipeline's auto-resolve stage must
   * never overwrite a pinned asset.
   */
  pinned: z.boolean().default(false),
  /** Layout variant for `template-anim` scenes; preset-defined (e.g. "title", "outro"). */
  variant: z.string().optional(),
  /** Filter/penyesuaian tampilan (ADR-0011); tidak ada = netral. */
  filter: visualFilterSchema.optional(),
  /** Kecepatan putar aset VIDEO (ADR-0015); 1 = normal, diabaikan utk gambar. */
  speed: z.number().min(0.25).max(4).default(1),
  /**
   * Titik mulai di dalam aset VIDEO sumber, detik (ADR-0017) — inti kemampuan
   * mengklip: satu rekaman panjang bisa dipakai berkali-kali dengan titik
   * masuk berbeda per scene. Diabaikan untuk gambar.
   */
  trimStartSec: z.number().min(0).finite().default(0),
  /** Cermin horizontal aset (ADR-0015) — membalik arah pandang footage. */
  flipH: z.boolean().default(false),
  /** Titik fokus crop `cover` (ADR-0015), fraksi 0-1; 0.5/0.5 = tengah. */
  focusX: normalized01.default(0.5),
  focusY: normalized01.default(0.5),
});
export type Visual = z.infer<typeof visualSchema>;

/**
 * Gaya caption karaoke (ADR-0016). Field `style` sudah ada sejak v0 tapi
 * belum pernah dieksekusi; tetap `string` agar plan lama ("inherit") valid —
 * templates menormalkan nilai tak dikenal ke "klasik" (pola yang sama dengan
 * visual.variant).
 */
export const CAPTION_STYLES = ["klasik", "tegas", "chip", "halus"] as const;
export const CAPTION_POSITIONS = ["bottom", "center"] as const;
export const captionPositionSchema = z.enum(CAPTION_POSITIONS);

export const captionSchema = z.strictObject({
  enabled: z.boolean().default(true),
  style: z.string().default("klasik"),
  /** Skala relatif ukuran caption preset (ADR-0016). */
  size: textSizeSchema.default("m"),
  position: captionPositionSchema.default("bottom"),
});
export type Caption = z.infer<typeof captionSchema>;

/**
 * Grafis tempelan di atas visual (ADR-0018): ikon dari pustaka terbuka, atau
 * stiker dari pustaka GIF. Posisinya memakai JANGKAR + geseran relatif, bukan
 * koordinat mutlak, supaya satu nilai yang sama tetap benar di 16:9, 9:16,
 * maupun 1:1 tanpa dihitung ulang.
 */
export const GRAPHIC_ANCHORS = [
  "kiri-atas",
  "tengah-atas",
  "kanan-atas",
  "kiri-tengah",
  "tengah",
  "kanan-tengah",
  "kiri-bawah",
  "tengah-bawah",
  "kanan-bawah",
] as const;
export const graphicAnchorSchema = z.enum(GRAPHIC_ANCHORS);
export type GraphicAnchor = (typeof GRAPHIC_ANCHORS)[number];

export const GRAPHIC_ANIMS = ["diam", "pop", "apung", "putar", "denyut"] as const;
export const graphicAnimSchema = z.enum(GRAPHIC_ANIMS);
export type GraphicAnim = (typeof GRAPHIC_ANIMS)[number];

export const graphicSchema = z.strictObject({
  id: z.string().min(1),
  /**
   * Rujukan sumber: "iconify:<set>:<nama>" untuk ikon, atau id aset yang sudah
   * ada di renderState.graphicAssets untuk stiker/gambar.
   */
  ref: z.string().min(1),
  anchor: graphicAnchorSchema.default("kanan-bawah"),
  /** Tinggi grafis sebagai fraksi tinggi frame. */
  size: z.number().min(0.02).max(0.6).default(0.12),
  /** Geseran dari jangkar, fraksi lebar/tinggi frame. */
  offsetX: z.number().min(-0.5).max(0.5).default(0),
  offsetY: z.number().min(-0.5).max(0.5).default(0),
  rotate: z.number().min(-180).max(180).default(0),
  opacity: normalized01.default(1),
  /** Warna ikon; null = warna aksen preset. Diabaikan untuk stiker gambar. */
  color: hexColorSchema.nullable().default(null),
  anim: graphicAnimSchema.default("pop"),
  /** Jendela tampil, fraksi 0-1 dari durasi scene. */
  startFrac: normalized01.default(0),
  endFrac: normalized01.default(1),
});
export type Graphic = z.infer<typeof graphicSchema>;

export const sceneSchema = z.strictObject({
  id: z.string().min(1),
  /** Hard contract: agents are rejected at the code level when touching a locked scene. */
  locked: z.boolean().default(false),
  narration: z.string().default(""),
  visual: visualSchema,
  // Gotcha zod: `.default(obj)` memakai objek APA ADANYA — default field di
  // dalamnya TIDAK diterapkan, jadi objek ini harus ditulis lengkap (ADR-0013).
  caption: captionSchema.default({
    enabled: true,
    style: "klasik",
    size: "m",
    position: "bottom",
  }),
  /** "auto" = narration length + padding; number = fixed seconds. */
  duration: z.union([z.literal("auto"), finitePositive]).default("auto"),
  /** Transisi keluar ke scene berikutnya (ADR-0011). */
  transition: transitionSchema.default({ type: "cross-fade", durationFrames: 15 }),
  /** Teks overlay (maks 3) di atas visual (ADR-0011). */
  texts: z.array(textOverlaySchema).max(3).default([]),
  annotations: z.array(annotationSchema).default([]),
  /** Ikon/stiker tempelan (maks 4) di atas visual (ADR-0018). */
  graphics: z.array(graphicSchema).max(4).default([]),
});
export type Scene = z.infer<typeof sceneSchema>;
export type SceneInput = z.input<typeof sceneSchema>;

// ---------------------------------------------------------------------------
// Meta & audio
// ---------------------------------------------------------------------------

export const designTokensSchema = z.strictObject({
  /** Primary brand color (CSS color). */
  primary: z.string().optional(),
  /** Accent color used for highlights/captions (CSS color). */
  accent: z.string().optional(),
  fontDisplay: z.string().optional(),
  fontBody: z.string().optional(),
});
export type DesignTokens = z.infer<typeof designTokensSchema>;

export const metaSchema = z.strictObject({
  title: z.string().min(1),
  aspectRatio: aspectRatioSchema.default("9:16"),
  /** Seconds; "auto" = follow the narration. A number is a *target* for the agent, not a hard constraint. */
  targetDuration: z.union([z.literal("auto"), finitePositive]).default("auto"),
  language: z.string().default("id"),
  /** References a curated Remotion template (PRD §8.3). */
  stylePreset: z.string().default("documentary-01"),
  /**
   * Format konten (ADR-0017) — memilih RESEP struktur yang dipakai agent dan
   * diperiksa `critiquePlan`. "bebas" = tanpa kerangka baku.
   */
  format: z.string().default("bebas"),
  tokens: designTokensSchema.optional(),
});
export type Meta = z.infer<typeof metaSchema>;

export const voiceSchema = z.strictObject({
  provider: z.string().min(1),
  voiceId: z.string().min(1),
  speed: finitePositive.default(1),
});
export type Voice = z.infer<typeof voiceSchema>;

export const musicSchema = z.strictObject({
  assetId: z.string().min(1),
  volume: normalized01.default(0.15),
  ducking: z.boolean().default(true),
});
export type Music = z.infer<typeof musicSchema>;

/**
 * Satu bunyi tempelan (ADR-0018). Ditambatkan ke SCENE, bukan ke garis waktu
 * mutlak: kalau scene digeser, dipotong, atau durasinya berubah, bunyinya ikut
 * — itu perilaku yang diharapkan editor, dan mencegah cue jadi yatim.
 */
export const sfxCueSchema = z.strictObject({
  id: z.string().min(1),
  /** "pustaka:<id>" (ter-bundle) atau id aset yang sudah diunduh. */
  assetId: z.string().min(1),
  sceneId: z.string().min(1),
  /** Detik dari awal scene. */
  atSec: z.number().min(0).finite().default(0),
  volume: normalized01.default(0.6),
});
export type SfxCue = z.infer<typeof sfxCueSchema>;

export const audioSchema = z.strictObject({
  voice: voiceSchema.optional(),
  music: musicSchema.optional(),
  /** Efek suara bertambat scene (ADR-0018). */
  sfx: z.array(sfxCueSchema).max(24).default([]),
});
export type Audio = z.infer<typeof audioSchema>;

// ---------------------------------------------------------------------------
// renderState — derived data produced by the pipeline, never authored by the
// agent or the user (PRD §5.1). Kept in the same document for portability but
// mutated only through pipeline helpers, never through patch ops.
// ---------------------------------------------------------------------------

/**
 * CONTRACT: word timestamps are relative to the start of the narration audio
 * file (0-based), exactly as TTS providers/forced alignment emit them. The
 * preset decides where the narration sits inside the scene and offsets audio
 * and captions together (see `NARRATION_LEAD_IN_SEC`).
 */
export const wordTimestampSchema = z.strictObject({
  word: z.string(),
  startSec: z.number().min(0).finite(),
  endSec: z.number().min(0).finite(),
});
export type WordTimestamp = z.infer<typeof wordTimestampSchema>;

export const narrationAudioSchema = z.strictObject({
  /** Path relative to the render public dir. */
  file: z.string().min(1),
  durationSec: finitePositive,
  /** Relative to the audio file start — see wordTimestampSchema contract. */
  wordTimestamps: z.array(wordTimestampSchema).optional(),
  /** Set when a fallback TTS provider was used; surfaced in the UI per scene. */
  fallbackQuality: z.boolean().optional(),
});
export type NarrationAudio = z.infer<typeof narrationAudioSchema>;

export const resolvedAssetSchema = z.strictObject({
  /** Path relative to the render public dir. */
  file: z.string().min(1),
  kind: z.enum(["image", "video", "audio"]),
  /** Provider id: "pexels" | "pixabay" | "local" | … */
  source: z.string().min(1),
  sourceUrl: z.string().optional(),
  author: z.string().optional(),
  /** License string kept verbatim for audit (PRD §10). */
  license: z.string().optional(),
  width: finitePositive.optional(),
  height: finitePositive.optional(),
  /**
   * Panjang aset video/audio sumber, detik (ADR-0017). Dibutuhkan agent untuk
   * memilih potongan yang sah lewat `visual.trimStartSec`.
   */
  durationSec: finitePositive.optional(),
});
export type ResolvedAsset = z.infer<typeof resolvedAssetSchema>;

export const renderStateSchema = z.strictObject({
  narrationAudio: z.record(z.string(), narrationAudioSchema).default({}),
  resolvedAssets: z.record(z.string(), resolvedAssetSchema).default({}),
  /** Berkas nyata untuk grafis tempelan, dikunci id grafis (ADR-0018). */
  graphicAssets: z.record(z.string(), resolvedAssetSchema).default({}),
  /** Berkas nyata untuk cue efek suara, dikunci id cue (ADR-0018). */
  sfxAssets: z.record(z.string(), resolvedAssetSchema).default({}),
});
export type RenderState = z.infer<typeof renderStateSchema>;

// ---------------------------------------------------------------------------
// Scene-plan root
// ---------------------------------------------------------------------------

export const scenePlanSchema = z
  .strictObject({
    /** Editor tooling hook (JSON Schema); ignored by the runtime. */
    $schema: z.string().optional(),
    version: z.literal(SCHEMA_VERSION),
    projectId: z.string().min(1),
    meta: metaSchema,
    // Gotcha zod (ketiga kalinya, lihat ADR-0013/0016): `.default(obj)`
    // memakai objek APA ADANYA — default field di dalamnya TIDAK diterapkan,
    // jadi objek ini harus ditulis lengkap. Kali ini TypeScript menangkapnya
    // saat kompilasi karena `sfx` wajib setelah default.
    audio: audioSchema.default({ sfx: [] }),
    scenes: z.array(sceneSchema).min(1),
    renderState: renderStateSchema.default({
      narrationAudio: {},
      resolvedAssets: {},
      graphicAssets: {},
      sfxAssets: {},
    }),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.scenes.forEach((scene, index) => {
      if (seen.has(scene.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "id"],
          message: `Duplicate scene id "${scene.id}"`,
        });
      }
      seen.add(scene.id);
    });
  });

export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type ScenePlanInput = z.input<typeof scenePlanSchema>;

/** Parse and validate; throws with a readable message on invalid input. */
export const parseScenePlan = (input: unknown): ScenePlan => {
  if (typeof input === "object" && input !== null && "version" in input) {
    const version = (input as { version: unknown }).version;
    if (version !== SCHEMA_VERSION) {
      throw new Error(
        `Versi scene-plan ${JSON.stringify(version)} tidak didukung — versi yang didukung: ${SCHEMA_VERSION}. ` +
          `Bump versi skema membutuhkan fungsi migrasi (lihat ADR-0003).`,
      );
    }
  }
  const result = scenePlanSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Scene-plan tidak valid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};

export const safeParseScenePlan = (input: unknown) => scenePlanSchema.safeParse(input);

export const getScene = (plan: ScenePlan, id: string): Scene | undefined =>
  plan.scenes.find((scene) => scene.id === id);

export const getSceneIndex = (plan: ScenePlan, id: string): number =>
  plan.scenes.findIndex((scene) => scene.id === id);

/** Resolution per aspect ratio. Develop & test at 1080p (PRD §4.2 note). */
export const DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};
