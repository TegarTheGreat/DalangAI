# ADR-0003 — Deviasi & Presisi Skema Scene-Plan v0 terhadap Draft PRD §5.1

**Status:** Diterima (Fase 0) · **Tanggal:** 2026-08-29

## Konteks

PRD menyatakan skema §5.1 adalah draft dan revisi harus lewat ADR, bukan diubah
diam-diam. Implementasi zod di `@dalang/core` (`src/scene-plan.ts`) mengikuti
draft tersebut; dokumen ini mencatat setiap penambahan/presisi dan alasannya.

## Keputusan (daftar deviasi)

1. **`meta.tokens` (opsional)** — design tokens `{primary, accent, fontDisplay,
   fontBody}`. Dituntut PRD §8.3 ("preset menerima design tokens") tapi belum
   ada tempatnya di draft skema.

2. **`visual.pinned` (default false)** — penanda aset yang dipilih eksplisit.
   Dituntut PRD §8.2 ("pilihan user tercatat sebagai patch user dan asset
   ter-pin"). Semantik: pipeline auto-resolve TIDAK BOLEH menimpa aset pinned;
   `replaceAsset` eksplisit (user maupun agent pada scene tak terkunci) tetap
   boleh. Pin ≠ lock: lock milik user dan mengikat agent; pin mengikat
   otomatisasi pipeline.

3. **`visual.variant` (opsional)** — varian layout untuk `template-anim`
   (mis. `"title"`, `"outro"`; default preset: `"title"`). Tanpa ini, preset
   harus menebak dari posisi scene — rapuh terhadap reorder.

4. **Presisi `renderState`** (draft menulis `...`):
   - `narrationAudio[sceneId]`: `{file, durationSec, wordTimestamps?
     [{word, startSec, endSec}], fallbackQuality?}` — `fallbackQuality`
     mengikuti PRD §7.2 (degradasi provider harus terlihat di UI).
   - `resolvedAssets[sceneId]`: `{file, kind: image|video|audio, source,
     sourceUrl?, author?, license?, width?, height?}` — metadata lisensi
     audit-ready (PRD §10, menyiapkan R-10).
   - **Path `file` didefinisikan relatif terhadap folder plan** dan disajikan
     ke komposisi lewat `staticFile()` pada path relatif yang sama (renderer
     men-stage-nya; path absolut dan `..` ditolak).

5. **`annotations` dipresisikan** menjadi
   `{type: zoom|highlight|arrow|blur, target: {x,y,w,h} ternormalisasi 0–1,
   timing: {startSec, endSec?}} `— tervalidasi sejak v0, dieksekusi Fase 4.

6. **Aturan mutasi yang dikodekan** (melengkapi §5.2):
   - `updateScene` tidak boleh menyentuh `id`, `locked`, `visual.assetId`,
     `visual.pinned` — masing-masing punya op khusus (`lockScene`,
     `replaceAsset`) agar tiap invariant punya satu pintu.
   - `addScene(afterId=null)` = sisip di AWAL (agar inverse `removeScene` scene
     pertama bisa direpresentasikan); append = `afterId` scene terakhir.
   - Reorder oleh agent tidak boleh memindahkan scene terkunci dari indeksnya
     (UC-4: "jangan ubah scene 1" mencakup posisinya).
   - `renderState` TIDAK dimutasi lewat patch ops — pipeline menulisnya lewat
     helper `setNarrationAudio`/`setResolvedAsset`. Konsekuensi yang disengaja:
     undo editan kreatif tidak ikut membatalkan hasil kerja pipeline; entri
     yang basi di-derive ulang (murah berkat content-hash caching, Fase 1).

7. **Resolusi `duration: "auto"` dibuat deterministik** (PRD prinsip #4):
   pakai `durationSec` audio TTS bila ada; sebelum itu estimasi
   2,4 kata/detik × `voice.speed`, + lead-in 0,25 dtk + padding 0,7 dtk,
   clamp minimum 2,2 dtk; scene tanpa narasi = 3 dtk. Konstanta ini milik
   `core` dan diuji; angka bisa dikalibrasi saat R-2/R-3.

8. **`meta.targetDuration` numerik = target untuk agent**, bukan constraint
   compose-time; compose selalu mengikuti narasi (di-dokumentasikan di skema).

## Konsekuensi

- Skema tetap superset yang kompatibel dengan draft PRD — contoh §5.1 valid
  tanpa perubahan.
- `strictObject` menolak field tak dikenal → typo agent terdeteksi dini;
  penambahan field masa depan wajib lewat ADR + bump `version`.
