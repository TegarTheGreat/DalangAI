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

### 5. Panel Pengaturan: wizard yang sama, tanpa terminal

Orang yang membuka Studio dari ikon di desktop tidak pernah melihat `dalang
setup`. Panel Pengaturan di lobi memberi mereka isi yang persis sama —
kemampuan disebut dengan apa yang bisa dilakukan, yang sudah menyala tampil
lebih dulu, tiap kemampuan menyatakan apa yang tetap jalan tanpanya, dan tiap
kunci punya tombol Uji sendiri.

Ia duduk di LOBI, bukan di editor, karena setelan berlaku untuk seluruh mesin
dan orang mencarinya sebelum punya proyek.

Tiga hal yang dijaga rute-rutenya, dan masing-masing punya tesnya:

- **Isi kunci tidak pernah sampai ke peramban.** Untuk setelan berjenis
  rahasia, server hanya mengirim empat huruf terakhirnya. Yang BUKAN rahasia
  (path, URL, angka) dikirim apa adanya — justru itu yang perlu dilihat mata
  saat ada salah ketik. Rute uji kunci tidak pernah mengembalikan nilai yang
  dikirim kepadanya, supaya jawabannya tidak jadi cara membaca ulang kunci
  lewat riwayat jaringan peramban.
- **Hanya kunci katalog yang boleh ditulis.** Tanpa ini, satu permintaan bisa
  menitipkan `NODE_OPTIONS` atau `PATH` ke `.env`, yaitu menjalankan kode di
  mesin orang lewat kotak teks di halaman web. Kunci asing menolak SELURUH
  permintaan, bukan dilewati diam-diam: keadaan setengah tertulis lebih
  membingungkan daripada penolakan yang menyebut kuncinya.
- **Nilai tidak boleh memuat baris baru.** Satu baris baru cukup untuk
  menyelundupkan variabel kedua yang tidak pernah dilihat siapa pun.

Yang tersimpan berlaku SEKETIKA untuk sebagian besar setelan, karena rantai
penyedia dibangun ulang tiap kali dipakai. Yang tidak begitu disebutkan apa
adanya: model orkestrator dipilih sekali sebelum server berdiri, jadi kunci
model dilaporkan "baru berlaku setelah Studio dijalankan ulang" alih-alih
diam-diam tidak bekerja.

Panel juga membedakan nilai yang datang dari `.env` dan yang di-export di
terminal. `process.loadEnvFile` tidak menimpa yang sudah ada di lingkungan,
jadi menyimpan kunci lain lewat panel akan berlaku sekarang lalu seolah-olah
hilang setelah start ulang. Itu jenis kebingungan yang memakan waktu berjam-jam
kalau tidak dikatakan.

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
- 14 tes rute panel Pengaturan: penyamaran rahasia diperiksa terhadap SELURUH
  jawaban, bukan cuma medan yang kebetulan diingat; nilai bukan rahasia tampil
  apa adanya; asal nilai dibedakan antara berkas dan terminal; menyimpan tidak
  merusak isi `.env` orang dan langsung berlaku di proses; mengosongkan
  mematikan setelan di berkas dan di proses; kunci model dilaporkan butuh start
  ulang; `NODE_OPTIONS` ditolak beserta seluruh permintaannya; nilai berisi
  baris baru ditolak; dan rute uji tidak pernah menyebut kembali nilai yang
  dikirim.
- Gerbang interaksi menjalankan jalur orang yang tidak memakai terminal di
  peramban sungguhan: buka lobi, klik kolom, ketik kunci lewat CDP, tekan Uji,
  tekan Simpan. Yang diperiksa setelah itu adalah BERKAS `.env` di disk, bukan
  layar — panel yang menghijaukan layar tanpa menulis apa pun adalah cacat yang
  mahal — lalu bahwa kunci utuh tidak pernah muncul kembali di halaman dan
  kemampuannya pindah ke daftar yang sudah menyala.
- Gerbang tata letak kini mengukur dialog Pengaturan di 18 lebar layar, pada
  mesin TANPA kunci apa pun: semua kemampuan belum menyala, jadi tiap kartu
  terbuka dan dialognya ada di keadaan paling tinggi yang mungkin.
- Pemindai katalog sempat merah karena tes panel ini menyebut `NODE_OPTIONS`
  untuk membuktikan bahwa ia ditolak. Yang dijaga pemindai adalah kode PROGRAM
  yang membaca konfigurasi tanpa menjelaskannya, jadi berkas tes kini dilewati
  seluruhnya — bukan `NODE_OPTIONS` yang didaftarkan sebagai pengecualian.

## Batas

- **Panel tidak bisa menjalankan ulang Studio sendiri.** Kunci model yang baru
  disimpan dilaporkan butuh start ulang, dan orangnya yang melakukannya. Server
  yang mematikan dirinya sendiri atas permintaan halaman web adalah kemampuan
  yang tidak ingin kami berikan.
- **Katalog tidak memvalidasi nilai.** Ia tahu sebuah kunci ada dan untuk
  apa, bukan apakah isinya benar. Yang menguji ke layanan sungguhan adalah
  `dalang setup`, `dalang doctor`, dan tombol Uji di panel Pengaturan.
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
- Konfigurasi kini punya empat permukaan yang membaca satu katalog yang sama,
  seperti yang dijanjikan bagian 1: `.env.example`, `dalang setup`, `dalang
  doctor`, dan panel Pengaturan. Menambah entri katalog memunculkannya di
  keempatnya sekaligus, tanpa menyentuh satu pun dari mereka.
