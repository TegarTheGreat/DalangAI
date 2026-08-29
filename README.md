# Dalang AI

**Platform video editor berpilot agent** — AI sebagai pilot yang menulis naskah,
memilih visual, menyusun timeline, dan me-render; manusia sebagai co-pilot yang
bisa mengarahkan dan mengambil alih elemen mana pun. "Cursor untuk video",
bukan "Midjourney untuk video".

📄 Dokumen produk lengkap: [docs/PRD.md](docs/PRD.md) ·
Keputusan teknis: [docs/decisions/](docs/decisions/)

## Status: Fase 2 selesai ✅ (agent) · Fase 1 ✅ · Fase 0 ✅

> *Gate Fase 0: apakah hasil render terlihat premium?*

| | | |
|---|---|---|
| ![Title](docs/media/borobudur-60s-f78.jpg) | ![Sunrise](docs/media/borobudur-60s-f240.jpg) | ![Stone](docs/media/borobudur-60s-f450.jpg) |
| ![Relief](docs/media/borobudur-60s-f660.jpg) | ![Ash](docs/media/borobudur-60s-f870.jpg) | ![Map](docs/media/borobudur-60s-f1080.jpg) |

Frame di atas dirender langsung dari
[`examples/borobudur-60s/plan.json`](examples/borobudur-60s/plan.json)
(hardcoded, tanpa AI — sesuai definisi Fase 0) memakai preset `documentary-01`.

Yang sudah berjalan:

- **Skema scene-plan v0** (zod, strict, versioned) + **patch operations** dengan
  lock enforcement di level kode, batch atomik, dan inverse ops → undo/redo.
  Artefak [JSON Schema](packages/core/schema/scene-plan.v1.schema.json) untuk
  autocomplete editor, selalu sinkron via unit test.
- **Preset `documentary-01`**: tipografi editorial (Fraunces + Inter,
  di-vendor, render offline), caption karaoke tersinkron (timestamps TTS asli
  ATAU estimasi deterministik), Ken Burns / pan, film grain + vignette +
  gradien keterbacaan, chrome global (progress, running head, penghitung
  scene), crossfade antar scene, title & outro card.
- **Renderer lokal** (RenderTarget `local`): **bundle cache persisten**
  (content-fingerprint; start render ~2 dtk saat hit), overlay aset per plan,
  deteksi Chromium terpasang, profil `draft`/`final`, render video & stills.
- **CLI `dalang`**: `validate`, `still`, `render` — opsi tervalidasi, pesan
  error ramah, `--no-cache`, `--concurrency`.
- **Pipeline deterministik (Fase 1)** — `dalang generate`:
  - **TTS per scene** dengan chain fallback (ElevenLabs → Edge TTS → silence
    offline) dan **word-timestamps native** → caption karaoke sinkron; setiap
    degradasi ditandai `⚠ fallback` per scene.
  - **Asset resolve** Pexels/Pixabay (foto+video, orientasi ikut aspect
    ratio, seleksi rendisi deterministik) + **metadata lisensi per aset**
    (audit-ready, R-10).
  - **Cache content-hash + resumable** di ledger SQLite (`.dalang/` di samping
    plan): ganti narasi satu scene → hanya scene itu yang disintesis ulang;
    run ulang = no-op; crash → lanjut, bukan mengulang; cache hit bahkan
    memulihkan renderState yang hilang.
  - Scene `pinned`/`locked` tidak pernah disentuh otomatisasi (ditegakkan di
    core).
- **Agent runtime (Fase 2)** — `dalang chat`:
  - Chat dengan agent "dalang" di atas proyek: brief → riset (tier-volume) →
    `writeScenePlan` → TTS/aset → preview; revisi lewat **patch kecil**
    (`applyPatch` memakai kontrak §5.2 apa adanya — lock ditegakkan core).
  - **Model-agnostic** (Vercel AI SDK v7 + registry models.dev dengan cache
    harian & snapshot offline): default `anthropic/claude-opus-5` +
    `anthropic/claude-haiku-4-5` (dua tingkat, §6.4), override `--model`.
  - **Guardrails di kode** (§6.3): step cap 15, budget per giliran & per
    proyek, approval gate utk renderFinal/TTS massal (non-interaktif =
    tolak default), semua tool call ter-log (`dalang log`).
  - **Sadar editan manual**: file plan yang diubah di luar chat terdeteksi
    per giliran dan disuntikkan ke konteks agent (PRD §5.2); riwayat +
    undo/redo (`/undo`, `/redo`) bertahan lintas restart.
- **Kualitas terjaga otomatis**: 181 unit test (kontrak lock/pin/undo, timing
  caption, snapshot timeline demo, cache/resume/fallback pipeline, protokol
  provider via fixture, keamanan staging path), Biome lint+format, dan CI
  GitHub Actions dengan **render smoke-test** nyata (prekursor R-8).
- Hasil ukur di container CPU-only: draft 540p **85 dtk**, final 1080p
  **4m38s** untuk video 51 dtk (8 scene) — lihat ADR-0004. E2E pipeline:
  MP4 hasil `generate --render` terverifikasi ber-stream audio AAC.

## Menjalankan

```bash
pnpm install

pnpm test                 # 181 unit test (6 paket) — tanpa browser & jaringan
pnpm typecheck            # semua paket
pnpm lint                 # Biome

pnpm dalang chat proyekku/            # chat agent (buat/revisi video) — Fase 2
pnpm dalang validate examples/borobudur-60s/plan.json
pnpm dalang generate examples/borobudur-60s/plan.json            # pipeline: TTS + aset
pnpm dalang generate examples/borobudur-60s/plan.json --render draft
pnpm dalang render   examples/borobudur-60s/plan.json --profile draft
pnpm dalang still    examples/borobudur-60s/plan.json -t 8 -t 29 -t 44 -o out
pnpm dalang log      proyekku/        # garis waktu pipeline + agent + biaya

pnpm studio               # Remotion Studio (preview + scrub timeline)
```

API key provider (opsional — semuanya punya jalur offline/fallback): salin
`.env.example` → `.env`. Tanpa key, TTS memakai provider `silence`
(placeholder, ditandai jelas) dan scene stock yang belum resolved gagal dengan
pesan env var yang dibutuhkan.

Alur kontribusi & konvensi: [CONTRIBUTING.md](CONTRIBUTING.md).

Butuh Node ≥ 20 dan pnpm. Renderer otomatis memakai Chromium/Chrome yang sudah
terpasang (Playwright/sistem); kalau tidak ada, Remotion mengunduh headless
shell sekali.

## Struktur repo (ADR-0001)

```
packages/
  core/       skema scene-plan + patch ops + patch log + resolusi durasi (zod saja)
  pipeline/   stages deterministik + ledger SQLite + content-hash + ports provider
  providers/  adapter TTS (ElevenLabs/Edge/silence) & stock (Pexels/Pixabay)
  agent/      runtime agent: AI SDK v7, registry models.dev, tools §6.2, guardrails
  templates/  preset Remotion terkurasi (documentary-01) + font vendored
  renderer/   RenderTarget lokal: staging, bundling, profil draft|final
  cli/        dalang chat | validate | generate | still | render | log
examples/
  borobudur-60s/   plan.json demo + aset ilustrasi lokal (lisensi tercatat)
docs/
  PRD.md           dokumen produk (sumber kebenaran)
  decisions/       ADR (R-1 patch-log vs CRDT, R-7 monorepo, deviasi skema,
                   render stack, pengerasan fondasi)
  media/           frame hasil render untuk review gate
```

Kontrak-kontrak penting yang SUDAH ditegakkan kode (bukan prompt):

- Scene `locked` menolak `updateScene`/`removeScene`/`replaceAsset`/reorder
  dari agent; `lockScene` hanya untuk user. (PRD §5.1, §6.3, UC-4)
- `visual.pinned`: aset pilihan eksplisit tidak boleh ditimpa auto-resolve
  pipeline. (PRD §8.2)
- `renderState` = data turunan; di luar patch/undo, ditulis pipeline lewat
  helper khusus. (PRD §5.1)
- Patch selalu atomik + membawa inverse → undo/redo & diff ringkas gratis.
  (PRD §5.2)

## Roadmap fase (PRD §11)

- [x] **Fase 0 — Fondasi visual**: skema v0, preset `documentary-01`, render
      lokal dari JSON hardcoded, gate kualitas.
- [x] **Fase 1 — Pipeline deterministik**: TTS + word timestamps native
      (ADR-0007), asset fetch Pexels/Pixabay + lisensi (ADR-0008), caching
      content-hash + resumability per scene di SQLite (ADR-0006),
      `dalang generate`. *Catatan: skor kualitas TTS ID (R-2) menunggu API
      key — kerangka evalnya siap; R-5/R-6 butuh perangkat keras nyata.*
- [x] **Fase 2 — Agent**: Vercel AI SDK v7 + registry models.dev (ADR-0009),
      tools §6.2 lengkap, guardrails §6.3 (step/budget/approval/log),
      `dalang chat` dengan kesadaran editan manual & undo/redo. *Catatan:
      perilaku live dengan model nyata butuh API key pemilik repo — loop
      teruji penuh dengan mock terskrip.*
- [ ] **Fase 3 — UI hybrid**: 3 panel, @remotion/player, timeline manual,
      diff & undo, status pipeline.
- [ ] **Fase 4 — Mode tutorial** (annotations sudah tervalidasi di skema),
      preset tambahan.
- [ ] **Fase 5 — RenderTarget cloud**, publish integrations.

Tugas riset R-2…R-6 & R-8…R-11 (PRD §14) belum diputuskan — masing-masing akan
menghasilkan ADR sebelum implementasinya, mengikuti pola R-1/R-7 yang sudah ada
di `docs/decisions/`.
