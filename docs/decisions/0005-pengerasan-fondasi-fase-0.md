# ADR-0005 — Pengerasan Fondasi Fase 0 (kontrak timestamps, cache bundle, tooling, CI)

**Status:** Diterima · **Tanggal:** 2026-08-29

## Konteks

Sebelum Fase 1 dibangun di atasnya, fondasi Fase 0 dikeraskan: kontrak data yang
akan dikonsumsi pipeline harus final, logika non-visual harus teruji tanpa
browser, dan regresi template harus tertangkap otomatis. Pass ini tidak
menambah fitur produk; ia menghilangkan utang yang akan berbunga di Fase 1–3.

## Keputusan

### 1. Kontrak word-timestamps: audio-relative

`renderState.narrationAudio[].wordTimestamps` didefinisikan **relatif terhadap
awal file audio (0-based)** — persis bentuk keluaran provider TTS / forced
alignment, tanpa transformasi di pipeline. Preset-lah yang menentukan posisi
narasi di dalam scene: audio diputar mulai `NARRATION_LEAD_IN_SEC`, dan
`captions-model` menggeser timestamp dengan konstanta yang sama.
`estimateWordTimestamps` (jalur sebelum TTS) diubah ke bingkai acuan yang sama,
sehingga **mengganti estimasi dengan TTS asli di Fase 1 hanya mengubah
fidelitas timing, bukan jalur kode**. Semula estimasi memakai acuan scene
sedangkan acuan TTS asli belum terdefinisi — bug arsitektural yang pasti
meledak saat integrasi TTS.

### 2. Logika murni diekstrak dari komponen React

- `templates/src/captions-model.ts` — seluruh matematika pagination/timing
  caption (komponen hanya me-render).
- `presets/documentary-01/typography.ts` — heuristik ukuran judul.
- `layout.ts` sudah murni; kini bertes, termasuk **snapshot timeline demo**
  (frame per scene + total) yang mengunci timing terhadap perubahan tak
  sengaja.

Hasil: 91 unit test lintas core/templates/renderer, semuanya tanpa Chromium.

### 3. Cache bundle webpack persisten (renderer)

- Kunci: fingerprint konten (sha256, 16 hex) atas `templates/src`,
  `templates/public` (tanpa `public/assets`), `core/src`, dan kedua
  `package.json` (mengunci versi Remotion).
- Lokasi: `$DALANG_CACHE_DIR` atau `~/.cache/dalang/bundles/<fingerprint>`,
  dengan marker file agar cache parsial tak pernah terpakai.
- Bundle di-cache **tanpa aset plan**: tiap render menyalin bundle ke dir
  sementara lalu meng-overlay aset `renderState` ke `public/` salinan itu —
  cache tidak mungkin menyajikan aset basi, dan aset demo Studio (gitignored)
  dikecualikan dari bundling maupun fingerprint.
- Terukur: still 540p dari 7,1 dtk (cold) → **2,2 dtk** (hit). Escape hatch:
  `--no-cache`.

### 4. CLI yang memvalidasi lebih dulu

`--profile`/`--format` memakai choices; `-t` dan `--concurrency` divalidasi
dengan pesan jelas; file hilang / JSON rusak / versi skema tak didukung
masing-masing punya pesan spesifik (bukan stack trace ENOENT).

### 5. Artefak JSON Schema untuk editor

`packages/core/schema/scene-plan.v1.schema.json` digenerate dari sumber zod
(`pnpm schema:gen`, mode input: field ber-default menjadi opsional). Field
`$schema` opsional ditambahkan ke skema (diabaikan runtime) supaya plan.json
mendapat autocomplete/validasi di editor. Unit test menjaga artefak selalu
sinkron dengan sumber. Catatan: refinement zod (cek id duplikat) tidak
terepresentasi di JSON Schema — parser runtime tetap otoritas.

### 6. Tooling & CI

- **Biome** (lint + format + organize imports) menggantikan ketiadaan linter;
  `noArrayIndexKey` dimatikan khusus `presets/**` (list statis pure-render
  Remotion tidak pernah di-reorder di state React).
- **GitHub Actions**: lint → typecheck → test → validate demo → **render
  smoke** (2 still nyata lewat bundle+Chromium runner, artefak di-upload).
  Ini prekursor R-8: regresi template gagal di CI, bukan di mata user.
- `.editorconfig`, `.nvmrc`, margin 16:9 dinaikkan mengikuti pedoman
  video-layout resmi (sisi ≥ 80px × skala lebar).

## Konsekuensi

- (+) Fase 1 (TTS) menulis ke kontrak yang sudah final dan teruji dua arah.
- (+) Iterasi visual cepat (cache) dan aman (snapshot timeline + smoke CI).
- (−) Cache menambah state di mesin dev (`~/.cache/dalang`) — dibersihkan
  aman kapan pun; fingerprint membangun ulang otomatis.
- (−) Perubahan apa pun di `core/src` atau `templates/` meng-invalidasi cache
  bundle — memang harus begitu.
