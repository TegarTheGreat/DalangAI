import {
  type NarrationAudio,
  narrationAudioSchema,
  type ProxyMedia,
  primaryClip,
  proxyMediaSchema,
  type ResolvedAsset,
  resolvedAssetSchema,
  type ScenePlan,
  type Transcript,
  transcriptSchema,
} from "./scene-plan";

/**
 * renderState mutation helpers — the pipeline's write path.
 *
 * renderState is DERIVED data (PRD §5.1): it is not part of the creative
 * intent, so it is intentionally outside the patch-op / undo system. Undoing a
 * narration edit must not undo a finished TTS file; the pipeline simply
 * re-derives stale entries (content-hash caching makes that cheap).
 */

export const setNarrationAudio = (
  plan: ScenePlan,
  sceneId: string,
  audio: NarrationAudio,
): ScenePlan => {
  const next = structuredClone(plan);
  next.renderState.narrationAudio[sceneId] = narrationAudioSchema.parse(audio);
  return next;
};

/**
 * Berkas nyata untuk satu KLIP (ADR-0033). Dikunci id klip, bukan id scene:
 * satu scene boleh punya beberapa klip, dan klip kedua akan menimpa berkas
 * klip pertama kalau kuncinya scene.
 */
export const setClipAsset = (
  plan: ScenePlan,
  clipId: string,
  asset: ResolvedAsset,
): ScenePlan => {
  const next = structuredClone(plan);
  next.renderState.clipAssets[clipId] = resolvedAssetSchema.parse(asset);
  return next;
};

/**
 * Berkas nyata untuk satu grafis tempelan (ADR-0018). Dikunci per ID GRAFIS,
 * bukan per scene, karena satu scene boleh punya beberapa tempelan.
 */
export const setGraphicAsset = (
  plan: ScenePlan,
  graphicId: string,
  asset: ResolvedAsset,
): ScenePlan => {
  const next = structuredClone(plan);
  next.renderState.graphicAssets[graphicId] = resolvedAssetSchema.parse(asset);
  return next;
};

/**
 * Berkas nyata untuk satu lapisan video (ADR-0025), dikunci per ID LAPISAN.
 *
 * Alasannya sama dengan grafis: satu scene boleh punya beberapa lapisan, jadi
 * mengunci per scene membuat lapisan kedua menimpa berkas lapisan pertama.
 */
export const setLayerAsset = (
  plan: ScenePlan,
  layerId: string,
  asset: ResolvedAsset,
): ScenePlan => {
  const next = structuredClone(plan);
  next.renderState.layerAssets[layerId] = resolvedAssetSchema.parse(asset);
  return next;
};

/**
 * Jalur tulis auto-resolve untuk lapisan: mencatat berkas DAN mengisi
 * `layer.visual.assetId` tanpa mem-pin — cermin `assignResolvedAsset`.
 * Menolak lapisan ter-pin: pilihan eksplisit tidak pernah ditimpa otomatis.
 */
export const assignLayerAsset = (
  plan: ScenePlan,
  sceneId: string,
  layerId: string,
  assetId: string,
  asset: ResolvedAsset,
): ScenePlan => {
  const next = structuredClone(plan);
  const scene = next.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    throw new Error(`assignLayerAsset: scene "${sceneId}" tidak ditemukan`);
  }
  const layer = scene.layers.find((candidate) => candidate.id === layerId);
  if (!layer) {
    throw new Error(
      `assignLayerAsset: lapisan "${layerId}" tidak ada di scene "${sceneId}"`,
    );
  }
  if (layer.visual.pinned) {
    throw new Error(
      `assignLayerAsset: aset lapisan "${layerId}" ter-pin — auto-resolve tidak boleh menimpanya`,
    );
  }
  layer.visual.assetId = assetId;
  next.renderState.layerAssets[layerId] = resolvedAssetSchema.parse(asset);
  return next;
};

/** Berkas nyata untuk satu cue efek suara (ADR-0018), dikunci per ID CUE. */
export const setSfxAsset = (
  plan: ScenePlan,
  cueId: string,
  asset: ResolvedAsset,
): ScenePlan => {
  const next = structuredClone(plan);
  next.renderState.sfxAssets[cueId] = resolvedAssetSchema.parse(asset);
  return next;
};

/** Berkas nyata untuk satu trek audio tambahan (ADR-0026), dikunci ID TREK. */
export const setTrackAsset = (
  plan: ScenePlan,
  trackId: string,
  asset: ResolvedAsset,
): ScenePlan => {
  const next = structuredClone(plan);
  next.renderState.trackAssets[trackId] = resolvedAssetSchema.parse(asset);
  return next;
};

/**
 * Hasil ukur kenyaringan satu berkas (ADR-0026), ditulis ke SEMUA entri
 * renderState yang menunjuk berkas itu.
 *
 * Dikunci PATH BERKAS, bukan id pemakainya: satu rekaman yang dipakai lima
 * scene diukur sekali, dan mengukurnya ulang per pemakai hanya membakar waktu
 * untuk mendapat angka yang sama persis.
 */
export const setLoudness = (
  plan: ScenePlan,
  file: string,
  lufs: number,
  channels?: number,
): ScenePlan => {
  const next = structuredClone(plan);
  for (const store of [
    next.renderState.clipAssets,
    next.renderState.layerAssets,
    next.renderState.sfxAssets,
    next.renderState.trackAssets,
  ]) {
    for (const asset of Object.values(store)) {
      if (asset.file === file) {
        asset.lufs = lufs;
        if (channels !== undefined) asset.channels = channels;
      }
    }
  }
  for (const audio of Object.values(next.renderState.narrationAudio)) {
    if (audio.file === file) {
      audio.lufs = lufs;
      if (channels !== undefined) audio.channels = channels;
    }
  }
  return next;
};

/** Fakta sumber yang ikut dicatat bersama proxy-nya (ADR-0028). */
export interface MediaProbeNote {
  codec?: string | null;
  fps?: number | null;
}

/**
 * Proxy pratinjau satu berkas video (ADR-0028), ditulis ke SEMUA entri
 * lumbung VIDEO yang menunjuk berkas itu — pola yang sama dengan `setLoudness`,
 * dengan alasan yang sama: proxy milik REKAMANNYA, bukan milik scene yang
 * kebetulan memakainya.
 *
 * `proxy` null berarti "sudah diperiksa, tidak perlu proxy": entri proxy
 * lamanya (bila ada) DIHAPUS supaya preview kembali memakai aslinya, dan fakta
 * sumbernya (kodek, laju bingkai) tetap dicatat.
 */
export const setProxy = (
  plan: ScenePlan,
  file: string,
  proxy: ProxyMedia | null,
  note: MediaProbeNote = {},
): ScenePlan => {
  const next = structuredClone(plan);
  const parsed = proxy ? proxyMediaSchema.parse(proxy) : null;
  for (const store of [next.renderState.clipAssets, next.renderState.layerAssets]) {
    for (const asset of Object.values(store)) {
      if (asset.file !== file) continue;
      if (parsed) asset.proxy = parsed;
      else delete asset.proxy;
      if (note.codec) asset.codec = note.codec;
      if (note.fps) asset.fps = note.fps;
    }
  }
  return next;
};

/**
 * Transkrip satu berkas rekaman (ADR-0021), dikunci PATH BERKAS relatif-plan.
 *
 * Bukan per scene: satu rekaman satu jam yang dipakai lima scene ditranskrip
 * sekali, dan transkripnya tetap sah saat scene-nya dipotong ulang atau
 * dihapus. Sama seperti entri renderState lain, ini data turunan — di luar
 * patch op, jadi undo pada potongan tidak pernah menghapus hasil transkripsi.
 */
export const setTranscript = (
  plan: ScenePlan,
  file: string,
  transcript: Transcript,
): ScenePlan => {
  const next = structuredClone(plan);
  next.renderState.transcripts[file] = transcriptSchema.parse(transcript);
  return next;
};

/**
 * Entri grafis/cue di renderState yang sudah tidak dirujuk plan (ADR-0018).
 *
 * Sengaja KUERI, bukan mutasi. Menghapus entri yatim saat grafis dibuang
 * terdengar rapi, tapi merusak undo: `updateScene` yang mengembalikan grafis
 * itu tidak mengembalikan berkasnya, sehingga render jadi 404 pada aksi yang
 * seharusnya persis membatalkan penghapusan. Yang benar-benar dibutuhkan
 * pemanggilnya hanya "jangan ikut disalin/diperiksa" — dan itu bisa dilakukan
 * tanpa menyentuh plan.
 */
export const orphanMediaAssetIds = (
  plan: ScenePlan,
): { graphics: string[]; layers: string[]; sfx: string[]; tracks: string[] } => {
  const graphicIds = new Set(plan.scenes.flatMap((s) => s.graphics.map((g) => g.id)));
  const layerIds = new Set(plan.scenes.flatMap((s) => s.layers.map((l) => l.id)));
  const cueIds = new Set(plan.audio.sfx.map((cue) => cue.id));
  const trackIds = new Set(plan.audio.tracks.map((track) => track.id));
  return {
    graphics: Object.keys(plan.renderState.graphicAssets).filter(
      (id) => !graphicIds.has(id),
    ),
    layers: Object.keys(plan.renderState.layerAssets).filter((id) => !layerIds.has(id)),
    sfx: Object.keys(plan.renderState.sfxAssets).filter((id) => !cueIds.has(id)),
    tracks: Object.keys(plan.renderState.trackAssets).filter((id) => !trackIds.has(id)),
  };
};

/**
 * Pipeline auto-resolve write path: records the chosen asset in
 * renderState AND fills `clip.assetId` (PRD §5.1: "diisi pipeline setelah
 * fetch") — WITHOUT pinning, so the user/agent can still replace it.
 * Refuses pinned clips: an explicitly chosen asset is never auto-replaced.
 *
 * `clipId` memilih POTONGAN yang ditulisi (ADR-0033); tanpa itu potongan
 * pertama, yaitu perilaku sebelum klip ada. Pin diperiksa pada potongan yang
 * disasar, bukan pada potongan pertama: satu potongan yang dipilih tangan
 * tidak boleh ditimpa auto-resolve, dan potongan lain di scene yang sama tidak
 * boleh ikut terkunci karenanya.
 */
export const assignResolvedAsset = (
  plan: ScenePlan,
  sceneId: string,
  assetId: string,
  asset: ResolvedAsset,
  clipId?: string,
): ScenePlan => {
  const next = structuredClone(plan);
  const scene = next.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    throw new Error(`assignResolvedAsset: scene "${sceneId}" tidak ditemukan`);
  }
  const clip =
    clipId === undefined
      ? primaryClip(scene)
      : scene.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw new Error(
      `assignResolvedAsset: klip "${clipId}" tidak ada di scene "${sceneId}"`,
    );
  }
  if (clip.pinned) {
    throw new Error(
      `assignResolvedAsset: aset klip "${clip.id}" ter-pin — auto-resolve tidak boleh menimpanya`,
    );
  }
  clip.assetId = assetId;
  next.renderState.clipAssets[clip.id] = resolvedAssetSchema.parse(asset);
  return next;
};

/** Drop derived entries for scenes that no longer exist (housekeeping). */
export const pruneRenderState = (plan: ScenePlan): ScenePlan => {
  const next = structuredClone(plan);
  const ids = new Set(next.scenes.map((scene) => scene.id));
  for (const key of Object.keys(next.renderState.narrationAudio)) {
    if (!ids.has(key)) delete next.renderState.narrationAudio[key];
  }
  const clipIds = new Set(
    next.scenes.flatMap((scene) => scene.clips.map((clip) => clip.id)),
  );
  for (const key of Object.keys(next.renderState.clipAssets)) {
    if (!clipIds.has(key)) delete next.renderState.clipAssets[key];
  }
  return next;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Terapkan PERUBAHAN renderState dari `before` → `after` di atas `base`
 * (koherensi Studio–server MCP, lanjutan ADR-0023).
 *
 * Tahap pipeline bekerja pada SNAPSHOT plan dan bisa berjalan lama. Kalau
 * selama itu berkasnya diubah pihak lain (server MCP, CLI, editor teks),
 * menulis `after` apa adanya menimpa editan itu tanpa suara. Yang dimiliki
 * tahap hanyalah renderState-nya, jadi yang dipindahkan hanya DELTA
 * renderState-nya: entri yang ditambah/diubah ditulis, entri yang dihapus
 * dihapus, dan sisanya — kreatif maupun turunan — tetap milik `base`.
 * Entri yang tidak disentuh tahap TIDAK ditulis ulang, supaya entri yang
 * diubah pihak lain selama tahap berjalan tidak ikut tertimpa.
 */
export const rebaseRenderState = (
  base: ScenePlan,
  before: ScenePlan,
  after: ScenePlan,
): ScenePlan => {
  const next = structuredClone(base);
  const target = next.renderState as unknown as Record<string, unknown>;
  const was = before.renderState as unknown as Record<string, unknown>;
  const now = after.renderState as unknown as Record<string, unknown>;
  for (const section of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const prev = was[section];
    const curr = now[section];
    if (isRecord(prev) && isRecord(curr)) {
      const existing = target[section];
      const merged: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
      for (const key of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
        if (JSON.stringify(prev[key]) === JSON.stringify(curr[key])) continue;
        if (curr[key] === undefined) delete merged[key];
        else merged[key] = structuredClone(curr[key]);
      }
      target[section] = merged;
    } else if (JSON.stringify(prev) !== JSON.stringify(curr)) {
      target[section] = structuredClone(curr);
    }
  }
  return next;
};
