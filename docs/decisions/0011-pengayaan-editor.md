# ADR-0011 — Pengayaan Skema & Editor (filter, transisi, teks overlay, chat multimodal)

**Status:** Diterima · **Tanggal:** 2026-08-29

## Konteks

Umpan balik owner: teks/grafis/filter/efek/transisi/opacity/rasio belum ada,
panel properti membingungkan, dan chat belum multimodal. Skema §5.1 hanya
boleh berubah lewat ADR — inilah ADR-nya. Prinsip: setiap kemampuan baru
harus lewat kontrak data (patch ops) agar agent dan manusia SETARA — bukan
fitur UI yang tak terlihat agent.

## Keputusan

### 1. Tiga field additive di skema v0 (mundur-kompatibel, default netral)

- `scene.visual.filter?` — `{ preset: none|warm|cool|mono|vivid|film,
  brightness/contrast/saturation (0.25–2), opacity (0–1) }`. Dirender
  sebagai rantai CSS filter dari `filterToCss()` (murni, diuji) di lapisan
  media Backdrop — berlaku sama di Player, renderer, dan thumbnail.
- `scene.transition` — `{ type: cross-fade|slide-left|slide-right|slide-up|
  wipe-right|wipe-down|none }`, transisi KELUAR scene, dipetakan ke
  presentation resmi `@remotion/transitions` (fade/slide/wipe/none, arah
  diverifikasi dari types terpasang). Durasi transisi tetap 15 frame agar
  `computeFrameLayout` dan snapshot timeline tidak berubah — durasi kustom
  menyusul bila dibutuhkan.
- `scene.texts` (maks 3) — `{ id, content, role: headline|subline|kicker|
  quote, position: top|center|bottom, startFrac/endFrac }`. Dirender
  `TextsOverlay` dengan tipografi theme preset + animasi masuk/keluar
  fade-rise deterministik; di atas visual, di bawah caption.

`sceneUpdateSchema` (patch §5.2) menerima ketiganya; inverse otomatis dari
mekanisme updateScene yang ada → undo/redo & lock enforcement gratis.
Plan lama terparse identik (default: cross-fade, texts [], tanpa filter).

### 2. Panel Properti bertab (pola editor umum)

Tab `Scene | Visual | Teks | Transisi` menggantikan satu gulungan panjang:
segmented control untuk gerak kamera/peran/posisi teks, chip preset filter +
empat slider (commit patch saat dilepas, bukan tiap piksel), kartu transisi
dengan glyph arah, saklar kunci selalu terlihat. Switcher rasio 16:9/9:16/1:1
di header (setMeta — layout & metrics per rasio sudah ada sejak Fase 0).

### 3. Chat multimodal dengan AUTODETEKSI dari registry

`ProjectStatePayload.models.vision` = `imageInput` model orkestrator dari
metadata models.dev: `true` → tombol lampir aktif; `false` → nonaktif dengan
alasan; `null` (metadata tak dikenal) → boleh dicoba. Server memvalidasi
data URL (png/jpeg/webp/gif, maks 3 × 4MB) dan MENOLAK 400 bila model
dipastikan non-vision. `runAgentTurn` menerima lampiran → content parts
gambar AI SDK; riwayat dipersist TANPA byte gambar (placeholder
"[gambar terlampir]") agar `.dalang/chat-history.json` tetap kecil. System
prompt diperluas: agent tahu perangkat sinematik baru + cara memperlakukan
gambar (referensi visual/brief).

### 4. Soal "kehandalan pengetahuan" — jujur

Pengetahuan agent = model pilihan user + `researchTopic` (tier-volume,
berbasis pengetahuan model, menandai ketidakpastian). BELUM ada web search
nyata; jalur berikutnya adalah tool pencarian provider-native via AI SDK —
butuh kredensial nyata untuk diverifikasi, jadi tidak diklaim sekarang.

## Bukti

Unit: 5 test kontrak ADR-0011 di core (default kompatibel, set/undo/clear
filter, transition+texts+inverse, lock tetap menolak, maks-3 ditegakkan) +
3 test `filterToCss`; total suite 224 hijau, typecheck penuh, Biome bersih.
Live via UI nyata (Playwright): pilih klip → chip filter Mono → filmstrip &
preview berubah; tambah teks → overlay & badge tab; kartu Geser kiri →
`transition.type` berubah — semua tercatat di patch log dan bisa di-undo.
Kirim gambar end-to-end dengan model vision nyata belum teruji (butuh API
key); jalur validasi server + bentuk pesan multimodal diuji unit.

## Konsekuensi

- (+) Agent bisa menyutradarai filter/transisi/teks lewat patch yang sama
  dengan manusia — dua arah tetap simetris.
- (−) Durasi transisi belum per-scene; kurva easing (curve) belum ada;
  musik/SFX, trim handle, dan pustaka media adalah pekerjaan berikutnya
  yang disadari, bukan diklaim.
- (−) Filter diterapkan di lapisan media (bukan post-process seluruh
  komposisi) — grain/vignette preset tidak ikut terfilter (disengaja,
  menjaga bahasa preset).
