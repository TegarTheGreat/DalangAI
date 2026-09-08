# ADR-0035: Preset klip-01 — konten pendek punya bahasa visualnya sendiri

**Status:** diterima (diterapkan) · **Tanggal:** 8 September 2026 · **Fase:** pelengkap ADR-0017

## Konteks

Format konten masuk ke Dalang lewat [ADR-0017](0017-agent-berkerajinan.md):
lima format (edukasi, tutorial, klip, berita, cerita), masing-masing dengan
kaidah penulisan dan kritiknya sendiri. Agent sejak itu tahu bahwa klip harus
9:16, caption "tegas", dan dibuka hook — bukan kartu judul.

Yang tidak ikut masuk waktu itu: **rumah visualnya.** Preset hanya ada dua —
`documentary-01` dan `tutorial-01` — jadi setiap plan berformat "klip"
dirender oleh documentary-01.

Itu bukan sekadar "kurang pilihan". documentary-01 dirancang untuk keadaan
menonton tertentu dan seluruh keputusannya mengikuti keadaan itu: layar besar,
suara menyala, penonton yang sudah memutuskan untuk menonton sampai selesai.
Grain, vignette, gradien keterbacaan, dolly lambat, serif editorial, kartu
judul kata-demi-kata — semuanya benar untuk esai video.

Klip vertikal ditonton dalam keadaan yang **berlawanan di hampir setiap
sumbu**: layar kecil, dipegang dekat, suara mati, sambil berjalan, oleh jempol
yang sedang mencari alasan untuk menggeser. Tiga dari keputusan documentary-01
justru merugikan di situ:

1. Grain dan vignette **meredupkan** gambar. Di umpan media sosial, gambar
   redup adalah gambar yang dilewati.
2. Kartu judul yang membangun suasana selama satu setengah detik memakai
   seluruh anggaran perhatian yang ada — hal yang kaidah agent sendiri sudah
   melarang di naskahnya, tapi tetap terjadi di gambarnya.
3. Caption serif berukuran sedang dirancang untuk didengar sambil dibaca,
   bukan untuk dibaca menggantikan suara.

Jadi format dan tampilannya bertentangan, dan yang menang selalu tampilannya.

## Keputusan

Preset ketiga, `klip-01`, dengan bahasa visual "layar penuh, kalimat berat".

### 1. Keterbacaan dibeli dengan bobot huruf, BUKAN dengan meredupkan gambar

Tidak ada `FilmGrain`, `Vignette`, maupun `ReadabilityGradients` di akar
komposisi. Ini keputusan, bukan kelalaian, dan ditulis begitu di kodenya
supaya tidak "diperbaiki" oleh yang mengira ketiganya lupa dipasang.

Penggantinya: pelat gelap seukuran kalimatnya di belakang caption, plus huruf
tebal ber-stroke. Yang digelapkan hanya sepetak bidang di belakang teks;
sisanya tetap terang.

### 2. Pelat MEMELUK teksnya

Lebar pelat mengikuti panjang kalimat (`max-content`), dijepit
`PLATE_WIDTH_FRACTION` (86% lebar bingkai). Pelat berlebar tetap membuat baris
pendek — dan di konten pendek sebagian besar baris memang pendek — duduk di
tengah bilah kosong yang terbaca sebagai elemen antarmuka yang belum jadi.

`max-content` dan bukan `fit-content`: elemennya berjangkar di `left: 50%`,
sehingga ruang yang dianggap tersedia hanya separuh bingkai, dan `fit-content`
akan melipat kalimat yang sebenarnya muat satu baris. Ini bukan kehati-hatian
teoretis — versi pertamanya memakai `fit-content` dan benar-benar melipat.

### 3. Kata aktif ditandai GERAK, bukan hanya warna

`wordPop` memberi pembesaran sesaat yang lalu pulang saat kata menyala. Warna
hilang begitu gambar di belakangnya kebetulan sewarna aksen; gerak terlihat di
latar apa pun.

Hentakan dipasang pada pembungkus, **bukan** menimpa `captionStyleSpec`
(ADR-0016). Gaya pilihan pemakai karena itu tetap utuh, dan keduanya bersusun:
hentakan saat kata datang, lalu duduk di ukuran aktif gayanya.

### 4. Kartu hook, bukan kartu judul yang dipercepat

Seluruh judul masuk sekaligus dalam 6 frame (0,2 detik) dengan sentakan skala.
Tidak ada kicker, tidak ada garis yang tumbuh pelan, tidak ada masuk
kata-demi-kata. Yang menyusul hanya satu baris penjelas, dan itu pun boleh
kosong.

Display-nya **Anton**, bukan Fraunces: Fraunces menahan mata, Anton menghentak.

### 5. Garis retensi di tepi ATAS

documentary-01 menaruh judul dan penomoran scene di chrome-nya. Di layar
vertikal, tiap piksel tepi diperebutkan dengan antarmuka platform
([ADR-0034](0034-zona-aman-platform.md)), dan judul yang sudah ada di kartu
hook tidak perlu diulang sepanjang video. Yang berguna bagi penonton konten
pendek cuma satu: berapa lama lagi.

Di tepi **atas** karena tepi bawah adalah wilayah tombol dan keterangan
platform.

### 6. Yang dipinjam, dipinjam apa adanya

`Backdrop`, `ClipStrip`, `TextsOverlay`, `GraphicsOverlay`, `LayersOverlay`,
`captions-model`, dan seluruh model audio dipakai tanpa disalin. `KlipTheme`
sengaja dibuat superset dari `DocTheme` supaya `Backdrop` — mesin seni
prosedural sekaligus pemutar media yang sudah diuji — bisa dipakai langsung.

Preset memiliki cara **menggambar**-nya sendiri, dan meminjam mesin yang sudah
ada. Seam yang sama dipakai tutorial-01.

`TextsOverlay` khususnya: tampilan teks overlay diputuskan oleh plan lewat
sistem "look"-nya sendiri (ADR-0011/0013). Menyalinnya akan membuat satu teks
yang sama terlihat berbeda hanya karena presetnya berganti — kebalikan dari
yang diharapkan siapa pun yang mengganti preset.

### 7. Gerak tetap milik plan

Preset ini tidak memaksakan gerak yang lebih cepat. `motionTransform` membaca
`clip.motion` dari plan, dan itu tetap keputusan penyunting, bukan preset.
Yang diubah preset adalah cara MENGGAMBAR, bukan cara bergerak.

## Konsekuensi

- Format "klip" akhirnya menghasilkan video yang terlihat seperti klip. Plan
  lama berformat "klip" **tidak** berubah sendiri: `stylePreset` adalah field
  plan, jadi yang sudah ada tetap dirender documentary-01 sampai seseorang
  menggantinya.
- Kaidah agent sekarang menyuruh set `stylePreset: "klip-01"` bersama
  `format: "klip"`. Agent yang tidak menurut tetap menghasilkan plan yang sah.
- Anton adalah berkas **statis** satu bobot, bukan variable font. Ia sudah
  ter-bundle sejak ADR-0016, jadi tidak ada berkas baru.
- Tiga preset berarti tiga permukaan yang harus tahu: registry renderer,
  Segmented Studio, kartu lobi, warna aksen kartu proyek, dan kaidah agent.
  Semuanya sudah didaftarkan.

## Bukti

Dirender sungguhan dari contoh `klip-borobudur` dengan `stylePreset` diganti,
zona aman 7%/20%/14%, tanpa satu kunci API pun.

Dua cacat ditemukan dengan **merender**, bukan dengan membaca kode:

| Cacat | Yang terlihat | Sebabnya |
| --- | --- | --- |
| `lineHeight: 0.98` | Dua baris judul benar-benar saling menimpa — koma baris atas ditubruk caps baris bawah | Anton punya caps tinggi tanpa ruang bawah yang lega |
| Pelat selebar bidang | Kalimat pendek duduk di tengah bilah kosong | Lebar diambil dari bidang tersedia, bukan dari teksnya |

Perbaikan pertama cacat kedua (`fit-content`) menimbulkan cacat ketiga:
kalimat yang muat satu baris jadi melipat dua. Sebabnya jangkar `left: 50%`
membuat ruang yang dianggap tersedia hanya separuh bingkai. Yang benar
`max-content`. Ketiganya hanya terlihat karena bingkainya benar-benar
dirender.

`examples/klip-hook/` masuk gerbang render CI (tiga bingkai: teks hook penuh,
caption berpelat di tengah kalimat, chip outro), jadi regresi visual preset ini
tertangkap tanpa ada yang perlu merender manual. Contohnya **tanpa satu berkas
aset pun** — seluruh latarnya prosedural — sehingga ia sekaligus menjalankan
jalur offline-first dan tidak menambah berkas biner ke repo.

Contoh itu juga menutup pertentangan yang ditemukan validator repo ini
sendiri: versi pertamanya dibuka kartu judul, dan `dalang validate`
memperingatkan bahwa klip pendek tidak punya waktu untuk itu. Kaidahnya benar
dan tetap benar meski kartunya mendarat 0,2 detik — yang mahal bukan
animasinya melainkan detik-detik scene yang dipakai untuk judul. Contohnya
yang diperbaiki, bukan kaidahnya, dan `HookScene` tetap ada untuk plan yang
memang memuat kartu judul.

Empat belas test menjaga matematika murninya. Yang dijaga bukan "angkanya enak
dilihat" — itu penilaian mata, dan buktinya bingkai — melainkan sifat yang
kalau rusak menghasilkan cacat yang tidak akan pernah dilacak kembali ke
fungsinya:

- hentakan yang tidak pernah pulang membuat kalimat tumbuh terus sepanjang
  halaman caption;
- hentakan yang turun di bawah 1 membuat kata yang sedang dibacakan justru
  mundur dari mata;
- `retentionProgress` pada plan tanpa durasi menghasilkan `width: "NaN%"` —
  garis retensi hilang tanpa satu pun pesan;
- `hookFontSize` yang tidak monoton membuat judul lebih panjang kadang lebih
  besar.

## Batas yang dinyatakan

- **Preset tidak mengubah gerak, transisi, maupun durasi.** Klip yang
  potongannya panjang dan transisinya lambat akan tetap terasa lambat meski
  memakai preset ini. Yang bisa dijamin preset adalah tampilan; irama tetap
  keputusan plan.
- **Angka zona aman tetap bukan spesifikasi platform** (ADR-0034 §2). Preset
  ini menghormatinya, tapi tidak menebak berapa yang benar untuk TikTok,
  Reels, atau Shorts.
- **Anotasi tutorial tidak dirender preset ini.** Sorotan dan panah adalah
  milik tutorial-01; plan berformat klip yang memuat anotasi akan kehilangan
  anotasinya tanpa peringatan di gambar (Inspector Studio sudah menyebutkan
  preset aktifnya).
- **Kartu hook memakai `meta.title`, bukan teks hook per scene.** Teks hook
  yang disarankan kaidah agent dipasang sebagai teks overlay scene pertama dan
  dirender `TextsOverlay`; kartu hook menampilkan judul proyeknya.
