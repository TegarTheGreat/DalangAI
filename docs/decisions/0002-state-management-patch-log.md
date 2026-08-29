# ADR-0002 — State Management Dokumen Bersama: Patch-Log, bukan CRDT (menjawab R-1)

**Status:** Diterima (untuk MVP) · **Tanggal:** 2026-08-29

## Konteks

Scene-plan dimutasi dua arah: agent (via chat) dan manusia (via UI). PRD §14
R-1 meminta perbandingan patch-log sederhana (event sourcing ringan) vs CRDT
(Yjs/Automerge), rekomendasi, dan bukti kompleksitas.

Fakta penentu dari PRD sendiri: **MVP single-user, dan agent bekerja per
giliran chat** (§5.2 — "UI dan agent tidak menulis bersamaan"). Artinya tidak
ada penulisan konkuren sungguhan yang harus direkonsiliasi; yang dibutuhkan
adalah (a) mutasi tervalidasi + lock enforcement, (b) undo/redo, (c) ringkasan
perubahan untuk konteks agent, (d) diff ringkas untuk UI.

## Opsi

### 1. Patch-log (event sourcing ringan) — dipilih

- Semua mutasi lewat `applyPatch(plan, ops, {origin})`; ops divalidasi zod,
  lock/pin ditegakkan di level kode, batch atomik, dan setiap patch membawa
  **inverse ops** → undo/redo gratis.
- Bukti kompleksitas (terukur dari implementasi Fase 0 di `@dalang/core`):
  - `patch.ts` + `patch-log.ts` = **623 baris** TypeScript (termasuk komentar
    kontrak), **0 dependensi tambahan** di luar zod (yang memang sudah wajib
    untuk skema).
  - 34 test case menutup matriks lock/pin/inverse/atomicity; seluruh suite
    core (51 test) berjalan <1 detik.
  - Kebutuhan produk yang "khas CRDT" ternyata jatuh alami dari patch-log:
    diff ringkas = deskripsi ops; konteks agent = `PatchLog.summarize()`;
    audit trail = log itu sendiri.
- Validasi domain (lock per scene, pin aset, "scene terakhir tidak boleh
  dihapus") hidup di satu tempat dan bisa MENOLAK mutasi — ini penting karena
  lock adalah kontrak keras (PRD §5.1), bukan preferensi merge.

### 2. CRDT (Yjs / Automerge)

- Kekuatan: merge otomatis penulisan konkuren multi-replika, sinkronisasi
  real-time multi-user, offline-first multi-perangkat.
- Biaya untuk kasus kita:
  - Dependensi + model data paralel (Y.Map/Y.Array atau dokumen Automerge)
    yang harus dipetakan bolak-balik ke tipe zod — dua sumber kebenaran tipe.
  - **Validasi domain menjadi lemah**: CRDT mem-merge dulu, validasi belakangan.
    Menolak "agent mengedit scene terkunci" harus dibangun sebagai lapisan
    tersendiri di atas CRDT — persis lapisan yang sudah kita tulis sebagai
    patch-log, sehingga CRDT menjadi biaya tambahan, bukan pengganti.
  - Undo/redo per-origin di CRDT (UndoManager per scope) lebih rumit daripada
    inverse-ops eksplisit.
  - Ukuran dokumen tumbuh dengan history; butuh kompaksi.

## Keputusan

**Patch-log untuk MVP.** CRDT tidak diadopsi sekarang, dan bukan karena
"nanti saja" yang kabur — ambang pemicunya eksplisit:

1. Kolaborasi **multi-user real-time** masuk roadmap aktif (PRD menempatkannya
   di "fase jauh"), atau
2. Agent dibuat menulis **paralel** dengan editing user dalam giliran yang
   sama, dan resolusi last-write-wins per field + notifikasi (rencana §5.2)
   terbukti tidak cukup dalam pengujian nyata.

Jika ambang tercapai, jalur migrasinya sudah disiapkan oleh desain ini: karena
SEMUA mutasi sudah berbentuk ops kecil yang tervalidasi, ops tinggal
diterjemahkan menjadi transaksi Yjs (patch-log tetap hidup sebagai lapisan
validasi + intent di atas CRDT). Tidak ada kode UI/agent yang perlu berubah
selain lapisan penyimpanan.

## Konsekuensi

- (+) Nol dependensi baru; undo/redo, diff, dan konteks agent sudah teruji.
- (+) Lock/pin ditolak di satu titik masuk — kontrak PRD §6.3 terpenuhi
  secara struktural.
- (−) Tidak ada merge konkuren: UI harus menahan penulisan saat agent
  menjalankan satu giliran (sesuai desain MVP §5.2). Jika kelak dilonggarkan,
  lihat ambang di atas.
- (−) Patch log in-memory pada Fase 0; persistensi (SQLite) menyusul di Fase 1
  bersama pipeline (serialisasi `toJSON()/fromJSON()` sudah ada dan teruji).
