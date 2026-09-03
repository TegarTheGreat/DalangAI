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

export const SCHEMA_VERSION = 2;

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
export type TextPosition = z.infer<typeof textPositionSchema>;
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
/**
 * Keyframe sembarang untuk properti (ADR-0027, roadmap §9.3).
 *
 * Sampai sini seluruh gerak di Dalang adalah PRESET: `anim: "pop"`,
 * `motion: "kenburns-in"`, `entrance: "fade"`. Preset bagus untuk memulai —
 * dan tetap jadi jalan bawaan — tapi ia tidak bisa menjawab "geser kartu ini
 * dari kanan ke tengah tepat saat narasi menyebutnya". Itu butuh nilai yang
 * berubah pada waktu yang DIPILIH, bukan dipilih dari daftar.
 *
 * Empat keputusan yang membentuk skema ini:
 *
 * 1. PROPERTINYA TERTUTUP, bukan jalur string bebas. `property: "offsetX"`
 *    bisa divalidasi; `path: "style.transform.x"` tidak bisa — dan yang tidak
 *    bisa divalidasi akan salah ditulis agent, lalu gagal saat render.
 * 2. NILAINYA DIJEPIT RENTANG YANG SAMA dengan properti statisnya. Tanpa itu
 *    sebuah keyframe bisa membawa `size` ke 5,0 — nilai yang ditolak skema
 *    kalau ditulis statis. Satu bentuk data tidak boleh punya dua batas.
 * 3. WAKTUNYA FRAKSI JENDELA ELEMEN, bukan detik. Elemen yang jendelanya
 *    digeser atau scene yang dipanjangkan membawa serta animasinya, persis
 *    seperti `startFrac`/`endFrac` sejak ADR-0018.
 * 4. EASING-nya BERNAMA, bukan empat angka bezier. Nama menjaga bahasa gerak
 *    yang sama dengan `anim.ts` (ADR-0015) dan membuat plan bisa dibaca.
 */
export const ANIMATABLE_PROPERTIES = [
  "offsetX",
  "offsetY",
  "size",
  "width",
  "height",
  "rotate",
  "opacity",
] as const;
export type AnimatableProperty = (typeof ANIMATABLE_PROPERTIES)[number];

/**
 * Rentang sah tiap properti — SATU sumber, dipakai keyframe maupun nilai
 * statisnya. Dituliskan sekali di sini supaya keduanya tidak bisa berbeda.
 */
export const ANIMATABLE_RANGE: Record<AnimatableProperty, readonly [number, number]> = {
  offsetX: [-0.5, 0.5],
  offsetY: [-0.5, 0.5],
  size: [0.02, 0.6],
  width: [0.08, 1],
  height: [0.08, 1],
  rotate: [-180, 180],
  opacity: [0, 1],
};

export const KEYFRAME_EASINGS = ["settle", "glide", "dolly", "linear"] as const;
export const keyframeEasingSchema = z.enum(KEYFRAME_EASINGS);
export type KeyframeEasing = (typeof KEYFRAME_EASINGS)[number];

/** Batas jumlah, supaya plan tetap terbaca dan biaya render tetap terduga. */
export const MAX_TRACKS_PER_ELEMENT = 4;
export const MAX_KEYFRAMES_PER_TRACK = 8;

export const keyframeSchema = z.strictObject({
  /** Waktu sebagai fraksi jendela tampil elemen: 0 = muncul, 1 = hilang. */
  at: normalized01,
  value: z.number().finite(),
  /**
   * Easing dari titik INI menuju titik berikutnya.
   *
   * Satu easing per SEGMEN, bukan dua per titik (masuk & keluar seperti
   * After Effects). Segmen adalah hal yang benar-benar dianimasikan, dan dua
   * easing per titik membuat dua titik bertetangga bisa saling bertentangan
   * tentang bentuk satu segmen yang sama.
   */
  easing: keyframeEasingSchema.default("settle"),
});
export type Keyframe = z.infer<typeof keyframeSchema>;
export type KeyframeInput = z.input<typeof keyframeSchema>;

export const keyframeTrackSchema = z.strictObject({
  property: z.enum(ANIMATABLE_PROPERTIES),
  points: z.array(keyframeSchema).min(2).max(MAX_KEYFRAMES_PER_TRACK),
});
export type KeyframeTrack = z.infer<typeof keyframeTrackSchema>;

/**
 * Aturan yang berlaku untuk SETIAP kumpulan track, di elemen mana pun.
 *
 * Dipakai lewat `.superRefine(refineTracks(...))` pada tiap elemen, bukan
 * disalin tiga kali: aturan yang disalin adalah aturan yang akan menyimpang.
 */
export const refineTracks =
  (allowed: readonly AnimatableProperty[]) =>
  (tracks: KeyframeTrack[], ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    tracks.forEach((track, index) => {
      if (!allowed.includes(track.property)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "property"],
          message: `Properti "${track.property}" tidak bisa dianimasikan pada elemen ini — yang bisa: ${allowed.join(", ")}`,
        });
      }
      // Satu properti satu track: dua track untuk properti yang sama berarti
      // dua jawaban untuk satu pertanyaan, dan yang menang cuma soal urutan.
      if (seen.has(track.property)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "property"],
          message: `Properti "${track.property}" punya lebih dari satu track`,
        });
      }
      seen.add(track.property);

      const range = ANIMATABLE_RANGE[track.property];
      track.points.forEach((point, pointIndex) => {
        if (range && (point.value < range[0] || point.value > range[1])) {
          ctx.addIssue({
            code: "custom",
            path: [index, "points", pointIndex, "value"],
            message: `Nilai ${point.value} di luar rentang ${track.property} (${range[0]}..${range[1]})`,
          });
        }
        // Waktu harus MENAIK. Titik yang tidak urut membuat interpolasinya
        // bergantung pada urutan tulis, bukan pada waktunya.
        const previous = track.points[pointIndex - 1];
        if (previous && point.at <= previous.at) {
          ctx.addIssue({
            code: "custom",
            path: [index, "points", pointIndex, "at"],
            message: `Waktu keyframe harus menaik (${previous.at} lalu ${point.at})`,
          });
        }
      });
    });
  };

/** Larik track untuk satu elemen, dengan daftar properti yang boleh. */
export const tracksSchema = (allowed: readonly AnimatableProperty[]) =>
  z
    .array(keyframeTrackSchema)
    .max(MAX_TRACKS_PER_ELEMENT)
    .default([])
    .superRefine(refineTracks(allowed));

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
  /**
   * Geseran dari jangkar `position`, fraksi lebar/tinggi bingkai (ADR-0024).
   *
   * Bentuknya sengaja SAMA dengan grafis: jangkar + geseran, bukan koordinat
   * mutlak. Dengan begitu satu nilai tetap benar di 16:9, 9:16, dan 1:1 —
   * dan nol berarti "di tempat yang dipilih preset", jadi semua plan lama
   * tetap ter-render persis seperti sebelumnya.
   */
  offsetX: z.number().min(-0.5).max(0.5).default(0),
  offsetY: z.number().min(-0.5).max(0.5).default(0),
  /** Track keyframe (ADR-0027) — lihat catatan di `graphicSchema.tracks`. */
  tracks: tracksSchema(["offsetX", "offsetY", "opacity"]),
  /** Jendela tampil, fraksi 0–1 dari durasi scene. */
  startFrac: normalized01.default(0),
  endFrac: normalized01.default(1),
});
export type TextOverlay = z.infer<typeof textOverlaySchema>;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/**
 * Amplop audio satu klip (ADR-0026, roadmap §9.4).
 *
 * SATU bentuk untuk semua yang berbunyi dan bukan narasi: suara alami visual
 * dasar, suara lapisan, dan trek audio tambahan. Menyalin empat field yang
 * sama ke tiga tempat berarti tiga tempat yang akan menyimpang — dan yang
 * pertama menyimpang tidak akan ketahuan sampai seseorang mendengar satu
 * sisipan yang tidak ikut mengecil di bawah narasi.
 *
 * ADR-0025 sengaja hanya memberi satu angka gain dan menyatakan amplopnya
 * sebagai utang §9.4. Ini pelunasannya: `visual.volume` diganti `visual.audio`.
 */
export const clipAudioSchema = z.strictObject({
  /** Gain akhir setelah normalisasi; 0 (bawaan) = bisu. */
  volume: normalized01.default(0),
  fadeInSec: z.number().min(0).max(10).default(0),
  fadeOutSec: z.number().min(0).max(10).default(0),
  /**
   * Mengecil otomatis di bawah scene bernarasi, sama seperti musik sejak
   * ADR-0014. Bawaannya HIDUP: begitu seseorang menaikkan volume klip, yang
   * hampir selalu ia maksud adalah "terdengar, tapi jangan menutupi suara".
   */
  ducking: z.boolean().default(true),
  /**
   * Ikut normalisasi kenyaringan ke `meta.loudnessTarget`. Dimatikan untuk
   * bunyi yang memang harus tetap pelan atau keras apa adanya.
   */
  normalize: z.boolean().default(true),
});
export type ClipAudio = z.infer<typeof clipAudioSchema>;

/**
 * Objek `clipAudio` LENGKAP untuk dipakai `.default()`.
 *
 * Gotcha zod (lihat ADR-0013/0016/0025): `.default(obj)` memakai objek APA
 * ADANYA — default field di dalamnya TIDAK diterapkan.
 */
export const SILENT_CLIP_AUDIO: ClipAudio = {
  volume: 0,
  fadeInSec: 0,
  fadeOutSec: 0,
  ducking: true,
  normalize: true,
};

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
  /**
   * Suara aset VIDEO (ADR-0025 sebagai satu angka, ADR-0026 sebagai amplop
   * penuh); `volume` 0 = bisu, dan itu bawaannya. Diabaikan untuk gambar.
   *
   * Ada di `visual` — bukan hanya di lapisan — supaya B-roll bersuara alami
   * memakai bentuk yang sama entah ia jadi visual dasar atau lapisan.
   */
  audio: clipAudioSchema.default(SILENT_CLIP_AUDIO),
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
  /**
   * Track keyframe (ADR-0027). Properti yang punya track ditentukan PENUH
   * olehnya — nilai statis dan preset `anim` tidak lagi ikut menghitung
   * properti itu. Mengalikan keduanya akan membuat "pindahkan ke 0,2" berarti
   * sesuatu yang berbeda tergantung preset yang kebetulan terpasang.
   */
  tracks: tracksSchema(["offsetX", "offsetY", "size", "rotate", "opacity"]),
  /** Jendela tampil, fraksi 0-1 dari durasi scene. */
  startFrac: normalized01.default(0),
  endFrac: normalized01.default(1),
});
export type Graphic = z.infer<typeof graphicSchema>;

/**
 * Lapisan video di atas visual dasar (ADR-0025, roadmap §9.2): B-roll,
 * picture-in-picture, sisipan bukti.
 *
 * KENAPA PER SCENE, BUKAN TRACK GLOBAL. Garis waktu Dalang adalah barisan
 * scene, dan scene itulah satuan yang dipahami agent: ia menulis naskah per
 * scene, memilih aset per scene, mengkritik per scene. Track global dengan
 * waktu mutlak akan memutus ikatan itu — memindahkan satu scene tidak lagi
 * memindahkan sisipannya, dan agent kehilangan cara menyebut "yang muncul saat
 * kalimat ini dibacakan". Jendela tampil karenanya FRAKSI durasi scene, sama
 * seperti grafis tempelan (ADR-0018): scene yang dipanjangkan membawa serta
 * sisipannya.
 *
 * Medianya memakai bentuk `visual` yang SAMA dengan visual dasar. Dengan itu
 * gerak Ken Burns, filter, kecepatan, trim, cermin, dan titik fokus berlaku di
 * lapisan tanpa satu baris rumus pun ditulis dua kali — dan lapisan tidak akan
 * pernah tertinggal saat kemampuan visual bertambah.
 */
export const LAYER_SHAPES = ["persegi", "bulat"] as const;
export const layerShapeSchema = z.enum(LAYER_SHAPES);
export type LayerShape = (typeof LAYER_SHAPES)[number];

export const LAYER_ENTRANCES = ["fade", "geser", "pop", "diam"] as const;
export const layerEntranceSchema = z.enum(LAYER_ENTRANCES);
export type LayerEntrance = (typeof LAYER_ENTRANCES)[number];

/**
 * `variant` dibuang dan `type` dipersempit: lapisan tidak bisa berupa scene
 * judul animasi maupun bidang warna. Keduanya adalah LATAR — menaruhnya
 * sebagai sisipan hanya menghasilkan kotak yang menutupi videonya sendiri.
 */
export const layerVisualSchema = visualSchema.omit({ variant: true }).extend({
  type: z.enum(["stock", "image", "generated", "screenshot"]),
});
export type LayerVisual = z.infer<typeof layerVisualSchema>;

// ---------------------------------------------------------------------------
// Klip (ADR-0033)
// ---------------------------------------------------------------------------

/**
 * Batas jumlah klip per scene. Bukan angka teknis: satu scene adalah satu
 * GAGASAN, dan gagasan yang butuh lebih dari dua lusin potongan sudah menjadi
 * dua gagasan.
 */
export const MAX_CLIPS = 24;

/**
 * Satu potongan gambar berurutan di dalam scene (ADR-0033).
 *
 * `Clip` memakai bentuk `Visual` yang SUDAH ADA apa adanya — assetId, motion,
 * filter, speed, trimStartSec, flipH, focusX/Y, audio, pinned — ditambah
 * identitas dan waktu. Pola yang sama dengan lapisan video: satu bentuk, jadi
 * setiap kemampuan visual berikutnya ikut berlaku untuk klip tanpa diputuskan
 * dua kali.
 *
 * `clips[0]` ADALAH `visual` yang lama. Tidak ada `scene.visual` lagi.
 */
export const clipSchema = visualSchema.extend({
  id: z.string().min(1),
  /**
   * Panjang klip di linimasa, detik. DIABAIKAN saat scene hanya punya satu
   * klip — di situ klip mengisi seluruh scene dan durasi datang dari
   * `scene.duration` seperti sebelumnya.
   */
  durationSec: finitePositive.optional(),
  /**
   * Transisi KELUAR ke klip berikutnya; tidak ada = potong keras, dan itu
   * bawaannya. Semantiknya sama dengan `scene.transition`, yang tetap
   * mengurus perpindahan ke scene berikutnya. Transisi pada klip TERAKHIR
   * diabaikan: batas itu milik scene.
   */
  transition: transitionSchema.optional(),
});
export type Clip = z.infer<typeof clipSchema>;

/** Batas jumlah lapisan per scene. */
export const MAX_LAYERS = 2;

export const videoLayerSchema = z.strictObject({
  id: z.string().min(1),
  visual: layerVisualSchema,
  /** Penempatan: jangkar + geseran fraksional, sama dengan grafis (ADR-0018). */
  anchor: graphicAnchorSchema.default("kanan-bawah"),
  /** Lebar kotak sebagai fraksi LEBAR frame. */
  width: z.number().min(0.08).max(1).default(0.34),
  /** Tinggi kotak sebagai fraksi TINGGI frame. */
  height: z.number().min(0.08).max(1).default(0.34),
  offsetX: z.number().min(-0.5).max(0.5).default(0),
  offsetY: z.number().min(-0.5).max(0.5).default(0),
  shape: layerShapeSchema.default("persegi"),
  /** Sudut membulat, fraksi sisi TERPENDEK kotak; diabaikan bila bulat. */
  radius: z.number().min(0).max(0.5).default(0.05),
  /** Tebal bingkai, fraksi tinggi frame; 0 = tanpa bingkai. */
  border: z.number().min(0).max(0.02).default(0),
  /** Warna bingkai; null = warna aksen preset. */
  borderColor: hexColorSchema.nullable().default(null),
  opacity: normalized01.default(1),
  /** Isi kotak: `cover` memotong, `contain` memuat seluruh bingkai. */
  fit: z.enum(["cover", "contain"]).default("cover"),
  entrance: layerEntranceSchema.default("fade"),
  /** Track keyframe (ADR-0027) — lihat catatan di `graphicSchema.tracks`. */
  tracks: tracksSchema(["offsetX", "offsetY", "width", "height", "opacity"]),
  /** Jendela tampil, fraksi 0-1 dari durasi scene. */
  startFrac: normalized01.default(0),
  endFrac: normalized01.default(1),
});
export type VideoLayer = z.infer<typeof videoLayerSchema>;
export type VideoLayerInput = z.input<typeof videoLayerSchema>;

export const sceneSchema = z.strictObject({
  id: z.string().min(1),
  /** Hard contract: agents are rejected at the code level when touching a locked scene. */
  locked: z.boolean().default(false),
  narration: z.string().default(""),
  /**
   * Potongan gambar scene, berurutan (ADR-0033). Minimal satu; `clips[0]`
   * adalah visual dasar yang dulu bernama `scene.visual`.
   */
  clips: z.array(clipSchema).min(1).max(MAX_CLIPS),
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
  /** Lapisan video di atas visual dasar (maks 2) — ADR-0025. */
  layers: z.array(videoLayerSchema).max(MAX_LAYERS).default([]),
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
  /**
   * Sasaran kenyaringan KLIP dalam LUFS (ADR-0026). Tiap sumber yang punya
   * hasil ukur dinaikkan/diturunkan supaya duduk di angka ini SEBELUM
   * `volume` klipnya diterapkan, sehingga rekaman keras dan rekaman pelan
   * tidak lagi menuntut penataan volume satu per satu.
   *
   * Ini normalisasi PER KLIP, bukan per program: campuran akhirnya tidak
   * diukur (lihat "Batas yang dinyatakan" ADR-0026). `null` mematikannya.
   */
  loudnessTarget: z.number().min(-40).max(-5).nullable().default(-16),
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
  /**
   * Panjang fade masuk/keluar bed musik (ADR-0026). Sebelum ini keduanya
   * konstanta di dalam preset (1 detik masuk, 2 detik keluar); bawaannya
   * sengaja sama persis, jadi plan lama berbunyi identik.
   */
  fadeInSec: z.number().min(0).max(10).default(1),
  fadeOutSec: z.number().min(0).max(10).default(2),
  /** Ikut normalisasi kenyaringan ke `meta.loudnessTarget`. */
  normalize: z.boolean().default(true),
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

/**
 * Trek audio tambahan (ADR-0026, roadmap §9.4): ambience, rekaman wawancara,
 * lagu berlisensi yang bukan bed — apa pun yang berbunyi dan bukan narasi,
 * bukan musik latar, bukan efek satu-ketukan.
 *
 * TAMBATANNYA DUA MACAM, dan bedanya penting. `sceneId` terisi = mulai
 * `atSec` detik setelah scene itu mulai, jadi ia ikut bergeser saat susunan
 * berubah (pola yang sama dengan cue efek suara). `sceneId` null = mulai
 * `atSec` detik dari AWAL VIDEO, untuk bunyi yang memang milik keseluruhan.
 */
export const audioTrackSchema = z.strictObject({
  id: z.string().min(1),
  /**
   * Path berkas relatif-plan; berkas nyatanya dicatat di renderState.
   *
   * Boleh KOSONG, dan itu berarti "berkasnya belum dipilih": trek yang baru
   * dibuat di UI belum punya berkas, dan menolak menyimpannya berarti tombol
   * "tambah trek" tidak bisa berbuat apa-apa. Trek tanpa berkas tidak
   * berbunyi, dan setiap permukaan mengatakannya.
   */
  assetId: z.string().default(""),
  /** Scene tambatan; null = ditambatkan ke awal video. */
  sceneId: z.string().nullable().default(null),
  atSec: z.number().min(0).finite().default(0),
  /** Diulang sampai jendelanya penuh — untuk ambience pendek. */
  loop: z.boolean().default(false),
  audio: clipAudioSchema.default({
    // Trek yang sengaja ditambahkan orang jelas dimaksudkan terdengar, jadi
    // bawaannya BUKAN bisu — berbeda dari suara aset visual yang bawaannya
    // memang harus diam supaya plan lama tidak tiba-tiba berbunyi.
    volume: 0.5,
    fadeInSec: 0.5,
    fadeOutSec: 1,
    ducking: true,
    normalize: true,
  }),
});
export type AudioTrack = z.infer<typeof audioTrackSchema>;

export const audioSchema = z.strictObject({
  voice: voiceSchema.optional(),
  music: musicSchema.optional(),
  /** Efek suara bertambat scene (ADR-0018). */
  sfx: z.array(sfxCueSchema).max(24).default([]),
  /** Trek audio tambahan (ADR-0026). */
  tracks: z.array(audioTrackSchema).max(8).default([]),
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
  /** Kenyaringan terintegrasi hasil ukur, LUFS (ADR-0026). */
  lufs: z.number().finite().optional(),
  /**
   * Jumlah kanal sumbernya saat diukur (ADR-0026).
   *
   * Disimpan bersama `lufs` karena keduanya baru berarti bersama-sama: sumber
   * MONO yang diputar di campuran stereo terdengar 3 LU lebih keras daripada
   * angka ukurnya, sebab dua kanal identik menjumlahkan DAYA. Tanpa angka ini
   * narasi mono akan mendarat 3 dB di atas sasaran sementara musik stereo
   * mendarat tepat — persis ketimpangan yang seharusnya dihapus normalisasi.
   */
  channels: z.number().int().min(1).max(8).optional(),
});
export type NarrationAudio = z.infer<typeof narrationAudioSchema>;

/**
 * Proxy pratinjau sebuah berkas VIDEO (ADR-0028, roadmap §9.5).
 *
 * Salinan RINGAN dari berkas aslinya — H.264 dengan sisi pendek 540 piksel,
 * laju bingkai paling tinggi 30 — yang dipakai preview Studio dan render draf.
 * Ia data TURUNAN yang selalu bisa dibuat ulang dari aslinya, hidup di
 * `.dalang/proxies/`, dan tidak pernah menyentuh render final: berkas final
 * selalu dibaca dari `file`, bukan dari sini.
 *
 * Absennya berarti "preview memakai aslinya" — keadaan normal untuk klip
 * pendek beresolusi rendah — bukan kerusakan.
 */
export const proxyMediaSchema = z.strictObject({
  /** Path relatif terhadap folder plan, di dalam `.dalang/proxies/`. */
  file: z.string().min(1),
  width: finitePositive,
  height: finitePositive,
  fps: finitePositive.optional(),
});
export type ProxyMedia = z.infer<typeof proxyMediaSchema>;

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
  /**
   * Kenyaringan terintegrasi hasil ukur, LUFS (ADR-0026, EBU R128).
   *
   * TIDAK ADA artinya "belum pernah diukur", dan itu dibedakan dari "diukur
   * dan hasilnya sunyi": berkas tanpa hasil ukur TIDAK dinormalisasi, bukan
   * dinormalisasi dengan angka karangan.
   */
  lufs: z.number().finite().optional(),
  /**
   * Jumlah kanal sumbernya saat diukur (ADR-0026).
   *
   * Disimpan bersama `lufs` karena keduanya baru berarti bersama-sama: sumber
   * MONO yang diputar di campuran stereo terdengar 3 LU lebih keras daripada
   * angka ukurnya, sebab dua kanal identik menjumlahkan DAYA. Tanpa angka ini
   * narasi mono akan mendarat 3 dB di atas sasaran sementara musik stereo
   * mendarat tepat — persis ketimpangan yang seharusnya dihapus normalisasi.
   */
  channels: z.number().int().min(1).max(8).optional(),
  /**
   * Kodek video sumber hasil pemeriksaan (ADR-0028), mis. "h264", "hevc",
   * "prores". Dipakai untuk memutuskan perlunya proxy dan untuk mengatakan
   * pada pengguna KENAPA sebuah rekaman tidak bisa diputar langsung di
   * browser — bukan sekadar menampilkan kotak hitam.
   */
  codec: z.string().min(1).optional(),
  /** Laju bingkai sumber, bingkai/detik (ADR-0028). */
  fps: finitePositive.optional(),
  /** Proxy pratinjau (ADR-0028); tidak ada = preview memakai berkas aslinya. */
  proxy: proxyMediaSchema.optional(),
});
export type ResolvedAsset = z.infer<typeof resolvedAssetSchema>;

/**
 * Satu kata dari hasil transkripsi (ADR-0021).
 *
 * Bentuknya SUPERSET dari `wordTimestampSchema`, bukan penggantinya: caption
 * hanya butuh kata + waktu, sedangkan editing berbasis rekaman juga butuh tahu
 * seberapa yakin mesinnya dan siapa yang bicara. Waktunya relatif terhadap awal
 * BERKAS REKAMAN, persis seperti yang dikeluarkan ASR — bukan relatif terhadap
 * scene, karena satu rekaman bisa dipakai banyak scene dengan titik masuk
 * berbeda.
 */
export const transcriptWordSchema = z.strictObject({
  word: z.string(),
  startSec: z.number().min(0).finite(),
  endSec: z.number().min(0).finite(),
  /** 0-1 kalau providernya melaporkan; tidak semua melaporkan. */
  confidence: z.number().min(0).max(1).optional(),
  /** Label diarisasi, mis. "A"/"B" atau "speaker_0" — apa adanya dari provider. */
  speaker: z.string().optional(),
});
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;

/** Satu giliran bicara: sudah berpunktuasi, untuk dibaca manusia dan agent. */
export const transcriptSegmentSchema = z.strictObject({
  startSec: z.number().min(0).finite(),
  endSec: z.number().min(0).finite(),
  text: z.string(),
  speaker: z.string().optional(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptSchema = z.strictObject({
  /** Id provider: "whisper-cpp" | "deepgram" | "elevenlabs-scribe" | "narration". */
  source: z.string().min(1),
  /** Bahasa yang TERDETEKSI (atau diminta), bukan bahasa proyek. */
  language: z.string().min(1),
  durationSec: finitePositive,
  words: z.array(transcriptWordSchema),
  segments: z.array(transcriptSegmentSchema).default([]),
  /**
   * True kalau transkrip ini diturunkan dari word timestamp TTS Dalang
   * sendiri, bukan dari mendengarkan rekaman. Dibedakan karena akurasinya
   * beda kelas — dan karena menyembunyikan bedanya berarti berbohong soal
   * dari mana angkanya datang.
   */
  fromNarration: z.boolean().optional(),
});
export type Transcript = z.infer<typeof transcriptSchema>;

export const renderStateSchema = z.strictObject({
  narrationAudio: z.record(z.string(), narrationAudioSchema).default({}),
  /**
   * Berkas nyata untuk visual dasar, dikunci ID KLIP (ADR-0033) — bukan id
   * scene. Alasannya sama persis dengan `layerAssets`: satu scene boleh punya
   * beberapa klip, dan klip kedua akan menimpa berkas klip pertama kalau
   * kuncinya scene.
   */
  clipAssets: z.record(z.string(), resolvedAssetSchema).default({}),
  /** Berkas nyata untuk grafis tempelan, dikunci id grafis (ADR-0018). */
  graphicAssets: z.record(z.string(), resolvedAssetSchema).default({}),
  /**
   * Berkas nyata untuk lapisan video, dikunci ID LAPISAN (ADR-0025) — bukan
   * id scene, karena satu scene boleh punya beberapa lapisan dan lapisan
   * kedua akan menimpa berkas lapisan pertama kalau kuncinya scene.
   */
  layerAssets: z.record(z.string(), resolvedAssetSchema).default({}),
  /** Berkas nyata untuk cue efek suara, dikunci id cue (ADR-0018). */
  sfxAssets: z.record(z.string(), resolvedAssetSchema).default({}),
  /** Berkas nyata untuk trek audio tambahan, dikunci id trek (ADR-0026). */
  trackAssets: z.record(z.string(), resolvedAssetSchema).default({}),
  /**
   * Transkrip, dikunci PATH BERKAS relatif-plan — bukan id scene (ADR-0021).
   * Satu rekaman panjang yang dipakai lima scene ditranskrip sekali, dan
   * transkripnya tidak basi saat scene berganti aset.
   */
  transcripts: z.record(z.string(), transcriptSchema).default({}),
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
    audio: audioSchema.default({ sfx: [], tracks: [] }),
    scenes: z.array(sceneSchema).min(1),
    renderState: renderStateSchema.default({
      narrationAudio: {},
      clipAssets: {},
      graphicAssets: {},
      layerAssets: {},
      sfxAssets: {},
      trackAssets: {},
      transcripts: {},
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

    /**
     * Setiap ruang id yang dipakai sebagai KUNCI di renderState harus unik
     * SE-PLAN — bukan se-scene.
     *
     * Alasannya sama untuk keempatnya: berkasnya dikunci per id di
     * `renderState.*Assets`, jadi dua benda bernama sama berbagi satu entri.
     * Yang terjadi kemudian tidak kelihatan sebagai galat: benda kedua diam-
     * diam memakai berkas milik yang pertama, dan menghapus salah satunya
     * mencabut berkas milik yang lain.
     *
     * Ditulis satu kali sebagai gelung karena ditulis empat kali berarti tiga
     * kesempatan untuk lupa. Aturan lapisan (ADR-0025) memang lahir lebih
     * dulu; saat trek audio (ADR-0026) ditambahkan, ternyata grafis dan cue
     * SFX tidak pernah punya penjagaan yang sama walau dikunci dengan cara
     * yang persis sama sejak ADR-0018.
     */
    const perScene: {
      field: "clips" | "layers" | "graphics";
      label: string;
      items: (scene: Scene) => { id: string }[];
    }[] = [
      { field: "clips", label: "klip", items: (scene) => scene.clips },
      { field: "layers", label: "lapisan", items: (scene) => scene.layers },
      { field: "graphics", label: "grafis", items: (scene) => scene.graphics },
    ];
    for (const { field, label, items } of perScene) {
      const ids = new Set<string>();
      plan.scenes.forEach((scene, sceneIndex) => {
        items(scene).forEach((item, itemIndex) => {
          if (ids.has(item.id)) {
            ctx.addIssue({
              code: "custom",
              path: ["scenes", sceneIndex, field, itemIndex, "id"],
              message: `Id ${label} "${item.id}" dipakai lebih dari sekali — id ${label} harus unik di seluruh plan`,
            });
          }
          ids.add(item.id);
        });
      });
    }

    /**
     * Begitu ada dua klip, waktu datang dari POTONGANNYA (ADR-0033 §2):
     * durasi scene adalah jumlah `durationSec` klipnya, jadi angka tetap di
     * `scene.duration` akan bertentangan dengan jumlah itu. Menskala klip agar
     * muat ke durasi yang ditetapkan tangan adalah keajaiban yang tidak bisa
     * ditebak siapa pun, jadi kombinasinya ditolak, bukan didamaikan.
     */
    plan.scenes.forEach((scene, index) => {
      if (scene.clips.length < 2) return;
      if (scene.duration !== "auto") {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "duration"],
          message:
            `Scene "${scene.id}" punya ${scene.clips.length} klip, jadi durasinya ` +
            `datang dari jumlah klip — "duration" wajib "auto".`,
        });
      }
      scene.clips.forEach((clip, clipIndex) => {
        if (clip.durationSec === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["scenes", index, "clips", clipIndex, "durationSec"],
            message:
              `Klip "${clip.id}" tidak punya durationSec — wajib saat scene ` +
              `memuat lebih dari satu klip.`,
          });
        }
      });
    });

    const perPlan: { field: "sfx" | "tracks"; label: string; items: { id: string }[] }[] =
      [
        { field: "sfx", label: "cue SFX", items: plan.audio.sfx },
        { field: "tracks", label: "trek audio", items: plan.audio.tracks },
      ];
    for (const { field, label, items } of perPlan) {
      const ids = new Set<string>();
      items.forEach((item, index) => {
        if (ids.has(item.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["audio", field, index, "id"],
            message: `Id ${label} "${item.id}" dipakai lebih dari sekali — id ${label} harus unik di seluruh plan`,
          });
        }
        ids.add(item.id);
      });
    }
  });

export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type ScenePlanInput = z.input<typeof scenePlanSchema>;

// ---------------------------------------------------------------------------
// Migrasi versi skema (ADR-0003 kebijakan, ADR-0033 pemakaian pertama)
// ---------------------------------------------------------------------------

/**
 * Id klip yang lahir dari migrasi v1 -> v2, DETERMINISTIK.
 *
 * Dihitung, bukan diundi: migrasi yang dijalankan dua kali harus menghasilkan
 * id yang sama, kalau tidak `clipAssets` kehilangan jejak berkasnya pada
 * jalan kedua. Alasan yang sama membuat kunci cache pipeline berupa hash isi.
 */
export const migratedClipId = (sceneId: string): string => `${sceneId}-k1`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * v1 -> v2 (ADR-0033 §7):
 *
 *   scene.visual                  -> scene.clips = [{ ...visual, id }]
 *   renderState.resolvedAssets[s] -> renderState.clipAssets[id]
 *
 * MURNI dan satu arah: tidak menulis berkas, tidak menyentuh masukannya. Plan
 * yang bermigrasi baru tersimpan saat plan itu memang disimpan, lewat jalur
 * tulis yang biasa. Bentuk yang tidak dikenali dibiarkan apa adanya — yang
 * memutuskan sah atau tidak tetap skema, bukan migrasi.
 */
export const migrateV1ToV2 = (input: unknown): unknown => {
  if (!isRecord(input)) return input;
  const next: Record<string, unknown> = { ...input, version: 2 };

  const scenes = input.scenes;
  if (Array.isArray(scenes)) {
    next.scenes = scenes.map((scene) => {
      if (!isRecord(scene) || !("visual" in scene)) return scene;
      const { visual, ...rest } = scene;
      const id = typeof scene.id === "string" ? scene.id : "";
      return {
        ...rest,
        clips: [{ ...(isRecord(visual) ? visual : {}), id: migratedClipId(id) }],
      };
    });
  }

  const renderState = input.renderState;
  if (isRecord(renderState) && "resolvedAssets" in renderState) {
    const { resolvedAssets, ...restState } = renderState;
    const clipAssets: Record<string, unknown> = {};
    if (isRecord(resolvedAssets)) {
      for (const [sceneId, asset] of Object.entries(resolvedAssets)) {
        clipAssets[migratedClipId(sceneId)] = asset;
      }
    }
    next.renderState = { ...restState, clipAssets };
  }

  return next;
};

/** Rantai migrasi, dari versi terlama ke versi sekarang. */
const MIGRATIONS: Record<number, (input: unknown) => unknown> = {
  1: migrateV1ToV2,
};

/**
 * Naikkan plan versi lama ke `SCHEMA_VERSION`, satu langkah per versi.
 *
 * Plan tanpa `version` dibiarkan lewat: yang berhak menolaknya adalah skema,
 * dengan pesan yang menyebut field yang hilang — bukan migrasi, dengan pesan
 * tentang versi yang tidak pernah ditulis siapa pun.
 */
export const migrateScenePlan = (input: unknown): unknown => {
  if (!isRecord(input) || typeof input.version !== "number") return input;
  let current: unknown = input;
  let version = input.version;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new Error(
        `Versi scene-plan ${version} tidak punya jalur migrasi ke ${SCHEMA_VERSION} (lihat ADR-0003).`,
      );
    }
    current = step(current);
    version =
      isRecord(current) && typeof current.version === "number"
        ? current.version
        : version + 1;
  }
  return current;
};

/** Parse and validate; throws with a readable message on invalid input. */
export const parseScenePlan = (input: unknown): ScenePlan => {
  if (typeof input === "object" && input !== null && "version" in input) {
    const version = (input as { version: unknown }).version;
    if (typeof version === "number" && version > SCHEMA_VERSION) {
      throw new Error(
        `Versi scene-plan ${JSON.stringify(version)} lebih baru daripada yang didukung (${SCHEMA_VERSION}) — ` +
          `perbarui Dalang, karena migrasi hanya berjalan maju.`,
      );
    }
    if (typeof version !== "number") {
      throw new Error(
        `Versi scene-plan ${JSON.stringify(version)} tidak didukung — versi yang didukung: ${SCHEMA_VERSION}.`,
      );
    }
  }
  const result = scenePlanSchema.safeParse(migrateScenePlan(input));
  if (!result.success) {
    throw new Error(`Scene-plan tidak valid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};

/**
 * Sama seperti `parseScenePlan`, tapi mengembalikan hasil alih-alih melempar.
 * IKUT memigrasikan: dua jalur parse yang berbeda pendapat soal versi adalah
 * cara termudah membuat Studio menerima plan yang ditolak CLI.
 */
export const safeParseScenePlan = (input: unknown) =>
  scenePlanSchema.safeParse(migrateScenePlan(input));

// ---------------------------------------------------------------------------
// Akses klip (ADR-0033)
// ---------------------------------------------------------------------------

/**
 * Klip pertama scene — visual dasar yang dulu bernama `scene.visual`.
 *
 * Skema menjamin `clips` tidak pernah kosong (`.min(1)`), jadi ini tidak
 * pernah undefined untuk plan yang sudah lolos parse. Fungsi ini ada supaya
 * ratusan pemanggil membaca "klip pertama" dengan satu nama, bukan menulis
 * `scene.clips[0]!` masing-masing dan tersebar saat klip jamak tiba.
 */
export const primaryClip = (scene: Scene): Clip => scene.clips[0] as Clip;

/** Berkas nyata satu klip, atau undefined kalau asetnya belum di-resolve. */
export const clipAsset = (plan: ScenePlan, clipId: string): ResolvedAsset | undefined =>
  plan.renderState.clipAssets[clipId];

/** Berkas nyata visual dasar sebuah scene — jalur terpendek yang paling sering dipakai. */
export const sceneAsset = (plan: ScenePlan, scene: Scene): ResolvedAsset | undefined =>
  plan.renderState.clipAssets[primaryClip(scene).id];

/**
 * Id klip dasar sebuah scene, dicari lewat id SCENE.
 *
 * Ada karena permukaan yang menerima perintah dari luar — tool agent, rute
 * Studio, server MCP — bicara dalam id SCENE, sementara `clipAssets` dikunci
 * id KLIP (ADR-0033). Terjemahan itu ditulis SATU kali di sini; ditulis tiga
 * kali berarti tiga kesempatan untuk memilih klip yang berbeda, dan yang
 * pertama menyimpang tidak akan terlihat sebagai galat — hanya sebagai berkas
 * yang tiba-tiba hilang dari satu scene.
 *
 * Melempar, bukan mengembalikan undefined: menulis berkas di bawah kunci yang
 * salah jauh lebih mahal daripada gagal terang-terangan.
 */
export const primaryClipId = (plan: ScenePlan, sceneId: string): string => {
  const scene = plan.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error(`Scene "${sceneId}" tidak ditemukan`);
  return primaryClip(scene).id;
};

/** Semua klip di seluruh plan, dengan scene pemiliknya. */
export const allClips = (plan: ScenePlan): { scene: Scene; clip: Clip }[] =>
  plan.scenes.flatMap((scene) => scene.clips.map((clip) => ({ scene, clip })));

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
