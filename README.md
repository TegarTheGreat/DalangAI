# Dalang AI

**Platform video editor berpilot agent** — AI sebagai pilot yang menulis naskah,
memilih visual, menyusun timeline, dan me-render; manusia sebagai co-pilot yang
bisa mengarahkan dan mengambil alih elemen mana pun. "Cursor untuk video",
bukan "Midjourney untuk video".

Dokumen produk lengkap: [docs/PRD.md](docs/PRD.md) ·
Keputusan teknis: [docs/decisions/](docs/decisions/)

## Status: Fase 3 (UI hybrid) selesai · Fase 2, 1, 0 selesai

![Dalang Studio — 3 panel: chat agent, preview @remotion/player, timeline/inspector](docs/media/studio-borobudur.jpg)

*Dalang Studio (`pnpm dalang studio proyekku/`), tata letak kelas editor:
chat agent (kiri, bisa dilipat), preview instan `@remotion/player` (tengah),
panel properti (kanan), dan timeline NLE di dasar — ruler ber-scrub, klip
filmstrip selebar durasinya, track suara, playhead tersinkron dua arah
dengan Player. Semua panel membaca-menulis scene-plan yang sama, sinkron
via SSE.*

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
    degradasi ditandai `fallback` per scene.
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
  - **Model-agnostic & netral vendor** (Vercel AI SDK v7 + registry
    models.dev): default TIDAK memihak provider — mengikuti API key yang
    terpasang di environment-mu (anthropic / google / openai /
    openai-compatible); model dipilih dari data registry, override
    `--model` / `DALANG_MODEL`. Lebih dari satu key = wajib memilih
    eksplisit (dua tingkat, §6.4).
  - **Guardrails di kode** (§6.3): step cap 15, budget per giliran & per
    proyek, approval gate utk renderFinal/TTS massal (non-interaktif =
    tolak default), semua tool call ter-log (`dalang log`).
  - **Sadar editan manual**: file plan yang diubah di luar chat terdeteksi
    per giliran dan disuntikkan ke konteks agent (PRD §5.2); riwayat +
    undo/redo (`/undo`, `/redo`) bertahan lintas restart.
- **UI hybrid (Fase 3)** — `dalang studio`:
  - **Perangkat sinematik lewat kontrak data (ADR-0011)**: filter per scene
    (6 preset + cerah/kontras/saturasi/opacity), transisi per scene
    (larut/geser/sapu/potong), hingga 3 teks overlay
    (judul/subjudul/label/kutipan, posisi & timing), switcher rasio
    16:9/9:16/1:1 — semuanya patch ops §5.2, jadi agent dan manusia sama
    kuatnya, dan semuanya bisa di-undo.
  - **Chat multimodal dengan autodeteksi**: lampirkan gambar sebagai
    referensi visual; tombolnya aktif hanya bila registry models.dev
    menyatakan model orkestrator mendukung input gambar.
  - **Satu state, tata letak editor** (PRD §8): chat agent · preview
    `@remotion/player` (komponen video yang sama dengan renderer — patch →
    preview < 1 dtk, tanpa render) · panel properti BERTAB
    (Scene/Visual/Teks/Transisi: segmented, chip filter, slider, kartu
    transisi) · **timeline NLE**:
    ruler waktu yang bisa di-scrub, playhead tersinkron dua arah, klip
    filmstrip selebar durasi (drag untuk susun ulang, **trim handle** di
    tepi kanan mengubah durasi — snap 0.1s, bisa di-undo), track suara per
    scene, transport play/jeda + zoom, pintasan Spasi. **Dialog Ekspor
    beropsi** (Draft 540p / Final 1080p), **perancang brief** + chip aksi
    cepat di chat. Sistem kontrol buatan sendiri tanpa dependensi UI
    (switch/popover/kartu radio/tooltip CSS, ring fokus konsisten).
    Mobile-friendly (laci penuh layar, Ekspor selalu terlihat, target
    sentuh besar); ikon SVG tanpa emoji.
  - **Edit manual = patch user**: narasi/durasi/visual/reorder/hapus/tambah,
    tombol kunci per scene — masuk patch log yang sama, bisa di-undo, dan
    terlihat agent di giliran berikutnya (§5.2 dua arah; edit file di luar
    UI pun terdeteksi).
  - **Grid kandidat aset** → pilih manual = aset terpasang & **ter-pin**;
    status pipeline per scene (belum/proses/ok/fallback/error) live di
    timeline; **estimasi biaya sebelum aksi mahal** + dialog konfirmasi
    (pola 428) dan approval gate agent yang dijembatani ke dialog UI.
  - Server single-writer (Hono + SSE) memakai ulang sesi/guardrails/stage
    yang sama dengan CLI; media tersaji traversal-safe + Range 206
    (ADR-0010). Tanpa API key, chat nonaktif dengan alasan jelas — panel
    manual tetap berfungsi penuh.
- **Kualitas terjaga otomatis**: 204 unit test (kontrak lock/pin/undo, timing
  caption, snapshot timeline demo, cache/resume/fallback pipeline, protokol
  provider via fixture, keamanan staging path), Biome lint+format, dan CI
  GitHub Actions dengan **render smoke-test** nyata (prekursor R-8).
- Hasil ukur di container CPU-only: draft 540p **85 dtk**, final 1080p
  **4m38s** untuk video 51 dtk (8 scene) — lihat ADR-0004. E2E pipeline:
  MP4 hasil `generate --render` terverifikasi ber-stream audio AAC.

## Menjalankan

```bash
pnpm install

pnpm test                 # 204 unit test (7 paket) — tanpa browser & jaringan
pnpm typecheck            # semua paket
pnpm lint                 # Biome

pnpm dalang studio proyekku/          # UI hybrid 3 panel di browser — Fase 3
pnpm dalang chat proyekku/            # chat agent di terminal — Fase 2
pnpm dalang validate examples/borobudur-60s/plan.json
pnpm dalang generate examples/borobudur-60s/plan.json            # pipeline: TTS + aset
pnpm dalang generate examples/borobudur-60s/plan.json --render draft
pnpm dalang render   examples/borobudur-60s/plan.json --profile draft
pnpm dalang still    examples/borobudur-60s/plan.json -t 8 -t 29 -t 44 -o out
pnpm dalang log      proyekku/        # garis waktu pipeline + agent + biaya

pnpm studio:remotion      # Remotion Studio (alat pengembang preset/template)
```

`dalang studio` menyajikan app yang sudah ter-build
(`pnpm --filter @dalang/studio build`, otomatis tersedia setelah clone +
build sekali). Untuk pengembangan UI dengan HMR: jalankan `dalang studio` di
satu terminal dan `pnpm --filter @dalang/studio dev` di terminal lain.

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
  studio/     UI hybrid 3 panel (Vite+React+Player) + server Hono/SSE single-writer
  templates/  preset Remotion terkurasi (documentary-01) + font vendored
  renderer/   RenderTarget lokal: staging, bundling, profil draft|final
  cli/        dalang studio | chat | validate | generate | still | render | log
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
- [x] **Fase 3 — UI hybrid**: `dalang studio` — 3 panel, @remotion/player,
      edit manual + lock + reorder, diff & undo, status pipeline per scene,
      grid aset ter-pin, approval & estimasi biaya di UI (ADR-0010).
      *Catatan: giliran agent live di UI & grid aset dengan provider nyata
      menunggu API key pemilik repo — jalur HTTP-nya teruji penuh dengan
      mock/fake.*
- [ ] **Fase 4 — Mode tutorial** (annotations sudah tervalidasi di skema),
      preset tambahan.
- [ ] **Fase 5 — RenderTarget cloud**, publish integrations.

Tugas riset R-2…R-6 & R-8…R-11 (PRD §14) belum diputuskan — masing-masing akan
menghasilkan ADR sebelum implementasinya, mengikuti pola R-1/R-7 yang sudah ada
di `docs/decisions/`.
