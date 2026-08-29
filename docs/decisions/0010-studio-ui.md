# ADR-0010 — UI Hybrid Fase 3 (Dalang Studio: Vite + Player, server single-writer + SSE)

**Status:** Diterima · **Tanggal:** 2026-08-29

## Konteks

PRD §8: tiga panel (Chat — Preview `@remotion/player` — Timeline/Inspector)
di atas project state yang SAMA; perubahan dari satu panel langsung terlihat
di panel lain; edit manual & agent setara (patch ops, §5.2). NFR §10:
patch → preview < 1 dtk; tidak ada kegagalan senyap. PRD §4.2 menyarankan
Next.js / Vite + React.

## Keputusan

### 1. Vite + React (bukan Next.js); satu paket `@dalang/studio` berisi app + server

App lokal single-user tanpa kebutuhan SSR/SEO; yang dibutuhkan justru proses
server BERUMUR PANJANG (sesi agent, SSE, job render) — anti-pola untuk route
handler serverless-style. Maka: **app** = Vite + React murni (browser),
**server** = Hono + `@hono/node-server` (composition root yang sama persis
dengan `dalang chat`: `ProjectSession`, `Guardrails`, stage Fase 1, renderer
Fase 0 — di-inject, teruji dengan fake). Vite 8 & node-server 2 lebih baru
dari pengetahuan model pengembang → API diverifikasi dari `.d.ts`/source
terpasang (disiplin ADR-0009).

### 2. Server = penulis tunggal; panel sinkron via broadcast SSE

Semua mutasi lewat satu `ProjectSession` di server. UI tidak menyimpan state
produk: POST patch/undo/chat → server memutasi → `plan-updated` disiarkan ke
`GET /api/events` (SSE) → semua panel fetch ulang snapshot. Melanjutkan
ADR-0002 (R-1): patch-log tanpa CRDT — cukup karena penulisnya satu.
Konsekuensi jujur: job yang memutasi plan (giliran chat, stage TTS/aset,
pick) berjalan **satu-per-satu** (busy lock, HTTP 409 + UI menonaktifkan
kontrol); render boleh paralel karena membaca file plan yang sudah dipersist.
Patch di TENGAH giliran agent tetap dipancarkan seketika (pulse per
aktivitas tool) — preview bergerak sebelum giliran selesai.

### 3. Player memakai komponen video yang sama, tanpa mengubah templates

Diverifikasi dari source remotion 4.0.518: di luar bundler,
`staticFile(p)` → `/p` (root, ter-encode per segmen). Maka server cukup
me-mount `templates/public` (font) dan folder plan (aset + `.dalang/
{tts,assets,renders}`) di web root — `DalangVideo` + preset documentary-01
berjalan APA ADANYA di `@remotion/player` & `<Thumbnail>` (thumbnail per
scene di timeline). Metadata Player diturunkan dari `computeFrameLayout`
yang sama dengan renderer → preview dan render tak pernah beda durasi.
File privat `.dalang` lain (pipeline.db, chat-history, patch-log) tidak
pernah tersaji; `serveStatic` menolak traversal & mendukung Range 206
(seek media) — keduanya diuji. `assetsDir` Vite = `app/` agar tidak
bertabrakan dengan `/assets` milik plan.

### 4. Edit manual = patch origin "user"; pilihan aset = pick + pin

Inspector/timeline mengirim op §5.2 apa adanya (`updateScene`, `lockScene`,
`reorderScenes`, `addScene`, `removeScene`, `replaceAsset`) → masuk patch
log yang sama → undo/redo menyatu dengan patch agent, dan agent membacanya
di giliran berikut (§5.2 dua arah; edit file di luar UI tetap terdeteksi
fs.watch + hash). Grid kandidat (§8.2): `searchAssets` → pilih →
`materializeCandidate` + patch user `replaceAsset(pinned:true)`. Pin guard
di `assignResolvedAsset` ternyata juga memblokir pilihan ulang EKSPLISIT —
diperbaiki: `allowPinned` (pilihan user boleh mengganti pilihannya sendiri;
auto-resolve & pick agent tetap ditolak). Batas jujur: undo pick
mengembalikan `assetId`/pin (niat kreatif), bukan file renderState (data
turunan, ADR-0002) — re-resolve menyembuhkannya.

### 5. Approval & aksi mahal: dua jalur eksplisit

- **Via agent** (renderFinal, TTS massal): `ApprovalFn` dijembatani ke
  stream chat (`approval-request` + `POST /api/approvals/:id`); tanpa
  jawaban/stream putus → **ditolak** (timeout default 10 menit,
  deny-by-default §6.3).
- **Via tombol UI**: klik = persetujuan, tapi ambang §6.3 tetap ditegakkan
  dengan **HTTP 428** `needsConfirmation` + estimasi biaya → dialog
  konfirmasi → kirim ulang `confirm:true`. Estimasi tampil SEBELUM aksi
  (§8.2).

Tanpa API key, studio tetap hidup: chat nonaktif dengan alasan tampil di
panel (503 di endpoint) — panel manual berfungsi penuh.

## Bukti

23 test integrasi server (Request→Response tanpa TCP: patch/undo/redo +
origin, SSE broadcast, traversal & privasi `.dalang`, Range 206, gate 428,
busy 409, pick+pin+re-pick+auto-skip, chat mock stream, chat-nonaktif 503)
+ logika UI murni (parser SSE, derivasi status scene, metadata player) —
total 204 test hijau. Gate demoable: `pnpm dalang studio
examples/borobudur-60s` + screenshot Playwright di Chromium nyata — tiga
panel tampil, kunci scene dari inspector muncul seketika di timeline
(chip terkunci + toast), thumbnail per scene ter-render. *Belum dicoba: giliran agent
live (butuh API key), grid aset dengan provider nyata (egress terblokir).*

## Konsekuensi

- (+) Fase 4 (tutorial) & preset baru otomatis muncul di studio — Player
  memakai komponen produksi.
- (−) Kolaborasi multi-user butuh revisit R-1 (CRDT) + penulis tunggal ini
  jadi titik serialisasi.
- (−) Teks agent belum streaming per-token (`generateText`, bukan
  `streamText`) — aktivitas tool live sudah mengisi jeda; upgrade terpisah.
- (−) `@remotion/player` dipin 4.0.518 harus se-versi dengan remotion
  (aturan Remotion); upgrade selalu serentak.
