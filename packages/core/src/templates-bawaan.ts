import { parseScenePlan, type ScenePlanInput } from "./scene-plan";
import {
  parseTemplatePack,
  TEMPLATE_FORMAT,
  type TemplateManifest,
  type TemplatePack,
} from "./template";

/**
 * Template BAWAAN yang ikut terpasang bersama Dalang (ADR-0037).
 *
 * Ditulis sebagai modul TypeScript, bukan berkas JSON di samping paket. Dua
 * alasan, dan keduanya soal apa yang terjadi setelah dipaketkan: berkas JSON
 * harus dicari saat runtime — jalur yang berbeda antara `tsx` di repo, paket
 * ter-publish, dan bundel Lambda — dan berkas JSON tidak diperiksa
 * TypeScript, jadi salah ketik di dalamnya baru terlihat saat seseorang
 * memasang template-nya. Yang ini ikut ter-typecheck dan ikut divalidasi
 * skema di test.
 *
 * Kenapa harus ada bawaan sama sekali: registri kosong pada pemasangan baru
 * membuat fitur ini terlihat seperti janji, bukan barang. Tiga template
 * cukup untuk menunjukkan bahwa yang dibagikan memang KERANGKA plus TAMPILAN
 * — satu per keadaan menonton yang dilayani ketiga preset.
 *
 * Narasinya sengaja berupa kalimat yang MENJELASKAN apa yang harus ditulis di
 * situ. Kotak kosong tidak mengajarkan apa-apa, dan narasi milik video orang
 * lain mengajarkan hal yang salah.
 */

const pack = (manifest: Omit<TemplateManifest, "createdAt">, plan: ScenePlanInput) =>
  parseTemplatePack({
    format: TEMPLATE_FORMAT,
    manifest: { ...manifest, createdAt: "2026-09-08T00:00:00.000Z" },
    plan: parseScenePlan(plan),
  });

const KLIP = pack(
  {
    id: "klip-tiga-detik",
    name: "Klip pendek — tiga detik pertama",
    description:
      "Tegak, huruf display berat, caption berpelat yang terbaca tanpa suara. Dibuka hook, bukan kartu judul.",
    author: "Dalang",
    version: "1.0",
  },
  {
    version: 2,
    projectId: "template-klip-tiga-detik",
    meta: {
      title: "Judul klip",
      aspectRatio: "9:16",
      format: "klip",
      stylePreset: "klip-01",
      language: "id",
      // Asimetris, sama seperti contoh klip-hook: rel tombol di kanan,
      // keterangan di bawah (ADR-0034).
      safeArea: { top: 0.07, bottom: 0.2, left: 0, right: 0.14 },
      tokens: { primary: "#07080C", accent: "#FF3D57" },
    },
    audio: {
      voice: { provider: "silence", voiceId: "id-standar", speed: 1 },
      // Bed dari pustaka ter-bundle: berkasnya ada di setiap pemasangan, jadi
      // ia ikut berpindah komputer — tidak seperti musik unggahan.
      music: { assetId: "pustaka:cerah", volume: 0.14 },
    },
    scenes: [
      {
        id: "sc-hook",
        narration:
          "Kalimat pembuka yang membuat orang berhenti menggulir. Satu gagasan, tanpa pemanasan.",
        clips: [
          { id: "sc-hook-k1", type: "solid", variant: "rays", motion: "kenburns-in" },
        ],
        caption: { enabled: true, style: "tegas", size: "l", position: "bottom" },
        texts: [
          {
            id: "sc-hook-t1",
            content: "TULIS HOOK DI SINI",
            role: "headline",
            position: "center",
            size: "l",
            anim: "pop",
          },
        ],
        transition: { type: "cross-fade", durationFrames: 8 },
      },
      {
        id: "sc-isi-1",
        narration:
          "Bagian isi pertama. Satu kalimat, satu gambar; kalau butuh dua gagasan, buat dua scene.",
        clips: [
          { id: "sc-isi-1-k1", type: "solid", variant: "topo", motion: "pan-left" },
        ],
        caption: { enabled: true, style: "tegas", size: "m", position: "bottom" },
        transition: { type: "cross-fade", durationFrames: 18 },
      },
      {
        id: "sc-isi-2",
        narration:
          "Bagian isi kedua. Di sini biasanya bukti atau contohnya — yang membuat gagasan tadi bisa dipercaya.",
        clips: [
          { id: "sc-isi-2-k1", type: "solid", variant: "grid", motion: "kenburns-out" },
        ],
        caption: { enabled: true, style: "tegas", size: "m", position: "bottom" },
        transition: { type: "cross-fade", durationFrames: 10 },
      },
      {
        id: "sc-outro",
        narration: "Satu kalimat penutup.",
        clips: [{ id: "sc-outro-k1", type: "template-anim", variant: "outro" }],
        duration: 2.5,
        caption: { enabled: false, style: "tegas", size: "m", position: "bottom" },
      },
    ],
  },
);

const ESAI = pack(
  {
    id: "esai-video",
    name: "Esai video — dokumenter",
    description:
      "Lebar, serif editorial, kartu judul yang membangun suasana. Untuk yang ditonton sampai selesai, bukan yang dilewati.",
    author: "Dalang",
    version: "1.0",
  },
  {
    version: 2,
    projectId: "template-esai-video",
    meta: {
      title: "Judul esai",
      aspectRatio: "16:9",
      format: "edukasi",
      stylePreset: "documentary-01",
      language: "id",
    },
    audio: {
      voice: { provider: "silence", voiceId: "id-standar", speed: 1 },
      music: { assetId: "pustaka:tenang", volume: 0.12 },
    },
    scenes: [
      {
        id: "sc-judul",
        narration: "",
        clips: [{ id: "sc-judul-k1", type: "template-anim", variant: "title" }],
        duration: 4,
        caption: { enabled: false, style: "klasik", size: "m", position: "bottom" },
        transition: { type: "cross-fade", durationFrames: 15 },
      },
      {
        id: "sc-hook",
        narration:
          "Kalimat pembuka yang menaruh taruhan. Sebuah klaim yang belum jelas benarnya, atau pertanyaan yang jawabannya tidak enak — bukan perkenalan topik. Panjangnya kira-kira sepanjang paragraf ini: cukup untuk satu gagasan utuh, belum cukup untuk dua.",
        clips: [
          { id: "sc-hook-k1", type: "solid", variant: "duotone", motion: "kenburns-in" },
        ],
        texts: [
          {
            id: "sc-hook-t1",
            content: "SATU KLAIM YANG BELUM TENTU BENAR",
            role: "headline",
            position: "center",
            size: "m",
            anim: "rise",
          },
        ],
        transition: { type: "cross-fade", durationFrames: 12 },
      },
      {
        id: "sc-pertanyaan",
        narration:
          "Pertanyaan intinya, dinyatakan sekali dengan jelas. Bagian ini yang membuat sisa videonya punya arah: penonton harus bisa menyebutkan ulang apa yang sedang dicari jawabannya kalau ditanya di tengah.",
        clips: [
          { id: "sc-pertanyaan-k1", type: "solid", variant: "grid", motion: "pan-left" },
        ],
        transition: { type: "cross-fade", durationFrames: 20 },
      },
      {
        id: "sc-konteks",
        narration:
          "Konteks secukupnya. Apa yang perlu diketahui supaya bagian berikutnya masuk akal — dan tidak lebih dari itu, karena konteks yang panjang adalah tempat penonton paling sering pergi.",
        clips: [
          { id: "sc-konteks-k1", type: "solid", variant: "topo", motion: "kenburns-out" },
        ],
        transition: { type: "cross-fade", durationFrames: 14 },
      },
      {
        id: "sc-bukti",
        narration:
          "Buktinya, atau mekanismenya. Angka, kejadian, kutipan, atau rantai sebab-akibat yang membuat bagian sebelumnya berhenti menjadi pendapat. Kalau satu bagian video ini boleh panjang, ini bagiannya.",
        clips: [
          { id: "sc-bukti-k1", type: "solid", variant: "rays", motion: "pan-right" },
        ],
        transition: { type: "cross-fade", durationFrames: 22 },
      },
      {
        id: "sc-artinya",
        narration:
          "Implikasinya. Bagian yang paling sering dilupakan: apa yang berubah bagi orang yang menonton, sekarang, setelah tahu ini. Tanpa bagian ini videonya benar tapi tidak berguna.",
        clips: [
          { id: "sc-artinya-k1", type: "solid", variant: "duotone", motion: "drift" },
        ],
        transition: { type: "cross-fade", durationFrames: 16 },
      },
      {
        id: "sc-penutup",
        narration: "Satu kalimat yang menutup lingkaran ke hook.",
        clips: [{ id: "sc-penutup-k1", type: "template-anim", variant: "outro" }],
        duration: 4,
        caption: { enabled: false, style: "klasik", size: "m", position: "bottom" },
      },
    ],
  },
);

const TUTORIAL = pack(
  {
    id: "tutorial-langkah",
    name: "Tutorial — langkah demi langkah",
    description:
      "Terang, panggung tangkapan layar, satu langkah per scene. Anotasi mengarahkan kameranya sendiri.",
    author: "Dalang",
    version: "1.0",
  },
  {
    version: 2,
    projectId: "template-tutorial-langkah",
    meta: {
      title: "Judul tutorial",
      aspectRatio: "16:9",
      format: "tutorial",
      stylePreset: "tutorial-01",
      language: "id",
    },
    audio: {
      voice: { provider: "silence", voiceId: "id-standar", speed: 1 },
      // Lebih pelan daripada dua template lain: tutorial dibaca sambil
      // dikerjakan, dan bed yang terdengar menuntut perhatian yang sedang dipakai.
      music: { assetId: "pustaka:tenang", volume: 0.08 },
    },
    scenes: [
      {
        id: "sc-judul",
        narration: "",
        clips: [{ id: "sc-judul-k1", type: "template-anim", variant: "title" }],
        duration: 3.5,
        caption: { enabled: false, style: "halus", size: "m", position: "bottom" },
        transition: { type: "cross-fade", durationFrames: 10 },
      },
      {
        id: "sc-hasil",
        narration:
          "Lihat dulu hasil akhirnya. Penonton tutorial memutuskan ikut atau tidak dari tujuannya, bukan dari langkah pertamanya.",
        clips: [{ id: "sc-hasil-k1", type: "screenshot" }],
        caption: { enabled: true, style: "halus", size: "m", position: "bottom" },
        texts: [
          {
            id: "sc-hasil-t1",
            content: "HASIL AKHIRNYA SEPERTI INI",
            role: "kicker",
            position: "top",
            size: "m",
            anim: "rise",
          },
        ],
        transition: { type: "cross-fade", durationFrames: 10 },
      },
      {
        id: "sc-langkah-1",
        narration:
          "Buka layar tempat semuanya dimulai, lalu sebutkan apa yang harus terlihat sebelum lanjut ke langkah berikutnya.",
        clips: [{ id: "sc-langkah-1-k1", type: "screenshot" }],
        caption: { enabled: true, style: "halus", size: "m", position: "bottom" },
        transition: { type: "cross-fade", durationFrames: 12 },
      },
      {
        id: "sc-langkah-2",
        narration:
          "Klik bagian yang dituju, dan katakan di sini juga kalau ada yang mudah keliru — bukan nanti di penutup.",
        clips: [{ id: "sc-langkah-2-k1", type: "screenshot" }],
        caption: { enabled: true, style: "halus", size: "m", position: "bottom" },
        transition: { type: "cross-fade", durationFrames: 9 },
      },
      {
        id: "sc-langkah-3",
        narration:
          "Simpan hasilnya, lalu tunjukkan cara memeriksa bahwa yang tersimpan memang benar.",
        clips: [{ id: "sc-langkah-3-k1", type: "screenshot" }],
        caption: { enabled: true, style: "halus", size: "m", position: "bottom" },
        transition: { type: "cross-fade", durationFrames: 14 },
      },
      {
        id: "sc-penutup",
        narration: "Ringkas sekalimat, lalu sebutkan langkah lanjutannya.",
        clips: [{ id: "sc-penutup-k1", type: "template-anim", variant: "outro" }],
        duration: 3.5,
        caption: { enabled: false, style: "halus", size: "m", position: "bottom" },
      },
    ],
  },
);

/** Ketiganya, berurutan seperti yang ditampilkan lobi dan `dalang template list`. */
export const BUILT_IN_TEMPLATES: readonly TemplatePack[] = [KLIP, ESAI, TUTORIAL];

export const builtInTemplate = (id: string): TemplatePack | undefined =>
  BUILT_IN_TEMPLATES.find((template) => template.manifest.id === id);
