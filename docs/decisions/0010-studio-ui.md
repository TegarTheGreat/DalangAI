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

## Revisi (2026-08-29, umpan balik owner)

Dua koreksi arah pada hari yang sama, keduanya dari umpan balik langsung:

1. **Tanpa emoji, dan tampilan harus kelas editor** — layout dirombak dari
   "3 kolom kartu" ke pola editor video (CapCut/Premiere-like): timeline
   HORIZONTAL di dasar (lebar klip = durasi, thumbnail nyata, dot status),
   panggung preview di tengah, panel properti tergrup di kanan, chat kiri
   yang bisa dilipat, ikon SVG + label (tanpa satu pun emoji — kini konvensi
   proyek). Playhead dua arah: `frameupdate` Player → bus playback → sorot
   klip aktif; klik klip → `seekTo` awal scene. Bus playback terpisah dari
   store agar denyut 30x/dtk hanya me-render timeline.
2. **Default model netral vendor** — lihat revisi ADR-0009
   (`pickDefaultModels`): environment user yang menentukan, bukan preferensi
   bawaan; UI menampilkan alasan apa adanya saat tidak ada/ambigu.

3. **Timeline naik kelas jadi NLE mini + pass mobile** (iterasi umpan balik
   kedua): ruler waktu ber-tick dengan SCRUB (pointer capture, jeda saat
   digosok), playhead garis penuh menembus track, track VIDEO berupa klip
   filmstrip (deretan `<Thumbnail>` nyata, lebar = durasi, pemetaan
   piecewise-linear frame<->px di `timeline-scale.ts` yang diuji unit),
   track SUARA per scene (blok bergaya gelombang: hijau ada, kuning
   fallback, putus-putus belum), transport play/jeda + waktu + zoom slider,
   drag-and-drop menyusun ulang klip (desktop; mobile pakai tombol Geser).
   Mobile diverifikasi screenshot 390x844: panel samping jadi laci penuh
   layar dengan tombol Tutup, toolbar header dapat digulir dengan tombol
   Ekspor sticky, target sentuh diperbesar.

4. **Sistem kontrol buatan sendiri, bukan adopsi kit** (iterasi umpan balik
   ketiga; owner eksplisit menolak adopsi shadcn — "wajib lebih bagus dan
   lebih solid"). `components/controls.tsx` + CSS token menjadi satu sumber
   kontrol tanpa dependensi UI eksternal: `Switch`, `Popover` (Esc +
   klik-luar), `RadioCard`, `Segmented` (dipakai lintas panel), tooltip CSS
   murni `[data-tip]` (jeda 250ms, varian bawah untuk header), ring fokus
   konsisten `--ring` di semua kontrol, select ber-chevron sendiri, animasi
   masuk dialog/popover/toast. Di atasnya: **dialog Ekspor beropsi**
   (RadioCard Draft 540p / Final 1080p dengan estimasi jujur; memilih =
   mengonfirmasi, tanpa dialog kedua), **perancang brief** di chat (form
   topik/gaya/durasi/rasio/suara + saklar "langsung suara & aset" yang
   dikompilasi jadi satu instruksi agent; tetap bisa dijelajahi saat chat
   nonaktif, hanya kirim yang terkunci beralasan), **chip aksi cepat**
   (suara semua/isi aset/rapikan narasi/render draft), **trim handle** di
   tepi kanan klip timeline (mekanika CapCut: seret = pratinjau lebar +
   label detik snap 0.1s, lepas = patch `updateScene{duration}` — tercatat,
   bisa di-undo, klem MIN_SCENE_SEC), dan pintasan **Spasi** putar/jeda
   (diabaikan saat fokus di input/tombol). Verifikasi Playwright 18/18:
   trim 5s -> 8.0s tepat sesuai piksel dan masuk patch log; perbaikan nyata
   yang ketahuan dari gate visual: lapisan overlay dinaikkan di atas kontrol
   Player dan `white-space: normal` pada RadioCard (teks kini membungkus di
   390px).

5. **Pass presisi setelah owner menolak hasil #4** ("tidak presisi, tidak
   simetris, ikon tak jelas, form asisten seperti buatan anak SD" — kritik
   yang terbukti benar di screenshot). Perombakan: (a) `icons.tsx` digambar
   ulang total di grid 24 dengan bentuk baku (mic, gembok, paku payung,
   sparkles AI, pesawat kirim, baki ekspor/unduh) dan DIVERIFIKASI lewat
   lembar ikon yang dirender dari markup produksi — bukan dikira-kira;
   (b) komposer chat yang tadinya empat elemen bertumpuk miring menjadi
   SATU kartu: textarea tanpa bingkai di atas, toolbar sejajar di bawah
   (sparkles + lampir kiri, kirim ikon pesawat kanan; ring fokus pindah ke
   kartu), terverifikasi sejajar dy=0.0px; (c) form brief keluar dari
   popover sempit: proyek kosong disambut KARTU PEMBUKA inline (glyph +
   judul + form), proyek berjalan membukanya sebagai dialog terpusat 480px
   — layout form simetris: topik penuh, twin select Gaya|Suara, Durasi
   3-segmen sama lebar, Rasio 3-segmen dengan GLYPH kotak proporsional
   (16:9 lebar, 9:16 tinggi, 1:1 persegi — juga dipasang di switcher rasio
   header), switch, CTA penuh; (d) lebar panel kiri/kanan disamakan 336px;
   (e) tombol "Mulai dari brief" di stage kosong kini memfokus input topik
   kartu pembuka (selektor lamanya sudah mati). Auto-scroll chat hanya
   berlaku saat ada pesan supaya kartu pembuka tampil dari atas.
   Verifikasi Playwright 21/21 termasuk regresi #43 (Ekspor, trim, Spasi).

## Konsekuensi

- (+) Fase 4 (tutorial) & preset baru otomatis muncul di studio — Player
  memakai komponen produksi.
- (−) Kolaborasi multi-user butuh revisit R-1 (CRDT) + penulis tunggal ini
  jadi titik serialisasi.
- (−) Teks agent belum streaming per-token (`generateText`, bukan
  `streamText`) — aktivitas tool live sudah mengisi jeda; upgrade terpisah.
- (−) `@remotion/player` dipin 4.0.518 harus se-versi dengan remotion
  (aturan Remotion); upgrade selalu serentak.
