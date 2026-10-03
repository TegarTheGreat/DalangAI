/**
 * Katalog tool server MCP, sebagai DATA — satu-satunya sumber bagi panduan
 * agent (`dalang agen siapkan`) dan tabel di dokumentasi.
 *
 * Kenapa terpisah dari pendaftaran di server.ts: panduan yang ditulis tangan
 * akan menyebut tool yang sudah diganti namanya, atau melewatkan yang baru.
 * Tes menyamakan katalog ini dengan daftar tool yang DILAYANI server sungguhan
 * lewat klien MCP, jadi simpangan terlihat sebagai tes merah, bukan sebagai
 * agent yang memanggil tool yang tidak ada.
 */

export interface McpToolEntry {
  name: string;
  /** Satu kalimat untuk panduan. */
  ringkas: string;
  /** Mengubah berkas di disk (ditolak saat server dijalankan --hanya-baca). */
  menulis: boolean;
  /** Hanya terdaftar bila server dijalankan dengan --izinkan-render. */
  butuhRender?: boolean;
}

export const MCP_TOOLS: readonly McpToolEntry[] = [
  {
    name: "dalang_list_projects",
    ringkas:
      "Proyek di ruang kerja ini (folder berisi plan.json), plus akar dan status hanya-baca.",
    menulis: false,
  },
  {
    name: "dalang_list_templates",
    ringkas: "Template untuk memulai proyek baru: id, nama, ringkas.",
    menulis: false,
  },
  {
    name: "dalang_new_project",
    ringkas: "Buat proyek baru dari template di bawah akar; tidak pernah menimpa.",
    menulis: true,
  },
  {
    name: "dalang_get_plan",
    ringkas:
      "Ringkasan garis waktu: scene, waktu, naskah, kesiapan aset dan suara (mentah=true untuk JSON utuh).",
    menulis: false,
  },
  {
    name: "dalang_critique",
    ringkas:
      "Pemeriksaan struktur oleh mesin (irama, panjang narasi, musik, klise); gratis, tidak melihat render.",
    menulis: false,
  },
  {
    name: "dalang_apply_patch",
    ringkas:
      "SATU-SATUNYA cara mengubah plan.json; op divalidasi skema, scene terkunci ditolak.",
    menulis: true,
  },
  {
    name: "dalang_undo",
    ringkas: "Balikkan patch terakhir yang dibuat lewat server ini.",
    menulis: true,
  },
  {
    name: "dalang_export_timeline",
    ringkas:
      "Tulis timeline.otio / timeline.fcpxml untuk Resolve, Premiere, Final Cut; selalu menyertakan daftar 'tidakIkut'.",
    menulis: true,
  },
  {
    name: "dalang_write_subtitle",
    ringkas:
      "Tulis berkas .srt / .vtt dari narasi dan transkrip untuk diunggah bersama video.",
    menulis: true,
  },
  {
    name: "dalang_render_still",
    ringkas:
      "Render frame pada detik tertentu jadi PNG untuk dilihat (lambat; menyalakan peramban).",
    menulis: true,
    butuhRender: true,
  },
];
