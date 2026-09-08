import { z } from "zod";
import type { PatchOpInput } from "./patch";
import {
  type captionSchema,
  emptyRenderState,
  parseScenePlan,
  type ScenePlan,
  scenePlanSchema,
} from "./scene-plan";

/**
 * Paket template (ADR-0037, roadmap §10.2).
 *
 * Sebuah template adalah SCENE-PLAN yang sah, bukan bentuk data ketiga.
 * Keputusan itu yang paling menentukan modul ini: template yang punya skema
 * sendiri harus dikejar setiap kali plan bertambah kemampuan, dan yang
 * tertinggal bukan cuma field melainkan kepercayaan — orang memasang template
 * lalu mendapati separuh yang dijanjikannya tidak ikut. Karena isinya plan,
 * ia bisa divalidasi parser yang sama, dirender renderer yang sama, dan
 * dikritik kritikus yang sama.
 *
 * Yang ditambahkan hanya MANIFES: siapa yang membuatnya, namanya apa, dan
 * versinya berapa — tiga hal yang tidak ada di plan karena plan adalah satu
 * video, bukan barang yang dibagikan.
 *
 * Modul ini MURNI. Registrinya (berkas di rumah Dalang) ada di paket agent,
 * persis seperti memori preferensi (ADR-0029).
 */

/** Versi bentuk paket. Naik hanya kalau manifesnya berubah, bukan plannya. */
export const TEMPLATE_FORMAT = 1;

export const MAX_TEMPLATE_NAME = 60;
export const MAX_TEMPLATE_DESCRIPTION = 240;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const templateManifestSchema = z.strictObject({
  /**
   * Id yang jadi NAMA BERKASNYA di registri, jadi bentuknya dibatasi: huruf
   * kecil, angka, dan tanda hubung. Id bebas akan berujung pada template
   * bernama `../../.bashrc`.
   */
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(slugPattern, "id template hanya huruf kecil, angka, dan tanda hubung"),
  name: z.string().min(2).max(MAX_TEMPLATE_NAME),
  description: z.string().max(MAX_TEMPLATE_DESCRIPTION).default(""),
  /** Nama pembuatnya apa adanya; kosong = tidak menyebut siapa pun. */
  author: z.string().max(MAX_TEMPLATE_NAME).default(""),
  /** Bebas dibaca manusia ("1.0", "2026-09"); tidak dipakai untuk logika apa pun. */
  version: z.string().min(1).max(32).default("1.0"),
  /** ISO 8601. */
  createdAt: z.string().min(1),
});
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

export const templatePackSchema = z.strictObject({
  format: z.literal(TEMPLATE_FORMAT),
  manifest: templateManifestSchema,
  /**
   * Kerangkanya, sebagai plan yang SAH. Bukan plan "hampir sah" yang harus
   * ditambal saat dipasang: template yang cuma bisa divalidasi setelah
   * dipakai adalah template yang rusaknya baru ketahuan di proyek orang.
   */
  plan: scenePlanSchema,
});
export type TemplatePack = z.infer<typeof templatePackSchema>;
export type TemplatePackInput = z.input<typeof templatePackSchema>;

export const parseTemplatePack = (input: unknown): TemplatePack => {
  const result = templatePackSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Paket template tidak sah:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};

/**
 * Apa saja yang DIBUANG saat sebuah proyek dijadikan template.
 *
 * Dilaporkan ke pemakainya, tidak cuma dilakukan: yang mengekspor berhak tahu
 * bahwa musik pilihannya tidak ikut, sebelum ia mengira template-nya lengkap
 * lalu heran kenapa videonya sunyi di komputer orang lain.
 */
export interface TemplateStripReport {
  /** Klip yang aset-nya dilepas. */
  clipAssets: number;
  layerAssets: number;
  graphics: number;
  sfx: number;
  audioTracks: number;
  music: boolean;
  transcripts: number;
  proxies: number;
}

const isEmptyReport = (report: TemplateStripReport): boolean =>
  report.clipAssets === 0 &&
  report.layerAssets === 0 &&
  report.graphics === 0 &&
  report.sfx === 0 &&
  report.audioTracks === 0 &&
  !report.music &&
  report.transcripts === 0 &&
  report.proxies === 0;

/** Baris ringkas untuk CLI dan Studio; kosong berarti tidak ada yang dibuang. */
export const describeStrip = (report: TemplateStripReport): string[] => {
  if (isEmptyReport(report)) return [];
  const lines: string[] = [];
  if (report.clipAssets > 0) lines.push(`${report.clipAssets} aset klip dilepas`);
  if (report.layerAssets > 0) lines.push(`${report.layerAssets} aset lapisan dilepas`);
  if (report.graphics > 0) lines.push(`${report.graphics} grafis tempelan dibuang`);
  if (report.music) lines.push("musik latar dibuang");
  if (report.audioTracks > 0) lines.push(`${report.audioTracks} trek audio dibuang`);
  if (report.sfx > 0) lines.push(`${report.sfx} bunyi tempelan dibuang`);
  if (report.transcripts > 0) lines.push(`${report.transcripts} transkrip dibuang`);
  if (report.proxies > 0) lines.push(`${report.proxies} proxy dibuang`);
  return lines;
};

/**
 * Berapa aset ter-resolve yang punya proxy pratinjau (ADR-0028).
 *
 * Dihitung dari `renderState`, tempat proxy sesungguhnya hidup — bukan dari
 * folder `.dalang/proxies/`, yang tidak bisa dilihat modul murni ini dan
 * memang bukan kebenarannya.
 */
const countProxies = (plan: ScenePlan): number => {
  const buckets = [
    plan.renderState.clipAssets,
    plan.renderState.layerAssets,
    plan.renderState.trackAssets,
  ];
  let count = 0;
  for (const bucket of buckets) {
    for (const asset of Object.values(bucket)) if (asset.proxy) count++;
  }
  return count;
};

/**
 * Rujukan yang berkasnya ADA di setiap pemasangan Dalang, jadi ia tetap
 * berarti di komputer orang lain.
 *
 * Dua bentuk: ikon `iconify:<set>:<nama>` yang digambar dari pustaka terbuka,
 * dan `pustaka:<id>` untuk bunyi serta musik ter-bundle (ADR-0018). Apa pun
 * selain itu adalah id aset proyek — berkas yang tidak ikut berpindah, dan
 * yang di template hanya akan jadi tautan putus.
 */
const isPortableRef = (ref: string): boolean =>
  ref.startsWith("pustaka:") || ref.startsWith("iconify:");

/**
 * Satu aturan, dan cuma satu: **template membawa semua yang dibawa plan,
 * KECUALI apa pun yang menunjuk sebuah berkas.**
 *
 * Kata-kata ikut — narasi, teks overlay, judul — karena itu yang sengaja
 * dituliskan pembuatnya untuk dibagikan, dan template dengan kotak kosong
 * mengajarkan lebih sedikit daripada template yang menunjukkan iramanya.
 * Berkas tidak ikut karena berkas tidak ikut berpindah komputer: aset,
 * musik, trek audio, transkrip, proxy, dan seluruh `renderState` adalah
 * tautan yang di mesin orang lain hanya akan menjadi tautan putus.
 *
 * Pengecualiannya satu dan bisa diperiksa: rujukan yang berkasnya ada di
 * SETIAP pemasangan Dalang — ikon `iconify:` dan bunyi `pustaka:` — ikut,
 * sebab di komputer orang lain ia tetap berarti hal yang sama.
 */
export const templateFromPlan = (
  plan: ScenePlan,
  manifest: TemplateManifest,
): { pack: TemplatePack; stripped: TemplateStripReport } => {
  // Musik ter-bundle IKUT — berkasnya ada di setiap pemasangan, dan kritikus
  // repo ini sendiri menyebut bed musik "pembeda terbesar antara slideshow
  // dan film". Template yang membuang musik pustaka membuang hal itu tanpa
  // sebab.
  const music = plan.audio.music;
  // `undefined`, bukan `null`: `audio.music` OPSIONAL di skema, dan `null`
  // ditolaknya. Perbedaan yang tidak terlihat sampai sebuah paket gagal
  // divalidasi oleh skema yang menghasilkannya sendiri.
  const keepMusic = music !== undefined && isPortableRef(music.assetId);
  const stripped: TemplateStripReport = {
    clipAssets: 0,
    layerAssets: 0,
    graphics: 0,
    sfx: 0,
    audioTracks: 0,
    music: music !== undefined && !keepMusic,
    transcripts: Object.keys(plan.renderState.transcripts).length,
    proxies: countProxies(plan),
  };

  const scenes = plan.scenes.map((scene) => ({
    ...scene,
    clips: scene.clips.map((clip) => {
      if (clip.assetId !== null) stripped.clipAssets++;
      return { ...clip, assetId: null, pinned: false };
    }),
    layers: scene.layers.map((layer) => {
      if (layer.visual.assetId !== null) stripped.layerAssets++;
      return {
        ...layer,
        visual: { ...layer.visual, assetId: null, pinned: false },
      };
    }),
    graphics: scene.graphics.filter((graphic) => {
      const keep = isPortableRef(graphic.ref);
      if (!keep) stripped.graphics++;
      return keep;
    }),
  }));

  const sfx = plan.audio.sfx.filter((cue) => {
    const keep = isPortableRef(cue.assetId);
    if (!keep) stripped.sfx++;
    return keep;
  });
  stripped.audioTracks = plan.audio.tracks.length;

  const pack = parseTemplatePack({
    format: TEMPLATE_FORMAT,
    manifest: templateManifestSchema.parse(manifest),
    plan: {
      ...plan,
      scenes,
      audio: {
        ...plan.audio,
        ...(keepMusic ? { music } : { music: undefined }),
        tracks: [],
        sfx,
      },
      renderState: emptyRenderState(),
    },
  });
  return { pack, stripped };
};

/**
 * Plan baru dari sebuah template.
 *
 * Judul dan `projectId` DIGANTI, sisanya diambil apa adanya. Dua alasan
 * keduanya wajib: dua proyek berbagi `projectId` akan berbagi entri ledger
 * pipeline, dan template yang membawa judul pembuatnya akan diam-diam
 * menerbitkan video berjudul milik orang lain.
 */
export const planFromTemplate = (
  pack: TemplatePack,
  input: { title: string; projectId: string },
): ScenePlan => {
  const title = input.title.trim();
  if (title === "") throw new Error("Judul proyek tidak boleh kosong");
  const projectId = input.projectId.trim();
  if (projectId === "") throw new Error("projectId tidak boleh kosong");
  return parseScenePlan({
    ...pack.plan,
    projectId,
    meta: { ...pack.plan.meta, title },
    renderState: emptyRenderState(),
  });
};

/**
 * Patch "pakai TAMPILAN template ini" untuk plan yang SUDAH ADA.
 *
 * Ini setengah dari §10.2 yang paling sering dibutuhkan orang: bukan memulai
 * dari nol dengan kerangka orang lain, melainkan meminjam tampilannya untuk
 * video yang sudah ditulis sendiri. Karena itu ia hanya menyentuh yang
 * TAMPILAN — preset, rasio, token warna & huruf, zona aman, bahasa, format —
 * dan gaya caption tiap scene. Narasi, potongan, aset, dan durasi tidak
 * disentuh sama sekali: yang dipinjam rupanya, bukan isinya.
 *
 * Keluarannya PATCH OP, bukan plan baru, supaya masuk ke jalur yang sama
 * dengan setiap perubahan lain — tercatat, bisa di-undo, terlihat agent.
 */
export const templateLookOps = (pack: TemplatePack, plan: ScenePlan): PatchOpInput[] => {
  const meta = pack.plan.meta;
  const ops: PatchOpInput[] = [
    {
      op: "setMeta",
      patch: {
        aspectRatio: meta.aspectRatio,
        stylePreset: meta.stylePreset,
        format: meta.format,
        language: meta.language,
        safeArea: meta.safeArea,
        // `tokens` tidak ada di sebagian template, dan MENGOSONGKANNYA berbeda
        // dari tidak menyebutnya: template tanpa token berarti "pakai warna
        // bawaan preset", jadi tokennya memang harus dikosongkan.
        tokens: meta.tokens ?? {},
      },
    },
  ];

  // Gaya caption diambil dari scene ISI PERTAMA template — bukan dari scene
  // pertama begitu saja, yang di sebagian besar template adalah kartu judul
  // dan caption-nya mati.
  const source = captionSourceOf(pack);
  if (source) {
    for (const scene of plan.scenes) {
      if (scene.locked) continue;
      ops.push({
        op: "updateScene",
        id: scene.id,
        patch: {
          caption: { style: source.style, size: source.size, position: source.position },
        },
      });
    }
  }
  return ops;
};

/** Caption scene isi pertama template, kalau ada yang caption-nya menyala. */
export const captionSourceOf = (
  pack: TemplatePack,
): z.infer<typeof captionSchema> | null =>
  pack.plan.scenes.find((scene) => scene.caption.enabled)?.caption ?? null;

/** Ringkasan satu baris untuk daftar di CLI dan Studio. */
export const describeTemplate = (pack: TemplatePack): string => {
  const meta = pack.plan.meta;
  const parts = [
    `${pack.plan.scenes.length} scene`,
    meta.aspectRatio,
    `preset ${meta.stylePreset}`,
    `format ${meta.format}`,
  ];
  return parts.join(" · ");
};
