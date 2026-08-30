# ADR-0020 — Lobi: satu port banyak proyek, dan gerbang yang mengukur tata letak

**Status:** Diterima · **Tanggal:** 2026-08-30

## Konteks

Sampai ADR-0019, `dalang studio` selalu membuka **satu** proyek dan langsung
masuk editor tiga panel. Tidak ada layar untuk melihat karya yang sudah ada,
membuat yang baru, atau berpindah tanpa mematikan server. Untuk sebuah alat
yang menyebut dirinya "Cursor untuk video", itu berarti setiap pekerjaan
dimulai dari terminal — dan orang yang membuat video kedua harus mengingat nama
foldernya sendiri.

Bersamaan dengan itu, sebuah cacat lama akhirnya terukur: header editor
**bertumpuk sendiri** di setiap lebar laptop 1440px ke bawah. Label "Properti"
digambar di atas "9:16", "Gaya" di atas "1:1". Tidak ada satu tes pun yang
gagal karenanya — DOM-nya benar, komponennya ter-render, seluruh suite hijau.
Yang salah hanya kotak geometrinya, dan itu cuma terlihat kalau ada yang
benar-benar mengukur.

Dua hal itu digabung dalam satu ADR karena keduanya menjawab pertanyaan yang
sama: **apa yang membuat sebuah editor terasa jadi, dan bagaimana kita tahu ia
tetap begitu.**

## Keputusan

### 1. Proyek tetap folder biasa; lobi hanya membaca folder

Sebuah proyek Dalang adalah **folder dengan `plan.json` di dalamnya**. Titik.
Lobi tidak punya basis data, indeks, atau berkas manifes sendiri: ia melakukan
`readdir` dan menampilkan apa yang ada.

Aturan itu sengaja dibuat sesederhana mungkin. Proyek yang hanya bisa dibaca
aplikasinya sendiri adalah proyek yang tersandera aplikasinya; folder biasa
bisa disalin, di-zip, dikirim lewat pesan, dan di-commit ke git seperti berkas
lain.

Konsekuensi yang diterima:

- proyek dengan `plan.json` rusak **tetap didaftar**, ditandai tidak sah.
  Lobi yang menyembunyikan proyek rusak membuat orang mengira karyanya hilang,
  padahal foldernya masih ada;
- folder tanpa `plan.json` diabaikan tanpa keluhan;
- workspace adalah folder induk mana pun. `dalang studio proyekku/` tetap
  membuka proyek itu (lobinya jadi folder induknya); `dalang studio folder/`
  yang tidak berisi `plan.json` membuka lobi. Tidak ada flag yang harus
  diingat.

### 2. Berpindah proyek membuang app-nya, bukan menukar sesinya

`createStudioApp` membangun satu `ProjectSession` dan memegangnya seumur hidup.
Puluhan rute menutup (`close over`) sesi itu saat didaftarkan. Menukar sesi di
bawah mereka berarti setiap rute harus tahu bahwa proyek bisa berganti di
tengah jalan — dan satu rute yang lupa akan menulis ke proyek yang salah tanpa
memberi tanda apa pun.

Jadi yang berganti bukan sesinya, melainkan **app-nya**:

```
StudioHost  (port, berkas UI, /api/workspace)   ← hidup terus
   └── Studio (app Hono + ProjectSession)       ← dibuang & dibangun ulang
```

Konsekuensi yang dinyatakan terang-terangan: **satu proyek terbuka pada satu
waktu, per server.** Editor video bukan peramban — dua proyek terbuka bersamaan
berarti dua render, dua pipeline, dan dua anggaran yang saling menutupi.

Pindah, tutup, dan buang **ditolak** selama ada ekspor atau job yang berjalan.
Panel yang masih tersambung diberi tahu lewat event `project-closed` sebelum
handle-nya dilepas, supaya mereka menutup SSE-nya sendiri dan kembali ke lobi,
bukan menggantung pada bus yang sudah mati.

### 3. Buang = pindah ke `.trash/`, bukan hapus

Sebuah tombol di layar tidak boleh bisa memusnahkan pekerjaan berhari-hari.
`POST /api/workspace/trash` memindahkan folder ke `<workspace>/.trash/<id>-<stempel>`
dan mengatakan ke mana ia pergi. Jalan pulangnya tidak butuh aplikasi ini sama
sekali — cukup pindahkan foldernya kembali.

Duplikat **tidak** membawa `.dalang`: cache pipeline, riwayat patch, dan ledger
biaya milik proyek asal. Salinan yang membawa ledger orang lain berbohong soal
biaya sejak detik pertama.

### 4. Kartu proyek memperlihatkan rupa proyeknya

Daftar teks memaksa orang membaca nama folder untuk mengenali karyanya sendiri.
Kartu di lobi memakai warna aksen efektif proyek (token plan, atau bawaan
preset), rasio aslinya, dan — bila sudah pernah diekspor — **ekspor terakhir
yang benar-benar berputar saat kartu disorot**.

Tiga batas yang dipegang:

- panggung kartu selalu berbingkai 16:9 yang sama, apa pun rasio proyeknya;
  rasio asli tampil jujur sebagai bidang di dalamnya (pola bin proyek di NLE).
  Grid dengan tinggi kartu berbeda-beda terbaca berantakan;
- video hanya lapisan **di atas** sampul yang selalu ada, dan baru terlihat
  setelah benar-benar bisa diputar. Sebagian peramban berbasis Chromium
  dibangun tanpa H.264 dan tidak bisa mendekode MP4 hasil ekspor sama sekali;
  di sana kartu tetap memperlihatkan sampulnya, bukan kotak hitam;
- rute pratinjaunya hanya menyajikan berkas video di `<proyek>/.dalang/renders/`.
  Sisi `.dalang` yang lain (pipeline.db, riwayat chat, log patch) tetap
  tertutup, dan traversal ditolak — sama seperti mount media proyek terbuka.

### 5. Durasi yang ditampilkan adalah durasi yang akan dilihat

Lobi sempat menyebut 59 detik untuk proyek yang di editor dan di berkas hasil
ekspor berdurasi 54,9 detik: menjumlahkan durasi scene mengabaikan transisi
yang saling menindih. Angka di lobi kini datang dari `computeFrameLayout` —
sumber yang sama dengan preview dan render.

Aturannya, di luar kasus ini: **satu besaran, satu sumber.** Angka yang tidak
akan pernah dilihat pengguna di tempat lain tidak boleh ditampilkan.

### 6. Tata letak punya gerbang yang mengukurnya

`pnpm --filter @dalang/studio gate:layout` membuka studio di 15 lebar layar
nyata (380-1920) dan memeriksa empat hal:

1. tidak ada dua kontrol header yang kotaknya saling menindih;
2. tidak ada kontrol header yang tergunting habis oleh overflow (kecuali di
   wadah yang memang bisa digulir) — kemampuan yang hilang tanpa jejak sama
   buruknya dengan yang tertindih;
3. tidak ada tab properti yang terpotong di wadah yang tidak bisa digulir;
4. halaman tidak bisa digeser ke samping sama sekali.

Browsernya adalah Chromium yang **sudah** dipakai render smoke test (lewat
`findBrowserExecutable` milik paket renderer), jadi CI tidak mengunduh peramban
kedua.

Gerbang yang tidak bisa gagal tidak berguna, jadi ia dibuktikan dua arah:
dengan perbaikannya dicabut, gerbang menemukan 30 masalah di 8 lebar.

## Apa yang gerbang itu temukan

Empat cacat yang lolos dari seluruh suite tes:

| Cacat | Akibatnya |
| --- | --- |
| Zona kiri header menyusut sampai nol, isinya meluap tanpa dipotong | Kontrol saling menindih di semua lebar ≤1440px |
| Aturan responsif ada di tengah berkas | `.segmented` yang ditulis belakangan memenangkan `display` pada kekhususan yang sama — sakelar rasio tetap tampil di 820px meski disuruh sembunyi |
| Tooltip CSS (`[data-tip]::after`) memperbesar area gulir leluhurnya | Seluruh halaman bisa digeser ke samping 32px di **semua** lebar |
| `.tl-scroll` tanpa `min-width: 0` | Timeline 55 detik melebarkan dokumen alih-alih menggulir sendiri |

Ditambah satu yang hanya muncul saat dipakai: laci samping membaca lebar layar
**sekali** saat memuat, jadi jendela yang dikecilkan meninggalkan dua laci
melayang menutupi seluruh panggung.

## Alternatif yang ditolak

**Registry sesi per proyek (banyak proyek terbuka sekaligus).** Menarik di
atas kertas, tapi menuntut setiap rute, setiap job pipeline, dan setiap
anggaran menjadi sadar-proyek. Biayanya nyata dan langsung; manfaatnya
spekulatif — belum ada bukti orang ingin merender dua proyek sekaligus dari
satu jendela.

**Basis data proyek.** Lebih cepat untuk daftar besar, dan menghancurkan
properti terpenting formatnya: proyek yang tetap bisa dibaca tanpa aplikasi
ini.

**Menyembunyikan proyek yang plan-nya rusak.** Terlihat lebih rapi, dan
membuat orang mengira karyanya hilang.

**Gerbang tata letak berbasis Playwright.** Perkakasnya lebih nyaman, tapi
menambah unduhan peramban kedua di CI untuk pemeriksaan yang bisa dilakukan
Chromium yang sudah ada.

## Konsekuensi

- `startStudioServer` sekarang menerima `workspaceRoot`; `createStudioApp`
  (satu proyek, tanpa lobi) tetap ada dan dipakai seluruh tes lama apa adanya.
- Satu aturan path (`planPathOf`) dipakai semua perintah CLI: sebelumnya
  `dalang render proyek/` menjawab "EISDIR" padahal `dalang studio proyek/`
  menerima folder.
- CI bertambah satu langkah (`gate:layout`, batas 6 menit).
- Tes 496 → 523.
