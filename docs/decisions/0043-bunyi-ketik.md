# ADR-0043: Bunyi ketik — satu ketukan tuts per huruf, tepat di bingkainya

**Status:** diterima (diterapkan) · **Tanggal:** 3 Oktober 2026

## Konteks

Pertanyaannya: apakah Dalang sudah bisa membuat bunyi ketik keyboard yang lazim
di video kreator YouTube bisnis dan keuangan — kalimat kunci diketikkan di layar
sambil berbunyi "tak-tak-tak"? (Video-video kreator itu tidak bisa saya tonton;
deskripsinya datang dari yang meminta.)

Jawabannya sebelum ADR ini: **belum, dan tidak bisa dirakit dari bagian yang
ada**. Alasannya konkret, bukan soal selera:

- Animasi teks `typewriter` sudah ada, tetapi bisu.
- Pustaka bawaan hanya punya `klik` (60 ms) dan `tap` (140 ms): satu ketukan
  tunggal, bukan rentetan.
- Satu ketukan per huruf berarti satu cue per huruf, dan `audio.sfx` dibatasi
  24 cue per plan. Kalimat 40 huruf tidak muat.
- Satu rekaman panjang yang ditempel kira-kira tidak selaras: huruf tampil tiap
  3 bingkai persis, ketukan rekaman tidak.

Dua temuan sampingan muncul saat mengukurnya, dan keduanya ikut ditutup:

1. **`tutorial-01` tidak memutar efek suara APA PUN.** Cue `pustaka:impact` di
   detik 0,5 terukur senyap total di video jadi (puncak -90 dBFS), sedangkan
   plan yang sama dengan preset `documentary-01` memuncak di -10 dBFS. Cue itu
   diterima skema, tampil di Studio, dan lolos `validate`. Blok pemutar efek
   suara dulu disalin tangan ke tiap preset, dan satu preset tidak mendapat
   salinannya.
2. **Teks `typewriter` memudar masuk selama 14 bingkai**, seperti teks lain.
   Huruf-hurufnya sudah muncul utuh pada gilirannya, tetapi seluruh blok setengah
   transparan — jadi empat-lima ketukan pertama berbunyi sebelum hurufnya
   terlihat jelas.

## Keputusan

### 1. Bunyi diturunkan dari TEKS, bukan disimpan sebagai cue

Dua field baru di `textOverlay`: `sound` (`none` | `ketik`) dan `soundVolume`
(0-1, bawaan 0,6). Bawaan `none`, jadi tidak satu plan lama pun berubah.

Karena diturunkan dari teksnya, memindahkan teks, menyunting isinya, atau
memanjangkan scene membuat bunyinya ikut tanpa satu angka pun disunting ulang.
Cue yang ditulis tangan akan usang pada suntingan pertama, dan bunyi ketik yang
usang terdengar sebagai keyboard yang mengetik kalimat yang bukan kalimatnya.

`sound` berupa enum, bukan boolean: bunyi iringan teks lain (notifikasi, mesin
ketik) datang sebagai nilai baru tanpa mengubah bentuk data.

### 2. Satu sumber untuk jadwalnya

`TYPEWRITER_FRAMES_PER_CHAR = 3` (core) dibaca oleh tiga pihak yang HARUS
sepakat: animasi (kapan huruf tampil, lewat `typewriterRevealFrame`), penempatan
bunyi (kapan ketukan berbunyi), dan kritik sutradara (apakah teksnya sempat
selesai). Tiga salinan angka itu akan menyimpang pada perubahan pertama, dan
simpangan tiga bingkai antara huruf dan bunyinya terdengar.

Fungsi murninya hidup di `typewriter.ts` tanpa Remotion, supaya `sfx.ts` — yang
juga diimpor agent dan MCP — tidak menarik Remotion ke sana.

### 3. Bahan bunyi: empat ketukan huruf dan satu spasi, disintesis

`scripts/buat-sfx.mjs` menyintesis `ketik-1..4` dan `ketik-spasi` dengan tiga
bagian yang memang ada pada keyboard mekanik: klik saklar (letupan lebar
1-2 ms), thock badan (resonansi 150-450 Hz yang meluruh ~45 ms), dan klik lepas
tuts (~65 ms kemudian). Spasi lebih dalam dan lebih panjang, dengan gemeretak
penstabil. Empat varian dipakai bergantian (tak pernah sama dengan sebelumnya)
dan volume tiap ketukan divariasikan 0,82-1,0 secara deterministik — telinga
langsung menangkap satu sampel yang diulang sepuluh kali per detik.

Mereka BUKAN bagian `BUNDLED_SFX`: orang tidak memilih "ketik-3" dari pustaka;
bahan ini hanya disusun otomatis. Ke-8 bunyi lama dibangkitkan ulang
byte-per-byte sama (diperiksa), jadi tidak ada yang berubah selain lima berkas
baru.

### 4. Satu komponen pemutar efek suara untuk semua preset

`SfxLayer` menggantikan blok salinan di `documentary-01` dan `klip-01`, dan
dipasang di `tutorial-01`. `placeSfxCues` membawa ketukan di daftar yang sama,
jadi preset mana pun yang memutar efek suara otomatis memutar ketukan.

### 5. Teks `typewriter` tidak memudar masuk

Awal rampa opasitas digeser mundur sebesar rampanya, jadi pada bingkai pertama
teks sudah penuh. Keluarnya tetap memudar. Ini perubahan tampilan untuk plan
lama yang memakai `typewriter`, dan disengaja.

### 6. Dua aturan kritik

- `ketik-tanpa-typewriter`: `sound: "ketik"` pada animasi lain. Skemanya sah,
  videonya SENYAP, tanpa pesan apa pun.
- `ketik-terpotong`: huruf muncul 10 per detik, jadi teks 60 huruf butuh 6
  detik; jendela yang lebih pendek memotongnya di tengah kalimat — dengan atau
  tanpa bunyi. Pesannya menyebut berapa huruf yang sempat tampil.

### 7. Gerbang yang mengukur video jadi

`gate:ketik` merender video sungguhan di ketiga preset dan mengukur DARI FILE:
bingkai tempat huruf tampil (piksel magenta bertambah) dan waktu tiap ketukan
(onset audio). Kontrolnya plan yang sama dengan `sound: "none"`, yang harus
senyap.

## Konsekuensi

**Dibuktikan, bukan diklaim.** Pada kalimat 62 huruf dengan jendela yang
memotongnya di huruf ke-45 (jadi ia juga menguji aturan "huruf yang tak sempat
tampil tidak berbunyi"):

| Preset | Ketukan terdengar | Terlambat dari huruf | Simpangan antar-ketukan | Huruf terlihat di kisi |
| --- | --- | --- | --- | --- |
| documentary-01 | 45 dari 45 | 43 ms | 0 ms | 30 dari 36 |
| klip-01 | 45 dari 45 | 43 ms | 0 ms | 34 dari 36 |
| tutorial-01 | 45 dari 45 | 43 ms | 0 ms | 24 dari 36 |

Kontrol tanpa `sound`: 0 ketukan. Semua huruf yang terdeteksi tampil di kisi
jadwal tiga bingkai; tidak satu pun di luarnya.

Gerbangnya diuji dengan disabotase: menggeser ketukan 2 bingkai mengubah
keterlambatan terukur menjadi 110 ms (gagal, batasnya 80); mencabut `SfxLayer`
dari `tutorial-01` mengubah ketukannya menjadi 0 dari 45 (gagal, dengan pesan
"preset ini tidak memutar efek suara sama sekali").

**Biaya render.** Satu elemen audio per ketukan, dibatasi umurnya ke panjang
sampelnya. Terukur pada video 5 detik 540p dengan cache bundel hangat, dua kali
jalan masing-masing: 11,7 dan 11,0 detik dengan 45 ketukan, 9,7 dan 9,7 detik
tanpa — tambahan sekitar 1,3-2 detik, atau 0,03-0,04 detik per ketukan.
Angka itu hanya untuk satu ukuran; untuk plan dengan ratusan ketukan biayanya
belum diukur.

## Batas yang dinyatakan

- **Bunyinya disintesis dan BELUM PERNAH DIDENGAR manusia.** Yang diukur adalah
  bentuk gelombang dan spektrumnya: serangan 0,2-0,6 ms, klik membawa 43-49%
  energi di atas 2 kHz pada 5 ms pertama, thock sekitar 14 dB di bawah klik pada
  huruf (8 dB pada spasi, yang memang lebih dalam). Itu bukti bentuknya masuk akal, BUKAN bukti bunyinya mirip keyboard
  yang disukai. Pengetahuannya hidup di `buat-sfx.mjs` (parameter `tuts`):
  yang punya telinga bisa menyetel nada, kecerahan, dan keseimbangan klik-thock
  tanpa menebak ulang cara membuatnya. Untuk bunyi tuts rekaman sendiri, jalurnya
  tetap `addAudioTrack` dengan penyelarasan manual.
- **Laju ketik tetap 10 huruf per detik** dan tidak bisa diatur. Itu laju
  animasi `typewriter` sejak ADR-0016; bunyinya mengikuti, tidak memutuskan.
- **Semua audio keluaran Dalang terlambat sekitar 43 ms terhadap videonya.**
  Terukur di tiap cue (0, 1000, 2500 ms) pada render apa pun: onset di 43,1
  ms. Penyebabnya penyandian AAC yang tidak diimbangi (berkas tanpa daftar
  suntingan untuk audio). Di bawah ambang kepekaan untuk audio yang terlambat,
  dan sama untuk narasi, musik, dan efek, jadi keselarasan RELATIF terjaga —
  tetapi ini sifat seluruh keluaran, bukan bunyi ketik, dan belum diperbaiki.
  Gerbang mengukur selisih konstan (batas -10..80 ms) dan simpangannya (batas
  setengah bingkai), bukan nol mutlak.
- **Belum ada bunyi untuk animasi lain** (per-kata `pop`/`rise`). Enum siap
  menerimanya.
- **Tidak ikut ekspor interop.** Ketukan disusun saat render dari teksnya, jadi
  tidak ada cue yang bisa diseberangkan; catatan ekspor menyebutnya (`bunyi-ketik`).
- **Belum diuji di Player Studio.** Komponennya sama dengan render, tetapi tidak
  ada gerbang yang memutar Studio dengan teks bersuara.
- **Ambang deteksi huruf di gerbang menangkap 24-34 dari 36 huruf** (huruf tipis
  seperti "i" dan "l" lolos). Cukup untuk membuktikan kisi dan awalnya, bukan
  untuk membuktikan setiap huruf; keselarasan tiap ketukan diukur dari audio,
  yang tidak punya batas itu.
- **Menyalakannya di semua teks membuat video berisik.** Prompt agent menyarankan
  satu-dua momen per video.

## Alternatif yang ditolak

**Cue per huruf di `audio.sfx`.** Terbentur batas 24, dan usang pada suntingan
pertama.

**Satu rekaman panjang yang ditempel.** Tidak selaras dengan jadwal tiga bingkai,
dan panjangnya tidak mengikuti panjang teks.

**WAV gabungan yang disusun pipeline per teks.** Satu elemen audio per teks
memang lebih ringan, tetapi butuh tahap pipeline baru, kolom renderState baru,
unggahan Lambda baru, dan jalur terpisah untuk Player — empat bagian bergerak
untuk menghemat beberapa elemen audio yang terukur tidak memperlambat render.

**Sampel rekaman sungguhan yang dibundel.** Mungkin lebih alami, tetapi syarat
lisensinya harus dibaca satu per satu (alasan yang sama dengan ADR-0041), dan
sampel mentah rekaman mengetik harus dipotong jadi ketukan tunggal — pekerjaan
yang tidak bisa diverifikasi tanpa telinga.

**`sound` sebagai boolean.** Menutup pintu untuk bunyi iringan teks yang lain.
