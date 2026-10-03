# ADR-0044: Registry models.dev dipakai sampai ke pemanggilan, bukan hanya untuk harga

**Status:** diterima (diterapkan) · **Tanggal:** 3 Oktober 2026

## Konteks

Pertanyaannya: apakah models.dev (dan registry sejenisnya) sudah diadopsi?

Jawaban jujur sebelum ADR ini: **setengahnya**. Registry sudah dipakai untuk
METADATA sejak PRD — harga per juta token, ukuran konteks, dukungan tool-calling
dan input gambar, dipakai memfilter model yang layak, memperkirakan biaya tiap
giliran chat, dan memilih model default yang netral-vendor. Tetapi untuk
MEMANGGIL model, Dalang hanya mengenal empat pintu yang dikodekan tangan:
`anthropic`, `openai`, `google`, dan satu gateway OpenAI-compatible yang harus
diisi alamatnya sendiri.

Akibatnya terukur, bukan perasaan. Registry yang diambil 2026-10-03 memuat
**226 provider dan 8.383 model** (7.327 di antaranya bisa tool-calling). Dari 226
provider itu, **185 berbicara protokol OpenAI-compatible** dan semuanya
mencantumkan alamat API-nya sendiri di registry. Orang yang punya kunci DeepSeek,
Groq, OpenRouter, Together, Mistral atau xAI harus tahu bahwa ada gateway
generik, mencari alamatnya di dokumentasi vendor, dan mengisi dua variabel
lingkungan — padahal semua yang dibutuhkan sudah tertulis di data yang kita unduh
tiap hari.

Dua temuan sampingan muncul saat mengerjakannya, dan keduanya ikut ditutup:

1. **`GITHUB_TOKEN` ada di mesin ini sendiri.** Registry mendaftarkan provider
   `github-copilot` dengan kunci `GITHUB_TOKEN`. Deteksi "env var mana pun yang
   dimiliki provider registry" akan memilihkan GitHub Copilot untuk chat di
   sandbox ini tanpa ada yang meminta — dan mengirim isi proyek pengguna ke
   layanan yang tidak pernah mereka pilih, memakai token yang dipasang untuk
   keperluan lain.
2. **SDK Anthropic membatasi model yang tak dikenalnya pada 4096 token per
   langkah.** Terlihat sebagai peringatan saat tes kabel pertama: model dengan id
   kustom di endpoint bergaya Anthropic (MiniMax dan sejenisnya) akan memotong
   `apply_patch` besar di tengah JSON.

## Keputusan

### 1. Metadata provider disimpan, dan dari situlah cara memanggilnya dibaca

`ModelRegistry` kini membawa `providers`: id, nama, paket SDK (`npm`), base URL
(`api`), nama env var kredensial (`env`), dan tautan dokumentasi. Field yang
bentuknya salah hilang SENDIRI-SENDIRI tanpa ikut membuang model provider itu —
registry adalah data luar, dan satu entri aneh tidak boleh menjatuhkan loader.

`providers.ts` menerjemahkannya dalam dua tahap, supaya daftar bisa ditampilkan
tanpa menyentuh env:

- `describeProvider` — STATIS: bisakah dipanggil, lewat jalur apa, env apa yang
  dibutuhkan;
- `routeProvider` — menerapkan env: rute siap, atau env apa yang kurang.

Aturannya, semuanya turunan dari data:

| Paket SDK di registry | Dipanggil lewat |
| --- | --- |
| `@ai-sdk/openai-compatible`, `@openrouter/ai-sdk-provider` | `createOpenAICompatible` dengan `api` |
| `@ai-sdk/openai` + `api` | `createOpenAI` dengan `baseURL` (mengikuti paket yang dipakai registry) |
| `@ai-sdk/anthropic` + `api` | `createAnthropic` dengan `baseURL` |
| SDK sendiri tanpa `api` (groq, mistral, xai, togetherai, cerebras, deepinfra, perplexity, cohere, venice) | tabel kurasi 9 endpoint OpenAI-compatible |
| paket lain (bedrock, vertex, azure, ...) | tidak didukung — alasannya menyebut nama paketnya |

Nama env var digolongkan dari AKHIRANNYA (`_KEY`, `_TOKEN`, `_PAT` = kredensial;
`_ENDPOINT`, `_URL`, `_HOST` = alamat), bukan dari daftar nama: registry menambah
provider tiap minggu dan konvensinya stabil. URL ber-template (`${VAR}`, mis.
Cloudflare Workers AI, Databricks) diisi dari env; variabel yang kurang disebut
satu per satu. Server loopback (LM Studio) tidak mewajibkan kunci.

Pada data nyata 2026-10-03: **211 dari 226 provider bisa dipanggil** — 199 dari
metadata registry, 9 dari tabel kurasi, 3 bawaan — dan dengan env lengkap ke-211
rutenya siap (0 gagal). 15 sisanya butuh SDK khusus (Bedrock, Vertex, Azure,
GitLab, watsonx, SAP, dan sejenisnya) dan DITOLAK dengan alasan, bukan "tidak
dikenal".

Tabel kurasi 9 endpoint diperiksa 2026-10-03 dengan permintaan TANPA kunci (401/403
= endpoint ada dan menuntut kredensial; 200 untuk daftar model yang publik;
Perplexity memakai `/chat/completions` di akar, tanpa `/v1`). Itu bukti
endpoint-nya ada, bukan bukti panggilan berhasil.

### 2. Keamanan: registry adalah masukan tak tepercaya

Registry mengatakan ke mana kunci pengguna dikirim. Karena itu:

- provider registry yang meminta env var MILIK provider bawaan
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_*`, `GEMINI_API_KEY`) ditolak —
  entri beracun tidak bisa mengarahkan kunci Anthropic ke penampung;
- mengirim kunci lewat `http://` di luar mesin ini ditolak (server TANPA kunci,
  mis. Ollama di LAN, boleh http);
- host tujuan ditampilkan di banner `dalang chat`, tanpa kunci.

Pengguna tetap harus memilih provider-nya (`DALANG_MODEL=provider/model`) agar
kunci apa pun terkirim; yang dijaga adalah entri registry yang berbohong tentang
SIAPA pemilik sebuah kunci.

### 3. Deteksi default: lebih luas, tetapi tidak menebak sembarangan

Sebelumnya kredensial terdeteksi dari empat nama yang dikodekan. Kini dari
`*_API_KEY` milik provider mana pun di registry yang bisa dipanggil — dengan tiga
pengaman, masing-masing menjawab satu cara salah yang nyata:

- **Hanya `*_API_KEY`.** `GITHUB_TOKEN`, `HF_TOKEN`, `AWS_*` dipasang orang untuk
  hal lain. Provider-nya tetap bisa dipakai bila dipilih eksplisit; ia hanya tak
  pernah menentukan default. Server loopback juga tak ikut ditebak: daftar
  modelnya di registry hanya katalog, yang dimuat di server pengguna bisa lain
  sama sekali.
- **Satu env var, banyak provider = ambigu.** `MINIMAX_API_KEY` dipakai empat
  provider (varian global, CN, paket coding) dengan endpoint berbeda; memilih satu
  berarti 401 yang membingungkan. Dari 212 provider yang bisa dipanggil (211 registry + ollama): 159
  terdeteksi tunggal, 32 ambigu, 2 butuh variabel pendamping, 19 tidak ditebak
  (lokal dan token generik).
- **Agregator tidak diberi model otomatis.** "Konteks terbesar" di antara 323
  model tool-calling OpenRouter bukan pilihan yang layak. Dikenali dari id
  berbentuk `vendor/model`; pengguna diminta memilih, dengan petunjuk
  `dalang models cari --provider`.

Pemilik bawaan menang atas registry untuk env var yang sama. Kaidah lama tetap:
lebih dari satu provider terdeteksi → Dalang MENOLAK memilih. Konsekuensinya satu
perubahan perilaku yang disengaja: pengguna yang memasang `ANTHROPIC_API_KEY`
DAN `GROQ_API_KEY` dulu mendapat Anthropic diam-diam (Groq tak dikenal), kini
mendapat penolakan yang menyebut keduanya dan satu baris `DALANG_MODEL` untuk
memutuskan. Itu penerapan kaidah netral-vendor yang konsisten, bukan kemunduran —
tetapi pengguna multi-kunci akan melihatnya.

### 4. Dua jalur tanpa kunci cloud masuk sebagai warga kelas satu

- **`ollama/<model>`** — Ollama TIDAK ada di models.dev (yang ada `ollama-cloud`),
  padahal ia jalur utama tanpa cloud dan tanpa kunci. Dikenal sebagai provider
  bawaan-lokal; `OLLAMA_HOST` memakai konvensi klien Ollama (`host:port`,
  `0.0.0.0` dinormalkan jadi `127.0.0.1`, `/v1` ditambahkan).
- **`GEMINI_API_KEY`** diterima sebagai nama lain kunci Google (itu nama yang
  dipakai Gemini CLI, jadi kunci yang sudah ada langsung terpakai). `GOOGLE_API_KEY`
  hanya bila `google/…` dipilih eksplisit: nama itu dipakai layanan Google lain.

### 5. Batas keluaran dikirim eksplisit untuk endpoint bergaya Anthropic

`ResolvedModel.maxOutputTokens` = batas registry atau 16.384, mana yang lebih
kecil, dikirim hanya untuk rute Anthropic non-bawaan; loop agent meneruskannya.
Model bawaan dikenal SDK-nya sendiri dan tidak disentuh.

### 6. Yang terlihat pengguna

- `dalang models` — ringkasan: sumber registry, kunci mana yang terpasang, apa yang
  setengah terpasang, server lokal, dan model default yang akan dipilih (atau
  mengapa tidak bisa). `dalang models cari <kata>` (harga, konteks, alat, gambar,
  `--siap`, `--urut`), `dalang models provider` (status tiap provider). Membaca
  registry saja: gratis, tanpa memanggil model.
- `dalang doctor/setup` memakai `chatReadiness` — jawaban yang SAMA dengan yang
  akan ditemui chat sungguhan — sehingga provider registry di luar katalog
  statis tidak dilaporkan "mati" padahal chat-nya hidup. Katalog konfigurasi
  menambah `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_HOST`.

## Bukti

**Data nyata, bukan fixture rekaan.** Seluruh klasifikasi dijalankan atas
`api.json` lengkap hasil unduhan (226 provider): angka di atas keluar dari situ.
Tes memakai cuplikan jujur dari entri yang sama (22 provider, 52 model, entri
provider tak diubah) termasuk kasus pelik: URL ber-template, env ganda, loopback,
SDK sendiri tanpa `api`, id model berslash.

**Rute sampai ke kabel.** Tes menjalankan `resolveModel` lalu `generateText` ke
server HTTP lokal dan memeriksa permintaannya: path `/v1/chat/completions`,
`Authorization: Bearer …` dari env var yang disebut registry, id model berslash
(`vendor/model-x`) utuh; jalur Anthropic: `/v1/messages` + `x-api-key` +
`max_tokens: 16384`; Ollama: tanpa header Authorization sama sekali. Temuan batas
4096 token datang dari tes ini.

**Yang TIDAK terbukti, dan dinyatakan:** tidak satu pun panggilan ke provider
sungguhan dilakukan — butuh kunci berbayar yang tidak tersedia di sini.
Kompatibilitas tool-calling di tiap endpoint (kualitasnya berbeda
antar-vendor) tidak diuji. Rute `@ai-sdk/openai` dengan `api` kustom memakai
Responses API (mengikuti paket yang dipilih registry); endpoint yang hanya
menyediakan chat completions akan gagal di sana.

## Yang tidak dilakukan

- **Registry kedua** (daftar model OpenRouter, berkas harga LiteLLM). models.dev
  sudah mengagregasi OpenRouter dan ratusan lainnya; dua sumber berarti dua
  jawaban untuk pertanyaan yang sama dan satu aturan penengah yang harus dijaga.
- **SDK khusus Bedrock, Vertex, Azure.** Masing-masing menyeret dependensi dan
  autentikasi sendiri (IAM, service account); itu pekerjaan tersendiri dengan
  kebutuhan ujinya sendiri. Sampai ada, mereka ditolak dengan alasan yang jelas.
- **Panel Pengaturan di Studio** belum mengenali provider registry di luar
  katalog; `doctor` dan `setup` sudah.
