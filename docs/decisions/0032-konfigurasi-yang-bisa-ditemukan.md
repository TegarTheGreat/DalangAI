# ADR-0032: Konfigurasi yang bisa ditemukan tanpa membaca kode

Status: diterima · pengalaman pemakai baru

## Konteks

Audit 2 September 2026 menghitung variabel lingkungan yang DIBACA kode
terhadap yang DIJELASKAN ke pengguna:

| | Jumlah |
| --- | --- |
| Dibaca kode | 32 |
| Ada di `.env.example` | 20 |
| Tidak disebut di berkas mana pun | 9 |

Sembilan yang hilang itu bukan detail kecil. Mereka mengunci tiga kemampuan
utuh: transkripsi rekaman lewat whisper.cpp dan Deepgram, stiker GIPHY dan
Tenor, serta efek suara Openverse. Semuanya sudah selesai dikerjakan, diuji,
dan tidak bisa ditemukan siapa pun kecuali dengan membaca kode sumber.

`dalang providers:check`, satu-satunya alat yang seharusnya menjawab
"kunciku sudah benar belum", justru melewatkan yang paling mahal: TTS
ElevenLabs, seluruh jalur ASR, dan token YouTube.

Menambal daftarnya sekali tidak menyelesaikan apa pun. `.env.example` yang
ditulis tangan akan basi lagi pada fitur berikutnya, persis seperti yang
sudah terjadi tiga kali.

## Keputusan

### 1. Satu katalog jadi sumber, empat permukaan membacanya

`config-catalog.ts` di paket providers memuat setiap variabel: nama, label
bahasa Indonesia, jenis nilainya, kemampuan yang dibukanya, wajib atau
penghalus, satu kalimat efeknya, dan langkah mendapatkannya untuk orang yang
belum pernah. Ia murni: data dan fungsi tanpa efek, tanpa berkas, tanpa
jaringan.

Kemampuan dikelompokkan dengan bahasa TUJUAN, bukan bahasa teknologi.
"Bikin video lewat percakapan", bukan "LLM provider". "Ubah rekaman jadi
teks berwaktu", bukan "ASR". Tiap kemampuan menyatakan apa yang TETAP bisa
dilakukan tanpanya, karena orang berhak tahu bahwa melewatkan satu langkah
tidak membuat programnya lumpuh.

### 2. `.env.example` dibangkitkan, dan tes menolak yang basi

Berkas itu kini keluaran `pnpm env:gen`. Dua tes menjaganya:

- satu memindai SELURUH kode sumber untuk pola `process.env.X` dan `env.X`,
  lalu gagal bila ada kunci yang tidak dijelaskan katalog. Daftar pengecualian
  sengaja pendek dan tiap entrinya menyertakan alasan, karena setiap tambahan
  adalah hal yang kami putuskan untuk tidak jelaskan;
- satu lagi membandingkan berkas di repo dengan hasil bangkitan, jadi katalog
  yang berubah tanpa `pnpm env:gen` menggagalkan CI.

Semua baris di berkas itu dikomentari. Ia katalog untuk dibaca, bukan
konfigurasi untuk dipakai apa adanya; menyalinnya dengan variabel kosong yang
aktif hanya menimbulkan tebakan soal mana yang sudah diisi.

### 3. Bahasa "aturan", bukan daftar tuntutan

Tiap kemampuan menyatakan cara ia hidup: `salah-satu` (Pexels ATAU Pixabay
cukup) atau `semua` (render cloud butuh empat-empatnya). Tanpa ini, pemakai
baru melihat enam kotak kosong dan mengira harus mengisi semuanya.

Ada juga `readyWithoutConfig` untuk yang memang sudah bekerja hari ini tanpa
apa pun: Edge TTS dan Openverse. Ini sengaja dibedakan dari "bisa jalan
offline" — transkripsi lokal memang tidak mengirim apa pun keluar, tetapi ia
baru hidup setelah whisper.cpp terpasang, jadi `alsoActiveWhen` yang
menjelaskannya dan yang mendeteksi adalah pemanggilnya, bukan katalog.

### 4. Wizard yang memindai dulu, baru bertanya

`dalang setup` mulai dengan APA YANG SUDAH ADA: kunci yang terpasang di
lingkungan, whisper.cpp di PATH, Chromium untuk render, dan `.env` yang
mungkin sudah ada. Yang bisa ditemukan sendiri tidak ditanyakan. Lalu ia
menampilkan kemampuan yang SUDAH bisa dipakai sebelum menampilkan yang belum,
karena orang baru perlu tahu bahwa programnya sudah berguna hari ini.

Tiga hal yang dijaga saat menulis:

- **Kunci diuji sebelum disimpan.** Kunci salah ketik terlihat persis seperti
  kunci benar; tanpa pengujian, kesalahannya baru ketahuan di tengah
  `generate` yang sudah berjalan lima menit, lewat pesan galat milik provider.
- **`.env` milik orang tidak pernah ditulis ulang.** Komentar, urutan, dan
  variabel yang bukan urusan Dalang tetap di tempatnya; kunci yang sudah ada
  diganti di barisnya sendiri.
- **Isi kunci tidak pernah dicetak.** Yang tampil hanya empat karakter
  terakhir, cukup untuk mengenali kunci mana yang terpasang.

`dalang doctor` adalah versi yang tidak bertanya: laporan keadaan, dan dengan
`--uji` ia menghubungi tiap layanan. Ia juga menutup celah yang ditemukan
audit — `providers:check` hanya memeriksa penyedia aset, sehingga TTS, ASR,
dan token YouTube tidak pernah teruji. Kini keduanya saling menunjuk.

## Verifikasi

- 8 tes katalog: pemindaian kode sumber, kesamaan `.env.example` dengan
  bangkitannya, keunikan kunci, aturan salah-satu dan semua, nilai kosong
  atau spasi tidak dianggap terisi, kemampuan siap-tanpa-konfigurasi
  dilaporkan aktif sejak awal sementara transkripsi tidak, deteksi di luar
  env ikut menghidupkan, dan penyamaran rahasia menyisakan empat karakter.
- Tes pemindainya menemukan empat kunci lagi yang bahkan tidak terlihat oleh
  audit manual: `PLAYWRIGHT_BROWSERS_PATH` dan tiga lainnya. Yang milik
  Dalang masuk katalog; yang milik alat lain masuk daftar pengecualian
  beserta alasannya.
- 10 tes untuk dua penopang wizard: penulis `.env` (mengganti di tempatnya,
  menghidupkan baris yang dikomentari, mengutip nilai bertanda baca,
  mengosongkan berarti mengomentari bukan menyisakan `KEY=`, berkas kosong
  tetap sah) dan penguji kunci (skema otentikasi per layanan, 401 dan 403
  berarti ditolak sementara 429 berarti diterima, token YouTube yang gagal
  menyebut kedaluwarsa, setelan path diuji lewat keberadaan berkasnya, yang
  tidak bisa diuji dikatakan apa adanya, dan layanan yang diam dilaporkan
  sebagai gangguan jaringan, bukan kunci salah).
- `dalang doctor` dijalankan pada folder tanpa konfigurasi: laporannya
  menemukan dua kesalahan penulisan saya sendiri, yaitu aturan "semua"
  dicetak sebagai "atau", dan jalur whisper.cpp yang gratis tidak muncul di
  kalimat "yang dibutuhkan". Keduanya dibetulkan dengan membawa `rule` dan
  `alsoActiveWhen` ke dalam status.
- `dalang setup` dijalankan sungguhan lewat masukan terskrip: ia memilih
  kemampuan, memandu, menyimpan `DEEPGRAM_API_KEY` ke `.env` di bawah judul
  bertanggal, dan keluar dengan kode 0 tanpa pernah mencetak kuncinya. Uji
  pertamanya MENGGANTUNG saat masukan habis, dan itu dibetulkan: setiap
  pertanyaan kini memakai sinyal batal yang menyala saat masukan tertutup,
  sehingga Ctrl+D menyimpan yang sudah terkumpul lalu berhenti.

## Batas

- **Katalog tidak memvalidasi nilai.** Ia tahu sebuah kunci ada dan untuk
  apa, bukan apakah isinya benar. Yang menguji ke layanan sungguhan adalah
  `dalang setup` dan `dalang doctor`.
- **Bahasa Indonesia saja.** Tidak ada lapisan terjemahan, sejalan dengan
  seluruh antarmuka Dalang.
- **Kredensial AWS ikut dicatat walau bukan kami yang membacanya.** SDK AWS
  yang membacanya, tetapi orang yang menyiapkan render cloud tetap perlu
  tahu, jadi ia ada di katalog dengan keterangan itu.

## Konsekuensi

- `.env.example` bertambah dari 20 jadi 33 setelan yang dijelaskan, lengkap
  dengan langkah mendapatkannya.
- Menambah provider baru sekarang berarti menambah entri katalog, kalau tidak
  tesnya merah. Itu memang maksudnya.
