# PRD — Dalang AI
**Platform Video Editor Berpilot Agent (Agent-Piloted Video Editor)**
**Versi:** 0.1 (Draft)
**Status:** Untuk direview — dokumen ini juga berfungsi sebagai briefing untuk coding agent (Claude Code)
**Terakhir diperbarui:** Agustus 2026

---

## 1. Ringkasan Eksekutif

Platform pembuatan video konten (pengetahuan, berita, tutorial, faceless content) di mana **AI agent bertindak sebagai pilot utama** — user cukup chat, dan agent yang menulis naskah, memilih visual, menyusun timeline, dan me-render video. Namun berbeda dari generator satu arah, **manusia tetap memegang kendali penuh sebagai co-pilot**: setiap elemen video bisa disesuaikan manual lewat UI (timeline, preview, properti scene), dan agent selalu sadar akan perubahan manual tersebut.

Analogi produk: **"Cursor untuk video"** — bukan "Midjourney untuk video". Agent dan manusia bekerja di atas satu dokumen hidup yang sama.

### Filosofi Nama

**Dalang** — dalam wayang, dalang adalah satu sosok yang mengendalikan segalanya sekaligus: cerita, suara semua karakter, musik gamelan, dan gerakan setiap wayang — sementara hadirin tetap bisa berinteraksi dan mengarahkan jalannya pertunjukan. Persis seperti itu peran agent di produk ini: satu orkestrator yang memainkan naskah, voiceover, visual, dan musik, di bawah arahan user sebagai tuan rumah pertunjukan.

### Prinsip Desain Inti

1. **Agent as pilot, human as co-pilot.** Default-nya agent yang mengerjakan; manusia mengarahkan, mengoreksi, dan bisa ambil alih elemen mana pun kapan pun.
2. **Scene-plan sebagai single source of truth.** Satu dokumen terstruktur (JSON) yang dimutasi dua arah — oleh agent (via chat) dan manusia (via UI). Bukan output sekali jadi.
3. **Compose, don't generate pixels.** Video dirakit dari aset nyata (stock, gambar, screenshot, TTS) lewat template terkurasi — bukan video generatif. Kualitas visual datang dari template, bukan dari model.
4. **Deterministic & resumable pipeline.** Setiap langkah pipeline bisa dijalankan ulang sendiri-sendiri tanpa mengulang semuanya. AI menghasilkan rencana; eksekusi bersifat deterministik.
5. **Model-agnostic.** Tidak terikat satu provider LLM. Registry model via models.dev + eksekusi via Vercel AI SDK.
6. **Local-first.** Berjalan penuh di mesin lokal (render, storage, pipeline). Cloud adalah optimisasi opsional di masa depan, bukan dependensi.

---

## 2. Latar Belakang & Masalah

Membuat konten video edukasi/berita/tutorial secara konsisten itu mahal waktunya. Tools yang ada terbagi dua kutub yang sama-sama tidak memuaskan:

- **Editor tradisional (CapCut, Premiere):** kontrol penuh, tapi semua manual. Riset, naskah, voiceover, pencarian aset, cutting, caption — semuanya kerja tangan.
- **Generator AI (Fliki, Pictory, faceless-video tools):** cepat, tapi black-box. Hasilnya generic, revisi terbatas pada regenerate, dan user tidak bisa menyentuh detail. Sekali hasil kurang pas, tidak ada jalan tengah selain terima atau ulang dari nol.

Celah pasarnya: **tidak ada produk yang memberikan kecepatan generator dengan kontrol editor** — di mana AI mengerjakan 90% pekerjaan dan manusia menyempurnakan 10% sisanya tanpa friksi, dalam percakapan yang berkelanjutan.

---

## 3. Target User & Use Case

### Persona Utama

1. **Kreator konten solo** (YouTube/TikTok/Shorts) — niche pengetahuan, sejarah, sains, berita, finansial. Butuh volume konsisten (3–7 video/minggu) dengan gaya visual yang khas.
2. **Pembuat tutorial produk** — dokumentasi software, onboarding, how-to. Bahan mentahnya screenshot dan screen recording.
3. **Tim kecil media/marketing** — mengubah artikel/press release jadi video berita pendek.

### Use Case Prioritas (MVP)

- UC-1: "Buatkan video 60 detik tentang [topik], gaya dokumenter, format 9:16" → agent riset, tulis naskah, pilih stock footage, render draft.
- UC-2: User mengedit hasil: geser durasi scene, ganti satu klip, ubah teks caption — via UI, tanpa chat.
- UC-3: User chat lanjutan: "scene 3 terlalu cepat, dan ganti musiknya jadi lebih tegang" → agent patch scene-plan tanpa merusak editan manual user.
- UC-4: User mengunci scene tertentu ("jangan ubah scene 1") → agent menghormati lock.
- UC-5 (fase 2): Upload screenshot aplikasi + "buatkan tutorial cara export" → agent susun langkah, deteksi koordinat elemen UI, auto-zoom + highlight + panah, sinkron dengan narasi.

### Non-Goals (eksplisit di luar scope)

- Video generatif (text-to-video ala Sora/Veo) sebagai fitur inti.
- Editing footage manusia berbicara (talking head), multicam, atau color grading profesional.
- Kolaborasi multi-user real-time (fase jauh).
- Upload/publish otomatis ke platform sosial (bisa jadi integrasi belakangan, bukan MVP).

---

## 4. Arsitektur Sistem

### 4.1 Gambaran Lapisan

```
┌─────────────────────────────────────────────────────────┐
│  UI (Web, local)                                        │
│  Chat Panel ←→ Preview (@remotion/player) ←→ Timeline   │
└──────────────────────┬──────────────────────────────────┘
                       │ (patch ops, dua arah)
┌──────────────────────▼──────────────────────────────────┐
│  PROJECT STATE — scene-plan.json + patch log            │
│  (single source of truth, versioned, undo/redo)         │
└───────┬──────────────────────────────────┬──────────────┘
        │                                  │
┌───────▼────────────┐          ┌──────────▼──────────────┐
│  AGENT RUNTIME     │          │  PIPELINE ENGINE        │
│  LLM (AI SDK) +    │          │  Job queue, stage cache,│
│  tool definitions +│          │  resumable steps        │
│  model registry    │          └──────────┬──────────────┘
│  (models.dev)      │                     │
└────────────────────┘          ┌──────────▼──────────────┐
                                │  SERVICES               │
                                │  TTS / Asset fetch /    │
                                │  Vision-grounding / OCR │
                                └──────────┬──────────────┘
                                ┌──────────▼──────────────┐
                                │  COMPOSER & RENDER      │
                                │  Remotion templates +   │
                                │  @remotion/renderer +   │
                                │  FFmpeg (hw-accel)      │
                                └─────────────────────────┘
```

### 4.2 Keputusan Teknologi (dengan alasan)

| Area | Pilihan | Alasan |
|---|---|---|
| Bahasa & runtime | TypeScript + Node.js (monorepo) | Satu bahasa end-to-end karena Remotion = React; ideal untuk dikembangkan dengan coding agent |
| Composer | Remotion | Video sebagai komponen React; preview instan via @remotion/player tanpa render; punya Agent Skills resmi untuk coding agent |
| Render lokal | @remotion/renderer + FFmpeg | Bundled FFmpeg; wajib aktifkan hardware encoder (NVENC/VideoToolbox/QSV) untuk render final; `-c copy` untuk operasi trim/concat murni |
| Agent execution | Vercel AI SDK | Interface seragam lintas provider; tool calling terstandar |
| Model registry | models.dev (api.json, cached lokal) | Metadata harga + kapabilitas 75+ provider; filter otomatis model yang mendukung tool-calling / vision; estimasi biaya per job |
| TTS | Provider-abstraction: ElevenLabs (utama, kualitas ID terbaik) + fallback lokal (mis. Kokoro via ONNX utk EN, Edge-TTS utk cadangan) | Pola fallback wajib untuk semua dependensi eksternal |
| Aset stock | Pexels + Pixabay API (gratis) | Cukup untuk MVP; abstraksi provider agar bisa tambah sumber |
| Vision/grounding | LLM multimodal via AI SDK (mis. Gemini/Qwen-VL class) | Untuk mode tutorial: OCR + bounding box elemen UI; model dipilih dari registry berdasarkan kapabilitas image-input |
| Data lokal | SQLite (job queue, project meta, patch log) + filesystem (media, cache) | Sederhana, tanpa server DB |
| UI | Next.js / Vite + React | Satu ekosistem dengan Remotion |

> Catatan untuk coding agent: sebelum menulis komponen Remotion apa pun, install dan ikuti **Remotion Agent Skills** (`npx remotion skills add`). Gunakan `<Video>` dari `@remotion/media` (bukan tag lama). Kembangkan & uji di 1080p, bukan 4K.

---

## 5. Kontrak Data: Scene-Plan & Patch Operations

Ini jantung produk. Semua fitur lain mengorbit dokumen ini.

### 5.1 Scene-Plan (draft skema v0)

```jsonc
{
  "version": 1,
  "projectId": "uuid",
  "meta": {
    "title": "Sejarah Borobudur dalam 60 Detik",
    "aspectRatio": "9:16",          // "16:9" | "9:16" | "1:1"
    "targetDuration": 60,            // detik; "auto" = ikuti narasi
    "language": "id",
    "stylePreset": "documentary-01"  // merujuk template Remotion terkurasi
  },
  "audio": {
    "voice": { "provider": "elevenlabs", "voiceId": "...", "speed": 1.0 },
    "music": { "assetId": "music-lib/calm-doc-03", "volume": 0.15, "ducking": true }
  },
  "scenes": [
    {
      "id": "sc-001",
      "locked": false,               // true = agent DILARANG memodifikasi
      "narration": "Borobudur dibangun pada abad ke-9...",
      "visual": {
        "type": "stock",             // "stock" | "image" | "generated" | "screenshot" | "solid" | "template-anim"
        "query": "borobudur temple aerial sunrise",
        "assetId": null,             // diisi pipeline setelah fetch; user bisa override manual
        "motion": "kenburns-in"      // efek gerak utk gambar statis
      },
      "caption": { "enabled": true, "style": "inherit" },
      "duration": "auto",            // "auto" = panjang narasi + padding; atau angka detik
      "annotations": []              // utk mode tutorial: zoom/highlight/arrow (lihat §9)
    }
  ],
  "renderState": {
    "narrationAudio": { "sc-001": { "file": "...", "wordTimestamps": [...] } },
    "resolvedAssets": { "sc-001": { "file": "...", "source": "pexels", "license": "..." } }
  }
}
```

Aturan skema:

- **`renderState` bersifat derived** — hasil kerja pipeline, bukan sesuatu yang ditulis agent/user langsung. Terpisah agar scene-plan inti tetap ringkas dan bisa di-regenerate sebagian.
- Semua ukuran/posisi dalam **koordinat ternormalisasi** (0–1), bukan piksel, agar aspect ratio bisa diganti tanpa merusak layout.
- Field `locked` per scene adalah kontrak keras: tool agent harus menolak operasi ke scene terkunci di level kode, bukan sekadar instruksi prompt.
- Skema divalidasi dengan Zod; versi skema eksplisit untuk migrasi ke depan.

### 5.2 Patch Operations (bukan tulis-ulang)

Agent dan UI sama-sama memutasi lewat operasi kecil:

```
addScene(afterId, scene)
removeScene(id)
updateScene(id, partial)          // ditolak jika locked
reorderScenes(order[])
setMeta(partial) / setAudio(partial)
lockScene(id, bool)               // hanya dari UI/user, bukan agent
replaceAsset(sceneId, assetRef)

// Potongan gambar di dalam satu scene — ditambahkan ADR-0033
setClips(sceneId, clips[], duration)
splitClip(sceneId, clipId, atSec, newClipId)
trimClip(sceneId, clipId, edge, mode, deltaSec)
removeClip(sceneId, clipId)
reorderClips(sceneId, order[])
```

> Lima op klip di bawah garis ditambahkan [ADR-0033](decisions/0033-beberapa-klip-dalam-satu-scene.md);
> `updateScene` sejak itu juga menerima `clipId`, dan payload `visual`-nya
> bernama `clip`. Yang mengubah SUSUNAN potongan adalah op klip; yang mengubah
> ISI satu potongan — termasuk transisi keluarnya ke potongan berikutnya — tetap
> `updateScene`.

Konsekuensi desain:

- **Undo/redo gratis** — patch log adalah event-sourcing ringan.
- **Editan manual tidak tertimpa** — agent tidak pernah menulis ulang dokumen penuh.
- **Konteks agent** — ringkasan patch log ("user baru saja memperpanjang sc-003 dan mengganti klipnya manual") disuntikkan ke konteks agent sebelum ia bertindak, sehingga agent sadar keadaan terkini.
- Resolusi konflik sederhana untuk MVP: UI dan agent tidak menulis bersamaan (agent bekerja per giliran chat); jika kelak paralel, last-write-wins per field + notifikasi.

---

## 6. Spesifikasi Agent Runtime

### 6.1 Peran & Batasan

Agent adalah **orkestrator, bukan renderer**. Ia berpikir dalam scene-plan dan tool call; tidak pernah menyentuh FFmpeg/frame langsung.

### 6.2 Tools yang Diekspos ke Agent (MVP)

| Tool | Fungsi |
|---|---|
| `researchTopic(query)` | Riset ringkas berbasis web/model untuk bahan naskah (dengan sitasi sumber di draft naskah) |
| `writeScenePlan(brief)` | Menghasilkan draft scene-plan awal dari brief user |
| `applyPatch(ops[])` | Satu-satunya jalan memodifikasi scene-plan; server memvalidasi (skema, lock, batas) |
| `searchAssets(query, type)` | Cari stock footage/gambar; kembalikan kandidat + thumbnail utk dipilih |
| `generateVoiceover(sceneIds[])` | Trigger TTS utk scene tertentu saja (parsial, bukan selalu semua) |
| `analyzeImage(assetId, question)` | Vision: deskripsi, OCR, bounding box (mode tutorial) |
| `renderPreview()` / `renderFinal(profile)` | Trigger pipeline render |
| `getProjectState()` | Baca scene-plan + ringkasan patch terakhir + status pipeline |

### 6.3 Guardrails (wajib di level kode)

- **Step cap:** maksimum N tool call per giliran chat (default 15) — cegah loop tak berujung dan ledakan biaya.
- **Cost cap:** estimasi biaya (dari harga models.dev + tarif TTS) dihitung sebelum eksekusi; di atas ambang → minta konfirmasi user.
- **Lock enforcement:** operasi ke scene `locked` ditolak server-side.
- **Approval gate untuk aksi mahal:** `renderFinal` dan TTS massal butuh konfirmasi eksplisit user (prinsip: mesin merender, manusia menilai).
- **Setiap tool call di-log** (input, output, durasi, biaya) untuk observability dan debugging.

### 6.4 Strategi Model Dua Tingkat

- **Tier orkestrasi** (naskah, penalaran, penyusunan plan): model kelas frontier dengan tool-calling.
- **Tier volume** (deskripsi frame, OCR, klasifikasi aset): model kecil/murah multimodal.
- Pemilihan model dari registry models.dev, difilter kapabilitas (tool-calling wajib utk tier 1; image-input wajib utk tugas vision). User bisa override di settings. Cache api.json lokal, refresh harian.

---

## 7. Pipeline Engine

### 7.1 Tahapan

```
brief → [1] script & scene breakdown → [2] TTS + word timestamps
     → [3] asset resolve (search/fetch/cache) → [4] caption build
     → [5] compose (Remotion props) → [6] render (preview | final)
```

### 7.2 Sifat Wajib

- **Per-scene granularity:** setiap tahap dieksekusi dan di-cache per scene. Ganti narasi sc-003 → hanya TTS + caption + compose sc-003 yang diulang.
- **Content-hash caching:** kunci cache = hash dari input tahap (teks narasi utk TTS; query+filter utk aset). Input sama → tidak ada kerja ulang, tidak ada biaya ulang.
- **Resumable:** status tiap tahap per scene tersimpan di SQLite; crash/restart melanjutkan, bukan mengulang.
- **Fallback antar provider:** tiap service eksternal (TTS, stock, LLM) punya minimal satu cadangan dengan degradasi yang jelas (contoh: ElevenLabs gagal → Edge-TTS + tandai scene "voice: fallback quality" di UI).
- **Idempotent:** menjalankan ulang tahap yang sudah selesai adalah no-op.

### 7.3 Render

- **Preview di browser:** @remotion/player memutar komposisi langsung dari scene-plan — perubahan apa pun (agent/manual) terlihat instan, nol render.
- **Draft render (opsional):** 480–720p, preset cepat, untuk cek hasil encode.
- **Final render:** @remotion/renderer di proses worker terpisah (bukan proses UI), concurrency dituning per mesin, lalu encode FFmpeg dengan hardware encoder yang terdeteksi (NVENC/AMF/QSV/VideoToolbox; fallback libx264).
- Arsitektur render dibuat **pluggable** (interface `RenderTarget`): implementasi `local` untuk sekarang; `remotion-lambda`/API cloud bisa ditambah kelak tanpa mengubah pipeline.

---

## 8. UI/UX

### 8.1 Layout

Tiga panel: **Chat (agent)** — **Preview (player)** — **Timeline/Inspector (edit manual)**. Semuanya membaca dan menulis ke project state yang sama; perubahan dari satu panel langsung terlihat di panel lain.

### 8.2 Interaksi Kunci

- Klik scene di timeline → inspector menampilkan properti (narasi, visual, durasi, caption) yang bisa diedit langsung.
- Tombol lock (gembok) per scene.
- Setiap balasan agent yang mengubah plan menampilkan **diff ringkas** ("mengubah 2 scene, menambah 1") dengan tombol undo.
- Kandidat aset dari `searchAssets` tampil sebagai grid thumbnail — user bisa memilih manual, pilihan itu tercatat sebagai patch user (dan asset ter-pin).
- Indikator status pipeline per scene (pending / processing / done / fallback / error) di timeline.
- Estimasi biaya job ditampilkan sebelum aksi mahal.

### 8.3 Kualitas Visual = Template

Diferensiasi produk ada di **style presets** Remotion yang didesain serius (tipografi, motion caption, transisi, grid layout). MVP: 2–3 preset yang benar-benar matang lebih berharga daripada 10 yang generic. Preset menerima design tokens (warna brand, font) agar user bisa personalisasi tanpa merusak desain.

---

## 9. Mode Tutorial (Fase 2)

Perluasan untuk konten how-to berbasis screenshot/screen recording:

- Input: sekumpulan screenshot (atau screen recording — di-sample per detik/perubahan besar).
- Agent menyusun langkah tutorial; per langkah, vision model mengembalikan **bounding box ternormalisasi** elemen UI yang dibahas.
- **Verifikasi grounding:** crop area hasil deteksi dikirim balik ke model untuk konfirmasi ("apakah ini tombol Export?") sebelum dipakai — mencegah zoom ke tempat salah.
- Skema `annotations` per scene: `{ type: "zoom"|"highlight"|"arrow"|"blur", target: {x,y,w,h}, timing: {...} }` — dieksekusi sebagai animasi murni di komponen Remotion (tanpa model tambahan).
- Untuk recording: deteksi posisi klik/kursor antar frame → auto-zoom mengikuti aksi (efek ala Screen Studio).

---

## 10. Kebutuhan Non-Fungsional

| Aspek | Target MVP |
|---|---|
| Waktu brief → draft preview pertama | < 3 menit (video 60 dtk) |
| Latency patch → preview terlihat | < 1 detik (player, tanpa render) |
| Final render 1080p (video 60 dtk) | < 5 menit di mesin dengan GPU consumer |
| Biaya variabel per video 60 dtk | < $0.15 (LLM + TTS), tampil transparan ke user |
| Observability | Log terstruktur semua tool call & tahap pipeline; setiap job bisa direplay/di-debug |
| Error handling | Tidak ada kegagalan senyap: setiap fallback/error tampak di UI per scene |
| Lisensi aset | Simpan metadata sumber + lisensi tiap aset yang dipakai (audit-ready) |
| Privasi | Semua media tetap lokal; hanya teks/gambar yang perlu dianalisis dikirim ke API model |

---

## 11. Fase & Milestone

**Fase 0 — Fondasi visual (validasi kualitas, tanpa AI):**
Skema scene-plan v0 + 1 style preset Remotion + render lokal dari file JSON hardcoded. *Gate: apakah hasil render terlihat premium?* Jika tidak, perbaiki template sebelum lanjut — ini penentu produk.

**Fase 1 — Pipeline deterministik:**
TTS + word timestamps → caption sinkron; asset fetch Pexels; caching + resumability per scene; CLI `dalang generate <plan.json>`.

**Fase 2 — Agent:**
AI SDK + registry models.dev; tools §6.2; patch ops + lock; loop chat di CLI dulu.

**Fase 3 — UI hybrid:**
Web UI 3 panel; @remotion/player; timeline edit manual; diff & undo; status pipeline.

**Fase 4 — Mode tutorial** (§9), style preset tambahan, draft render profile.

**Fase 5 (opsional) —** RenderTarget cloud (Remotion Lambda), publish integrations, template marketplace.

---

## 12. Metrik Sukses

- **Aktivasi:** % sesi yang menghasilkan minimal 1 draft preview.
- **Hybrid-ness (metrik khas produk ini):** rasio patch manual vs patch agent per proyek — sehat jika keduanya > 0 (bukti mode pilot+co-pilot benar-benar terpakai).
- **Iterasi:** median jumlah giliran chat + edit manual sampai render final (proksi seberapa cepat mencapai "puas").
- **Waktu total brief → final export.**
- **Biaya per video final** vs target.
- **Retensi:** user kembali membuat video ke-2+ dalam 14 hari.

---

## 13. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Hasil terasa generic (masalah #1 kategori ini) | Investasi terbesar di template/preset (Fase 0 sebagai gate); design tokens utk personalisasi; bukan menambah fitur AI |
| Kualitas TTS Bahasa Indonesia pada provider murah/lokal | Abstraksi provider + uji A/B sejak Fase 1; anggarkan ElevenLabs utk kualitas; riset alternatif (lihat §14) |
| Relevansi hasil pencarian stock rendah utk topik lokal/spesifik | Multi-provider + reranking kandidat oleh vision model murah + jalur generate-image sebagai cadangan |
| Agent merusak editan user | Patch ops + lock + diff + undo (sudah di desain inti) |
| Biaya API meledak karena loop/bug | Step cap + cost cap + approval gate + hard budget per proyek |
| Perubahan API Remotion / lisensi | Pin versi; catat: lisensi perusahaan Remotion berlaku di atas skala tertentu — review saat komersialisasi |
| Vendor lock-in model AI | models.dev + AI SDK sejak hari pertama (sudah di desain inti) |

---

## 14. Pertanyaan Terbuka & Tugas Riset untuk Coding Agent

Bagian ini sengaja dibiarkan terbuka. Coding agent (Claude Code) diharapkan **meriset dan mengusulkan jawaban dengan bukti** (benchmark kecil, prototype, perbandingan) sebelum implementasi penuh — jangan mengasumsikan jawaban dari PRD ini.

**R-1. State management dokumen bersama.** Bandingkan pendekatan patch-log sederhana (event sourcing ringan) vs CRDT (mis. Yjs/Automerge) untuk scene-plan. MVP single-user cukup patch-log? Di titik mana CRDT layak? Buat rekomendasi + bukti kompleksitas.

**R-2. TTS Bahasa Indonesia.** Uji nyata 3–5 opsi (ElevenLabs, Edge-TTS, Coqui/XTTS, provider lain terkini) untuk kualitas ID: prosodi, angka, kata serapan. Deliverable: tabel skor + rekomendasi utama & fallback + apakah word-timestamps tersedia native atau butuh forced alignment.

**R-3. Word-level timestamps.** Jika provider TTS tidak memberi timestamp per kata, bandingkan: forced alignment (mis. WhisperX di audio TTS) vs estimasi berbasis durasi fonem. Ukur akurasi sinkron caption.

**R-4. Relevansi aset.** Desain & uji strategi query stock: LLM menghasilkan query → ambil N kandidat → rerank dengan vision model murah vs embedding similarity (CLIP-class). Ukur precision@1 pada 30 topik uji (campur topik global & Indonesia).

**R-5. Arsitektur worker render.** Uji @remotion/renderer dalam: child process vs worker_threads vs proses terpisah dgn IPC. Ukur stabilitas memori Chromium pada render beruntun & perilaku saat crash. Tentukan concurrency default per profil hardware.

**R-6. Hardware encoder detection.** Implementasi deteksi & pemilihan encoder FFmpeg lintas-platform (NVENC/AMF/QSV/VideoToolbox → fallback libx264) + preset kualitas/kecepatan per profil (draft vs final). Sertakan uji di minimal 2 platform.

**R-7. Struktur monorepo.** Usulkan struktur (mis. pnpm workspaces: `core` (skema+patch), `pipeline`, `agent`, `renderer`, `ui`, `providers/*`) dengan boundary yang membuat tiap paket bisa diuji terisolasi. Pertimbangkan pola hexagonal (adapters vs core) dari proyek referensi sejenis.

**R-8. Evaluasi otomatis kualitas output.** Eksplorasi: bisakah vision model menilai sampel frame hasil render terhadap brief (layout rusak? teks terpotong? kontras caption?) sebagai smoke-test CI — bukan pengganti review manusia, tapi jaring pengaman regresi template.

**R-9. Skema annotations mode tutorial.** Riset model grounding UI terkini (kelas Qwen-VL / UI-TARS / OS-Atlas atau penerusnya) — akurasi bounding box pada screenshot aplikasi nyata, format koordinat, biaya. Prototipe loop verifikasi crop (§9).

**R-10. Lisensi & atribusi aset.** Petakan kewajiban lisensi Pexels/Pixabay/musik library untuk konten termonetisasi; desain penyimpanan metadata lisensi di renderState.

**R-11. Benchmark pesaing.** Analisis singkat 3–4 produk terdekat (Eddie AI, Descript, Fliki/Pictory-class, Screen Studio utk mode tutorial): apa yang mereka lakukan baik di UX yang layak diadopsi, dan validasi celah "hybrid pilot/co-pilot" masih terbuka.

**Konvensi kerja untuk coding agent:**

- Sebelum menulis kode Remotion: `npx remotion skills add` dan patuhi skill resminya.
- Setiap tugas R-x menghasilkan dokumen keputusan singkat di `docs/decisions/` (format ADR: konteks → opsi → keputusan → konsekuensi).
- Fase dikerjakan berurutan (§11); setiap fase punya kriteria selesai yang bisa didemokan.
- Skema scene-plan (§5.1) adalah draft — boleh diusulkan revisi lewat ADR, bukan diubah diam-diam.

---

## 15. Glossary

- **Scene-plan:** dokumen JSON sumber kebenaran tunggal yang mendeskripsikan seluruh video.
- **Patch op:** operasi mutasi kecil dan tervalidasi terhadap scene-plan.
- **Lock:** penanda per scene bahwa agent dilarang memodifikasinya.
- **Style preset:** template Remotion terkurasi yang menentukan seluruh bahasa visual video.
- **RenderState:** data turunan hasil pipeline (audio TTS, aset ter-resolve, timestamps) — bukan bagian dari niat kreatif.
- **RenderTarget:** abstraksi tujuan render (local sekarang; cloud kelak).
