# ADR-0018 — Pustaka media: GIF, stiker, ikon, efek suara

**Status:** Diterima · **Tanggal:** 2026-08-30

## Konteks

Owner meminta integrasi dengan lima layanan: **MyInstants, yarn.co, GIPHY,
Tenor, dan icon-icons**.

Sebelum menulis kode, kelimanya diperiksa: apakah punya API resmi, apa isi
syarat pakainya, dan siapa pemilik hak atas kontennya. Hasilnya membelah
permintaan itu jadi dua bagian yang sangat berbeda.

### Tiga tidak bisa diintegrasikan

Bukan karena sulit secara teknis. Ketiganya **tidak punya API resmi**, dan
ketiganya **melarang tertulis persis apa yang dibutuhkan integrasi otomatis**.

| Layanan | API resmi | Yang menghalangi |
| --- | --- | --- |
| MyInstants | tidak ada | Syarat pakai membatasi ke penggunaan pribadi non-komersial. Semua paket npm yang beredar adalah scraper HTML — README salah satunya menyatakan sendiri isinya "obtained ... by web scraping". Kontennya klip game/film/musik milik pihak lain; MyInstants menjalankan kebijakan DMCA, yang berarti ia memposisikan diri sebagai host, bukan pemilik, sehingga tidak bisa melisensikan apa pun kepada kita. |
| yarn.co / getyarn.io | tidak ada | Paling tegas dari ketiganya. ToS melarang eksplisit *"use manual or automated software ... to 'crawl' or 'spider' any page of the Site, harvest or scrape any Content"*, dan melarang eksplisit penggunaan komersial. Isinya klip film dan serial TV berhak cipta penuh; operatornya mengindeks, tidak memiliki. |
| icon-icons.com | tidak ada | ToS: *"will not access the Services through automated or non-human means, whether through a bot, script or otherwise."* Lisensi gratisnya melarang memasukkan ikon ke database aplikasi dan menyajikannya untuk diunduh — persis yang dilakukan sebuah asset library. |

Memaksakannya bukan berarti mengirim fitur; itu berarti mengirim mesin
penghasil copyright strike, di atas kode yang patah setiap kali situs-situs
itu mengubah HTML-nya.

Catatan metode yang jujur: proxy lingkungan kerja memblokir ketiga domain itu,
sehingga teks ToS tidak bisa dibaca verbatim dari halaman aslinya —
kesimpulannya bersandar pada ringkasan mesin pencari atas halaman legal
tersebut. Yang **tidak** bergantung pada itu adalah ketiadaan API-nya: itu
terkonfirmasi dari registry npm, pencarian repo GitHub, dan absennya halaman
developer.

### Dua bisa, tetapi dengan syarat yang harus dinyatakan

GIPHY dan Tenor punya API resmi dan terdokumentasi. Tetapi ada perbedaan yang
mudah tertukar dan mahal kalau salah:

> Punya API resmi berarti kita boleh **mencari dan menampilkan** lewat jalur
> mereka. Itu **bukan** hak untuk membakar isinya ke video ekspor.

Isi keduanya tetap unggahan pihak ketiga yang hak ciptanya milik pengunggah,
dan sangat sering memuat potongan film, serial, atau musik.

## Keputusan

### 1. GIPHY & Tenor masuk, dengan lisensi yang ditulis apa adanya

Keduanya menempati port `StockProvider` yang sudah ada, sehingga seluruh jalur
pencarian dan pemasangan aset (agent, Studio, pipeline) langsung memakainya
tanpa jalur baru.

Kontraknya diambil dari sumber otoritatif, bukan ingatan:

- **GIPHY** — bentuk respons disalin dari paket tipe terbitan GIPHY sendiri
  (`@giphy/js-types`: `IGif` + `IImages`), dan pembentukan URL dari SDK resmi
  `@giphy/js-fetch-api` (base `https://api.giphy.com/v1/`, jalur
  `gifs/search` dan `stickers/search`). Dimensi diperlakukan sebagai string
  karena begitu bentuk JSON aslinya.
- **Tenor** — endpoint v2 diverifikasi langsung ke host: `/search`,
  `/featured`, dan `/categories` menjawab 400 "API key not valid", artinya
  jalurnya ada dan kunci diperiksa lebih dulu.

**Pemilihan rendition.** MP4 dipilih untuk GIF biasa: jauh lebih kecil, dan
jalur render video sudah menanganinya. Stiker TIDAK boleh MP4 — MP4 tidak
punya kanal alfa, sehingga latar tembus pandang yang justru jadi gunanya akan
hilang. Stiker memakai WebP/GIF.

**Penjagaan hak pakai, tiga lapis:**

1. Lisensi aset ditulis apa adanya dan memuat penanda `PERIKSA HAK PAKAI`.
2. Kritik sutradara baru `aset-hak-pakai` (level perhatian) menegur bila aset
   bertanda itu terpakai. Pemeriksanya membaca lisensi yang tercatat, bukan
   nama provider — jadi provider baru dengan masalah serupa ikut tertangkap
   tanpa mengubah kode kritik.
3. Urutan rantai stock menaruh Pexels/Pixabay (lisensi jelas untuk komersial)
   SELALU di depan GIPHY/Tenor, dikunci oleh test.

Peringkat konten disetel aman untuk semua umur secara bawaan (GIPHY
`rating=g`, Tenor `contentfilter=high`).

### 2. Ikon: Iconify menggantikan icon-icons

API publik **tanpa kunci**, 237 set ikon. Jebakannya: lisensi melekat PER SET
dan tidak semua set bebas — ada set NonCommercial di dalamnya.

`judgeIconLicense` memakai **daftar putih SPDX, bukan daftar hitam**: lisensi
yang belum dikenal diperlakukan TIDAK aman sampai ditinjau. Apa pun yang
mengandung `-NC-` ditolak lebih dulu, bahkan seandainya kebetulan ada di
daftar putih. Set NonCommercial dibuang dari hasil pencarian secara bawaan,
supaya "gampang dipakai" tidak pernah berarti "diam-diam melanggar". Set yang
mewajibkan kredit (CC-BY, OFL, Apache-2.0) ditandai `needsAttribution`.

### 3. Efek suara: Openverse menggantikan MyInstants

Openverse (WordPress Foundation), API resmi, token opsional yang hanya
menaikkan batas laju.

Dipilih **di atas Freesound**, dan alasannya layak dicatat karena mudah
tertukar: lisensi SUARA di Freesound boleh saja CC0, tetapi syarat pemakaian
API-nya sendiri gratis hanya untuk keperluan NON-KOMERSIAL. Dua lapis lisensi
yang berbeda. Openverse tidak punya batasan itu, dan malah menyediakan string
kredit siap tempel.

Bawaannya `cc0,pdm`, dengan sabuk pengaman kedua di sisi kita yang membuang
hasil ber-`nc` seandainya lolos dari saringan permintaan.

### 4. Skema: grafis tempelan dan cue bunyi

- **`scene.graphics[]`** (maks 4). Posisi memakai **jangkar + geseran
  fraksional**, bukan koordinat piksel: satu nilai yang sama tetap benar di
  16:9, 9:16, dan 1:1 tanpa ditata ulang tiap ganti rasio.
- **`audio.sfx[]`** (maks 24). Cue ditambatkan ke **scene**, bukan garis waktu
  mutlak. Menggeser atau memanjangkan scene membuat bunyinya ikut pindah tanpa
  satu angka pun disunting; cue yang scene-nya dihapus jadi yatim dan dilewati
  diam-diam, bukan menggagalkan render.
- **`renderState.graphicAssets` / `.sfxAssets`** — lumbung berkas terpisah,
  dikunci per grafis/cue (bukan per scene seperti `resolvedAssets`), supaya
  satu scene bisa punya beberapa tempelan.

`graphic.ref` adalah **permintaan** (`"iconify:mdi:home"`), bukan berkas.
Berkas nyatanya hidup di `renderState`, diisi tahap resolve. Karena itu render
tetap deterministik dan tidak melakukan satu pun pengambilan data saat
merender.

### 5. `dalang providers:check` — verifikasi yang bisa dijalankan sendiri

Fixture hanya membuktikan kode konsisten dengan ANGGAPAN kita soal bentuk
respons; ia tidak bisa membuktikan anggapan itu benar. Satu nama field yang
meleset akan lolos semua test dan baru gagal di mesin user.

Perintah ini memanggil layanan sungguhan dengan kunci milik user dan
melaporkan bidang mana yang benar-benar terbaca — `assetId`, `downloadUrl`,
`fileExt`, `width`, `height`, `license` — bukan sekadar "ada jawaban". Untuk
ikon dan efek suara ia menguji **penjaga lisensinya**: satu hasil
NonCommercial yang lolos dilaporkan sebagai kegagalan bertuliskan "ini bug,
jangan dipakai".

Ini penting karena proxy lingkungan pengembangan hanya mengizinkan
`tenor.googleapis.com`; GIPHY, Iconify, dan Openverse **tidak bisa diuji
hidup dari sana**. Perintah ini memindahkan verifikasi itu ke tempat yang
memang bisa melakukannya.

## Konsekuensi

- GIF, stiker, ikon, dan efek suara tersedia; ikon dan efek suara bahkan tanpa
  kunci API sama sekali.
- Setiap aset membawa lisensinya sendiri ke dalam plan, sehingga audit
  (PRD §10 / R-10) tidak pernah perlu menebak.
- Aset yang hak pakainya belum jelas tidak pernah lolos diam-diam.
- Menambah pustaka baru = satu provider yang mengisi port yang sudah ada.

## Bukti

**433 unit test hijau**; typecheck dan lint bersih. Yang diuji terutama bukan
jalur bahagianya, melainkan penjaganya: penolakan lisensi NonCommercial,
urutan rantai yang menjaga lisensi, batas ukuran grafis, cue yatim, dan enam
kasus path traversal.

**Gerbang visual** — still dirender dari proyek bergrafis dan diperiksa dengan
mata: dua ikon muncul di jangkar yang benar (kiri-atas dan kanan-bawah),
berukuran proporsional terhadap tinggi frame (0,12 dan 0,18), dan berwarna
benar (satu hijau sesuai `color` eksplisit, satu memakai warna aksen preset).

## Jebakan yang ditemukan (dicatat supaya tidak berulang)

1. **Berkas grafis tidak ikut disalin ke folder publik render.**
   `copyPlanAssets` hanya tahu `resolvedAssets` dan `narrationAudio`; dua
   lumbung baru terlewat, sehingga render gagal 404. **Semua test lolos** —
   karena tidak ada satu pun yang benar-benar merender.
2. **Ikon selalu keluar hitam.** SVG yang dimuat lewat `<img>` dirender di
   konteks dokumennya sendiri, sehingga `currentColor` di dalamnya TIDAK
   mewarisi `color` dari elemen induk. Test sempat memeriksa bahwa gaya
   warnanya terpasang — dan gaya itu memang terpasang, hanya tidak
   berpengaruh. Diperbaiki dengan mask CSS (bentuk SVG jadi stensil di atas
   bidang warna), khusus untuk ikon; stiker tetap gambar biasa karena mask
   akan menghapus warna aslinya.
3. **Pembersih nama meloloskan `.` dan `..` utuh sebagai segmen**, sehingga
   `assets/../x.svg` memindahkan berkas ke akar proyek. Batas PROYEK tetap
   dijaga `assertSafeRelative` — tidak pernah menembus ke luar proyek — tetapi
   lokasi berkas tidak boleh bisa dialihkan oleh nama dari layanan luar.
4. **Jebakan zod `.default(obj)`, kali ketiga** (lihat ADR-0013 dan ADR-0016).
   Kali ini TypeScript menangkapnya saat kompilasi karena field barunya wajib.
5. **Pesan "tidak ada provider aktif" yang menyesatkan** di `providers:check`:
   ikon/SFX ada dan hanya jaringannya yang gagal. Provider tidak
   terkonfigurasi dan provider tak terjangkau adalah dua hal berbeda.

## Alternatif yang ditolak

- **Scraping MyInstants / yarn.co / icon-icons.** Ditolak: melanggar syarat
  pakai yang tertulis, memindahkan risiko hak cipta ke pengguna, dan patah
  setiap kali situsnya berubah.
- **Freesound untuk efek suara.** Ditolak sebagai bawaan: syarat pemakaian
  API-nya non-komersial, terlepas dari lisensi suaranya.
- **Menandai GIF sebagai "bebas pakai" karena API-nya resmi.** Ditolak: itu
  mencampur izin mengakses dengan izin menyiarkan ulang.
- **Menyimpan SVG ikon sebagai teks di dalam plan.** Ditolak: plan adalah
  dokumen keputusan, bukan lumbung biner; berkas tetap di folder proyek
  seperti aset lain.
- **Mewarnai ikon dengan `color` + `currentColor`.** Ditolak setelah terbukti
  tidak bekerja pada SVG yang dimuat lewat `<img>` (lihat Jebakan 2).
