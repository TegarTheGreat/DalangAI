# ADR-0004 — Render Stack Fase 0 (lokal, libx264, Chromium terdeteksi)

**Status:** Diterima (Fase 0; encoder HW menyusul di R-6) · **Tanggal:** 2026-08-29

## Konteks

Fase 0 butuh render lokal dari plan.json hardcoded. PRD §7.3 mensyaratkan
arsitektur pluggable (`RenderTarget`), §4.2 mewajibkan hardware encoder untuk
render final (riset R-6), dan proses render harus di luar proses UI.

## Keputusan

1. **Alur render**: `loadPlan` (validasi zod) → `stagePublicDir` (font template
   + semua file yang dirujuk `renderState`, disalin ke dir sementara) →
   `bundle()` → `selectComposition("Dalang")` → `renderMedia`/`renderStill`.
   Komposisi tunggal; durasi/dimensi diturunkan dari plan via
   `calculateMetadata` — renderer tidak pernah menghitung timing sendiri.

2. **Profil** (`@dalang/renderer`):
   | Profil | Skala | CRF | x264 preset | debug overlay |
   |---|---|---|---|---|
   | `draft` | 0.5 (540p utk 9:16) | 28 | veryfast | ya (badge aset belum resolve) |
   | `final` | 1.0 (1080p) | 17 | medium | tidak |

3. **Encoder**: libx264 (FFmpeg bundled Remotion) untuk Fase 0. Deteksi
   NVENC/AMF/QSV/VideoToolbox adalah R-6 (Fase 1) — interface profil sudah
   menyediakan tempatnya, dan hasil ukur Fase 0 dipakai sebagai baseline.

4. **Chromium**: `findBrowserExecutable()` memakai urutan
   env override → browser Playwright terpasang (headless shell diprioritaskan,
   artefak yang sama dengan yang diunduh Remotion) → lokasi sistem →
   biarkan Remotion mengunduh. Local-first: tidak ada unduhan bila sudah ada
   browser di mesin.

5. **Font di-vendor** (Fraunces + Inter variable, subset latin, OFL) di
   `templates/public/fonts` dan dimuat via `@remotion/fonts` + `staticFile` —
   render sepenuhnya offline; kegagalan memuat font = render gagal keras
   (PRD §10: tanpa kegagalan senyap).

## Bukti (diukur di container CPU-only, 8 scene / 51,3 dtk / 1539 frame @ 30fps)

| Render | Hasil | Waktu |
|---|---|---|
| draft 540×960 | 2,8 MB | **84,8 dtk** |
| final 1080×1920 (CRF 17) | 18,3 MB | **278,4 dtk (4m38s)** |

Target NFR "final 1080p < 5 menit di mesin ber-GPU" sudah terpenuhi bahkan di
baseline CPU murni; R-6 (encoder HW) dan tuning concurrency (R-5) memberi
ruang aman lebih jauh.

## Konsekuensi

- (+) Satu jalur kode untuk still/draft/final; profil = data, bukan cabang logika.
- (+) `renderPlanStills` mem-bundle sekali untuk banyak frame — dipakai untuk
  gate visual & kelak smoke-test template (R-8).
- (−) Bundling webpack (~15–30 dtk) terjadi tiap invokasi CLI; cache bundle
  persisten adalah optimisasi Fase 1 (bersama pipeline compose).
- (−) Belum ada worker process terpisah (R-5); CLI = proses render. UI Fase 3
  wajib memindahkan ini ke worker sesuai PRD §7.3.
