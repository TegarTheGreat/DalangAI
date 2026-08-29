# ADR-0006 — Arsitektur Pipeline Deterministik (Fase 1)

**Status:** Diterima · **Tanggal:** 2026-08-29

## Konteks

PRD §7 menuntut pipeline dengan sifat wajib: granularitas per scene, caching
content-hash, resumable (SQLite), fallback antar provider dengan degradasi
jelas, dan idempoten. Fase 1 mengimplementasikan tahap [2] TTS dan [3]
asset-resolve; tahap [4] caption dan [5] compose sudah termaterialisasi saat
render dari `renderState` (keputusan Fase 0), tahap [1] script menunggu agent
(Fase 2).

## Keputusan

### 1. Dua paket baru dengan arah dependensi hexagonal

- `@dalang/pipeline` — **ports** (`TtsProvider`, `StockProvider`), stages,
  ledger SQLite, hashing. Tidak mengimpor provider konkret satu pun; stages
  menerima chain via injeksi.
- `@dalang/providers` — implementasi (ElevenLabs, Edge, silence, Pexels,
  Pixabay) + registry perakit chain. Bergantung pada pipeline, bukan
  sebaliknya. CLI (kelak agent runtime) yang mengawinkan keduanya.
- *Amandemen ADR-0001:* `providers/*` menjadi SATU paket `@dalang/providers`
  (adapter masih tipis, semuanya berbasis fetch/WS bawaan). Provider berdeps
  berat kelak (mis. TTS ONNX lokal) dipecah jadi paket sendiri saat muncul.

### 2. Output hidup di samping plan: `<planDir>/.dalang/`

`tts/<hash>.<ext>`, `assets/<hash>.<ext>`, `pipeline.db`. Wajib begitu karena
path `renderState.file` adalah **relatif terhadap folder plan** (kontrak Fase
0; staging renderer menolak path keluar folder). Konsekuensi manis: proyek
portabel — pindahkan foldernya, semua ikut. `.dalang/` gitignored.

### 3. Kunci cache = input kreatif, bukan provider

`hash(text + voiceId + speed + language)` untuk TTS;
`hash(query + orientation + preferensi kind)` untuk aset. Provider yang
kebetulan berhasil dicatat di ledger tapi tidak pernah ikut kunci — fallback
tidak menginvalidasi cache. Nama file content-addressed + tulis atomik
(tmp+rename) ⇒ menjalankan ulang tahap selesai adalah no-op sejati.

### 4. Ledger `stage_runs` di `node:sqlite`

Satu baris per (project, scene, stage): status running/done/error, provider,
flag fallback, `output_json` (snapshot NarrationAudio/ResolvedAsset penuh),
error, perkiraan biaya, durasi. Sifat yang dibeli:

- **Resume:** baris `done` + hash sama + file ada ⇒ skip; baris `running`
  basi (crash) di-overwrite oleh start berikutnya — aman karena output
  atomik.
- **Self-healing:** cache hit me-rematerialisasi `renderState` dari
  `output_json` — plan yang kehilangan renderState (revert/undo) pulih tanpa
  sintesis ulang. Ini membuat keputusan Fase 0 ("undo tidak menyentuh
  renderState") murah secara nyata.
- **Observability (PRD §10):** ledger = log terstruktur per tahap.

Driver: `node:sqlite` bawaan (nol dependensi native, local-first; permukaan
API dibungkus satu modul `db.ts` sehingga bisa ganti driver kapan pun;
warning experimental difilter spesifik). Batasan yang diterima: satu proses
generate per proyek pada satu waktu — job queue multi-proses menyusul bersama
UI (Fase 3), dicatat di sini agar tidak jadi asumsi diam-diam.

### 5. Aturan tulis ke plan

- TTS menulis `renderState.narrationAudio` (helper `setNarrationAudio`).
- Asset-resolve menulis `renderState.resolvedAssets` DAN `visual.assetId`
  lewat helper baru `assignResolvedAsset` — PRD §5.1: "assetId diisi pipeline
  setelah fetch". Helper menolak scene `pinned` di level kode; stage juga
  melewati scene `locked` (kunci berarti "jangan sentuh scene ini", termasuk
  visualnya).
- `generate` menulis balik plan.json secara atomik hanya bila berubah;
  field kreatif tidak pernah disentuh (diuji).

### 6. Degradasi selalu terlihat

Fallback ke provider ke-2+ ATAU provider placeholder ⇒
`narrationAudio.fallbackQuality: true` + peringatan konsol + kolom `suara`
di `dalang validate` menampilkan `⚠ fallback`. Chain kosong / key hilang ⇒
error per scene yang menyebut nama env var, exit code ≠ 0 — bukan diam.

## Bukti

- 55 unit test baru (pipeline 28, providers 27): cache/resume/force, fallback
  + penandaan, pin/lock, query turunan, rematerialisasi, atomicity ledger.
- E2E di lingkungan dev: `generate` (silence) → 8 scene tersintesis; run ke-2
  100% cache; render draft menghasilkan MP4 dengan **stream audio AAC**
  terverifikasi ffprobe; `generate` pada plan tanpa voice = no-op byte-identik.

## Konsekuensi

- (+) Fase 2 tinggal memberi agent tool `generateVoiceover(sceneIds)` sebagai
  panggilan tipis ke stage yang sudah teruji.
- (−) File content-addressed lama tidak dihapus saat input berubah (sampah
  terakumulasi); `dalang clean` masuk backlog.
- (−) R-5 (worker render terpisah) dan R-6 (encoder HW) belum disentuh —
  keduanya butuh perangkat keras nyata; tetap terjadwal Fase 1 akhir/Fase 3
  (lihat catatan di ADR-0004).
