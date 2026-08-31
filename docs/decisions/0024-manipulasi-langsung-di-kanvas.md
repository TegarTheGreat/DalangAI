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

## Batas yang dinyatakan

- **Yang bisa diseret baru teks dan grafis.** Anotasi tutorial (zoom, sorot,
  panah, blur) punya `target` berupa persegi ternormalisasi dan secara teknis
  bisa ikut, tapi anotasi digambar dengan aturan lain per preset dan belum
  ditandai di DOM. Caption tidak bisa dan tidak akan bisa: letaknya milik
  preset.
- **Ubah ukuran hanya untuk grafis.** Ukuran teks adalah `s`/`m`/`l` (skala
  relatif terhadap peran tipografinya), bukan angka bebas — menyeret sudut
  untuk menghasilkan tiga nilai diskret akan terasa rusak, jadi ukuran teks
  tetap di panel Properti.
- **Video tidak ikut bergerak selama seretan**, hanya kotaknya. Itu
  konsekuensi langsung dari keputusan mengirim satu patch saat dilepas.
- **Belum ada pemilihan jamak** (menyeret beberapa elemen sekaligus) dan belum
  ada penempelan ke elemen lain — garis bantunya baru tiga per sumbu (margin
  aman kiri/kanan, tengah, dan padanan vertikalnya).
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
