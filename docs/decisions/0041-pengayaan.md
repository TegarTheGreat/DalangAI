# ADR-0041: Pengayaan — font, filter, efek, transisi, gerak, dan pustaka bunyi

**Status:** diterima (diterapkan) · **Tanggal:** 8 September 2026

## Konteks

Permintaannya sederhana: "perkaya data fonts, filter, efek, suara dan
semacamnya". Audit isi repo menemukan satu lubang yang berbeda kelas dari yang
lain:

| Kategori | Sebelum | Catatan |
| --- | --- | --- |
| Font | 6 keluarga | Cukup luas, tapi tanpa monospace sama sekali |
| Preset warna | 6 | Tidak ada nada gelap maupun matte |
| Efek | tidak ada | Hanya filter CSS; vignette dan butiran mustahil |
| Transisi | 7 | Tujuh, padahal dependensinya menyediakan belasan |
| Gerak kamera | 8 | Semuanya berlaju TETAP — tidak satu pun bisa menekan momen |
| Gaya caption | 4 | — |
| Animasi teks | 4 | — |
| Musik bawaan | 2 bed | Bekerja offline |
| **Efek suara bawaan** | **NOL** | **Hanya Openverse — mati total tanpa jaringan** |

Baris terakhir itu bukan "kurang kaya", melainkan **fitur yang separuh mati**:
seluruh sisa Dalang dirancang berjalan offline, sementara `audio.sfx` menuntut
jaringan untuk bunyi sependek 60 milidetik.

## Keputusan

### 1. Pustaka efek suara BAWAAN — disintesis, bukan diunduh

Delapan bunyi ikut repo: `whoosh`, `pop`, `klik`, `ding`, `tap`, `swipe`,
`impact`, `riser`. Dirujuk `pustaka:<id>`, kosakata yang sama dengan bed musik.

**Disintesis oleh `scripts/buat-sfx.mjs` yang ikut di-commit.** Itu keputusan
lisensi sebelum jadi keputusan teknis: efek suara "gratis" di internet punya
syarat atribusi yang berbeda-beda, dan pustaka yang syaratnya tidak seragam
adalah pustaka yang tidak bisa dipakai tanpa membaca satu per satu. Yang lahir
dari angka jadi CC0 tanpa syarat apa pun.

Pembangkitnya ikut, berbeda dari pembangkit bed musik yang hanya ada di riwayat
repo. Pembangkit yang tidak ikut membuat berkas suaranya jadi data yatim: tidak
ada yang bisa mengubah panjang atau nadanya tanpa menebak ulang cara membuatnya.

Bunyi pustaka **tidak butuh `renderState` sama sekali** — tidak ada yang
diunduh, di-stage, atau dicatat. Itulah yang membuatnya bekerja offline, dan
`placeSfxCues` menandainya `bundled: true` supaya komponen mengalamatkannya
lewat `staticFile` (aset SITUS, ADR-0019) di mana pun render berjalan.

**Kenyaringan dilaporkan hanya untuk bunyi yang cukup panjang.** Empat dari
delapan lebih pendek dari satu blok 400 ms, dan kenyaringan TERINTEGRASI tidak
punya arti di bawah itu. Angka yang dipaksa keluar dari sana akan dipakai orang
seolah-olah berarti; keseragaman kedelapannya dijamin lewat normalisasi PUNCAK
ke -1 dBFS, yang memang bisa diukur untuk bunyi sependek apa pun.

### 2. Efek yang BUKAN filter CSS: vignette dan butiran

Tidak ada fungsi `filter` CSS yang menggelapkan tepi saja atau menambah noise.
Keduanya digambar sebagai LAPISAN — karena itu ia dua angka di
`clip.filter`, bukan dua preset:

- **Vignette** memetakan kekuatan ke OPASITAS tepi, bukan ke jari-jari.
  Vignette yang jari-jarinya berubah akan memotong subjek di tengah pada nilai
  tinggi; yang opasitasnya berubah cuma menggelapkan sudut — yang memang
  gunanya.
- **Butiran** memakai noise SVG ber-seed TETAP, jadi polanya sama di tiap
  bingkai. Butiran yang berubah tiap bingkai terlihat seperti kompresi rusak,
  bukan seperti film — dan ia juga menghancurkan efisiensi enkode, karena tiap
  bingkai jadi berbeda dari tetangganya.

Nol berarti tidak ada lapisan sama sekali, dengan ambang 0,01: sisa nilai dari
slider yang diseret balik akan memasang lapisan penuh bingkai yang tidak
terlihat tapi tetap dibayar compositor tiap bingkai. Karena nol adalah bawaan,
tidak satu pun plan lama bergeser satu piksel — yang dijaga gerbang paritas
byte.

### 3. Transisi: yang ditambahkan KOSAKATA, dan hanya yang benar-benar jalan

`clock-wipe`, `flip-left`, `flip-up` semuanya sudah terpasang di
`@remotion/transitions` sejak lama; yang tidak ada adalah cara plan
menyebutnya.

Yang **sengaja tidak masuk**: `dissolve`, `zoom-blur`, `swap`, `linear-blur`.
Keempatnya presentation berbasis SHADER yang menuntut HTML-in-Canvas, dan
Chromium yang dipakai renderer menolaknya:

```
GAGAL: HTML in Canvas is not supported. Two common causes: Chrome is older
than version 148 (update Chrome), or the HTML-in-Canvas flag is disabled.
```

Itu ditemukan dengan **merender**, bukan dari tipenya — TypeScript menerima
keempatnya tanpa satu pun keluhan, dan keempatnya sempat masuk enum sebelum
render pertama menjatuhkannya. Menawarkan transisi yang menggagalkan render
lebih buruk daripada tidak menawarkannya.

### 4. Gerak yang punya AKSEN

Delapan gerak lama semuanya berlaju tetap dari awal ke akhir: enak untuk latar,
tapi tidak satu pun bisa menekan sebuah momen. Tiga yang baru bisa:

- `punch-in` zum cepat di 22% pertama lalu **DIAM**. Berhentinya itu yang jadi
  penekanan; gerak yang tidak pernah berhenti tidak menunjuk apa pun.
- `tilt` memiringkan pelan — kesan kamera di tangan, bukan di tripod. Sudutnya
  sengaja di bawah 0,6 derajat: di atas satu derajat, tepi bingkai mulai
  terbaca sebagai kemiringan yang salah, bukan sebagai gerak.
- `pan-diagonal` menggeser dua sumbu sekaligus.

`tilt` memaksa `MotionTransform` menumbuhkan field `rotate`, sebagai properti
CSS mandiri — bukan digabung ke satu string `transform`. Properti mandiri bisa
dianimasikan dan ditimpa satu per satu; satu string `transform` menuntut setiap
penulisnya menyusun ulang seluruh rantainya.

### 5. Dua gaya caption dan dua animasi teks

- `pita` menaruh SELURUH baris di atas pita solid, menempel pada barisnya
  (bukan pada bloknya, supaya baris kedua yang pendek tidak menyeret kotak
  besar berisi ruang kosong). Gaya berita yang tetap terbaca di footage
  seramai apa pun, karena keterbacaannya tidak bergantung pada gambar di
  belakangnya. Warnanya `palette.plate` yang baru — terpisah dari `accent`,
  karena pita harus gelap dan netral sementara aksen harus menarik perhatian;
  satu warna untuk keduanya memaksa memilih antara pita menyilaukan atau
  aksen tak terlihat.
- `karaoke` menyisakan JEJAK: kata yang sudah lewat tetap beraksen (berbeda
  dari `klasik`, yang mengembalikannya ke warna biasa), jadi penonton bisa
  mengejar kalimat yang terlewat sekilas.
- `blur-in` masuk dari kabur ke tajam — pintu masuk tenang untuk teks panjang,
  sementara `pop` dan `rise` selalu terasa energik. Blur dipatok tepat nol di
  akhir; sisa 0,04em membuat judul besar tidak pernah benar-benar tajam, dan
  itu terlihat.
- `slide-in` menggeser blok dari sisi.

### 6. Tiga font, dipilih dari CELAH bukan dari jumlah

Pertanyaan sebelum menambah satu font: kalimat apa yang hari ini **tidak bisa**
disusun dengan enam yang sudah ada.

- **JetBrains Mono** — tidak ada monospace sama sekali, padahal preset
  `tutorial-01` seluruhnya tentang layar dan kode.
- **Playfair Display** — serif kontras tinggi untuk judul; Fraunces hangat dan
  Lora tenang, tidak satu pun mewah.
- **Manrope** — sans geometris hangat untuk badan teks; Inter netral dan Space
  Grotesk teknis.

Semuanya variable font berlisensi OFL, ter-vendor seperti enam lainnya jadi
render tetap berjalan offline.

## Konsekuensi

**Yang didapat.** 9 font, 11 preset warna, 2 efek lapisan, 10 transisi, 11
gerak, 6 gaya caption, 6 animasi teks, dan 8 efek suara yang bekerja tanpa
jaringan. Semuanya lewat kosakata `plan` yang sama, jadi agent, Studio, dan CLI
mendapatkannya sekaligus tanpa permukaan baru.

**Yang dibayar.** Repo tumbuh 1,1 MB: 653 KB tiga font dan 432 KB delapan
bunyi. Itu harga "berjalan offline" — dan sudah harga yang ditawar, karena bed
musiknya 22 kHz dan bunyinya mono.

**Yang dibuktikan, bukan diklaim.** Gerbang CI `gate:pengayaan` merender
bingkai yang sama tiga kali — polos, ber-vignette, berbutir — lalu MENGUKUR
hasilnya: vignette wajib menggelapkan sudut relatif terhadap tengah TANPA
menambah tekstur, butiran wajib menaikkan beda piksel bertetangga TANPA
menggelapkan sudut. Dua tuntutan yang saling menyilang itu diuji dengan
disabotase — menukar implementasi keduanya membuat KEEMPAT pemeriksaan merah
sekaligus.

Satu tes lama juga menangkap kelalaian nyata: `sfx/` sempat tidak terdaftar di
`SITE_ASSET_DIRS`, yang berarti bunyinya berbunyi di render dan 404 di preview
Studio. Tes itu memang ditulis untuk kelas cacat itu, dan ia bekerja.

## Batas yang dinyatakan

- **Transisi shader tidak tersedia**, dan tidak akan sampai renderer memakai
  Chrome 148+ dengan HTML-in-Canvas menyala. Empat transisi paling sinematik
  di `@remotion/transitions` ada di balik pintu itu.
- **Vignette dan butiran hanya berlaku pada visual dasar dan lapisan video.**
  Preset `tutorial-01` tidak memakai `clip.filter` sama sekali — panggung
  tangkapan layarnya digambar dengan cara lain — jadi efek ini tidak
  menyentuhnya.
- **Bunyi bawaan disintesis, dan terdengar seperti itu.** Delapan bunyi ini
  cukup sebagai aksen; ia bukan pengganti pustaka Foley sungguhan, dan tidak
  ada yang mengklaim begitu. Openverse tetap jalur untuk bunyi bernuansa.
- **Butiran STATIS.** Ia tidak berkedip antar bingkai, dan itu keputusan
  (lihat §2) — bukan pendekatan. Butiran film sungguhan bergerak; yang ini
  tidak.
- **Angka LUFS empat bunyi pendek tidak ada**, dan itu bukan data yang belum
  diisi. Normalisasi kenyaringan tetap melewatinya; volumenya diatur `volume`
  cue.

## Alternatif yang ditolak

**Mengunduh pustaka SFX dari internet.** Syarat atribusinya berbeda-beda, dan
pustaka yang harus dibaca satu per satu tidak bisa dipakai dengan tenang.

**Vignette sebagai preset warna.** Ia bukan warna, dan ia harus bisa dipakai
BERSAMA preset mana pun. Sebagai preset, "noir + vignette" akan butuh preset
gabungan sendiri, lalu "senja + vignette", dan seterusnya.

**Butiran yang berubah tiap bingkai.** Terlihat seperti kompresi rusak dan
menghancurkan efisiensi enkode. Yang dicari orang saat menyalakan butiran
adalah tekstur film, bukan noise sensor.

**Menambah font sampai belasan.** Pilihan yang terlalu banyak membuat orang
memilih yang pertama. Tiga yang ditambahkan masing-masing menutup celah yang
bisa disebut dalam satu kalimat.

**Memasukkan transisi shader dan mendokumentasikan "butuh Chrome baru".**
Transisi yang menggagalkan render bukan fitur dengan syarat, melainkan jebakan
dengan catatan kaki.
