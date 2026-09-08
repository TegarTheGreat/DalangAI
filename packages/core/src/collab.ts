import { z } from "zod";
import type { PatchOp, PatchOpInput } from "./patch";

/**
 * Beberapa orang pada satu proyek (ADR-0038, roadmap §10.4).
 *
 * Modul ini MURNI, dan sengaja: aturan "perubahan siapa yang bentrok dengan
 * perubahan siapa" adalah hal yang paling mahal kalau salah — dua orang
 * kehilangan pekerjaan tanpa satu pun pesan — dan hal seperti itu harus bisa
 * diuji sebagai angka, bukan diperiksa dengan dua peramban yang dibuka
 * berdampingan.
 */

/** Nama penyunting paling panjang yang masih muat di bilah kehadiran. */
export const MAX_EDITOR_NAME = 32;

export const editorSchema = z.strictObject({
  /**
   * Id yang dibuat peramban dan disimpan di localStorage-nya.
   *
   * Bukan nama: dua orang boleh bernama sama, dan satu orang yang mengganti
   * namanya di tengah sesi tetap orang yang sama. Yang membedakan kursor di
   * layar adalah id ini.
   */
  id: z.string().min(4).max(64),
  name: z.string().min(1).max(MAX_EDITOR_NAME),
});
export type Editor = z.infer<typeof editorSchema>;

/**
 * PETAK yang disentuh sebuah operasi — satuan terkecil yang dipakai untuk
 * memutuskan bentrok.
 *
 * Bukan "seluruh plan": dua orang yang menyunting dua scene berbeda tidak
 * saling mengganggu, dan penolakan yang menuntut mereka bergantian adalah
 * cara tercepat membuat fitur ini dimatikan.
 *
 * Bukan pula per-field: penggabungan tingkat field menuntut aturan gabung
 * untuk tiap field, dan aturan gabung yang salah kehilangan pekerjaan orang
 * DIAM-DIAM. Petak sebesar scene bisa dijelaskan dalam satu kalimat ke orang
 * yang ditolak — "scene ini baru saja diubah orang lain" — dan itu yang
 * membuat penolakan bisa diterima.
 */
export type TouchKey = string;

/** Petak khusus: susunan scene (tambah, buang, urut ulang). */
export const TOUCH_STRUCTURE = "struktur";
/** Petak khusus: meta proyek. */
export const TOUCH_META = "meta";
/** Petak khusus: audio tingkat proyek (musik, trek, sfx, suara). */
export const TOUCH_AUDIO = "audio";

export const sceneTouchKey = (sceneId: string): TouchKey => `scene:${sceneId}`;

/**
 * Petak yang disentuh satu daftar operasi.
 *
 * Op yang tidak dikenal jatuh ke `TOUCH_STRUCTURE` — sisi yang AMAN. Op baru
 * yang lupa didaftarkan di sini lalu bentrok dengan segalanya, dan itu jauh
 * lebih baik daripada op baru yang diam-diam tidak pernah dianggap bentrok
 * dengan apa pun.
 */
export const patchTouchKeys = (ops: readonly (PatchOp | PatchOpInput)[]): TouchKey[] => {
  const keys = new Set<TouchKey>();
  for (const op of ops) {
    switch (op.op) {
      case "setMeta":
        keys.add(TOUCH_META);
        break;
      case "setAudio":
        keys.add(TOUCH_AUDIO);
        break;
      case "addScene":
      case "removeScene":
      case "reorderScenes":
        keys.add(TOUCH_STRUCTURE);
        break;
      case "updateScene":
      case "lockScene":
        keys.add(sceneTouchKey(op.id));
        break;
      case "setClips":
      case "splitClip":
      case "trimClip":
      case "removeClip":
      case "reorderClips":
        keys.add(sceneTouchKey(op.sceneId));
        break;
      case "replaceAsset":
        keys.add(sceneTouchKey(op.sceneId));
        break;
      default:
        keys.add(TOUCH_STRUCTURE);
    }
  }
  return [...keys];
};

/**
 * Petak yang benar-benar bertabrakan antara dua kumpulan.
 *
 * `TOUCH_STRUCTURE` bertabrakan dengan petak SCENE mana pun, dan itu bukan
 * kehati-hatian berlebih: membuang scene ketiga sementara orang lain sedang
 * menyunting scene ketiga akan membuat suntingan itu mendarat di scene yang
 * sudah tidak ada — atau, lebih buruk, di scene lain yang kebetulan naik ke
 * posisinya.
 *
 * `meta` dan `audio` berdiri sendiri: mengganti judul tidak mengganggu siapa
 * pun yang sedang menulis narasi.
 */
export const touchConflicts = (
  mine: readonly TouchKey[],
  theirs: readonly TouchKey[],
): TouchKey[] => {
  const other = new Set(theirs);
  const hit = new Set<TouchKey>();
  const structureThere = other.has(TOUCH_STRUCTURE);
  const structureHere = mine.includes(TOUCH_STRUCTURE);

  for (const key of mine) {
    if (other.has(key)) {
      hit.add(key);
      continue;
    }
    if (key.startsWith("scene:") && structureThere) hit.add(key);
    if (key === TOUCH_STRUCTURE) {
      for (const lain of other) if (lain.startsWith("scene:")) hit.add(lain);
    }
  }
  if (structureHere && structureThere) hit.add(TOUCH_STRUCTURE);
  return [...hit];
};

/** Kalimat penolakan yang menyebut APA yang bentrok, bukan cuma "gagal". */
export const conflictMessage = (keys: readonly TouchKey[], by: string): string => {
  const scenes = keys
    .filter((key) => key.startsWith("scene:"))
    .map((key) => key.slice("scene:".length));
  const bagian: string[] = [];
  if (scenes.length > 0) bagian.push(`scene ${scenes.join(", ")}`);
  if (keys.includes(TOUCH_STRUCTURE)) bagian.push("susunan scene");
  if (keys.includes(TOUCH_META)) bagian.push("pengaturan proyek");
  if (keys.includes(TOUCH_AUDIO)) bagian.push("audio proyek");
  const apa = bagian.length > 0 ? bagian.join(" dan ") : "bagian yang sama";
  return (
    `${by} baru saja mengubah ${apa}. Perubahanmu TIDAK dipakai supaya tidak ` +
    "menimpa pekerjaannya — lihat versi terbarunya, lalu ulangi kalau masih perlu."
  );
};
