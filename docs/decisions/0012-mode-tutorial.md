# ADR-0012 — Fase 4: Mode Tutorial & preset tutorial-01

**Status:** Diterima · **Tanggal:** 2026-08-30

## Konteks

PRD §9 + §11 Fase 4: konten how-to berbasis screenshot dengan anotasi
(zoom/highlight/arrow/blur) yang dieksekusi sebagai animasi murni, grounding
elemen UI oleh model vision DENGAN verifikasi, plus "style preset tambahan".
Skema `annotations` §9 ternyata sudah ada di skema v0 sejak awal (type,
target ternormalisasi, timing) — ADR ini TIDAK mengubah §5.1; ia mengisi
semua lapisan yang mengeksekusinya.

## Keputusan

### 1. Preset kedua: `tutorial-01` (templates)

Bahasa visual "dokumentasi produk": kertas terang ber-titik grid, kartu
screenshot ber-titlebar dengan bayangan lembut, chip "LANGKAH n/m" otomatis
(scene template-anim tidak dinomori), caption karaoke tema terang, chrome
progres tipis. Transisi dipetakan lewat modul bersama `transitions.ts`
(dipakai kedua preset — bahasa transisi konsisten).

Mesin anotasi = modul murni `annotate.ts` (diuji unit):

- `zoom`: kamera scale+translate ke target, coverage 66% sisi terpendek,
  skala diklem ≤3.4, dan PAN DIKLEM agar tepi gambar tidak pernah masuk
  stage (pola auto-pan perekam layar; ketahuan dari gate visual, bukan
  teori). Target selebar ~1.0 memang tak bisa zoom — terklem netral.
- `highlight`: ring aksen + peredup sekitar (box-shadow raksasa), pulse-in.
- `arrow`: memilih sisi yang CUKUP lapang dengan preferensi
  bawah > kiri > kanan > atas (atas paling sering melintasi konten —
  ketahuan di gate visual, lalu dikodifikasi + diuji).
- `blur`: patch backdrop-filter untuk redaksi.
- Timing: `endSec` kosong = bertahan sampai akhir scene (tanpa fade-out —
  transisi scene yang mengambil alih); easing masuk/keluar kubik.

Lapisan anotasi hidup DI DALAM ruang gambar yang di-transform — ikut
bergerak saat kamera zoom.

### 2. Aset lokal (pipeline)

Stage assets kini meng-ingest scene `screenshot`/`image` dengan
`visual.assetId` berupa path relatif di folder proyek → entri
`renderState.resolvedAssets` bersumber `local` (lisensi milik user), dimensi
dibaca parser header PNG/JPEG murni (`image-dims.ts`, tanpa decoder).
Path absolut / `..` ditolak; scene terkunci dilewati; idempoten (cached).

### 3. Grounding + VERIFIKASI (agent)

Tool baru `locateUiElement(sceneId, description)`:

1. Kirim screenshot ke model vision tier-volume, minta bbox JSON ketat;
   `parseBbox` menerima JSON murni/dalam prosa/persen, mengklem ke gambar.
2. **Verifikasi §9**: crop area terdeteksi (jimp 1.6.0, pure-JS; padding
   2%) dikirim balik — "apakah ini X? YA/TIDAK". `verified:false` DIKEMBALIKAN
   sebagai data dengan instruksi koreksi, bukan dipakai diam-diam.

System prompt bertambah bagian MODE TUTORIAL (alur, batas zoom, larangan
memakai target tak terverifikasi). Biaya kedua panggilan masuk guardrails.

### 4. Paritas manusia: tab Anotasi (studio)

Inspector bertambah tab kelima "Anotasi": segmented jenis, empat slider
target ternormalisasi, timing mulai + saklar "bertahan sampai akhir scene",
tambah/hapus — semuanya patch `updateScene{annotations}` yang sama dengan
milik agent (tercatat, bisa di-undo). Hint jujur saat stylePreset bukan
tutorial-01.

## Bukti

Unit: 11 test `annotate` (window/presence/zoom+klem pan/arrow-policy/step),
3 ingest lokal + dims, 8 grounding (parse/crop/verifikasi + alur tool
terskrip verified/ditolak/tanpa-bbox) — total suite 246. Demo
`examples/tutorial-studio`: 3 screenshot NYATA Dalang Studio dengan target
anotasi diukur dari boundingBox elemen asli; gate visual still (7 frame,
2 iterasi perbaikan nyata: klem pan zoom, kebijakan sisi panah) + draft MP4
27 dtk / 1,4 MB / render 24,6 dtk; tab Anotasi diverifikasi live Playwright.
CI smoke bertambah 2 frame tutorial.

## Konsekuensi & batas jujur

- (+) Fase 4 inti terpenuhi: preset tambahan + mode tutorial + grounding
  terverifikasi; draft profile sudah ada sejak Fase 0.
- (−) Grounding live butuh API key model vision — alur diuji dengan model
  terskrip; klaim kualitas deteksi nyata menunggu kredensial owner.
- (−) Screen RECORDING (sampling frame, deteksi klik/kursor, auto-zoom ala
  Screen Studio) belum dibangun — disadari sebagai lanjutan §9.
- (−) Upload screenshot lewat UI studio belum ada (file diletakkan manual /
  oleh agent ke folder proyek); antrean berikutnya.
- (+) jimp 1.6.0 (pure-JS) jadi dependensi agent — dipilih daripada sharp
  (native) demi portabilitas; hanya dipakai jalur grounding.
