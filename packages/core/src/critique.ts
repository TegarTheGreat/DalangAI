import type { Scene, ScenePlan } from "./scene-plan";

/**
 * Kritik sutradara otomatis (ADR-0014): heuristik deterministik atas
 * scene-plan yang menandai pola "generic" — gerak kamera monoton, transisi
 * seragam, tanpa musik, hook lemah, narasi terlalu padat. Dipakai dua arah:
 * `dalang validate` menampilkannya ke manusia, dan konteks agent
 * menyuntikkannya supaya model memperbaiki kelemahan tanpa disuruh.
 *
 * Murni membaca plan — tidak pernah mengubah apa pun; keputusan tetap di
 * tangan pengarah (manusia atau agent).
 */

export interface DirectorNote {
  /** Kode stabil untuk test/telemetri, kebab-case. */
  code: string;
  level: "saran" | "perhatian";
  sceneId?: string;
  message: string;
}

const ASSET_TYPES = new Set(["stock", "image", "generated", "screenshot"]);

const wordCount = (text: string): number =>
  text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

/** Durasi efektif scene dalam detik, kalau bisa diketahui. */
const sceneSeconds = (plan: ScenePlan, scene: Scene): number | null => {
  if (typeof scene.duration === "number") return scene.duration;
  const audio = plan.renderState.narrationAudio[scene.id];
  return audio ? audio.durationSec : null;
};

export const critiquePlan = (plan: ScenePlan): DirectorNote[] => {
  const notes: DirectorNote[] = [];
  const scenes = plan.scenes;

  // 1. Musik latar — video tanpa bed musik terasa slideshow.
  if (!plan.audio.music) {
    notes.push({
      code: "musik-hening",
      level: "saran",
      message:
        "Tidak ada musik latar (audio.music). Bed musik pelan + ducking di bawah narasi adalah pembeda terbesar antara slideshow dan film.",
    });
  }

  // 2. Gerak kamera monoton pada scene beraset.
  const assetScenes = scenes.filter((s) => ASSET_TYPES.has(s.visual.type));
  if (assetScenes.length >= 3) {
    const motions = new Set(assetScenes.map((s) => s.visual.motion));
    if (motions.size === 1) {
      notes.push({
        code: "gerak-monoton",
        level: "saran",
        message: `Semua ${assetScenes.length} scene beraset memakai gerak kamera yang sama (${[...motions][0]}). Selang-seling kenburns-in/out dan pan agar mata tidak jenuh.`,
      });
    }
  }

  // 3. Transisi seragam (tipe DAN tempo).
  if (scenes.length >= 4) {
    const signatures = new Set(
      scenes
        .slice(0, -1)
        .map((s) => `${s.transition.type}:${s.transition.durationFrames}`),
    );
    if (signatures.size === 1) {
      notes.push({
        code: "transisi-monoton",
        level: "saran",
        message:
          "Semua transisi bertipe dan bertempo sama. Beri aksen: potongan cepat (durationFrames kecil) di momen energik, larut panjang untuk pergantian babak.",
      });
    }
  }

  // 4. Hook 3 detik pertama.
  const firstBody = scenes.find((s) => s.visual.type !== "template-anim");
  if (firstBody && wordCount(firstBody.narration) > 14 && firstBody.texts.length === 0) {
    notes.push({
      code: "hook-lemah",
      level: "saran",
      sceneId: firstBody.id,
      message: `Scene pembuka ${firstBody.id} bernarasi panjang tanpa teks overlay. Tambahkan satu kalimat hook (headline/kicker) di 3 detik pertama.`,
    });
  }

  // 5. Kepadatan narasi per scene (kata per detik).
  for (const scene of scenes) {
    const seconds = sceneSeconds(plan, scene);
    const words = wordCount(scene.narration);
    if (seconds === null || seconds <= 0 || words === 0) continue;
    const rate = words / seconds;
    if (rate > 3.2) {
      notes.push({
        code: "narasi-padat",
        level: "perhatian",
        sceneId: scene.id,
        message: `Scene ${scene.id}: ${words} kata dalam ${seconds.toFixed(1)} dtk (${rate.toFixed(1)} kata/dtk). Narasi akan terdengar terburu — ringkas naskah atau panjangkan scene.`,
      });
    }
  }

  // 6. Judul terlalu panjang untuk kartu title.
  if (wordCount(plan.meta.title) > 8) {
    notes.push({
      code: "judul-panjang",
      level: "saran",
      message: `Judul ${wordCount(plan.meta.title)} kata — kartu title paling kuat di bawah 8 kata; sisanya pindahkan ke dek (narasi scene title).`,
    });
  }

  // 7. Scene solid polos beruntun tanpa varian seni.
  const plainSolid = scenes.filter(
    (s) => s.visual.type === "solid" && (s.visual.variant ?? null) === null,
  );
  if (plainSolid.length >= 2) {
    notes.push({
      code: "solid-polos",
      level: "saran",
      message: `${plainSolid.length} scene solid tanpa varian seni. Pakai visual.variant (rays/topo/grid) supaya latar prosedural tidak seragam.`,
    });
  }

  // 8. Semua teks overlay datar (tanpa hierarki).
  const allTexts = scenes.flatMap((s) => s.texts);
  if (
    allTexts.length >= 2 &&
    allTexts.every((t) => t.emphasis === "none" && t.size === "m")
  ) {
    notes.push({
      code: "teks-datar",
      level: "saran",
      message:
        "Semua teks overlay berukuran M tanpa penekanan. Beri hierarki: satu headline L ber-emphasis (kotak/garis), pendukung S/M polos.",
    });
  }

  // 9. Tutup dengan outro.
  const last = scenes[scenes.length - 1];
  if (last && last.visual.type !== "template-anim") {
    notes.push({
      code: "outro-hilang",
      level: "saran",
      sceneId: last.id,
      message:
        "Scene terakhir bukan kartu template-anim. Outro (CTA/kredit) membuat video terasa selesai, bukan terpotong.",
    });
  }

  return notes;
};

/** Format catatan jadi baris teks siap tampil (CLI/konteks agent). */
export const formatDirectorNotes = (notes: DirectorNote[]): string[] =>
  notes.map((n) => `[${n.level === "perhatian" ? "PERHATIAN" : "saran"}] ${n.message}`);
