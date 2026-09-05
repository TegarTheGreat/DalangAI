# ADR-0015 — Pass kehandalan gerak: latar hidup, satu bahasa easing, bingkai & sisa roadmap editor

**Status:** Diterima · **Tanggal:** 2026-08-30

## Konteks

Audit gerak atas permintaan owner ("motion background, animated icon, glowing
icons, keyframe, smooth, curve, blur — periksa yang belum handal"). Temuan
jujur dari membaca kode, bukan asumsi:

1. **Varian seni prosedural DIAM.** `rays`/`topo`/`grid` (ADR-0013) dihitung
   sekali dari seed scene — indah tapi statis; hanya lapisan duotone di
   bawahnya yang bergerak. Latar "motion" ternyata setengah motion.
2. **Kurva tersebar.** Easing ditulis ulang di tiap komponen (bezier literal
   di Backdrop, transitions, teks); teks overlay malah masih memakai
   interpolate linear untuk masuk/keluar — terasa mekanis dibanding kartu
   judul yang sudah ber-spring.
3. **Blur belum ada** sebagai kontrol, padahal dibutuhkan untuk latar di
   belakang teks besar dan efek fokus.
4. **Cincin struktur statis**; tidak ada glow untuk label kecil.
5. Sisa roadmap yang cocok arsitektur belum dikerjakan: belah scene, speed
   video, H.265, preset ekspor platform, panah playhead, cermin/fokus crop,
   dan drop file ke timeline.

## Keputusan

### 1. Satu bahasa gerak (`templates/src/anim.ts`)

Modul murni & teruji: `easeSettle` (masuknya elemen), `easeGlide` (transisi),
`easeDolly` (kamera) — dinamai berdasarkan RASA, bukan angka bezier, supaya
pemakaian di komponen terbaca sebagai keputusan sutradara. Plus `kf()`
(interpolasi keyframe piecewise ber-easing, di-clamp dua ujung, tanpa
ekstrapolasi) dan `enterExit()` (jendela masuk-tahan-keluar standar). Kedua
preset memakai `enterExit` untuk teks overlay; Backdrop memakai `kf` untuk
draw-on cincin.

### 2. Latar prosedural HIDUP

Semua varian kini fungsi frame deterministik: `rays` berputar ~0.055°/frame,
`topo` bernapas (pusat kontur bergerak sinusoidal), `grid` drift diagonal.
Cincin raksasa jadi SVG dengan `pathLength=1` + `strokeDashoffset` — tergambar
80 frame pertama lalu berputar sangat lambat. Terbukti dari piksel: dua frame
`rays` berjarak 15 frame berbeda rata-rata 0.86/255 (bergerak, tapi halus —
sebelumnya persis 0).

### 3. Gerak kamera & bingkai (`motion-model.ts`, skema aditif)

- `MOTIONS` += `pan-up`, `pan-down` (penting untuk 9:16), `drift` (setengah
  orbit melayang).
- `visual.flipH` (cermin horizontal — menyamakan arah pandang antar shot),
  `visual.focusX/focusY` (titik fokus crop `cover`), `visual.speed` (0.25-4,
  kecepatan aset video lewat `playbackRate`).
- Seluruh matematikanya pindah ke `motionTransform()` yang murni dan diuji
  (8 motion, flip, fokus) — Player dan renderer memakai satu sumber.

### 4. Blur & glow

- `filter.blur` (0-20px pada basis 1080) masuk `visualFilterSchema` dan
  `filterToCss`; slider "Blur" di tab Visual.
- Chip teks `emphasis: "box"` mendapat `backdrop-filter: blur(10px)` — chip
  kaca yang terbaca di atas footage ramai — plus glow lembut opsional.
- Kicker mendapat glow aksen (`text-shadow` berwarna aksen) supaya label
  kecil menyala di footage gelap.

### 5. Sisa roadmap editor

- **Belah scene di playhead**: endpoint `POST /api/scene/split` — durasi
  terbagi (masing-masing minimal 1 dtk), bagian kedua mewarisi visual dan
  ASET RESOLVED-nya (disalin di renderState sebelum patch), narasi kosong.
  Satu batch patch user, jadi bisa di-undo. Tombol di transport aktif hanya
  saat playhead berada di posisi yang sah.
- **Panah playhead**: kiri/kanan = 1 frame, Shift = 1 detik; memakai guard
  fokus yang sama dengan Spasi.
- **Drop file gambar ke klip** = unggah + pasang ter-pin ke scene itu (reuse
  jalur upload ADR-0013); tanpa file, drop tetap reorder klip.
- **H.265** (`format: "hevc"`, ekstensi tetap .mp4, skala CRF bergeser +5 dari
  H.264) dan **chip preset ekspor** (Sosial / Web ringan / Master arsip) yang
  mengisi format+resolusi+mutu sekali klik.

## Konsekuensi

- Plan lama tetap valid: semua field baru berdefault netral (speed 1, flipH
  false, fokus 0.5/0.5, blur 0).
- Nama file ekspor kini menyertakan format (`ekspor-webm-720p-cepat.webm`)
  supaya dua varian MP4 (H.264/H.265) tidak saling menimpa.
- Gerak latar menambah kerja render per frame (gradien dihitung ulang tiap
  frame); pada gate 1080p tidak terukur signifikan karena beban didominasi
  bundling + enkode.
- Verifikasi: 283 unit test; 10 cek Playwright LULUS (panah, split beserta
  pewarisan aset, drift, cermin, blur, 4 kartu format, chip preset, drop file,
  undo beruntun); bukti piksel HEVC + gerak rays + blur.
