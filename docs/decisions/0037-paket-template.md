# ADR-0037: Template sebagai paket yang bisa dibagikan

**Status:** diterima (diterapkan) · **Tanggal:** 8 September 2026 · **Fase:** roadmap §10.2

## Konteks

Roadmap §10.2 menulis satu baris: "Marketplace preset/template." Satu baris
itu memuat dua hal yang sangat berbeda, dan hanya satu yang bisa dikerjakan
dari repo ini.

Yang **tidak** bisa: toko. Toko butuh akun, pembayaran, moderasi, peringkat,
dan indeks yang di-host — semuanya keputusan produk dan komersial, tidak satu
pun bisa diverifikasi di sini, dan membangun etalase yang tidak terhubung ke
apa pun akan menghasilkan halaman yang terlihat seperti fitur dan tidak
melakukan apa-apa.

Yang **bisa**, dan yang sebenarnya menahan semuanya: **template belum berupa
BARANG.** Hari ini "preset" adalah komponen React di dalam repo — menambahnya
berarti menyunting `packages/templates` dan merilis ulang Dalang. Dan
"template" dalam arti titik awal sebuah proyek tidak ada sama sekali: dialog
proyek baru menyusun satu kartu judul kosong, tiap kali, dari nol.

Akibatnya bukan sekadar merepotkan. Orang yang sudah menemukan tampilan yang
cocok untuk kanalnya harus menirukannya dengan tangan di setiap proyek
berikutnya, dan tidak punya satu pun cara mengirimkannya ke rekan kerjanya.

ADR ini membuat template jadi barang. Tokonya tidak, dan itu dikatakan apa
adanya di "Batas yang dinyatakan".

## Keputusan

### 1. Sebuah template ADALAH scene-plan, bukan bentuk data ketiga

`templatePackSchema` = manifes + `scenePlanSchema`. Tidak ada skema template
tersendiri.

Alasannya bukan hemat kode. Bentuk data kedua yang menggambarkan hal yang sama
harus dikejar setiap kali plan bertambah kemampuan, dan yang tertinggal bukan
cuma satu field melainkan kepercayaan: orang memasang template lalu mendapati
separuh yang dijanjikannya tidak ikut, tanpa satu pun pesan yang mengatakan
kenapa. Semua kemampuan yang datang sesudah ini — keyframe kamera ADR-0036
termasuk — otomatis ikut, karena tidak ada tempat kedua yang perlu tahu.

Konsekuensi langsungnya: template bisa divalidasi parser yang sama, dirender
renderer yang sama, dan dikritik `critiquePlan` yang sama.

Yang ditambahkan hanya manifes — id, nama, deskripsi, penulis, versi, tanggal
— karena itu tiga hal yang memang tidak ada di plan: plan adalah satu video,
manifes adalah identitas sebuah barang yang dibagikan.

### 2. Satu aturan tentang isinya: semua ikut KECUALI yang menunjuk berkas

Kata-kata ikut. Narasi, judul, teks overlay — itu yang sengaja dituliskan
pembuatnya untuk dibagikan, dan template berisi kotak kosong mengajarkan lebih
sedikit daripada template yang memperlihatkan iramanya.

Berkas tidak ikut, karena berkas tidak berpindah komputer. Aset klip, aset
lapisan, musik unggahan, trek audio, transkrip, proxy, dan seluruh
`renderState` dilepas — di mesin orang lain semuanya hanya akan jadi tautan
putus, dan tautan putus tidak menghasilkan galat melainkan gambar yang hilang.

Pengecualiannya satu dan bisa diperiksa: rujukan yang berkasnya ADA di setiap
pemasangan Dalang. Ikon `iconify:` dan bunyi serta musik `pustaka:` ikut,
sebab di komputer orang lain ia tetap berarti hal yang sama.

Yang dilepas **dilaporkan**, bukan cuma dilakukan: `dalang template ekspor`
mencetak daftarnya sebelum orang sempat mengira paketnya lengkap.

### 3. Dua hal yang bisa dilakukan dengan template, dan keduanya beda

**Mulai proyek baru dari template** memakai seluruhnya — kerangka dan
tampilan. Judul dan `projectId` diganti; dua proyek yang berbagi `projectId`
akan berbagi entri ledger pipeline, dan judul pembuat template yang tertinggal
akan menerbitkan video atas nama orang lain.

**Pakai tampilannya saja** (`templateLookOps`) untuk video yang SUDAH ditulis
sendiri. Ini setengah yang paling sering dibutuhkan orang, dan ia hanya
menyentuh preset, rasio, token warna & huruf, zona aman, bahasa, format, dan
gaya caption tiap scene. Narasi, potongan, aset, dan durasi tidak disentuh
sama sekali.

Keluarannya PATCH OP, bukan plan baru. Dengan begitu ia masuk jalur yang sama
dengan setiap perubahan lain: tercatat, bisa di-undo, terlihat agent. Scene
yang TERKUNCI tidak ikut berubah, karena kunci berarti kunci.

Template tanpa token MENGOSONGKAN token, bukan membiarkan yang lama. "Tidak
menyebut token" pada sebuah template berarti "pakai warna bawaan presetnya";
menyisakan token lama menghasilkan campuran yang bukan tampilan mana pun.

### 4. Registri: satu folder JSON di rumah Dalang

`$DALANG_HOME/templates/<id>.json`, bawaan `~/.dalang/templates`. Bentuk yang
sama dengan memori preferensi (ADR-0029), dan alasannya juga sama: template
milik ORANGNYA, bukan milik satu folder proyek.

Folder biasa berisi JSON, bukan basis data. Yang dipertaruhkan kecil dan yang
didapat besar: template bisa disalin, dikirim lewat surel, dimasukkan git, dan
dibaca mata — tiga hal yang paling dibutuhkan barang yang memang untuk
dibagikan.

`manifest.id` dibatasi huruf kecil, angka, dan tanda hubung. Bukan kerapian:
id itu jadi nama berkas, dan id bebas akan berujung pada template bernama
`../../.bashrc`.

Berkas rusak tidak menggagalkan daftarnya — ia dilaporkan terpisah, di CLI
maupun di lobi. Satu berkas salah ketik yang membuat seluruh daftar kosong
akan terbaca sebagai "fitur ini tidak jalan".

Template terpasang MENANG atas bawaan ber-id sama: memasang versi sendiri
adalah pernyataan pilihan, dan registri yang tetap mengembalikan bawaan akan
terlihat seperti pemasangannya gagal.

### 5. Tiga template bawaan, ditulis sebagai modul TypeScript

Registri kosong pada pemasangan baru membuat fitur ini terbaca sebagai janji,
bukan barang. Tiga bawaan — klip pendek, esai video, tutorial — satu per
keadaan menonton yang dilayani ketiga preset.

Modul TypeScript, bukan berkas JSON di samping paket. Berkas JSON harus dicari
saat runtime, dan jalurnya berbeda antara `tsx` di repo, paket ter-publish,
dan bundel Lambda; berkas JSON juga tidak diperiksa TypeScript, jadi salah
ketik di dalamnya baru terlihat saat seseorang memasangnya.

Narasinya berupa kalimat yang MENJELASKAN apa yang harus ditulis di situ.
Kotak kosong tidak mengajarkan apa-apa, dan narasi milik video orang lain
mengajarkan hal yang salah.

### 6. Template bawaan wajib lulus kaidah sutradara repo ini sendiri

Ada test yang menuntut `critiquePlan` mengembalikan NOL catatan untuk
ketiganya. Contoh yang melanggar aturannya sendiri mengajarkan hal yang salah;
template lebih buruk lagi, sebab ia dipakai sebagai TITIK AWAL — kesalahannya
ikut disalin ke tiap proyek yang lahir darinya.

Gerbang itu langsung bekerja. Versi pertama ketiganya tersandung tujuh catatan
berbeda, dan tiap perbaikannya membuat template-nya benar-benar lebih baik,
bukan sekadar lolos: esai video naik dari 5 ke 7 scene dengan narasi contoh
seukuran paragraf sungguhan (bukan satu kalimat pendek yang mengajarkan irama
yang salah), tiap langkah tutorial dimulai kata kerja perintah, dan ketiganya
diberi bed musik dari pustaka ter-bundle — hal yang kritikus repo ini sendiri
sebut "pembeda terbesar antara slideshow dan film".

Satu catatan diperbaiki di KAIDAHNYA, bukan di template-nya: `gerak-monoton`
sekarang melewati preset tutorial-01, sebab panggung tangkapan layarnya
mengarahkan kamera dari anotasi (ADR-0036) dan menyuruh menyelang-nyeling
`clip.motion` di situ berarti menyuruh mengubah angka yang tidak akan dibaca
siapa pun. Kaidah yang menyuruh melakukan hal tanpa efek adalah kaidah yang
mengajari orang mengabaikan kaidah.

### 7. Empat permukaan, satu registri

| Permukaan | Yang bisa dilakukan |
| --- | --- |
| `dalang template` | daftar, ekspor, pasang, copot, pakai (tampilan), mulai (proyek baru) |
| Lobi Studio | "Dari template" — pilih, beri judul, langsung terbuka di editor |
| Agent | `listTemplates`, `applyTemplateLook` (lewat applyPatch, jadi bisa di-undo) |
| Registri | folder JSON yang sama untuk ketiganya |

Agent sengaja TIDAK bisa membuat proyek baru dari template: membuat proyek
adalah keputusan orangnya, dan tool yang diam-diam membuat folder baru di
workspace adalah tool yang akan membuat folder yang tidak diminta siapa pun.

## Konsekuensi

- Tampilan yang sudah cocok akhirnya bisa dipindahkan antar proyek dan antar
  orang, tanpa menyalin JSON dengan tangan.
- Menambah "preset" tidak lagi harus berarti menyunting repo. Yang masih harus
  lewat repo adalah cara MENGGAMBAR baru (preset Remotion seperti klip-01);
  yang sekarang bisa dari luar adalah cara MEMAKAI preset yang ada.
- `emptyRenderState()` lahir di core sebagai satu sumber, karena bentuk
  lengkapnya sudah ditulis di tiga tempat dan tempat keempat yang lupa satu
  kunci akan lolos skema lalu meledak di pemakainya.
- Registri kedua di rumah Dalang (setelah `memori.json`) berarti `DALANG_HOME`
  sekarang memuat dua hal. Keduanya milik orangnya, keduanya terlihat, dan
  keduanya bisa dihapus dengan menghapus berkasnya.

## Bukti

Dijalankan sungguhan, ujung ke ujung, tanpa satu kunci API pun:

```
dalang template daftar                → 3 bawaan
dalang template mulai klip-tiga-detik → proyek baru, 4 scene, lulus validate
dalang template ekspor examples/klip-borobudur/plan.json
                                      → "3 aset klip dilepas" dikatakan
dalang template pasang <paket.json>   → muncul di daftar sebagai terpasang
dalang template pakai esai-video <plan.json>
                                      → preset klip-01 → documentary-01,
                                        9:16 → 16:9, caption tegas → klasik,
                                        NARASI TETAP UTUH
dalang template copot esai-video      → ditolak: "adalah bawaan Dalang"
```

Proyek yang lahir dari template `esai-video` **benar-benar dirender**: kartu
judulnya membawa judul proyek baru ("Kenapa Jalan Tol Selalu Macet"), bukan
judul template, dengan tipografi documentary-01 lengkap. Template yang tidak
pernah dirender adalah template yang tidak terbukti menghasilkan video.

Dua puluh lima test menjaga janji-janji yang kalau dilanggar tidak
menghasilkan galat, melainkan kerusakan yang sunyi: paket yang membawa
`assetId` (gambar hilang di komputer orang lain), musik pustaka yang ikut
terbuang (video jadi sunyi tanpa sebab), token lama yang tertinggal saat
tampilan diganti (warna campuran yang bukan tampilan mana pun), scene terkunci
yang ikut berubah, id template berbentuk path, satu berkas rusak yang
mengosongkan seluruh daftar, dan template terpasang yang kalah dari bawaan.

## Batas yang dinyatakan

- **Tidak ada toko.** Tidak ada indeks yang di-host, akun, peringkat,
  pembayaran, moderasi, maupun pemasangan dari URL. Template berpindah sebagai
  BERKAS — disalin, dikirim, atau dimasukkan git. Itu bukan kekurangan yang
  menunggu ditambal dengan kode: toko adalah keputusan produk dan komersial,
  dan membangun etalase yang tidak terhubung ke apa pun akan menghasilkan
  halaman yang terlihat seperti fitur.
- **Template tidak bisa membawa cara MENGGAMBAR baru.** Ia memilih di antara
  preset yang sudah ada (`documentary-01`, `tutorial-01`, `klip-01`); preset
  baru tetap berupa komponen Remotion di dalam repo. Template yang menyebut
  preset yang tidak dikenal akan jatuh ke `documentary-01` dengan peringatan
  di konsol renderer, sama seperti plan mana pun.
- **Paket tidak ditandatangani dan isinya tidak "aman" secara otomatis.** Ia
  divalidasi skema — jadi tidak bisa membawa field asing atau nilai di luar
  rentang — tapi teks di dalamnya (narasi, judul, deskripsi) adalah teks milik
  pembuatnya. Pasang template dari sumber yang kamu percaya, sama seperti
  berkas lain.
- **Belum ada pratinjau template di lobi.** Kartunya menyebut jumlah scene,
  rasio, preset, dan format — bukan gambar. Merender thumbnail menuntut satu
  render nyata per template, dan lobi yang membuka Chromium tiga kali sebelum
  memperlihatkan apa pun bukan lobi yang lebih baik.
- **"Pakai tampilan" tidak menyentuh gaya per elemen.** Warna teks overlay,
  emphasis, dan anim per scene tetap milik plan yang ada; yang berpindah
  adalah keputusan tingkat proyek plus gaya caption. Menimpa setiap elemen
  akan membuat "pinjam tampilannya" berubah jadi "buang penataanku".
