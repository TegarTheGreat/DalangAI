# ADR-0009 — Agent Runtime Fase 2 (AI SDK v7, registry models.dev, guardrails)

**Status:** Diterima · **Tanggal:** 2026-08-29

## Konteks

PRD §6 mendefinisikan agent sebagai orkestrator (berpikir dalam scene-plan &
tool call, tak pernah menyentuh frame), model-agnostic (prinsip #5: Vercel AI
SDK + models.dev), dengan guardrails di level kode (§6.3) dan strategi model
dua tingkat (§6.4). Fase 2 = tools §6.2 + loop chat di CLI.

## Keputusan

### 1. Vercel AI SDK v7 (terbaru), API diverifikasi dari types terpasang

`ai@7.0.84` + `@ai-sdk/{anthropic,openai,google,openai-compatible}`. Karena
v7 lebih baru dari pengetahuan model pengembang, seluruh permukaan API yang
dipakai (generateText multi-step, `tool()`+zod, `stopWhen`, `stepCountIs`,
kondisi berhenti kustom, `responseMessages`, `MockLanguageModelV3`)
diverifikasi terhadap `.d.ts` terinstal dan sebuah spike runtime SEBELUM
implementasi — bukan dari ingatan.

### 2. Registry models.dev: fetch → cache 24 jam → snapshot bundled

Loader defensif (api.json = data eksternal; entri rusak dilewati per-entri,
tak pernah dieksekusi). Karena endpoint terblokir di lingkungan dev, snapshot
bundled berisi **model Anthropic saja** dari data harga resmi (bukan tebakan
untuk provider lain); provider lain terisi saat api.json terjangkau, dan model
tanpa metadata tetap jalan dengan biaya "tak diketahui" (null — tidak pernah
dipalsukan nol). Kapabilitas dipakai menyaring: tool-calling wajib untuk
orkestrator; image-input dicek sebelum analyzeImage.

Default dua tingkat (§6.4): orkestrator `anthropic/claude-opus-5`, volume
`anthropic/claude-haiku-4-5` — override via `--model`/`--model-volume`/env
`DALANG_MODEL*`. Peta eksekusi terkurasi: anthropic/openai/google/
openai-compatible (baseURL kustom = pintu provider lain) + `mock/echo` untuk
smoke offline.

### 3. Tools §6.2 = pembungkus tipis lapisan yang sudah teruji

`applyPatch` memakai **patchOpSchema §5.2 apa adanya** sebagai inputSchema —
validasi server-side gratis, lock ditegakkan core (agent yang mencoba
menyentuh scene terkunci menerima error sebagai DATA dan mengoreksi arah).
`generateVoiceover`/`resolveAssets` = stage Fase 1 dengan filter `sceneIds`;
`searchAssets`+`pickAsset` (kandidat → materializeCandidate) adalah fondasi
reranking R-4; `renderPreview/renderFinal` = renderer Fase 0.
`researchTopic` memakai tier-volume "berbasis web/model" (PRD §6.2) — versi
berbasis pengetahuan model dulu; web search provider-native menyusul.
Semua dependensi (TTS/stock/render/model) di-inject → 33 unit test agent
berjalan tanpa jaringan.

### 4. Guardrails §6.3 di level kode

- **Step cap** (default 15): `stopWhen: stepCountIs(cap)`.
- **Budget giliran** (default $0,50): kondisi berhenti kustom membaca
  akumulasi biaya (usage × harga registry) yang dimutakhirkan tiap step.
- **Approval gate**: callback ter-inject; `renderFinal` SELALU minta izin;
  TTS "massal" (> 5 scene atau estimasi > $0,10) minta izin; budget proyek
  (default $5) diperiksa sebelum aksi berbiaya. Non-interaktif = **tolak
  default** (`--yes` eksplisit untuk otomasi).
- **Log semua tool call** (input/output/durasi/biaya) + baris LLM per giliran
  di tabel `agent_events` (pipeline.db yang sama) — `dalang log` menampilkan
  satu garis waktu pipeline+agent.

### 5. Kesadaran dua arah (PRD §5.2) di CLI

Konteks dinamis per giliran disuntikkan ke PESAN USER (system prompt dibiarkan
stabil byte-per-byte → ramah prompt-cache): ringkasan plan, rekap patch log,
dan **deteksi edit manual** — hash file plan dibandingkan tiap giliran; bila
berubah di luar sesi, plan dimuat ulang dan agent diberi tahu scene mana yang
diedit user. Riwayat penuh (termasuk jejak tool) + patch log dipersist di
`.dalang/` → undo/redo dan percakapan bertahan lintas restart. Plan hanya
ditulis bila berubah (tanpa churn file).

## Bukti

33 unit test agent (registry fallback-order, resolve, sesi/undo/edit-manual,
matriks tools & approval, loop mock: happy path, step-cap menghentikan loop
tanpa ujung, budget stop, biaya null utk harga tak dikenal) + smoke CLI
`dalang chat --once` offline dengan `mock/echo` pada demo. Jalur live butuh
`ANTHROPIC_API_KEY` (endpoint terjangkau dari lingkungan ini; key tidak
tersedia — perilaku end-to-end dengan model nyata belum terverifikasi).

## Konsekuensi

- (+) Fase 3 (UI) tinggal mengganti CLI: session/tools/guardrails dipakai ulang.
- (−) Biaya LLM dihitung SETELAH tiap step (bukan pra-estimasi per panggilan) —
  budget berhenti "satu step terlambat" paling banyak; pra-estimasi token
  menyusul bila terbukti perlu.
- (−) `researchTopic` tanpa web nyata; upgrade ke web-search provider-native
  saat kredensial tersedia.
- (−) `ai@7` dipin eksak; upgrade lintas-minor lewat verifikasi types yang sama.
