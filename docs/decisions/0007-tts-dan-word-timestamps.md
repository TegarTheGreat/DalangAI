# ADR-0007 — TTS Bahasa Indonesia & Word Timestamps (menjawab R-2 & R-3, sebagian)

**Status:** Diterima (arsitektur & kerangka evaluasi); skor empiris **menunggu
API key/egress** · **Tanggal:** 2026-08-29

## Konteks

R-2 meminta uji nyata 3–5 opsi TTS untuk kualitas Bahasa Indonesia; R-3
meminta perbandingan sumber word-timestamps (native vs forced alignment vs
estimasi). Kendala material: lingkungan pengembangan ini berada di belakang
egress proxy yang **memblokir semua endpoint TTS** (ElevenLabs, Edge, dan
kandidat lain), sehingga penilaian kualitas suara secara empiris tidak bisa
dilakukan dari sini. Yang bisa dan sudah dilakukan: implementasi penuh + uji
unit protokol/kontrak, dan kerangka evaluasi yang tinggal dijalankan pemilik
repo dengan key.

## Keputusan

### 1. Tiga provider terimplementasi di balik satu port

| Provider | Status | Timestamps | Biaya | Catatan |
|---|---|---|---|---|
| **ElevenLabs** (utama, PRD §4.2) | Kode lengkap + unit test (fixture); belum diuji live | **Native** — endpoint `with-timestamps` memberi alignment per karakter → digabung jadi kata (`charAlignmentToWords`, teruji utk tanda baca/multi-spasi) | ~$0,11/1k karakter (estimasi, dicatat per run) | `eleven_multilingual_v2` mendukung ID; `voice_settings.speed` diteruskan |
| **Edge TTS** (cadangan gratis) | Protokol WS lengkap (GEC token, SSML, parsing frame biner, WordBoundary) + unit test; **belum diuji live** — protokol tak resmi, bisa berubah | **Native** — event WordBoundary (tick 100ns → detik) | Gratis | Suara ID tersedia: `id-ID-ArdiNeural`, `id-ID-GadisNeural`; voiceId asing dipetakan ke default bahasa |
| **silence** (placeholder offline) | Teruji penuh, dipakai E2E | Estimasi deterministik (core) | 0 | WAV sunyi; SELALU ditandai fallbackQuality |

Chain default: provider yang diminta plan → sisanya → `silence` terakhir.
Primary yang diminta tanpa key = error konfigurasi yang keras; fallback tanpa
key hanya di-drop dari chain.

### 2. Jawaban R-3 untuk kandidat saat ini: forced alignment TIDAK diperlukan

Kedua provider nyata memberi timestamps **native** dalam bingkai acuan yang
sudah menjadi kontrak core (audio-relative, 0-based) — jalur data identik
dengan estimasi offline, jadi peningkatan fidelitas tidak mengubah kode.
WhisperX/forced alignment baru relevan bila provider tanpa timestamps
diadopsi (mis. XTTS lokal) — keputusan ditunda sampai kandidat itu nyata,
tercatat sebagai kelanjutan R-3.

### 3. Kerangka evaluasi R-2 (dijalankan saat key tersedia)

- **Korpus uji ID** (14 kalimat, akan hidup di `docs/evaluasi/tts-id.md` saat
  eval pertama dijalankan): angka & tahun ("pada tahun 1814…", "2.672 panel"),
  kata serapan (stupa, relief, ekspedisi, vulkanik), nama diri (Borobudur,
  Syailendra), kalimat panjang bertanda hubung — titik lemah umum TTS ID.
- **Rubrik 1–5 per dimensi:** prosodi/naturalness, pelafalan angka,
  pelafalan serapan/nama, artefak audio, akurasi timestamps (offset kata vs
  audio, diukur manual di 3 kalimat).
- **Prosedur:** `dalang generate` pada plan uji per provider (chain
  dipaksa tunggal), bandingkan buta. Biaya per video 60 dtk dicatat dari
  ledger (target PRD < $0,15 total).
- Kandidat tambahan utk dieval saat itu: Kokoro/ONNX (EN-only per PRD),
  XTTS lokal — masuk hanya bila skor ElevenLabs/Edge tidak memadai.

## Konsekuensi

- (+) Integrasi TTS nyata = menjalankan eval + mengisi `.env`; tidak ada
  perubahan kode di jalur data.
- (−) **Jujur:** klaim kualitas ID belum berbasis pendengaran; Edge belum
  terverifikasi live dan protokolnya tak resmi (risiko dicatat di PRD §13 pola
  fallback). Keduanya diblokir oleh lingkungan, bukan oleh desain.
- (−) Durasi MP3 Edge diaproksimasi dari boundary terakhir (+0,4 dtk) sampai
  kalibrasi live; ElevenLabs eksak dari alignment.
