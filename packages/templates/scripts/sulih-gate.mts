/**
 * Gerbang sulih suara (ADR-0040).
 *
 * Klaim yang dijaga: "menukar bahasa menghasilkan VIDEO LAIN yang utuh, bukan
 * video yang sama dengan teks lain di atasnya".
 *
 * Tiga hal yang tidak bisa dibuktikan tes unit:
 *
 * 1. **Durasinya benar-benar ikut bahasanya.** Ini keputusan utama ADR-0040 —
 *    sulihan yang lebih pendek menghasilkan video yang lebih pendek, bukan
 *    ucapan yang dipercepat. Kalau `planInLanguage` suatu hari berhenti
 *    menukar audionya, durasinya akan diam-diam sama persis dan tidak satu pun
 *    tes format yang merah.
 * 2. **Tidak ada sisa bahasa lain yang terbawa.** Plan hasil tukar harus
 *    SATU BAHASA: `dubs`, `dubAudio`, `dubVoices`, dan `dubTitles` kosong.
 *    Sisa data adalah cara termudah jalur di hilir membaca bahasa yang salah.
 * 3. **Subtitle bahasa itu memakai jam bahasa itu.** Kartu terakhir harus
 *    jatuh di dalam durasi video BAHASA ITU, bukan durasi bahasa utama.
 *
 * Jalankan: pnpm --filter @dalang/templates gate:sulih
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dubCoverage,
  parseScenePlan,
  planInLanguage,
  planLanguages,
  type ScenePlan,
} from "@dalang/core";
import { activeSceneIndex, computeFrameLayout, FPS } from "../src/layout";
import { buildSubtitleCues } from "../src/subtitle";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const demo = process.argv[2]
  ? resolve(repoRoot, process.argv[2])
  : join(repoRoot, "examples", "sulih-dua-bahasa", "plan.json");

const plan: ScenePlan = parseScenePlan(JSON.parse(readFileSync(demo, "utf8")));
const problems: string[] = [];

const bahasa = planLanguages(plan);
if (bahasa.length < 2) {
  console.error(
    `GERBANG SULIH GAGAL: ${demo} cuma punya satu bahasa (${bahasa[0]}).\n` +
      "  Gerbang yang berjalan atas plan tanpa sulihan tidak menguji apa pun.",
  );
  process.exit(1);
}

const utama = computeFrameLayout(plan);
console.log(`Gerbang sulih atas ${demo}`);
console.log(
  `  bahasa utama ${plan.meta.language}: ${(utama.totalFrames / FPS).toFixed(2)} dtk`,
);

for (const lang of bahasa.slice(1)) {
  const swap = planInLanguage(plan, lang);
  const layout = computeFrameLayout(swap);
  const cakupan = dubCoverage(plan, lang);
  const detik = layout.totalFrames / FPS;
  console.log(
    `  ${lang}: ${detik.toFixed(2)} dtk · teks ${cakupan.diterjemahkan}/${cakupan.perlu} · ` +
      `suara ${cakupan.bersuara}/${cakupan.perlu}`,
  );

  // --- 1. Plan hasil tukar harus SATU BAHASA, tanpa sisa ---
  if (swap.meta.language !== lang) {
    problems.push(`${lang}: meta.language masih "${swap.meta.language}"`);
  }
  if (Object.keys(swap.meta.dubTitles).length > 0) {
    problems.push(`${lang}: meta.dubTitles tidak dikosongkan`);
  }
  if (Object.keys(swap.renderState.dubAudio).length > 0) {
    problems.push(`${lang}: renderState.dubAudio tidak dikosongkan`);
  }
  if (Object.keys(swap.audio.dubVoices).length > 0) {
    problems.push(`${lang}: audio.dubVoices tidak dikosongkan`);
  }
  for (const scene of swap.scenes) {
    if (Object.keys(scene.dubs).length > 0) {
      problems.push(`${lang}: scene ${scene.id} masih membawa dubs`);
    }
    for (const text of scene.texts) {
      if (Object.keys(text.dubs).length > 0) {
        problems.push(`${lang}: teks ${scene.id}/${text.id} masih membawa dubs`);
      }
    }
  }

  // --- 2. SUSUNAN video tidak boleh berubah antar bahasa ---
  // Scene yang belum disulih jadi bisu, bukan hilang: dua video yang jumlah
  // scene-nya berbeda bukan lagi satu video yang disulih.
  if (swap.scenes.length !== plan.scenes.length) {
    problems.push(
      `${lang}: jumlah scene berubah (${plan.scenes.length} -> ${swap.scenes.length})`,
    );
  }
  swap.scenes.forEach((scene, index) => {
    if (scene.id !== plan.scenes[index]?.id) {
      problems.push(`${lang}: urutan scene berubah di posisi ${index}`);
    }
  });

  // --- 3. Audio narasi bahasa itu benar-benar dipakai ---
  const dipakai = Object.keys(swap.renderState.narrationAudio).length;
  if (dipakai !== cakupan.bersuara) {
    problems.push(
      `${lang}: ${cakupan.bersuara} scene punya audio sulih tapi hanya ${dipakai} yang masuk ke narrationAudio`,
    );
  }

  // --- 4. Durasi IKUT bahasanya ---
  // Keputusan utama ADR-0040. Kalau `planInLanguage` suatu hari berhenti
  // menukar narasi atau audionya, durasinya jadi sama persis dengan bahasa
  // utama dan tidak satu pun tes format yang merah.
  //
  // Dibandingkan PER SCENE, bukan totalnya: total dua bahasa bisa kebetulan
  // sama walau tiap scene-nya berbeda, dan gerbang yang bisa lolos karena
  // kebetulan adalah gerbang yang suatu saat lolos saat seharusnya merah.
  const bedaTeks = plan.scenes.filter((scene, index) => {
    const sulihan = (scene.dubs[lang] ?? "").trim();
    return sulihan !== "" && sulihan !== scene.narration.trim() && index >= 0;
  });
  if (bedaTeks.length > 0) {
    const bergeser = plan.scenes.filter(
      (_, index) => layout.sceneFrames[index] !== utama.sceneFrames[index],
    );
    if (bergeser.length === 0) {
      problems.push(
        `${lang}: tidak satu pun scene berubah panjangnya padahal ${bedaTeks.length} scene ` +
          "punya narasi yang berbeda — narasi atau audionya kemungkinan tidak ikut tertukar",
      );
    }
  }

  // --- 5. Subtitle bahasa itu memakai JAM bahasa itu ---
  const cues = buildSubtitleCues(swap);
  if (cakupan.diterjemahkan > 0 && cues.length === 0) {
    problems.push(`${lang}: tidak ada satu pun kartu subtitle padahal narasinya ada`);
  }
  const akhir = (cues[cues.length - 1]?.endMs ?? 0) / 1000;
  if (akhir > detik + 0.001) {
    problems.push(
      `${lang}: kartu subtitle terakhir berakhir di ${akhir.toFixed(3)} dtk, ` +
        `melewati durasi videonya (${detik.toFixed(3)} dtk)`,
    );
  }

  // --- 6. Tiap kartu jatuh di scene asalnya menurut RENDERER ---
  const rata = (text: string) => text.replace(/\s+/g, " ").trim();
  let berjangkar = 0;
  cues.forEach((cue, i) => {
    const teks = rata(cue.lines.join(" "));
    const cocok = swap.scenes
      .map((scene, index) => ({ index, narasi: rata(scene.narration) }))
      .filter((item) => item.narasi.length > 0 && item.narasi.includes(teks));
    if (cocok.length !== 1) return;
    berjangkar++;
    const asal = cocok[0]?.index ?? 0;
    const tengah = Math.min(
      layout.totalFrames - 1,
      Math.max(0, Math.round(((cue.startMs + cue.endMs) / 2000) * FPS)),
    );
    const tampil = activeSceneIndex(layout, tengah);
    if (tampil !== asal) {
      problems.push(
        `${lang}: kartu ${i + 1} milik scene ${swap.scenes[asal]?.id} tapi titik tengahnya ` +
          `(bingkai ${tengah}) jatuh di ${swap.scenes[tampil]?.id}`,
      );
    }
  });
  if (cakupan.diterjemahkan > 0 && berjangkar === 0) {
    problems.push(`${lang}: tidak satu pun kartu bisa dijangkarkan ke scene asalnya`);
  }
}

if (problems.length > 0) {
  console.error("\nGERBANG SULIH GAGAL:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  "\nLulus: tiap bahasa jadi plan satu-bahasa yang utuh, durasinya ikut narasinya, " +
    "dan subtitle-nya memakai jam bahasa itu.",
);
