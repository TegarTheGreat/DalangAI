# ADR-0014 — Ekspor kaya, musik latar, dan kaidah sutradara

**Status:** Diterima · **Tanggal:** 2026-08-30

## Konteks

Kritik owner: dialog Ekspor terlalu miskin (hanya draft/final), hasil video
masih terasa "generic" — belum seperti keluaran tangan editor — dan mutu
enkode kurang. Diagnosis: (1) pengguna menilai kualitas dari preview 540p
CRF 28; (2) video hening tanpa bed musik terasa slideshow; (3) timing
linear di transisi dan Ken Burns terasa mekanis; (4) tidak ada mekanisme
yang MENDORONG rencana ke arah kaidah editing yang baik.

## Keputusan

### 1. Pengaturan ekspor (renderer, CLI, studio)

- `ExportSettings { format, resolution, quality }` di @dalang/renderer:
  - format: `mp4` (H.264+AAC), `webm` (VP9+Opus), `mov` (ProRes+PCM 16-bit);
  - resolution: 540/720/1080 (sisi pendek; skala dari komposisi 1080);
  - quality: `cepat`/`seimbang`/`terbaik` → CRF+preset per codec
    (H.264: 23/18/15 + veryfast/medium/slow, audio 128k/192k;
    VP9: 36/32/28; ProRes: proxy/standard/hq), jpegQuality 80/90/95.
- Profil lama `draft|final` tetap ada sebagai MAKRO default
  (draft = mp4 540p cepat + petunjuk debug; final = mp4 1080p seimbang);
  `settings` menimpanya per field. `encoderArgs` murni + teruji unit.
- CLI: `dalang render --video-format --resolution --quality`; nama file
  default `<proyek>-<res>p-<mutu>.<ext>`.
- Studio: dialog Ekspor = 3 kartu format + Segmented resolusi + mutu, dengan
  baris penjelasan teknis yang jujur per kombinasi; pekerjaan berat
  (1080p / terbaik / mov) tetap lewat pola konfirmasi 428. Nama file
  `ekspor-<res>p-<mutu>.<ext>`; riwayat render menampilkan label dari nama.
- Verifikasi tanpa ffprobe: byte kontainer dicek langsung
  (ftyp+avc1+mp4a; EBML+V_VP9+A_OPUS; ftyp+apc?+PCM).

### 2. Musik latar (mengimplementasikan `audio.music` yang sudah ada di §5.1)

Skema TIDAK berubah — `audio.music { assetId, volume, ducking }` sudah
dicadangkan sejak v0 dan baru sekarang dieksekusi ujung-ke-ujung:

- Pustaka ter-bundle `pustaka:tenang` / `pustaka:cerah`
  (templates/public/music, WAV mono 22.05kHz, 48 dtk loop mulus).
  KEDUANYA DISINTESIS DETERMINISTIK oleh proyek (pad sinus terkuantisasi ke
  grid 1/48 Hz + noise ter-filter; CC0, lihat LICENSE.md) — unduhan musik
  eksternal diblokir proxy lingkungan, dan sintesis menjaga repo bebas
  masalah lisensi. assetId lain dianggap file milik proyek dan ikut
  di-stage renderer.
- `buildMusicVolume` (murni, teruji): fade-in/out global + DUCKING kosinus
  ke 35% di bawah scene yang bernarasi DAN sudah punya audio narasi di
  renderState. Preview Player dan render final memakai envelope yang sama.
- Studio: pilihan musik di dialog Gaya → satu op `setAudio` (undoable);
  agent mendapat instruksi + bisa memakai op yang sama.

### 3. Craft pass templates

- Transisi memakai timing ber-easing kubik lewat `timingFor` bersama —
  linear terasa mekanis.
- Ken Burns/pan di Backdrop diberi easing kubik (settle di awal/akhir,
  seperti dolly sungguhan).
- Plan demo Borobudur menerapkan kaidah: musik tenang, tempo transisi
  bervariasi (10–24 frame, slide/wipe di momen energik), kicker hook ber-chip
  di scene pembuka.

### 4. Kritik sutradara (`critiquePlan`, core)

Heuristik deterministik anti-"generic": musik hening, gerak kamera monoton,
transisi seragam (tipe+tempo), hook lemah, narasi terlalu padat per detik,
judul kepanjangan, solid polos beruntun, teks tanpa hierarki, outro hilang.
Dipakai tiga arah:

1. `dalang validate` menampilkan "Saran sutradara";
2. blok konteks agent menyertakan maksimal 5 saran — model memperbaiki
   rencananya tanpa disuruh (dan diminta menjelaskan bila sengaja
   mengabaikan);
3. system prompt mendapat bagian KAIDAH SUTRADARA (hook 3 detik, musik
   hampir selalu menyala, variasi gerak, tempo mengikuti isi, hierarki teks).

Murni saran — tidak pernah memutasi plan sendiri (PRD: manusia/agent yang
memegang kemudi).

## Konsekuensi

- Ekspor kini punya 27 kombinasi teruji-tipe (3 format × 3 resolusi × 3
  mutu) dengan default rilis mp4 1080p seimbang; preview cepat tetap ada.
- Ukuran repo +4.3MB untuk dua bed musik WAV; harga yang diterima untuk
  render offline tanpa dependensi jaringan/lisensi.
- Ducking mengikuti keberadaan audio narasi di renderState: proyek demo
  ber-TTS silence tetap ter-duck (jujur terhadap struktur); saat TTS nyata
  dipakai perilakunya identik.
- `RenderVideoResult` membawa `settings` — pemanggil tahu persis apa yang
  dirender.
