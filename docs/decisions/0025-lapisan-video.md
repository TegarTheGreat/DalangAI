# ADR-0025 — Lapisan video

**Status:** diterima · **Tanggal:** 31 Agustus 2026 · **Fase:** 9 (§9.2)

## Konteks

Sampai fase kesembilan, satu scene Dalang punya tepat satu gambar. Semua yang
bisa ditumpuk di atasnya adalah gambar diam atau teks: ikon, stiker, caption,
teks overlay, anotasi. Tidak ada cara menaruh **video kedua** di dalam satu
scene.

Yang hilang karena itu bukan hiasan. B-roll — potongan yang menunjukkan apa
yang sedang dikatakan sementara narasi berjalan — adalah salah satu dari sedikit
teknik yang membedakan video yang ditata dari deretan gambar. Begitu juga
picture-in-picture (rekaman wajah di atas rekaman layar) dan sisipan bukti
(potongan grafik di samping penjelasan). Semuanya butuh hal yang sama: klip
kedua yang hidup di dalam scene, punya kotaknya sendiri, dan punya jendela
tampilnya sendiri.

Batasan yang sama juga menahan arah lain: ADR-0023 mencatat bahwa impor FCPXML
hanya menghitung connected clip di lane dan melewatinya, "karena garis waktu
Dalang baru punya satu jalur video". Berkas dari editor lain kehilangan
sisipannya begitu masuk ke Dalang.

## Keputusan

### 1. Lapisan hidup DI DALAM scene, bukan di trek global

`scene.layers` adalah larik (maksimal dua), dengan jendela tampil berupa
**fraksi durasi scene** — persis seperti grafis tempelan sejak ADR-0018.

Track global dengan waktu mutlak adalah bentuk yang lebih umum, dan ditolak.
Garis waktu Dalang adalah barisan scene, dan scene itulah satuan yang dipahami
agent: ia menulis naskah per scene, memilih aset per scene, mengkritik per
scene. Waktu mutlak memutus ikatan itu — memindahkan satu scene tidak lagi
memindahkan sisipannya, memperpanjang narasi menggeser semuanya keluar tempat,
dan agent kehilangan cara menyebut "yang muncul saat kalimat ini dibacakan".

Konsekuensinya dinyatakan di bawah: sisipan yang membentang melewati batas
scene harus ditulis dua kali.

### 2. Media lapisan memakai bentuk `visual` yang SAMA

Lapisan bukan tipe media baru. `layer.visual` adalah `visualSchema` yang sudah
ada, dengan `variant` dibuang dan `type` dipersempit ke aset nyata.

Karena itu gerak Ken Burns, filter warna, kecepatan putar, titik masuk trim,
cermin horizontal, dan titik fokus crop berlaku di lapisan **tanpa satu baris
rumus pun ditulis dua kali**. Yang lebih penting: lapisan tidak akan pernah
tertinggal saat kemampuan visual bertambah — kemampuan berikutnya yang masuk ke
`visualSchema` langsung berlaku untuk sisipan juga.

Yang dipersempit dipersempit dengan alasan: `solid` dan `template-anim` adalah
LATAR. Sebagai sisipan keduanya cuma jadi kotak yang menutupi videonya sendiri.

### 3. Kotaknya jangkar + geseran, dengan lebar dan tinggi TERPISAH

Penempatan memakai sembilan jangkar yang sama dengan grafis, plus geseran
fraksional — alasan yang sama dengan ADR-0018/0024: satu nilai yang sama tetap
benar di 16:9, 9:16, dan 1:1.

Bedanya satu: lapisan punya `width` dan `height` sendiri, bukan satu `size`.
Grafis adalah ikon persegi; sisipan video punya rasio sendiri, dan memaksa
kotaknya persegi akan memotong footage 16:9 di setiap sisipan.

### 4. Satu angka `volume`, di `visual` — bukan amplop

`visual.volume` (bawaan **0 = bisu**) ada di visual dasar MAUPUN lapisan, karena
keduanya memakai skema yang sama. B-roll bersuara alami memakai field yang sama
entah ia jadi latar atau sisipan.

Yang TIDAK ada di sini: fade in/out, ducking otomatis di bawah narasi, dan
normalisasi kenyaringan EBU R128. Ketiganya §9.4, dan mengatakannya lebih baik
daripada menaruh kendali yang tidak melakukan apa yang namanya janjikan.

Bawaannya nol, jadi setiap plan lama ter-render byte-per-byte sama.

### 5. Kueri lapisan WAJIB, tidak diturunkan dari narasi

Visual dasar boleh tidak punya `query`: pipeline menurunkannya dari narasi.
Lapisan tidak. Kalau diturunkan, kuerinya akan sama persis dengan kueri visual
dasarnya — dan sisipan yang isinya sama dengan latarnya bukan B-roll, itu cuma
gambar yang sama dua kali. Lapisan stock tanpa kueri jadi **error** yang
menyebutkan alasannya, bukan tebakan.

Orientasi pencariannya juga diturunkan dari **kotak lapisan**, bukan dari rasio
video: sisipan 0,2 × 0,55 di bingkai 16:9 adalah kotak tegak, dan meminta stok
landscape untuknya berarti memotong habis isinya di setiap sisipan.

### 6. Berkasnya dikunci per ID LAPISAN, dan id itu unik SE-PLAN

`renderState.layerAssets[layer.id]` — bukan per scene, karena satu scene boleh
punya dua lapisan dan kunci per scene membuat lapisan kedua menimpa berkas
lapisan pertama.

Karena kuncinya se-plan, skema **menolak** id lapisan kembar walau di scene
berbeda. Ini pelajaran ADR-0018 yang dulu hanya jadi konvensi penamaan; kali ini
ia dijaga `superRefine`.

### 7. `replaceAsset` dipakai ulang, bukan op baru

Op yang sudah ada mendapat `layerId` opsional. Keduanya menjawab pertanyaan
yang identik ("aset mana yang dipakai di sini"), dan op kedua berarti aturan
pin/lock hidup di dua tempat yang harus tetap seragam selamanya.

Menambah dan membuang lapisan tetap lewat `updateScene` (ganti larik), sama
seperti teks dan grafis: lapisan yang baru dibuat belum punya aset sama sekali,
jadi memaksa dua op untuk satu tindakan hanya membuat undo setengah jalan.

### 8. Ekspor jadi lane; impor lane jadi lapisan

Lapisan diekspor sebagai **trek video tambahan** di OTIO dan **connected clip
lane positif** di FCPXML. Waktunya diukur dari AWAL SCENE, bukan dari titik
potong yang dipakai trek utama — di render, lapisan hidup di dalam Sequence
scene-nya.

Arah masuk ikut terbuka: connected clip lane positif dan trek video kedua kini
**dipulihkan** jadi lapisan, mencabut batas yang dinyatakan ADR-0023. Lane
negatif (audio tempelan) tetap dilewati dengan hitungannya.

## Bukti

**Dirender sungguhan, bukan hanya diuji sebagai angka.** Proyek contoh
`examples/tutorial-studio` sekarang punya satu lapisan PiP, dan `dalang still`
pada detik ke-18 menghasilkan kotak bersudut membulat berbingkai aksen di
kanan-bawah, di atas screenshot langkah ketiga. Tanpa render itu, "lapisan
tampil" hanya klaim.

**Diseret sungguhan di peramban, bukan hanya diuji sebagai angka.** Studio
dijalankan dengan Chromium, playhead diletakkan di dalam jendela tampil
lapisan, dan pegangannya benar-benar ADA di kanvas (268x130 px — persis 0,3 x
0,26 dari kotak pemutar). Setelah diseret dari kanan-bawah ke kiri-atas lewat
peristiwa pointer CDP, `plan.json` di disk berubah dari `kanan-bawah` /
`offsetY -0,1` jadi `kiri-tengah` / `offsetX 0,0556` / `offsetY -0,1976`. Tanpa
uji ini, "lapisan bisa diseret" hanya klaim — dan pengalaman ADR-0024 menunjukkan
justru pengukuran pegangan yang paling mudah menghasilkan NOL tanpa ketahuan.

**Gerbang interop dibuat GAGAL lebih dulu, tiga kali.** Menghapus trek lapisan
dari pengekspor, menggesernya dua frame, dan menggesernya SATU frame —
ketiganya ditolak gerbang. Yang pertama juga membongkar tautologi di versi
awalnya: saat harapan jumlah lapisan dibaca dari `buildEditTimeline` (modul yang
sedang diuji), penghapusan trek lapisan LULUS. Harapannya kini dihitung dari
plan + `computeFrameLayout` milik renderer.

**Batas ketelitian pembaca rujukan diukur, bukan ditebak.** Adapter FCPXML resmi
membaca lapisan kami di frame 508 padahal berkasnya menulis `50900/3000s` yang
persis 509 frame. Sebabnya ada di barisnya: `otio_fcpx_xml_adapter/fcpx_xml.py`
memakai `int(...)` — pemotongan, bukan pembulatan — dan Python menghitung
`50900/3000*30 = 508.99999999999994`. Nilai lain di berkas yang sama
(`48800/3000s` → tepat `488.0`) lolos utuh. Karena itu sisi `.otio` diperiksa
PERSIS, atribut `offset` di berkas kami sendiri diurai ulang sebagai pecahan
bulat dan diperiksa PERSIS, dan hanya jalur adapter FCPXML yang diberi toleransi
satu frame — dengan alasannya tertulis di gerbangnya.

**Gerbang tata letak kini membuka SEMUA tab Properti,** bukan hanya tab bawaan.
Tab "Lapisan" bahkan dipaksa punya satu kartu terbuka sebelum diukur: keadaan
kosong tidak pernah meluber, jadi mengukurnya tidak membuktikan apa pun.

**Dan cara mengukurnya diperbaiki karena percobaan menunjukkan cara pertama
buta.** Versi pertama memakai `scrollWidth` panel; kartu memakai
`overflow: hidden`, sehingga isi yang kelewat lebar TERGUNTING di dalam kartu
dan tidak pernah menambah `scrollWidth` sama sekali — hijau persis pada kasus
yang paling perlu ditangkap. Sekarang tiap kendali diukur terhadap kotak
panelnya, dan `min-width: 900px` yang dipasang sengaja langsung ditolak.

## Batas yang dinyatakan

- **Dua lapisan per scene.** Tiap lapisan adalah satu pemutar video lagi di
  setiap frame; render melambat jauh lebih cepat daripada gambarnya jadi lebih
  baik.
- **Sisipan lintas scene harus ditulis dua kali.** Konsekuensi langsung dari
  keputusan §1, dan harga yang dibayar untuk garis waktu yang tetap bisa disusun
  ulang per scene.
- ~~**Suara lapisan cuma satu angka gain.**~~ *DICABUT oleh ADR-0026:*
  `visual.audio` lapisan punya amplop penuh (fade, ducking di bawah narasi,
  normalisasi kenyaringan) yang sama dengan klip lain.
- **Ekspor membawa KLIPNYA, bukan tampilannya.** Letak, ukuran, sudut membulat,
  bingkai, dan animasi masuk tidak ikut menyeberang: itu transform milik render,
  bukan properti klip di OTIO/FCPXML. Klipnya akan tampil layar penuh di editor
  tujuan sampai ditata ulang, dan laporan ekspor mengatakan itu.
- **Impor memulihkan WAKTU dan BERKAS, bukan kotaknya.** Berkas interchange
  tidak menyimpan letak sisipan, jadi semuanya memakai kotak bawaan.
- **Ubah ukuran di kanvas bersifat seragam** (lebar dan tinggi diskalakan
  bersama). Rasio bebas ada di panel Properti; sudut yang memetakan dx ke lebar
  dan dy ke tinggi hampir selalu memenceng-mencengkan sisipan 16:9 tanpa
  disadari.
- **Lapisan yang asetnya belum ada tidak digambar sama sekali.** Ia tidak
  menggagalkan render dan tidak menggambar kotak kosong yang menyesatkan;
  statusnya terlihat di kartu Properti, di bar timeline yang bergaris putus, dan
  sebagai kritik ber-level "perhatian".

## Konsekuensi

- Skema §5.1 bertambah: `scene.layers`, `visual.volume`, dan
  `renderState.layerAssets`. Preset mana pun yang ditulis sesudah ini wajib
  memasang `LayersOverlay`, sama seperti ia memasang `GraphicsOverlay`.
- Batas ADR-0023 tentang connected clip dicabut: round-trip lane kini bekerja
  dua arah.
- Agent punya dua tool baru (`addLayer`, `removeLayer`) dan melihat lapisan tiap
  scene di konteksnya, jadi ia tidak menumpuk sisipan sampai batas tanpa sadar.

## Alternatif yang ditolak

- **Track video global dengan waktu mutlak.** Ditolak: memutus ikatan scene yang
  jadi dasar seluruh cara agent bekerja (lihat §1).
- **Tipe media baru khusus lapisan.** Ditolak: dua model visual yang harus tetap
  sama selamanya, dan yang kedua pasti tertinggal saat yang pertama bertambah.
- **Menurunkan kueri lapisan dari narasi**, supaya lapisan bisa dibuat tanpa
  mengetik apa pun. Ditolak: hasilnya sisipan yang isinya sama dengan latarnya.
- **Satu `size` untuk lapisan**, seperti grafis. Ditolak: memotong footage 16:9
  di setiap sisipan.
- **Amplop volume (fade in/out) sekalian.** Ditolak dari ADR ini: model audio
  yang benar butuh ducking dan normalisasi juga, dan setengah model audio lebih
  buruk daripada satu angka gain yang jujur.
- **Membiarkan gerbang interop memakai harapan dari `buildEditTimeline`.**
  Ditolak setelah dibuktikan: penghapusan trek lapisan lulus.
