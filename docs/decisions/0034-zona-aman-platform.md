# ADR-0034: Zona aman platform

**Status:** diterima (diterapkan) · **Tanggal:** 5 September 2026 · **Fase:** 10 (pelengkap §10.3)

## Konteks

Dalang membuat video 9:16, dan tujuan video 9:16 hampir selalu platform sosial.
Platform-platform itu menggambar antarmukanya sendiri **di atas** video: judul
dan nama akun di tepi bawah, rel tombol di tepi kanan, kadang bilah di atas.

Caption Dalang bawaannya duduk di bawah (`caption.position: "bottom"`,
`captionBottom` 316 piksel dari tepi bawah pada 9:16 — sekitar 16% tinggi
bingkai). Itu persis pita yang ditutupi platform. Hasilnya teks menimpa teks.

Yang membuat cacat ini mahal bukan besarnya, melainkan **kapan ia terlihat**:
preview Studio dan berkas hasil render keduanya bersih, karena keduanya tidak
tahu apa-apa soal antarmuka platform. Yang menyunting baru melihatnya setelah
mengunggah — dan yang menonton melihatnya sebelum dia.

Perkakas profesional menyebutnya *title safe* / *action safe*. Dalang tidak
punya konsep itu sama sekali: `aspectMetrics` memberi satu himpunan margin per
rasio, dan tidak ada satu pun jalan bagi plan untuk mengatakan "kosongkan tepi
ini".

## Keputusan

`meta.safeArea` — empat **fraksi** sisi bingkai yang dikosongkan untuk
antarmuka platform tujuan:

```jsonc
"safeArea": { "top": 0.10, "bottom": 0.22, "left": 0, "right": 0.16 }
```

### 1. Fraksi, bukan piksel

Satu plan bisa dirender ke 9:16, 1:1, dan 16:9. "144 piksel" berarti bagian
yang berbeda-beda di ketiganya; fraksi tetap berarti hal yang sama. Batasnya
0–0,4 per sisi: dua sisi berhadapan yang masing-masing 0,5 tidak menyisakan
bidang sama sekali, dan tata letak berlebar nol adalah kegagalan yang muncul
jauh dari sebabnya.

### 2. Angka bebas, BUKAN daftar nama platform

Godaan pertama adalah `"safeArea": "tiktok"`. Ditolak, dan alasannya bukan
kemalasan: repo ini **tidak bisa memverifikasi** ukuran antarmuka TikTok,
Reels, atau Shorts. Angka yang tidak bisa diverifikasi lalu dibekukan sebagai
nama platform akan menua diam-diam — platformnya mengubah tata letak, nama
"tiktok" tetap berarti angka lama, dan pemakainya mengira sudah aman padahal
tidak. Kesalahan yang paling mahal bukan yang keliru, melainkan yang keliru
sambil terlihat berwenang.

Yang bisa dijamin repo ini adalah **aritmetikanya**: sebutkan berapa yang
harus dikosongkan, dan setiap teks akan menghormatinya. Berapa angkanya adalah
pengetahuan pemakainya, dan Studio menampilkan persentasenya apa adanya di
bawah tiap pilihan alih-alih menyembunyikannya di balik nama platform.

### 3. Bawaannya NOL, dan itu bagian dari keputusan

Fitur tata letak yang menyala sendiri akan menggeser setiap plan yang sudah ada
tanpa diminta. Bawaan nol membuat perubahan ini **tidak terlihat sama sekali**
sampai seseorang menyalakannya — dan itu bukan klaim, melainkan hasil ukur:
gerbang paritas migrasi merender tiga bingkai contoh Borobudur SESUDAH
perubahan ini dan mendapat sha256 yang sama persis dengan sebelum
(`2d425140dc3c`, `7de98cc05c9d`, `45d84f4df315`).

### 4. Satu tempat: `aspectMetrics`

Zona amannya disisipkan di `aspectMetrics`, satu-satunya sumber angka tata
letak yang dibaca caption, teks overlay, tempelan, dan chrome. Menyisipkannya
di sana berarti tidak ada satu pun overlay yang bisa **lupa** menghormatinya —
dan overlay yang lupa adalah persis cacat yang fitur ini ada untuk mencegah.
Produksinya cuma tiga pemanggil: dua akar preset dan kanvas Studio.

### 5. Kiri dan kanan jadi satu margin simetris

Diambil yang terbesar dari keduanya. Alasannya bukan penyederhanaan malas:
tata letak Dalang berpusat (caption, judul, kicker semuanya `left: 50%`), jadi
margin asimetris tidak menggeser isinya menjauh dari sisi yang dijaga — ia
hanya membuat kotaknya melebar ke sisi lain. Mengambil yang terbesar untuk
keduanya menjaga isinya tetap di tengah DAN tetap keluar dari rel tombol.

### 6. Zona aman MENAMBAH kelonggaran, tidak pernah mengurangi

Semua nilainya `Math.max` terhadap margin desain. Zona aman yang lebih sempit
daripada margin bawaan tidak boleh diam-diam mengurangi margin itu: kalau
boleh, menyalakannya dengan angka kecil justru membuat tata letak lebih
berbahaya daripada mematikannya — kebalikan dari gunanya.

### 7. Gambarnya tetap penuh

Yang bergeser hanya teks. Mengecilkan gambar demi zona aman membuang bidang
yang justru jadi alasan video vertikal dipakai, dan menghasilkan pita hitam di
tempat yang toh akan ditutupi antarmuka platform.

## Konsekuensi

- Video untuk platform sosial bisa disiapkan **sebelum** diunggah, bukan
  diperbaiki sesudah.
- `setMeta` mengganti zona aman **utuh**, bukan menggabung per sisi: empat sisi
  itu satu keputusan ("video ini untuk platform apa"), dan penggabungan per sisi
  membuat undo satu langkah mengembalikan campuran dari dua keputusan berbeda.
- Bidang teks menyempit. Judul panjang jadi lebih cepat terpotong elipsis —
  terlihat di bukti render di bawah, dan itu memang harganya.

## Bukti

Bingkai yang sama dari contoh `klip-borobudur`, dirender dua kali:

| Tanpa zona aman | `{top: 0,10, bottom: 0,22, right: 0,16}` |
| --- | --- |
| caption menempel di pita bawah | caption naik ke atas pita |
| kicker tepat di bawah chrome | kicker turun mengikuti margin atas |
| judul chrome utuh selebar bingkai | judul terpotong elipsis karena kolomnya menyempit |

**Pitanya digambar di kanvas Studio**, diarsir samar dengan garis batas di
tepi dalamnya — panduan di atas gambar yang sedang disunting, bukan blok pekat
yang menutupinya. Digambar dari `meta.safeArea` LANGSUNG, bukan dari margin
yang berlaku: yang harus terlihat adalah pita yang DIMINTA, sementara margin
yang berlaku sudah dijepit ke margin desain. Tidak ada tombol menyembunyikan —
pitanya hanya muncul saat seseorang benar-benar menyetel zona aman, dan
panduan yang muncul cuma saat diminta tidak perlu tombol untuk tidak diminta.

Gerbang interaksi mengukur ketiga pitanya terhadap kanvas sungguhan lewat CDP,
dengan fraksi yang sengaja berbeda di tiap sisi (7% / 23% / 13%, kiri nol):
pita yang salah dipetakan — atas dipakai untuk bawah, tinggi untuk lebar —
akan tetap lulus kalau keempatnya sama. Versi pertama pemeriksaan itu sendiri
tertipu (ia mengenali pita dari satu tepi saja, dan pita atas juga rata kanan),
melaporkan pita kanan selebar 732 piksel; yang dibetulkan pemeriksaannya, bukan
komponennya.

Lima test aritmetika menjaga sifatnya: bawaan tidak menggeser apa pun, caption
naik keluar pita bawah, rel kanan mempersempit kedua sisi, zona aman kecil
tidak mengurangi margin desain, dan bidang tersisa tetap positif di batas
paling ekstrem skema (0,4 keempat sisi).

## Batas yang dinyatakan

- **Angkanya bukan spesifikasi platform.** Repo ini tidak pernah mengukur
  antarmuka TikTok, Reels, atau Shorts. Pilihan "Sedang" dan "Longgar" di
  Studio adalah cadangan konservatif yang persentasenya ditampilkan, bukan
  hasil pengukuran.
- **Anotasi tutorial-01 tidak ikut bergeser.** Sorotan dan panah berjangkar
  pada koordinat screenshot, bukan pada margin tata letak.
- **Kiri dan kanan tidak bisa asimetris**, lihat §5.
