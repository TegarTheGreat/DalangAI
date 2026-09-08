# ADR-0040: Sulih suara — satu plan, banyak bahasa

**Status:** diterima (diterapkan) · **Tanggal:** 8 September 2026 · **Fase:** roadmap §10.3 (lanjutan), sesudah ADR-0039

## Konteks

ADR-0039 menutup subtitle: berkas teks berjalan bersama video, dan penonton
bisa menyalakannya. Yang tetap tidak bisa dilakukan Dalang sesudah itu adalah
hal yang lebih besar: **menerbitkan video yang sama dalam bahasa lain**.

Batas itu sudah dinyatakan di penutup ADR-0039 — "satu plan tetap satu bahasa" —
dan alasannya satu: `meta.language` tunggal dan `scene.narration` tunggal.
Untuk menerbitkan versi bahasa Inggris, satu-satunya cara adalah menyalin
seluruh folder proyek, menimpa narasinya, dan sejak itu memelihara DUA proyek
yang gambarnya harus dijaga tetap sama dengan tangan. Setiap perbaikan visual
harus dikerjakan dua kali, dan yang terlewat baru ketahuan saat ditonton.

Sementara itu jangkauan bahasa adalah alasan paling nyata orang membuat versi
lain: pasar penonton yang berlipat, aksesibilitas, dan — untuk kanal Indonesia —
kemampuan menjangkau penonton yang tidak berbahasa Indonesia tanpa membuat
ulang videonya.

## Keputusan

### 1. Seluruh fitur ini berdiri di atas SATU fungsi: `planInLanguage`

`planInLanguage(plan, "en")` menukar narasi, berkas suaranya, judul, dan teks
layar, lalu mengembalikan sebuah **scene-plan biasa**.

Itu keputusan arsitektural utamanya, dan yang membuat ADR ini kecil. Karena
hasilnya scene-plan biasa, tidak ada satu pun jalur di hilir yang perlu tahu
soal sulih suara: aritmetika durasi, tata letak bingkai, caption karaoke,
berkas subtitle, ducking musik, campuran akhir, ekspor OTIO/FCPXML, dan gerbang
paritas byte semuanya bekerja apa adanya.

Alternatifnya — menyalurkan parameter `language` ke setiap fungsi yang
menyentuh narasi — akan menyentuh puluhan pemanggil, dan satu yang terlewat
akan merender gambar bahasa A dengan suara bahasa B **tanpa satu pun galat**.
Cacat seperti itu tidak punya pesan; ia cuma terdengar salah.

Konsekuensinya renderer hanya perlu satu baris: `language` masuk sebagai opsi,
diterapkan di satu-satunya tempat plan masuk ke renderer. Render lokal, render
Lambda, `still`, dan jalur Studio ikut sadar bahasa sekaligus.

### 2. Durasi IKUT bahasanya — video sulihan boleh berbeda panjang

Kalimat bahasa Inggris jarang butuh waktu ucap yang sama dengan padanannya
dalam bahasa Indonesia. Ada dua cara menghadapinya, dan hanya satu yang jujur:

| Pilihan | Akibatnya |
| --- | --- |
| Gambar tetap, audio dipaksa muat | Ucapan dipercepat/diperlambat. **Terdengar.** |
| Durasi ikut narasinya | Video sulihan lebih pendek atau lebih panjang |

Dipilih yang kedua. Pada contoh `sulih-dua-bahasa`: 20,7 detik (id) dan 18,3
detik (en) — beda 12% dari naskah yang sama. Mempercepat ucapan 12% adalah
suara yang terdengar buru-buru, dan penonton mendengarnya bahkan kalau tidak
bisa menyebut apa yang salah.

Ini bekerja karena `scene.duration` bawaannya `"auto"`: durasi memang sudah
diturunkan dari narasinya. Scene yang durasinya DIPATOK angka tidak ikut
melar — dan kalau sulihannya tidak muat di situ, kaidah sutradara
`sulih-kepanjangan` mengatakannya dengan angkanya.

Yang TIDAK berubah antar bahasa: **susunan videonya**. Scene yang belum
disulih tampil BISU, bukan dibuang. Dua video yang jumlah scene-nya berbeda
bukan lagi satu video yang disulih, dan gerbang CI menuntut jumlah dan urutan
scene-nya sama persis.

### 3. Sulihan tinggal di dalam SCENE, bukan di satu blok terjemahan

`scene.dubs` adalah peta `bahasa -> teks`, di dalam scene-nya sendiri. Begitu
juga `textOverlay.dubs` untuk teks layar. Judul proyek: `meta.dubTitles`.

Letaknya bukan detail. Karena sulihan ada di dalam scene:

- op yang membuang scene ikut membuang sulihannya, dan undo mengembalikan
  keduanya — tanpa satu baris kode tambahan;
- deteksi bentrok ADR-0038 yang berpetak SCENE sudah menutupinya, jadi dua
  orang yang menerjemahkan dua scene berbeda tidak saling menghalangi;
- tidak ada larik id yang harus dijaga sinkron dengan daftar scene.

Blok terjemahan tingkat plan akan butuh ketiganya sebagai kode baru, dan
daftar id yang harus dijaga sinkron selalu menyimpang pada akhirnya.

### 4. Op sendiri: `setDub`, bukan field di `updateScene`

Tiga alasan, semuanya soal pemakaian: log patch-nya terbaca sebagai pekerjaan
penerjemahan ("menyulih narasi sc-003 ke en") alih-alih tenggelam sebagai satu
field di antara sepuluh; `text: null` menghapus satu bahasa tanpa menuntut
pemanggilnya menyusun ulang seluruh peta; dan inversnya persis satu nilai,
jadi mengurungkan penerjemahan tidak ikut mengembalikan perubahan lain yang
kebetulan satu patch.

`textId` opsional menyasar teks layar di scene yang sama. Bawaannya narasi,
karena itu jalur yang jauh lebih sering dipakai.

### 5. Teks LAYAR ikut disulih — kalau tidak, ini bukan video sulihan

Versi pertama fitur ini hanya menyulih narasi. Bingkai hasilnya terdengar
bahasa Inggris sementara bilah atas masih membaca "SEJARAH BOROBUDUR DALAM 60
DETIK" dan chip di bawahnya "ABAD KE-9 · JAWA TENGAH". Suara yang salah
terdengar sekali; **teks yang salah terlihat di setiap bingkai**.

Jadi `meta.dubTitles` dan `textOverlay.dubs` ikut. Yang belum disulih dipakai
APA ADANYA, tidak dikosongkan: bilah atas tanpa judul terlihat seperti preset
yang rusak, sedangkan judul bahasa asli terlihat seperti judul yang belum
diterjemahkan — dan yang kedua itu yang benar. Kaidah `sulih-teks-layar`
menyebutkan mana saja yang tertinggal.

### 6. Suara sendiri per bahasa

`audio.dubVoices` memetakan bahasa ke konfigurasi suara. Bahasa tanpa entri
memakai `audio.voice` apa adanya — bawaan yang jujur tapi jarang benar: suara
Indonesia yang membaca teks Inggris terdengar persis seperti itu. Ketiga
permukaan MENGATAKANNYA saat itu terjadi, karena orang yang tidak diberi tahu
akan mengira itu batas kualitas TTS-nya.

### 7. Tahap sulih membungkus tahap TTS, tidak menyalinnya

`runDubStage` menukar plan ke bahasanya, menjalankan `runTtsStage` yang sudah
ada di atasnya, lalu melipat hasilnya ke `renderState.dubAudio[bahasa]`.

Menyalin isi tahap TTS akan menghasilkan dua tempat yang sama-sama harus tahu
soal cache, rantai fallback, penandaan `fallbackQuality`, pengukuran
kenyaringan, dan penulisan berkas. Yang menyimpang duluan pasti yang jarang
dijalankan — yaitu justru yang ini.

Satu hal yang HARUS ditambahkan ke tahap TTS: `ledgerScope`. Tanpa itu, run
bahasa sulih memakai kunci ledger `(projectId, sceneId, "tts")` yang sama
dengan bahasa utama dan keduanya saling menimpa barisnya — bolak-balik antar
bahasa berarti sintesis ulang setiap kali, dengan tagihan providernya. Bahasa
utama sengaja tidak memakai akhiran, supaya ledger yang sudah ada tetap kena
cache.

### 8. Menerjemahkan adalah pekerjaan AGENT, bukan flag CLI

`dalang sulih` melaporkan keadaan dan menjalankan TTS. Ia **tidak**
menerjemahkan, dan itu disengaja: terjemahan butuh model, butuh biaya, dan
butuh kerajinan yang tidak pantas disembunyikan di balik sebuah flag.

Tool agent `translateNarration` yang mengerjakannya, sekali jalan untuk SELURUH
naskah — bukan satu panggilan per scene. Terjemahan yang baik butuh melihat
naskahnya utuh: istilah harus konsisten, dan panjang tiap kalimat dijaga
terhadap tetangganya. Menerjemahkan scene demi scene menghasilkan sepuluh
terjemahan yang masing-masing benar dan bersama-sama tidak nyambung.

Aturan pertama di prompt-nya bukan soal makna, melainkan **panjang ucapan** —
karena itu yang menentukan apakah videonya masih enak ditonton.

Jawaban model yang tidak bisa diurai TIDAK menghasilkan patch apa pun. Plan
yang tersulih separuh lebih buruk daripada yang belum sama sekali: separuhnya
tampil BISU tanpa satu pun pesan.

## Konsekuensi

**Yang didapat.** Satu proyek menerbitkan video dalam banyak bahasa, dengan
gambar yang dijamin sama karena memang plan yang sama. `dalang sulih`,
`--bahasa` pada `render`/`still`/`validate`/`subtitle`, tab Sulih di Studio,
tool agent `translateNarration`, rute `/api/pipeline/sulih`, dan
`dalang_write_subtitle --bahasa` untuk agent lain.

**Yang dibayar.** Tiap bahasa adalah satu set berkas TTS dan satu render
sendiri — biaya provider dan waktu render berlipat sejumlah bahasanya. Batas 12
bahasa per proyek bukan batas teknis: proyek yang menyimpan lima puluh bahasa
adalah proyek yang tidak ada yang pernah mendengarkan semuanya.

**Yang dibuktikan, bukan diklaim.** Gerbang CI `gate:sulih` menjalankan jalur
penuh: TTS bahasa sulih dengan provider offline, lalu pemeriksaan bahwa tiap
bahasa jadi plan satu-bahasa yang utuh (tanpa sisa `dubs`, `dubAudio`,
`dubVoices`, `dubTitles`), bahwa susunan scene-nya tidak berubah, bahwa
durasinya benar-benar bergeser mengikuti narasinya, dan bahwa tiap kartu
subtitle jatuh di scene asalnya menurut `activeSceneIndex` milik renderer.
Terakhir satu bingkai yang sama dirender DUA kali dan dituntut berbeda byte —
dua PNG identik berarti bahasanya tidak sampai ke layar. Gerbangnya diuji
dengan disabotase: membuat `planInLanguage` berhenti menukar narasi membuatnya
merah.

## Batas yang dinyatakan

- **Musik, efek suara, dan rekaman TIDAK ikut disulih.** Yang berganti hanya
  narasi TTS. Video yang orangnya bicara di kamera akan tetap terdengar
  berbahasa aslinya di bawah narasi bahasa lain; untuk itu yang dibutuhkan
  penggantian trek, bukan sulih narasi.
- **Satu berkas video per bahasa, bukan satu video bertrek banyak.** YouTube
  mendukung beberapa trek audio pada satu video; Dalang merender satu campuran
  per bahasa dan mengunggahnya sebagai video terpisah. Menggabungkannya butuh
  jalur unggah trek audio YouTube yang berbeda dan belum dikerjakan.
- **Terjemahan tidak diperiksa mutunya oleh repo ini.** `translateNarration`
  menyerahkan pekerjaannya ke model, dan yang dijaga Dalang hanya panjang
  ucapannya. Naskah yang penting tetap perlu dibaca manusia yang menguasai
  bahasanya.
- **Anotasi tutorial (ADR-0020) belum punya `dubs`.** Label anotasi tetap
  bahasa aslinya di video sulihan. Preset `tutorial-01` karena itu belum
  sepenuhnya bisa disulih.
- **Nama berkas render tidak menyebut bahasanya.** Merender dua bahasa ke
  folder keluaran bawaan yang sama akan menimpa berkasnya; pakai `-o`.

## Alternatif yang ditolak

**Menyalin folder proyek per bahasa.** Cara yang dipakai orang hari ini, dan
persis masalahnya: dua proyek yang gambarnya harus dijaga sama dengan tangan.

**Menyalurkan `language` ke setiap fungsi.** Puluhan pemanggil, dan yang satu
terlewat merender gambar bahasa A dengan suara bahasa B tanpa satu pun galat.

**Memaksa audio sulihan muat di durasi aslinya.** Berarti mempercepat ucapan,
dan itu terdengar. Video yang panjangnya berbeda adalah harga yang jujur.

**Menerjemahkan scene demi scene.** Istilahnya menyimpang dan panjangnya tidak
terjaga terhadap tetangganya.

**Kunci gabungan `"en:sc-1"` untuk audio sulih.** `planInLanguage` menukar
seluruh peta satu bahasa masuk ke `narrationAudio`, dan peta yang sudah
berbentuk benar bisa dipakai apa adanya. Kunci gabungan menuntut penguraian
string di titik terpanas jalur render, dan pengurai yang salah tanda baca akan
membaca bahasa yang keliru tanpa satu pun galat.
