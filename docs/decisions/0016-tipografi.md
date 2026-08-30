# ADR-0016 — Pass tipografi: caption bergaya, tipografi kinetik, dan rupa teks

**Status:** Diterima · **Tanggal:** 2026-08-30

## Konteks

Audit tipografi (permintaan owner: "apakah sudah mendukung semuanya dan
sangat bagus") menemukan lubang yang nyata, bukan kosmetik:

1. **`caption.style` MATI.** Field ini ada di skema §5.1 sejak v0 dengan
   default `"inherit"` — dan TIDAK PERNAH dibaca satu baris pun oleh
   templates. Caption karaoke hanya punya SATU rupa sejak Fase 0.
2. **Tidak ada garis luar (stroke)** untuk teks — padahal itu syarat
   keterbacaan wajib di atas footage ramai, dan penanda visual utama gaya
   klip pendek Indonesia.
3. **Tidak ada animasi per kata/karakter.** Teks overlay hanya larut sebagai
   satu blok; tidak ada pop/rise berjenjang maupun efek ketik.
4. **Warna teks terkunci peran**; tidak ada kapital, kerapatan huruf, atau
   penekanan gaya "stabilo".
5. Enam kontrol caption yang wajar (ukuran, posisi) tidak ada sama sekali.

Riset paralel atas gaya editor konten Indonesia (Timothy Ronald, Raymond
Chin, Deddy Corbuzier, Ferry Irwandi) mengonfirmasi prioritasnya: teks di
layar adalah ELEMEN UTAMA, bukan dekorasi — highlight per kata, efek
"stabilo", efek ketik, dan subtitle burned-in ada di hampir semua gaya.
Catatan jujur: riset itu terbatas pada hasil pencarian (halaman video tidak
bisa dibuka dari lingkungan ini), jadi ia memandu PRIORITAS, bukan meniru
satu kreator.

## Keputusan

### 1. `caption.style` akhirnya dieksekusi — empat gaya

Skema tetap `string` (plan lama bernilai `"inherit"` tetap valid);
`captionStyleOf()` menormalkan nilai tak dikenal ke `klasik` — pola yang
sama dengan `visual.variant`. Ditambah `caption.size` (s/m/l) dan
`caption.position` (bottom/center).

- **klasik** — kata aktif berganti warna aksen (perilaku sejak Fase 0).
- **tegas** — KAPITAL, bobot 900, garis luar 4px, kata aktif membesar 1.09;
  ukuran dasar 1.14×. Untuk klip pendek berenergi.
- **chip** — kata aktif duduk dalam kotak aksen berwarna kontras.
- **halus** — tanpa karaoke, satu warna tenang untuk konten formal.

### 2. Tipografi kinetik pada teks overlay

`texts[].anim`: `fade` (blok, seperti sebelumnya) | `pop` | `rise`
(berjenjang PER KATA, jeda 3 frame) | `typewriter` (per karakter). Semua
memakai kurva `easeSettle` dari `anim.ts` (ADR-0015).

### 3. Rupa teks

`texts[]` bertambah `color` (hex atau null = warna peran), `stroke` (0–8 px,
garis luar 8 arah lewat text-shadow — konsisten di Chromium render),
`uppercase`, dan `tracking` (−0.05..0.5 em). Emphasis bertambah **`stabilo`**
— pita sapuan stabilo yang TUMBUH mengikuti progress masuk, penekanan khas
konten esai Indonesia.

### 4. Dua font baru (total 6, semua OFL, offline)

- **Plus Jakarta Sans** — geometris, karya Tokotype (foundry Indonesia),
  huruf resmi Pemprov DKI Jakarta.
- **Anton** — display sangat berat untuk judul menghentak. Berkas STATIS
  satu bobot, jadi `loadFont` memakai `weight: "400"`, bukan rentang
  variable — kalau salah, browser menyintesis bobot dan hurufnya rusak.

## Dua jebakan yang ditemukan lewat gate visual (bukan teori)

1. **`.default(obj)` zod, LAGI.** `caption: captionSchema.default({enabled,
   style})` memakai objek apa adanya sehingga `size`/`position` tidak pernah
   terisi — persis jebakan ADR-0013 pada `transition`. Objek default kini
   ditulis lengkap. Ini kedua kalinya; pola "tulis default lengkap" wajib
   dipatuhi untuk setiap `.default()` berisi objek.
2. **`scale` tidak menambah lebar layout.** Kata aktif gaya `tegas` yang
   diperbesar 1.09 secara visual MENUTUPI spasi tetangganya — render
   membaca "TAPI SOAL" sebagai "TAPISOAL". Dua perbaikan: spasi pemisah
   token dirender di LUAR kotak `inline-block` (`splitToken`, karena
   inline-block mengempiskan spasi tepi), dan token `tegas` diberi padding
   horizontal nyata sebagai ruang pembesaran.

## Konsekuensi

- Plan lama tetap valid: semua field baru berdefault netral; `"inherit"`
  dinormalkan, bukan ditolak.
- Default `caption.style` untuk plan BARU kini `"klasik"`, bukan
  `"inherit"` — nilai yang sekarang punya arti.
- Repo bertambah ~347KB untuk dua font; harga yang diterima untuk render
  offline tanpa jaringan.
- Verifikasi: 296 unit test (60 di templates, termasuk 18 uji tipografi
  murni); still render membuktikan keempat gaya caption, stabilo, garis
  luar + warna + kapital, dan perbaikan spasi.
