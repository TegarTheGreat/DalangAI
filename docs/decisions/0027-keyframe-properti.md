# ADR-0027 — Keyframe sembarang untuk properti

**Status:** diterima · **Tanggal:** 1 September 2026 · **Fase:** 9 (§9.3)

## Konteks

Sampai fase kesembilan, SELURUH gerak di Dalang adalah preset. Grafis punya
`anim: pop|apung|putar|denyut`, lapisan punya `entrance: fade|geser|pop`, teks
punya `anim: fade|pop|rise|typewriter`, visual punya `motion: kenburns-in|...`.
ADR-0015 menambahkan util `kf()` untuk menulis keyframe — tapi di dalam KODE
preset, bukan di dalam plan. Yang bisa dipilih pengguna dan agent tetap hanya
nama dari daftar.

Preset itu tepat sebagai jalan bawaan: ia membuat video pertama seseorang
langsung terasa ditata, tanpa harus tahu apa itu easing. Yang tidak bisa
dilakukannya adalah menjawab permintaan yang menyebut WAKTU dan TEMPAT
tertentu — "geser kartu ini dari kanan ke tengah tepat saat narasi
menyebutnya", "besarkan sisipan ini pelan-pelan sepanjang penjelasan". Itu
butuh nilai yang berubah pada saat yang dipilih, bukan dipilih dari daftar.

Ini juga satu-satunya sisa Fase 9 yang roadmap sendiri tandai "menuntut model
animasi baru dan ADR tersendiri".

## Keputusan

### 1. Keyframe adalah DATA PLAN, bukan kode preset

`tracks` dipasang pada grafis, teks, dan lapisan:

```json
{ "property": "offsetX",
  "points": [ { "at": 0, "value": -0.3, "easing": "glide" },
              { "at": 1, "value": 0.1 } ] }
```

Dengan begitu animasi tunduk pada aturan yang sama dengan seluruh isi plan:
divalidasi skema, diubah lewat patch op, bisa di-undo, terlihat agent, dan
ikut ter-render sama persis di preview maupun render akhir.

### 2. Propertinya TERTUTUP, bukan jalur string bebas

`property: "offsetX"` bisa divalidasi; `path: "style.transform.x"` tidak bisa.
Yang tidak bisa divalidasi akan salah ditulis agent, dan salahnya baru
ketahuan saat render — jauh dari tempat ia ditulis.

Daftarnya berbeda per elemen, karena bentuknya memang berbeda: grafis persegi
(satu `size`), lapisan punya `width`/`height` terpisah (sisipan video punya
rasio sendiri, lihat ADR-0025), teks diatur peran dan ukurannya enum.

| Elemen  | Boleh dianimasikan |
| --- | --- |
| Grafis  | offsetX, offsetY, size, rotate, opacity |
| Teks    | offsetX, offsetY, opacity |
| Lapisan | offsetX, offsetY, width, height, opacity |

### 3. Nilainya dijepit RENTANG YANG SAMA dengan properti statisnya

`ANIMATABLE_RANGE` adalah satu sumber yang dipakai keduanya. Tanpa itu sebuah
keyframe bisa membawa `size` ke 5,0 — nilai yang ditolak skema kalau ditulis
statis. Satu bentuk data tidak boleh punya dua batas; kalau punya, penjagaan
yang lebih ketat cuma hiasan.

### 4. Waktunya FRAKSI JENDELA ELEMEN, bukan detik

`at: 0` = elemen muncul, `at: 1` = elemen hilang. Sama seperti `startFrac`/
`endFrac` sejak ADR-0018: scene yang dipanjangkan atau jendela yang digeser
membawa serta animasinya, tanpa satu pun angka perlu dihitung ulang. Detik
mutlak akan membuat setiap perubahan durasi merusak setiap animasi.

### 5. Easing BERNAMA, satu per SEGMEN

`settle | glide | dolly | linear` — nama yang sama dengan bahasa gerak preset
(ADR-0015), bukan empat angka bezier yang tidak bisa dibaca siapa pun di dalam
plan JSON.

Satu easing per segmen, disimpan di titik yang MEMULAI segmen. Dua easing per
titik (masuk & keluar, seperti After Effects) membuat dua titik bertetangga
bisa saling bertentangan tentang bentuk satu segmen yang sama.

### 6. Track menang PENUH atas preset dan nilai statis

Properti yang punya track ditentukan seluruhnya olehnya. Bukan dikalikan:
"geser ke 0,2" harus berarti 0,2 — bukan 0,2 dikali apa pun yang kebetulan
sedang dilakukan preset.

Tapi hanya properti ITU. Satu track `offsetX` tidak mematikan animasi `pop`
yang mengurus `scale`; kalau ia melakukannya, menganimasikan satu properti
akan diam-diam membuang gerak yang sudah dipilih orang untuk properti lain.

Konsekuensinya di kode: nilai terpakai tiap properti diputuskan di SATU tempat
(`graphicMotion` / `layerMotion`), dan penyusun gaya membaca dari situ, bukan
dari elemen statisnya lagi.

### 7. Di luar titik pertama/terakhir, nilainya DITAHAN

Bukan diekstrapolasi. Ekstrapolasi akan membawa properti ke luar rentang
sahnya sendiri pada frame-frame di tepi — persis hal yang dijaga skema saat
menulis, jadi melanggarnya saat membaca membuat penjagaan itu sia-sia.

### 8. Keyframe dipasang DI POSISI PLAYHEAD

Di Studio, tombol keyframe menaruh titik pada posisi playhead, bukan lewat
isian waktu. Menganimasikan sesuatu berarti melihatnya; mengetik "0,42" ke
dalam kotak tidak pernah memberi tahu apakah itu saat yang tepat. Kalau
playhead sedang di luar jendela tampil elemennya, tombolnya mati dan
mengatakan alasannya.

## Bukti

Diverifikasi lewat render sungguhan, diukur dari PIKSELNYA — bukan hanya unit
test. Satu teks dengan track `offsetX` linear dari -0,28 ke +0,28 sepanjang
scene 4 detik; pusat massa piksel teks diukur dari PNG hasil render:

| frame | kemajuan | pusat-x diramalkan | pusat-x TERUKUR |
| --- | --- | --- | --- |
| 15 | 0,125 | 0,290 | **0,2888** |
| 45 | 0,375 | 0,430 | **0,4295** |
| 75 | 0,625 | 0,570 | **0,5688** |

Jarak antar titik rata (0,1407 dan 0,1393) — persis yang dituntut easing
`linear`. Kontrolnya menutup celah "mungkin yang menggerakkan sesuatu yang
lain": plan yang SAMA dengan `tracks: []` menaruh teks di 0,4988 pada
ketiga frame — diam sama sekali.

Aturan-aturannya dibuktikan bisa GAGAL sebelum dipercaya. Enam perusakan pada
evaluator (easing diambil dari titik penutup, ekstrapolasi alih-alih ditahan,
properti tanpa track ikut diisi, pembagi kemajuan salah satu, `linear` diganti
kurva lain, penjaga ujung dihapus) dan empat pada penyambungannya ke model —
semuanya tertangkap.

Dua di antaranya **lolos pada percobaan pertama**: mengembalikan `graphicStyle`
dan `layerBoxStyle` ke nilai statis membuat seluruh tes tetap hijau, karena tes
saat itu hanya memeriksa objek motion dan tidak pernah memeriksa gaya yang
benar-benar dipakai. Di video itu terlihat sebagai ukuran yang diam sementara
sisanya bergerak. Tes tingkat-gaya ditambahkan, dan kedua perusakan itu
sekarang tertangkap.

## Batas

- ~~**Menyeret berlian di timeline belum ada.**~~ *DICABUT.* Berlian di bar
  lapisan kini pegangan: diseret dengan pointer capture (posisi sementara di
  state, satu patch `updateScene` saat dilepas), atau difokus dari papan ketik
  dan digeser dengan panah kiri/kanan (1%, Shift 5%), Home/End ke ujung.
  Pemindahannya lewat `moveKeyframe` yang MURNI: waktu dipangkas ke 0..1, dan
  seretan yang mendarat tepat di atas keyframe lain pada track yang sama
  ditolak tanpa mengubah apa pun, karena dua titik pada waktu yang sama tidak
  bisa dibedakan dan skema pun menolaknya. Penolakan mengembalikan larik yang
  SAMA (identitas) — versi pertama mengembalikan salinan, dan gerbang interaksi
  menangkapnya: seretan yang ditolak tetap mengirim patch kosong, tercatat di
  log, dan undo berikutnya memakan patch kosong itu alih-alih langkah nyata.
  Gerbang yang sama (`gate:interaksi`, di CI) membuktikan seretan 25% ke 50%,
  panah kiri 1%/Shift 5%/End, fokus yang kembali ke berlian yang sama setelah
  React memasang ulang elemennya, dan undo yang mengembalikan langkah nyata.
  ~~Yang belum ada: snap ke keyframe track lain~~ — *DICABUT:* berlian yang
  diseret menempel ke keyframe track LAIN pada lapisan yang sama (ambang 2%
  durasi elemen, `snapKeyframeTime` murni di core; kandidat yang bertabrakan
  dengan titik track sendiri dilewati; nudge papan ketik tidak menempel karena
  langkahnya sudah eksplisit), dengan garis bantu putus-putus di bar selama
  ditahan. Gerbang interaksi menyeret berlian opacity ke 1,5% dari keyframe
  offsetX@60%: garis bantunya muncul di x keyframe itu, pelepasannya mendarat
  tepat di 0,6, dan seretan yang dilepas 4% darinya tidak menempel. Dua
  berlian dari track berbeda pada waktu yang SAMA tidak bertumpuk persis:
  tiap track punya lajur sendiri di bar (selisih 7 px), dan pointer ditangani
  BAR-nya — saat menekan, berlian yang paling dekat ke titik tekan (jarak ke
  pusat, lajur ikut dihitung) yang diambil, lalu capture, geser, dan lepas
  terjadi di bar. Versi pertama mengandalkan z-index hover, dan gerbang di CI
  menangkap kelemahannya: mousePressed yang tiba sebelum hover ter-render
  mengambil berlian yang digambar belakangan. Gerbang menyeret berlian
  opacity yang berbagi waktu 60% dengan offsetX dari pusatnya sendiri, dan
  offsetX tetap di tempat. Yang masih belum ada: pemilihan jamak berlian.
- **Properti yang bisa dianimasikan masih sedikit** — tidak ada warna, blur,
  atau parameter filter. Menambahnya berarti menambah entri di satu tabel, dan
  sengaja ditunda sampai ada permintaan nyata.
- **Visual dasar scene belum bisa di-keyframe** (Ken Burns tetap preset).
  Gerak kamera punya bentuk sendiri — titik fokus, skala, kecepatan — dan
  memaksanya ke dalam bentuk track properti akan menghasilkan API yang bisa
  menyatakan hal-hal yang tidak masuk akal.
- **Tidak ikut ekspor.** OTIO tidak punya kurva properti sama sekali, dan
  FCPXML hanya punya milik Final Cut sendiri. Laporan ekspor MENGATAKAN itu,
  lengkap dengan jumlah elemennya.

## Konsekuensi

- Skema §5.1 bertambah `tracks` pada `graphicSchema`, `textOverlaySchema`, dan
  `videoLayerSchema`, plus `ANIMATABLE_PROPERTIES`, `ANIMATABLE_RANGE`, dan
  `keyframeTrackSchema`.
- `setKeyframe` / `removeKeyframe` / `clearTrack` adalah fungsi MURNI atas
  larik track — pemanggilnya membungkusnya dalam patch op biasa, jadi tidak ada
  jalur kedua yang mengubah kebenaran tanpa undo.
- Kedua preset (documentary-01 dan tutorial-01) menghormati track. Kalau hanya
  satu yang menghormatinya, plan yang sama akan bergerak di satu gaya dan diam
  di gaya lain.
- Agent tahu cara memakainya, lengkap dengan peringatan memakainya hemat:
  video yang semua elemennya bergerak sendiri-sendiri terbaca gelisah, bukan
  hidup.

## Alternatif yang ditolak

- **Jalur properti bebas (`path: "..."`)**. Ditolak: tidak bisa divalidasi,
  jadi agent akan menuliskannya salah dan salahnya muncul saat render.
- **Waktu dalam detik**. Ditolak: setiap perubahan durasi scene akan merusak
  setiap animasi di dalamnya.
- **Track dikalikan dengan preset**. Ditolak: membuat nilai yang diminta
  berarti hal berbeda tergantung preset yang kebetulan terpasang.
- **Bezier per titik sebagai empat angka**. Ditolak: plan berhenti bisa dibaca
  manusia, dan bahasa geraknya lepas dari preset yang sudah ada.
- **Kurva editor penuh (grafik nilai-terhadap-waktu)**. Ditunda, bukan ditolak:
  ia menuntut kanvas interaksi tersendiri. Sejak berlian bisa diseret di
  timeline, tempatnya sudah wajar; yang belum ada adalah kebutuhannya.
