# ADR-0030: Publikasi langsung ke YouTube lewat port PublishTarget

Status: diterima · Fase 10.3 (roadmap §10.3)

## Konteks

Jalan dari maksud ke video jadi berhenti di berkas MP4 di folder proyek.
Langkah terakhir — mengunggahnya ke tempat penonton ada — dikerjakan orang
di luar Dalang: buka browser, seret berkas, ketik judul dan deskripsi yang
sebenarnya sudah ada di plan. Roadmap §10.3 menyebut YouTube, TikTok, dan
Instagram; ADR ini mengerjakan YouTube dan meletakkan pintunya untuk yang
lain.

Yang berbeda dari tahap lain: unggahan adalah efek yang **tidak bisa
diurungkan**. Render yang salah tinggal dihapus; video yang sudah publik
sudah ditonton. Keputusan di bawah mengejar dua hal: tidak pernah mengunggah
tanpa persetujuan orang, dan tidak pernah mengunggah dua kali tanpa sengaja.

## Keputusan

### 1. Port `PublishTarget`, provider YouTube

`PublishTarget { id, label, publish(request) }` di paket pipeline, seperti
`StockProvider` dan `AsrProvider`: tes memberi tujuan palsu, platform baru
masuk lewat pintu yang sama. Provider pertama: YouTube Data API v3, unggahan
**resumable** — POST memulai sesi (Location), PUT per potongan 8 MiB dengan
`Content-Range`, 308 + `Range` untuk melanjutkan, JSON video di akhir.
Berkas dibaca per potongan, tidak dimuat utuh. Galat 401 dan 403 dijelaskan
dengan kalimat (token ditolak; kuota/kanal), bukan angka saja.

### 2. Otentikasi: token milik user, tanpa alur OAuth di Dalang

`YOUTUBE_ACCESS_TOKEN` di `.env` — token akses OAuth 2.0 dengan cakupan
`youtube.upload` yang user dapatkan sendiri (OAuth Playground, atau aplikasi
OAuth miliknya). Dalang TIDAK menjalankan alur OAuth dan tidak menyegarkan
token: alur itu butuh client ID/secret milik sebuah aplikasi Google yang
terdaftar, dan menanamkannya di alat sumber terbuka berarti membagikan
rahasia yang bukan rahasia. Token kedaluwarsa dilaporkan apa adanya.

### 3. Ledger: berkas yang sama tidak diunggah dua kali

`publishRender` memakai ledger `pipeline.db` (tahap `publish`) dengan kunci
path render dan hash `{ukuran, mtime, tujuan}`: mengulang perintah yang sama
mengembalikan tautan yang sudah ada, bukan video kedua di kanal orang.
`--force` mengunggah ulang dengan sengaja. Berkas yang berubah isinya
diunggah sebagai video baru, karena memang video baru.

### 4. Persetujuan dan bawaan privat

Bawaan `privacy` adalah **private**: langkah pertama ke publik harus
keputusan orang. Studio memakai gerbang 428 yang sama dengan render final
(dialog judul/deskripsi/privasi adalah konfirmasinya); CLI bertanya kecuali
`--yes`; tool agent `publishVideo` SELALU meminta persetujuan lewat
guardrails, dan system prompt melarangnya mengunggah tanpa diminta.
Metadata bawaan diturunkan murni dari plan (`defaultPublishMetadata`): judul
proyek, deskripsi dari narasi yang benar-benar dibacakan, tag dari format —
semuanya bisa ditimpa sebelum unggah.

## Verifikasi

- 3 tes provider dengan fetch palsu: sesi → potongan dengan `Content-Range`
  yang persis (3 potongan untuk 2×256 KiB + 1000 byte) → lanjut dari `Range`
  308 → tautan `youtu.be/<id>`; 401 dijelaskan, sesi tanpa Location ditolak,
  ukuran potongan bukan kelipatan 256 KiB ditolak; registry tanpa/dengan token.
- 2 tes tahap pipeline: unggah sekali, jalan kedua dari ledger, `--force`
  mengunggah lagi; berkas yang berubah diunggah lagi; kegagalan tercatat
  `error` dan berkas yang tidak ada dilaporkan.
- 2 tes core untuk metadata bawaan (privat, narasi, tag, pemangkasan judul).
- 4 tes server Studio dengan tujuan palsu: tanpa tujuan, daftar kosong
  berpetunjuk dan unggah ditolak 400; gerbang 428 lalu 202 + event
  `started`/`progress`/`done` bertautan dengan metadata bawaan dari plan,
  jalan kedua `cached` tanpa panggilan ke tujuan, `force` mengunggah lagi
  dengan judul/privasi baru dan riwayat render menunjukkan tautan barunya;
  path keluar folder render 400, berkas tak ada 404, tujuan tak dikenal 400;
  satu unggahan pada satu waktu (409), pembatalan jadi event `error`
  "dibatalkan" tanpa tautan, kegagalan tujuan jadi event `error`.
- 4 tes agent: tanpa tujuan menjawab petunjuk token tanpa meminta
  persetujuan; tanpa berkas render menyuruh render dulu; persetujuan ditolak
  = tidak diunggah, disetujui = render terbaru (mtime) naik dengan metadata
  plan, jalan kedua dari ledger tanpa panggilan baru, `file` memilih berkas
  lain; system prompt memuat larangannya.
- Gerbang interaksi (browser sungguhan, tanpa token): tombol Unggah di
  riwayat render ada, nonaktif, dan judulnya menyebut token yang kurang.
- Gerbang tata letak (tujuan palsu di stub, berkas render disemai): dialog
  Unggah dibuka dan diukur di 18 lebar layar — tidak boleh keluar layar, dan
  tombolnya WAJIB ada.
- Gerbang interaksi, alur penuh dengan tujuan palsu di proses yang sama:
  tombol Unggah aktif, dialog terbuka dengan judul proyek terisi dari plan,
  klik Unggah, event `publish` lewat SSE, dan tautan terbit muncul di
  riwayat render — tujuan menerima tepat satu unggahan.

## Batas

- **Belum pernah dijalankan terhadap YouTube sungguhan.** Sama seperti jalur
  API ASR (ADR-0021): protokolnya diuji terhadap fetch palsu yang mengikuti
  dokumentasi Google, bukan terhadap layanan hidup. Yang pertama kali
  menjalankannya dengan token asli akan menemukan selisihnya, dan galatnya
  dirancang untuk terbaca.
- **Hanya YouTube.** TikTok dan Instagram butuh peninjauan aplikasi dan
  alur OAuth yang tidak bisa diselesaikan dari alat CLI; pintunya (port)
  sudah ada.
- **Token akses saja, tanpa refresh.** Unggahan yang lebih lama dari umur
  token akan gagal di tengah dan harus diulang (ledger tidak mencatat yang
  gagal sebagai selesai).
- **Tanpa thumbnail, playlist, atau jadwal tayang.** Judul, deskripsi, tag,
  bahasa, dan privasi saja.

## Konsekuensi

- Pipeline bertambah port `PublishTarget`, tahap `publish` di ledger, dan
  metadata murni di core; providers bertambah `publish/youtube.ts` dan
  `buildPublishTargets`; CLI bertambah `dalang publish`; Studio bertambah
  rute `/api/publish*`, event `publish`, dan tombol unggah di riwayat render;
  agent bertambah tool `publishVideo` dengan gerbang persetujuan.
- Ditemukan sekalian: daftar nama event `EventSource` di klien Studio tidak
  memuat `proxy-progress`, sehingga kemajuan proxy (ADR-0028 §10) tidak
  pernah sampai ke browser walau server menyiarkannya. Diperbaiki bersama
  ini, dan `publish` didaftarkan lewat jalur yang sama.
