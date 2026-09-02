# ADR-0031: Studio hanya menerima perintah dari dirinya sendiri

Status: diterima · keamanan · menambal celah pada ADR-0010

## Konteks

Studio adalah server HTTP yang berjalan di mesin orangnya sendiri dan
mendengar di `127.0.0.1` saja. Selama sepuluh fase, itu dianggap cukup:
server yang tidak terjangkau dari jaringan tidak bisa diserang dari
jaringan. Anggapan itu benar, dan tidak menjawab pertanyaan yang sebenarnya.

Yang tidak dijaga oleh alamat ikat: **peramban milik user sendiri**. Selama
Studio berjalan, situs web mana pun yang kebetulan dibuka di tab lain bisa
mengirim permintaan ke `http://127.0.0.1:4646`. Dua hal membuatnya mempan:

1. Rute kami membaca badan permintaan sebagai JSON dengan `c.req.json()`,
   yang tidak peduli pada `Content-Type`.
2. `<form>` HTML boleh mengirim `text/plain` lintas asal **tanpa preflight
   CORS**. Preflight yang biasanya melindungi API JSON tidak pernah terjadi.

Diaudit pada 2 September 2026 dengan menjalankan permintaan sungguhan
terhadap server sungguhan. Semuanya berhasil sebelum ADR ini:

| Permintaan dari asal asing | Hasil sebelum |
| --- | --- |
| `POST /api/patch` | 200, judul scene-plan di disk benar-benar berubah |
| `POST /api/render` | 202, render CPU dimulai |
| `POST /api/publish` dengan `confirm:true`, `privacy:"public"` | 202, unggahan YouTube benar-benar dipanggil |

Gerbang konfirmasi 428 (ADR-0014, ADR-0030) tidak menolong sama sekali:
penyerang mengirim `confirm: true` sendiri. Dan unggahan publik adalah efek
yang tidak bisa diurungkan dari sini, persis yang dicemaskan ADR-0030.

Yang TIDAK bisa dilakukan penyerang: membaca jawabannya. Kami tidak pernah
mengirim header CORS, jadi peramban menahan isinya. Ini sabotase, biaya API,
dan unggahan tak diminta — bukan pencurian isi proyek. Itu tetap tidak bisa
dibiarkan.

## Keputusan

### 1. Permintaan yang MENGUBAH hanya sah bila datang dari Studio sendiri

Satu middleware di app terluar, dipasang sebelum rute apa pun, sehingga
lobi, proyek yang didelegasikan, dan mount media ikut terjaga. Aturannya
dua pagar, dan keduanya perlu:

- **`Origin`.** Peramban SELALU mengirimnya pada permintaan yang mengubah,
  termasuk form biasa, dan halaman tidak bisa memalsukannya. Asal yang bukan
  loopback ditolak 403 dengan kalimat yang menyebut asalnya.
- **`Host`.** Tanpa ini, DNS rebinding lolos: penyerang mengarahkan
  `jahat.example` ke `127.0.0.1`, lalu Origin dan Host sama-sama
  `jahat.example` dan aturan "sama asal" akan meloloskannya.

### 2. Tanpa `Origin` = bukan dari peramban, dan itu dibiarkan lewat

curl, skrip, tes, dan pemanggil server-ke-server tidak mengirim `Origin`.
Peramban tidak bisa menghilangkannya pada permintaan yang mengubah, jadi
ketiadaannya bukan celah yang bisa dipakai halaman web. Menolaknya hanya
akan mematahkan pemakaian yang sah tanpa menutup apa pun.

### 3. Hanya metode yang mengubah yang dijaga

GET tetap terbuka. Jawabannya tidak terbaca lintas asal, dan menjaganya akan
mematahkan hal wajar seperti membuka berkas render di tab baru.

### 4. Host tambahan disahkan secara eksplisit, bukan dengan melonggarkan bawaan

Bawaannya hanya loopback. `allowedHosts` menyahkan nama lain dengan sengaja,
dan alamat ikat yang dipilih user otomatis masuk — mengikat ke LAN dengan
sadar tidak boleh berarti server menolak dirinya sendiri. Tes memakai jalan
yang sama: ia menyahkan `studio.local` miliknya, bukan mematikan penjaganya.

## Verifikasi

- 5 tes tabel untuk aturan murninya: pembacaan nama host (asal, header Host,
  IPv6 berkurung, yang tak terbaca), loopback seluruh 127.0.0.0/8 dan
  `.localhost`, GET selalu lewat, tanpa Origin lewat, asal asing ditolak,
  DNS rebinding ditolak lewat Host walau Origin dan Host sama, dan host
  tambahan yang disahkan hanya berlaku untuk dirinya.
- 2 tes integrasi yang MENJALANKAN ULANG serangan di atas terhadap server
  yang sama: patch, render, publish, dan rute memori lobi semuanya 403, dan
  judul plan terbukti tidak berubah. Lalu jalur sah tetap hijau: dari halaman
  Studio sendiri 200, dan dari pemanggil tanpa Origin 200.
- Skrip serangan asli dijalankan ulang terhadap port sungguhan: 403, dan
  `publish` tidak pernah memanggil tujuannya.
- 134 tes studio, gerbang tata letak, dan gerbang interaksi tetap hijau:
  peramban sungguhan memakai asalnya sendiri, jadi tidak ada yang berubah
  bagi pemakaian normal.

## Batas

- **Bukan otentikasi.** Siapa pun yang bisa menjalankan program di mesin ini
  tetap bisa memanggil API-nya, sama seperti mereka bisa membaca berkas
  proyeknya langsung. Yang ditutup adalah halaman web, bukan proses lokal.
- **Mount media tetap terbuka untuk GET.** Program lokal bisa mengambil aset
  proyek lewat HTTP. Itu keadaan yang sama dengan sebelum ADR ini.
- **Tidak ada CSRF token.** Pemeriksaan `Origin` sudah cukup untuk peramban
  masa kini dan tidak menambah state yang harus dijaga; token baru berguna
  bila suatu saat Studio disajikan lintas asal dengan sengaja.

## Konsekuensi

- Server bertambah satu berkas `guard.ts` berisi fungsi murni dan satu
  middleware; `StudioHost` memasangnya paling awal, dan `startStudioServer`
  menyahkan alamat ikatnya sendiri.
- Pemakaian normal tidak berubah sama sekali: Studio di peramban, `dalang
  studio`, tes, dan kedua gerbang berjalan seperti biasa.
