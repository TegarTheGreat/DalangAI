# ADR-0024 — Manipulasi langsung di kanvas

**Status:** diterima · **Tanggal:** 31 Agustus 2026 · **Fase:** 9 (§9.1)

## Konteks

Sampai fase kedelapan, memindahkan teks atau grafis di Dalang harus lewat form
di panel Properti: pilih posisi dari tiga pilihan, ketik angka geseran, lihat
hasilnya, ketik lagi. Riset roadmap menyebut ini **celah paling kentara
dibanding editor mana pun** dan menempatkannya di daftar tiga hal terpenting
yang bisa dikerjakan — dengan catatan bahwa §9.1 memberi rasa paling besar per
biaya.

Alasannya sederhana: tidak ada editor video yang menyuruh orang mengetik
koordinat. Menyeret adalah cara manusia memindahkan barang.

## Keputusan

### 1. Teks mendapat `offsetX`/`offsetY`, bentuknya SAMA dengan grafis

Sebelum ini, letak teks hanya bisa dinyatakan sebagai `position` (tiga nilai:
atas, tengah, bawah). Itu cukup untuk agent yang menyusun draft, tapi tidak
cukup untuk tangan yang menata.

Skema teks kini punya geseran fraksional, persis seperti grafis sejak
ADR-0018. Bukan koordinat mutlak, dan itu keputusan yang sama: satu nilai yang
sama harus tetap benar di 16:9, 9:16, dan 1:1 — kalau memakai piksel, tiap
ganti rasio semua tempelan harus ditata ulang.

Bawaannya nol, dan nol berarti "di tempat yang dipilih preset". Semua plan lama
ter-render persis seperti sebelumnya.

### 2. Kotak pegangan dibaca dari DOM, bukan dihitung ulang

Preset menata teks dengan flex, margin aman per rasio, pengelompokan per
posisi, dan animasi masuk per kata. Menirukan semua itu di sisi Studio berarti
dua rumus tata letak yang harus tetap sama selamanya — dan yang pertama kali
menyimpang tidak akan ketahuan sampai seseorang melihat pegangan meleset dari
teksnya.

Jadi preset menandai elemennya (`data-dalang-text`, `data-dalang-graphic`) dan
lapisan kanvas membaca `getBoundingClientRect()` dari DOM yang SUDAH
ter-render. Pegangan selalu pas — di preset mana pun, termasuk preset yang
belum ditulis. Di video hasil render atribut itu tidak berpengaruh apa-apa.

### 3. Jangkar DIPILIH ULANG saat dilepas

Titik jatuh diubah jadi jangkar terdekat + sisa geseran, bukan jadi geseran
dari jangkar lama. Kalau jangkarnya dipertahankan, menyeret tempelan dari
kanan-bawah ke kiri-atas butuh geseran hampir -1 sementara skema membatasinya
di ±0,5 — tempelannya akan berhenti di tengah jalan tanpa alasan yang bisa
dilihat pengguna.

Jangkar tepi memakai **margin aman**, bukan tepi layar: menyeret sesuatu "ke
pinggir" mendaratkannya di kolom aman yang sama dengan tempat preset menaruh
teks, bukan menempel di tepi bingkai.

**Amandemen (bersama §7).** Menghitung ulang offset dari jangkar pada
SETIAP pelepasan ternyata salah untuk elemen yang tidak ditaruh preset tepat
di jangkar + offset: teks bertumpuk dalam satu kelompok (yang kedua di bawah
yang pertama) dan blok yang diangkat sedikit. Gerbang interaksi yang menilai
kotak di LAYAR (bukan angka di plan) menangkapnya: seretan mendatar pertama
pada judul melompat 32 px ke bawah. Kini, selama posisi/jangkarnya tidak
berubah, offset digeser RELATIF sebesar selisih seretan — elemen bergerak
persis sejauh jari — dan dihitung ulang dari jangkar hanya saat pusatnya
menyeberang ke wilayah lain, tempat offset relatif akan menabrak batas ±0,5.
Kotak elemen dan bingkai anotasi juga dibaca SEGAR dari DOM saat menekan dan
melepas, bukan dari pengukuran mutasi terakhir: pemutar bisa menskalakan
ulang isinya di antara dua mutasi, dan angka yang menentukan patch harus
dibaca pada detik yang sama dengan jarinya.

### 4. Menyeret TIDAK mengubah `align`

Perataan adalah keputusan tipografi (rata kiri, tengah, kanan di dalam
kolomnya), bukan keputusan letak. Mengubahnya diam-diam saat orang menggeser
blok teks akan mengubah rupa paragrafnya tanpa diminta. Perataan tetap di
panel Properti; yang berubah saat diseret hanya posisi dan geseran.

### 5. Keluarannya PATCH OP biasa

Melepas seretan menghasilkan `updateScene` lewat jalur yang sama dengan semua
editan manual lain: tercatat di patch log, bisa di-undo dengan Ctrl+Z, dan
terlihat agent di konteksnya. Tidak ada jalan tembus ke plan.json.

Patch dikirim SEKALI, saat dilepas — bukan tiap gerakan pointer. Patch per
frame gerakan akan membanjiri log dan membuat undo berarti "mundur satu piksel".
Konsekuensinya videonya sendiri baru berpindah setelah dilepas, jadi kotak
pegangannya yang mengikuti kursor selama seretan: tanpa bayangan itu, menyeret
terasa seperti tidak terjadi apa-apa.

### 6. Aritmetikanya di `@dalang/core`, bukan di komponen

`placeGraphic`, `placeText`, `snapToLines` adalah fungsi murni di paket core.
Ini bagian yang paling mudah salah dan paling mahal kalau salah: satu tanda
minus yang keliru membuat tempelan melompat ke sisi berlawanan saat dilepas,
dan itu tidak terlihat dari kode — hanya dari tangan. Sebagai fungsi murni,
seluruh aturannya diuji sebagai angka.

### 7. Pemilihan jamak: satu seretan, satu patch

Shift+klik menambah (atau mengurangi) anggota seleksi; klik biasa pada
anggota mempertahankan seleksinya — itulah cara menyeret kelompok — dan klik
pada yang lain menggantinya. Menyeret salah satu anggota memindahkan
semuanya sejauh yang sama, dan keluarannya SATU `updateScene` yang memuat
semua elemen yang berubah: satu baris di log patch, satu undo untuk
mengembalikannya. Garis bantu dihitung dari anggota yang diseret terhadap
elemen di LUAR seleksi (anggota lain ikut bergerak, jadi tidak bisa jadi
rujukan). Anotasi selalu sendiri karena koordinatnya milik bingkai
screenshot; ubah ukuran selalu satu elemen. Panah TIDAK menggeser seleksi:
panah kiri/kanan milik transport, dan dua arti untuk satu tombol lebih buruk
daripada tidak ada.

## Bukti

**Diuji dengan menyeret sungguhan di peramban, bukan hanya dengan tes unit.**
Studio dijalankan dengan Chromium, kotak teks diseret dari tengah ke kiri-atas
lewat peristiwa pointer CDP, lalu `plan.json` di disk dibaca ulang:
`position` berubah dari `"center"` jadi `"top"` dengan `offsetX` 0,1023 dan
`offsetY` 0,0838 — angka yang cocok dengan titik jatuhnya. Tanpa uji ini,
"seretan menghasilkan patch" hanya klaim.

**Pengukuran kotak pertama menghasilkan NOL pegangan, dan itu ketahuan dari
peramban.** Versi pertama hanya mengukur ulang saat `frame` berubah. Saat
effect pertama berjalan, Player belum menggambar apa pun — dan karena preview
yang dijeda tidak pernah mengubah frame, tidak ada yang memicu pengukuran
kedua. Sekarang yang didengarkan adalah DOM-nya sendiri: `MutationObserver`
untuk Remotion mengganti scene, `ResizeObserver` untuk jendela berubah, dan
`requestAnimationFrame` supaya pengukuran terjadi setelah gambar.

**Perbandingan kotak diperlukan supaya tidak berputar tanpa henti.**
MutationObserver memicu setState, setState memicu render, render mengubah DOM,
DOM memicu MutationObserver. Kotak dibandingkan pada presisi piksel sebelum
setState — itu juga meredam getaran sub-piksel dari animasi.

**Gerbang JSON Schema menangkap perubahan skema, seperti seharusnya.**
Menambah `offsetX`/`offsetY` membuat tes artefak skema merah sampai
`pnpm schema:gen` dijalankan. Itu gerbang yang bekerja: skema §5.1 tidak boleh
berubah diam-diam.

**Gerbang interaksi di CI** (`gate:interaksi`) menyeret kotak anotasi dengan
pointer sungguhan lewat CDP dan memeriksa plan di server: geser +60/+40 px
menghasilkan `dx = 0,1215` / `dy = 0,1441` fraksi bingkai 494×278 px (harapan
0,1215 / 0,1441), ubah ukuran +30/+20 px menghasilkan `dw = 0,0607` /
`dh = 0,0721` (harapan 0,0607 / 0,0721). Gerbang ini GAGAL pada percobaan
pertamanya dan menemukan cacat yang tidak tertangkap unit test mana pun: klik
klip melompat ke `sceneStarts + 1`, yaitu AWAL transisi, dan pada frame itu
renderer (aturan titik-tengah transisi) masih menganggap scene sebelumnya yang
aktif — kanvas mengukur penanda scene yang diklik, `buildOps` mencari
anotasinya di scene lain, dan seretan menghilang tanpa patch dan tanpa pesan.
Dua pembetulan: klik klip (dan tombol scene sebelumnya/berikutnya) kini
melompat ke `sceneSettledFrame`, frame pertama scene tampil utuh; dan preset
menandai akar tiap scene dengan `data-dalang-scene`, sehingga kanvas hanya
mengukur penanda milik scene yang aktif walau dua scene terpasang sekaligus di
tengah transisi.

## Batas yang dinyatakan

- ~~**Yang bisa diseret baru teks dan grafis.**~~ *DICABUT untuk anotasi.*
  Preset tutorial-01 kini menandai setiap anotasi di DOM
  (`data-dalang-annotation` pada penanda di dalam bingkai
  `data-dalang-annotation-frame`), dan kanvas membaca penanda itu seperti
  membaca teks/grafis: `target` (persegi ternormalisasi) bisa digeser dan
  diubah ukurannya, sisi minimalnya 2% bingkai, tanpa snap — anotasi mengikuti
  isi tangkapan layar, bukan kisi kanvas. Penanda hanya dipasang saat bingkai
  tidak sedang di-zoom (skala 1): di tengah zoom, koordinat layar dan
  koordinat tangkapan layar tidak lagi sebangun, dan pegangan yang menipu
  lebih buruk daripada tidak ada. Caption tetap tidak bisa dan tidak akan
  bisa: letaknya milik preset.
- **Ubah ukuran hanya untuk grafis.** Ukuran teks adalah `s`/`m`/`l` (skala
  relatif terhadap peran tipografinya), bukan angka bebas — menyeret sudut
  untuk menghasilkan tiga nilai diskret akan terasa rusak, jadi ukuran teks
  tetap di panel Properti.
- **Video tidak ikut bergerak selama seretan**, hanya kotaknya. Itu
  konsekuensi langsung dari keputusan mengirim satu patch saat dilepas.
- ~~**Belum ada pemilihan jamak** (menyeret beberapa elemen sekaligus).~~
  *DICABUT (Keputusan 7):* Shift+klik menambah/mengurangi anggota seleksi,
  klik biasa pada anggota mempertahankan seleksinya, menyeret salah satu
  memindahkan SEMUANYA sejauh yang sama dalam SATU patch `updateScene` (satu
  undo mengembalikan semuanya), Escape mengosongkan. Anotasi selalu sendiri;
  ubah ukuran selalu satu elemen. Gerbang interaksi: Shift+klik menjadikan
  dua kotak teks aktif, seretan 60 px menggeser keduanya sejauh yang sama,
  dan satu undo mengembalikan keduanya.
  ~~Belum ada penempelan ke elemen lain~~ — *DICABUT:* selain tiga garis
  margin aman per sumbu, elemen yang diseret kini menempel ke elemen lain di
  scene — pusat ke pusat, tepi ke tepi (kiri/kanan, atas/bawah), dan
  bersebelahan (tepi menempel tepi lawan) — dan garis bantu digambar di TEPI
  yang disejajarkan, bukan di pusat (`elementGuides`, murni di core; panduan
  dihitung sekali saat seretan dimulai). Anotasi tidak ikut menempel:
  koordinatnya milik bingkai tangkapan layar. Gerbang interaksi menyeret
  teks pendek sampai tepi kirinya sejajar tepi kiri teks panjang (meleset
  3 px) dan menahannya: garis bantu muncul tepat di x tepi kiri elemen lebar
  (553,1 px = 553,1 px), dan pelepasannya tetap menghasilkan patch
  (`offsetX` -0,2118).
- **Scene terkunci menolak seretan**, dan mengatakannya lewat label di kanvas
  — pagar yang sama dengan yang berlaku untuk agent.

## Konsekuensi

- Menata teks dan tempelan berhenti jadi pekerjaan mengetik angka.
- Skema teks bertambah dua field. Preset mana pun yang ditulis sesudah ini
  wajib menghormatinya, sama seperti mereka menghormati geseran grafis.
- Karena keluarannya patch op biasa, agent melihat hasil tataan tangan di
  konteksnya — dan bisa mengomentarinya lewat `critiqueDraft` atau
  `reviewRender` seperti perubahan lain.

## Alternatif yang ditolak

- **Koordinat mutlak (x/y piksel) untuk teks.** Ditolak: setiap ganti rasio,
  semua teks harus ditata ulang. Jangkar + geseran fraksional adalah alasan
  Dalang bisa mengganti rasio tanpa merusak tata letak.
- **Menghitung ulang tata letak preset di sisi Studio** untuk menempatkan
  pegangan. Ditolak: dua rumus tata letak yang harus tetap sama selamanya, dan
  yang menyimpang tidak akan ketahuan sampai dilihat.
- **Mengirim patch tiap gerakan pointer** supaya video ikut bergerak.
  Ditolak: membanjiri patch log dan membuat undo berarti mundur satu piksel.
- **Menyeret juga mengubah `align`.** Ditolak: mengubah rupa paragraf tanpa
  diminta.
- **Menampilkan pegangan selama pemutaran.** Ditolak: teks bergerak sepanjang
  animasinya, jadi kotaknya bergetar mengikuti — dan tidak ada editor yang
  menampilkan pegangan transform di atas video yang sedang jalan.
