# ADR-0013 — Pengayaan editor 2: teks bergaya, tempo transisi, seni prosedural, font, upload, liveness

**Status:** Diterima · **Tanggal:** 2026-08-30

## Konteks

Permintaan owner: perkaya teks/font/grafis/aset/efek, buat agent lebih handal,
dan pastikan studio terasa hidup — autosave, realtime, tanpa refresh. Semua
perubahan skema §5.1 lewat ADR (aturan proyek); perubahan di sini murni
aditif dengan default sehingga plan lama tetap valid tanpa migrasi.

## Keputusan

### 1. Skema (aditif, default kompatibel)

- `texts[]` bertambah `align` (left|center|right, default center), `size`
  (s|m|l, default m), `emphasis` (none|box|underline, default none).
- `transition` bertambah `durationFrames` (int 6–24, default 15) — tempo
  potongan per scene, bukan lagi konstanta global.
- Gotcha zod yang dikodifikasi: `.default(obj)` memakai objek APA ADANYA
  (default field di dalamnya tidak diterapkan), jadi default `transition`
  di `sceneSchema` ditulis lengkap `{ type: "cross-fade", durationFrames: 15 }`.
  Artefak JSON Schema diregenerasi via `pnpm schema:gen`.

### 2. Templates

- Modul bersama `text-overlay-model.ts`: faktor ukuran (0.78/1/1.3), gaya
  perataan (container/self/block), dan `emphasisStyle` (chip berlatar dengan
  `box-decoration-break: clone`, atau garis bawah aksen 0.09em). Kedua preset
  memakai semantik yang sama; warna konkret milik theme masing-masing.
- Teks yang berbagi `position` kini mengalir dalam SATU kolom flex per posisi
  (rowGap proporsional), bukan saling tumpuk absolut — ketahuan dari gate
  visual still, bukan teori. Perataan per teks jatuh ke `alignSelf`.
- Empat varian seni prosedural via `visual.variant`: `duotone` (default),
  `rays` (repeating-conic), `topo` (kontur radial), `grid` (crosshatch +
  vignette) — deterministik per scene id.
- Preseden latar: `visual.type === "solid"` SELALU latar prosedural, meski
  sisa aset resolved masih tercatat di renderState (kontrak Backdrop yang
  kini ditegakkan di kedua preset).
- `computeFrameLayout` menghasilkan `boundaryFrames[]` per batas scene dari
  `transition.durationFrames`; `TransitionSeries` dan `activeSceneIndex`
  memakainya (durasi minimal scene ikut memperhitungkan overlap maksimal).
- Empat font variable ter-bundle (OFL, lihat `public/fonts/LICENSE.md`):
  Fraunces, Inter, Space Grotesk, Lora. `FONT_CHOICES` diekspor lewat entri
  `@dalang/templates/fonts`; `meta.tokens.fontDisplay/fontBody` boleh merujuk
  keluarga ini (string lain tetap sah — fallback stack menjaga render).

### 3. Studio

- Dialog "Gaya proyek": preset gaya, token warna aksen/dasar, dan dua pilihan
  font — satu op `setMeta` (undoable). "Reset token" mengosongkan tokens.
- Tab Teks: kontrol align/size/emphasis per teks (Segmented, label pendek).
- Tab Transisi: slider "Durasi" 6–24 frame (netral 15, ditampilkan dalam
  detik) — commit mempertahankan `type`.
- Tab Visual: "Seni prosedural" (Duotone/Sinar/Kontur/Grid) untuk scene
  solid/stock, dan "Unggah gambar" — file PNG/JPEG ≤8MB dikirim sebagai data
  URL, disimpan ke `assets/unggah-<hash8>-<nama>`, `setResolvedAsset` dengan
  dimensi terukur, lalu SATU batch patch user `[replaceAsset pinned,
  updateScene type:"image" bila perlu]` — atomik dan undoable.
- Liveness: EventSource diberi `onopen`/`onerror` → state `connected`;
  chip "Tersimpan"/"Menyambung" di topbar, reconnect otomatis me-refresh
  state penuh + toast. Setiap patch memang sudah persist server-side
  (autosave), SSE menyiarkan ke semua tab — tanpa reload halaman.

### 4. Agent lebih handal

- `pruneHistory`: riwayat sesi dipangkas ke 40 pesan terakhir dengan penanda
  ringkas, dan kepala riwayat yang yatim (pesan `tool` tanpa assistant
  pemanggilnya — ditolak sebagian provider) di-drop baik saat prune maupun
  saat load. Sesi panjang tidak lagi bisa merusak permintaan berikutnya.
- System prompt "PERANGKAT SINEMATIK" menjelaskan semantik align/size/
  emphasis, tempo `durationFrames`, varian seni, token gaya, dan empat nama
  font — agent bisa memakai seluruh perangkat baru tanpa menebak.

## Konsekuensi

- Plan lama valid tanpa perubahan; semua field baru berdefault.
- Verifikasi: 11 cek Playwright terskrip (liveness putus-sambung tanpa
  reload, Gaya, teks bergaya, durasi transisi, varian, upload ter-pin, undo
  beruntun sampai riwayat kosong) LULUS; still render membuktikan chip/garis
  bawah/kolom teks, varian rays/grid, dan font token sampai ke piksel.
- Upload menulis file ke folder proyek (`assets/unggah-*`) — di luar cache
  `.dalang`, ikut plan sebagai aset lokal biasa (lisensi milik pengguna).
