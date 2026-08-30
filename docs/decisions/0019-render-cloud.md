# ADR-0019 — RenderTarget cloud: aset lewat URL, biaya lebih dulu

**Status:** Diterima · **Tanggal:** 2026-08-30

## Konteks

PRD §7.3 menyebut arsitektur render **pluggable** (`RenderTarget`) sejak awal:
`local` sekarang, `remotion-lambda` kelak. Fase 5 adalah "kelak" itu.

Selama Fase 0-4 `RenderTarget` hanya hidup sebagai komentar — satu implementasi
tidak membutuhkan interface. Yang membuatnya nyata sekarang bukan keinginan
merapikan kode, melainkan penghalang teknis yang harus diselesaikan lebih dulu.

### Penghalangnya bukan API cloud, melainkan tempat aset

Render lokal bekerja begini: `copyPlanAssets` menumpuk suara narasi, footage
ter-resolve, ikon, stiker, dan efek suara ke dalam public dir bundle, lalu
komposisi mengambilnya dengan `staticFile()`.

Di Lambda cara itu runtuh. Situs Remotion dipasang **sekali** lalu dipakai
berkali-kali; menyisipkan aset per proyek ke dalamnya berarti memasang ulang
seluruh situs — bundel JS, font, semuanya — untuk setiap render.

## Keputusan

### 1. Aset SITUS dan aset PLAN dibedakan secara eksplisit

| | Contoh | Nasib |
| --- | --- | --- |
| Aset situs | font ter-vendor, bed musik `pustaka:*` | ikut bundel komposisi; `staticFile()` di mana pun |
| Aset plan | narasi, footage, ikon, stiker, efek suara, musik unggahan | dialamatkan lewat `useAssetSrc()` |

`resolveMusicFile` karenanya mengembalikan asalnya juga (`bundled`): bed
pustaka dan musik unggahan berakhir di dua tempat yang berbeda.

### 2. `assetBaseUrl` / `assetUrls` adalah prop RENDER, bukan field scene-plan

Alamat bucket adalah detail penyebaran, bukan keputusan kreatif. Kalau ia masuk
ke scene-plan, ia ikut masuk patch log, undo, dan diff dokumen — dan proyek yang
dibagikan akan menunjuk infrastruktur orang lain. Hal yang sama berlaku untuk
nama fungsi Lambda dan bucket: keduanya dibaca dari environment.

### 3. URL per berkas, bukan hanya satu URL dasar

Browser di dalam Lambda mengambil aset lewat HTTPS biasa, tanpa kredensial AWS.
Artinya objeknya harus publik ATAU bertanda tangan (presigned).

Bawaan yang dipilih adalah **bertanda tangan**, dan itu memaksa bentuk API-nya:
tanda tangan berbeda untuk setiap objek, jadi alamat aset tidak bisa dinyatakan
sebagai satu URL dasar. `useAssetSrc` karenanya menerima peta `path -> URL` dan
jatuh kembali ke URL dasar, lalu ke `staticFile()`.

Alternatifnya — membuat seluruh aset proyek bisa diakses siapa pun yang tahu
URL-nya — adalah bawaan yang salah untuk video yang belum dirilis.

### 4. Estimasi biaya ada di KONTRAK, bukan sebagai tambahan

`RenderTarget.estimateCost` wajib, dan target lokal menjawab `0` — itu jawaban
yang benar, bukan ketiadaan jawaban. Gerbang persetujuan §6.3 memutuskan
berdasarkan angka ini; target yang tidak bisa menyebut harganya akan membuat
gerbang itu diam-diam berhenti bekerja.

Estimasi Lambda dihitung dari **durasi plan**, tanpa memanggil AWS sama sekali —
menyebutkan harga tidak boleh berbiaya. Rumusnya sengaja **dibulatkan ke atas**:
user yang menyetujui "$0,004" lalu ditagih "$0,02" akan berhenti mempercayai
angkanya sama sekali.

### 5. Panggilan AWS di-inject; urutan langkahnya diuji tanpa AWS

Pola yang sama dengan seluruh provider di repo ini. `render.ts` memegang seluruh
urutan (unggah → mulai → pantau → unduh), batas waktu, dan penanganan galat, dan
diuji penuh dengan fake. `aws.ts` hanya memetakan ke SDK.

Aset yang isinya tidak berubah tidak diunggah ulang (checksum disimpan sebagai
metadata objek): itu yang membuat iterasi di cloud terasa murah, bukan sekadar
mungkin.

## Bukti

**Paritas render, dan kenapa bentuknya begini.** Sebuah still dirender dua kali
dari plan yang sama: sekali lewat `staticFile`, sekali lewat URL dengan aset
**sengaja tidak disalin** ke bundle. Hasilnya identik byte per byte di kedua
contoh proyek, dengan tiga aset benar-benar dilayani lewat HTTP tiap kali.

Menyalin aset DAN memberi URL akan membuat gerbang itu hampa: satu pemanggil
`staticFile()` yang terlewat tetap akan menemukan berkasnya, dan jalur URL lolos
tanpa pernah diuji. Frame-nya pun dipilih dari plan (titik tengah scene yang
punya aset ter-resolve), bukan ditulis tangan — nomor frame tetap bisa jatuh di
kartu judul yang tidak memuat aset, yaitu lulus tanpa menguji apa pun.
Gerbang ini jalan di CI.

**Kontrak Remotion diambil dari tipe paket terpasang, bukan dari ingatan.** Dua
temuan yang akan salah kalau menebak (diperiksa terhadap 4.0.518):

- `renderMediaOnLambda`, `getRenderProgress`, dan `presignUrl` **deprecated** di
  `@remotion/lambda`; yang hidup ada di `@remotion/lambda-client`. `deploySite`
  juga deprecated, digantikan `bundle()` + `deploySiteFromBundle()`.
- Unduhan hasil memakai `downloadMedia()` milik Remotion, BUKAN `GetObject`
  dengan kunci S3 yang ditulis tangan. Versi pertama modul ini menebak
  `renders/<id>/out.mp4` — benar untuk MP4, dan diam-diam salah untuk WebM dan
  MOV yang bernama `out.webm`/`out.mov`.

**19 test** untuk paket ini: urutan langkah, aset tidak terunggah dua kali,
alamat aset benar-benar sampai ke komposisi, kegagalan Lambda jadi galat yang
memuat pesan aslinya, render tidak menggantung selamanya, dan estimasi biaya
bisa dijawab tanpa satu pun panggilan AWS.

## Batas yang dinyatakan

- **Belum pernah dijalankan terhadap AWS sungguhan.** Proxy lingkungan kerja
  tidak punya akses ke AWS, dan repo ini tidak punya kredensial. Yang sudah
  diverifikasi: seluruh urutan langkah (dengan fake) dan seluruh kontrak SDK
  (dengan typecheck terhadap tipe paket terpasang). Yang belum: apakah AWS
  berperilaku seperti dokumentasinya. `dalang cloud:check` dibuat persis untuk
  itu — pemilik repo bisa menjalankannya sendiri.
- Gerbang paritas memakai still, dan still tidak memuat audio. Jalur GAMBAR
  terbukti; jalur audio masih bersandar pada render video E2E lokal.
- Penyiapan Lambda (`functions deploy`, `sites create`) tetap dilakukan lewat
  CLI Remotion. Membungkusnya berarti menduplikasi perkakas yang sudah bagus
  dan menyembunyikan langkah yang memang perlu dipahami pemiliknya.

## Konsekuensi

- `dalang render --target lambda` tersedia; tanpa konfigurasi, `dalang render`
  tetap berjalan penuh di mesin sendiri seperti sebelumnya.
- Preview Player dan render lokal tidak berubah sedikit pun — keduanya tidak
  tahu modul alamat aset ini ada.
- Menambah target ketiga = satu paket yang mengisi interface yang sama.

## Alternatif yang ditolak

- **Memasang ulang situs per render.** Ditolak: mengunggah seluruh bundel dan
  font untuk setiap render, hanya karena beberapa aset berubah.
- **Menaruh `assetBaseUrl` di scene-plan.** Ditolak: alamat infrastruktur akan
  ikut ter-commit, ter-undo, dan ikut terbawa saat proyek dibagikan.
- **Membuat aset publik supaya cukup satu URL dasar.** Ditolak sebagai bawaan:
  itu membuat footage dan narasi yang belum dirilis bisa dibaca siapa pun yang
  punya URL-nya.
- **Memakai `estimatePrice()` Remotion untuk gerbang §6.3.** Ditolak untuk
  estimasi PRA-render: fungsi itu butuh durasi tagihan yang baru diketahui
  setelah render berjalan. Ia tetap berguna untuk melaporkan biaya sesudahnya.
- **Membungkus `remotion lambda functions deploy` di dalam `dalang`.** Ditolak:
  menduplikasi perkakas yang sudah baik, dan menyembunyikan sumber daya AWS yang
  pemiliknya justru perlu tahu ada.
