# ADR-0042: Rekaman memenuhi bingkai — `objectFit` lewat prop, dan uji promo sungguhan

**Status:** diterima (diterapkan) · **Tanggal:** 3 Oktober 2026

## Konteks

Pertanyaannya: apakah Dalang sudah handal untuk orang yang membuat video
promosi secara profesional? Menjawabnya dari kode tidak cukup — hampir semua
gerbang CI merender kartu, teks, dan latar prosedural, bukan rekaman. Jadi
pertanyaan itu dijawab dengan cara yang paling jujur: mencari seperti apa video
promosi sekarang, membuat satu dengan alat yang ada, merendernya, dan
melihat hasilnya.

Uji itu menemukan cacat dalam hitungan menit. Rekaman 16:9 yang dipasang di
proyek 9:16 tampil sebagai **pita kecil di tengah bingkai**, dengan warna latar
mengisi bagian atas dan bawah. Tidak ada galat, tidak ada peringatan, dan
`dalang validate` melaporkan plan-nya sehat.

## Penyebab

`<Video>` dari `@remotion/media` (4.0.518) menimpa `style.objectFit` dengan
prop `objectFit`-nya sendiri:

```js
const actualStyle = { ...style, objectFit: objectFitProp };   // preview
objectFit: objectFit ?? "contain",                            // render
```

Backdrop (`documentary-01/Backdrop.tsx`, dipakai juga oleh `klip-01`) dan
`LayersOverlay` menulis `objectFit: "cover"` di `style`. Untuk `<Img>` itu
benar. Untuk `<Video>` itu diabaikan, dan Remotion sendiri mencatat peringatan
"Use the `objectFit` prop instead of the `style` prop" — yang tidak terbaca
siapa pun karena keluar di log render.

Dua akibatnya:

1. Rekaman landscape di bingkai vertikal (kasus paling umum untuk konten
   promosi) selalu `contain`.
2. `layer.fit` di skema, yang bawaannya `"cover"`, tidak berpengaruh apa pun
   pada lapisan video.

Cacat ini lolos karena dua hal: stok diminta dalam orientasi yang sama dengan
bingkai (`orientationForAspect` di tahap aset), jadi rekaman dari penyedia
jarang berbeda rasio; dan tak satu pun gerbang merender VIDEO pada rasio yang
berbeda dari rekamannya. Rekaman milik sendiri — yang paling lazim untuk
konten promosi — tidak melewati penyaring orientasi itu.

## Keputusan

1. `objectFit` dilewatkan sebagai **prop**: `"cover"` untuk visual dasar,
   `layer.fit` untuk lapisan. `style` untuk `<Video>` tidak lagi memuatnya.
2. Gerbang baru `gate:footage` (`packages/renderer/scripts/footage-gate.mts`):
   membuat dua rekaman polos 16:9 (merah, hijau), merender bingkai 9:16 di
   kedua preset, lalu MENGUKUR piksel:
   - keempat sudut bingkai harus didominasi warna rekaman, bukan warna latar;
   - bagian atas kotak lapisan harus berwarna rekaman lapisan.

   Pemeriksaannya berdasarkan dominasi kanal warna, bukan kecerahan, karena
   `documentary-01` menggelapkan sudut dengan gradien keterbacaan dan vignette.
3. Gerbang itu masuk CI sebagai langkah tersendiri.

## Konsekuensi

**Dibuktikan, bukan diklaim.** Tanpa perbaikan, gerbang merah di keempat
pemeriksaan (sudut jadi biru latar `rgb(0,0,255)`, atas kotak lapisan biru);
dengan perbaikan, hijau. Hasilnya juga diperiksa pada FILE mp4 akhir (1080x1920,
dibongkar dengan ffmpeg), bukan hanya still.

**Yang TIDAK dicakup.**

- Rekaman yang dari sumbernya sudah memuat pita hitam (film berformat 2,35:1
  dalam kontainer 16:9) tetap menampilkan pita itu setelah `cover`. Dalang
  belum mendeteksi pita bawaan sumber; jalan keluarnya zoom kamera lewat
  keyframe.
- Pemain pratinjau Studio memakai jalur kode yang sama (prop yang sama), tetapi
  tidak ada gerbang yang merender Studio dengan rekaman. Itu belum diuji.

## Percobaan yang ditolak: `colorSpace: "bt709"`

Keluaran H.264 Dalang ditandai `yuvj420p`, rentang penuh, matriks BT.601
(sebabnya: bingkai dikirim ke ffmpeg sebagai JPEG, dan JPEG adalah YCbCr 601
berentang penuh). Itu tidak lazim untuk HD. Percobaan pertama: menambah
`colorSpace: "bt709"` pada `renderMedia`.

Diukur dengan kuning merek `#FFD60A` pada profil draf yang sama, median piksel
bidang kuning:

| Berkas | Dibaca menurut tandanya | Dibaca pemutar yang mengira 709 |
| --- | --- | --- |
| Bawaan (601, rentang penuh) | (254, 213, 9) | (255, 205, 0) |
| `colorSpace: "bt709"` | (255, 204, 0) | (255, 204, 0) |

Bendera itu hanya mengganti tanda dan rentang tanpa menghitung ulang matriks,
jadi hasilnya KONSISTEN SALAH: pemutar yang menghormati tanda — yang sebelumnya
tepat — ikut bergeser. Perubahan dibatalkan. Perbaikan yang benar butuh
konversi eksplisit (`scale=in_color_matrix=bt601:out_color_matrix=bt709`
melalui `ffmpegOverride`) dan ukuran ulang; itu belum dikerjakan. Angka di atas
dicatat supaya percobaan yang sama tidak diulang.

## Alternatif yang ditolak

**Mengubah komponen menjadi `<OffthreadVideo>`.** Itu jalur cadangan yang
sudah dipakai Remotion otomatis saat dekoder tidak bisa membaca berkas
(terlihat di log: "falling back to `<OffthreadVideo>`"). Tetap satu komponen
dengan satu prop lebih mudah dijaga daripada dua jalur.
