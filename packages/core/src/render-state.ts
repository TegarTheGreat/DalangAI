import {
  type NarrationAudio,
  narrationAudioSchema,
  type ResolvedAsset,
  resolvedAssetSchema,
  type ScenePlan,
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

export const setResolvedAsset = (
  plan: ScenePlan,
  sceneId: string,
  asset: ResolvedAsset,
): ScenePlan => {
  const next = structuredClone(plan);
  next.renderState.resolvedAssets[sceneId] = resolvedAssetSchema.parse(asset);
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
): { graphics: string[]; sfx: string[] } => {
  const graphicIds = new Set(plan.scenes.flatMap((s) => s.graphics.map((g) => g.id)));
  const cueIds = new Set(plan.audio.sfx.map((cue) => cue.id));
  return {
    graphics: Object.keys(plan.renderState.graphicAssets).filter(
      (id) => !graphicIds.has(id),
    ),
    sfx: Object.keys(plan.renderState.sfxAssets).filter((id) => !cueIds.has(id)),
  };
};

/**
 * Pipeline auto-resolve write path: records the chosen asset in
 * renderState AND fills `visual.assetId` (PRD §5.1: "diisi pipeline setelah
 * fetch") — WITHOUT pinning, so the user/agent can still replace it.
 * Refuses pinned scenes: an explicitly chosen asset is never auto-replaced.
 */
export const assignResolvedAsset = (
  plan: ScenePlan,
  sceneId: string,
  assetId: string,
  asset: ResolvedAsset,
): ScenePlan => {
  const next = structuredClone(plan);
  const scene = next.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    throw new Error(`assignResolvedAsset: scene "${sceneId}" tidak ditemukan`);
  }
  if (scene.visual.pinned) {
    throw new Error(
      `assignResolvedAsset: aset scene "${sceneId}" ter-pin — auto-resolve tidak boleh menimpanya`,
    );
  }
  scene.visual.assetId = assetId;
  next.renderState.resolvedAssets[sceneId] = resolvedAssetSchema.parse(asset);
  return next;
};

/** Drop derived entries for scenes that no longer exist (housekeeping). */
export const pruneRenderState = (plan: ScenePlan): ScenePlan => {
  const next = structuredClone(plan);
  const ids = new Set(next.scenes.map((scene) => scene.id));
  for (const key of Object.keys(next.renderState.narrationAudio)) {
    if (!ids.has(key)) delete next.renderState.narrationAudio[key];
  }
  for (const key of Object.keys(next.renderState.resolvedAssets)) {
    if (!ids.has(key)) delete next.renderState.resolvedAssets[key];
  }
  return next;
};
