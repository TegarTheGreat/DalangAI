# ADR-0023 — Keluar dan masuk: interchange dan Dalang sebagai kemampuan

**Status:** diterima · **Tanggal:** 31 Agustus 2026 · **Fase:** 8

## Konteks

Sampai fase ketujuh, Dalang adalah pulau. Dua bukti yang dicatat riset roadmap:

- **Tidak ada jalan keluar.** Hasil kerja berakhir sebagai berkas video. Tidak
  ada cara membawa rough cut-nya ke DaVinci Resolve, Premiere, atau Final Cut
  untuk difinishing — padahal itu justru alur kerja profesional yang normal:
  susun cepat, poles di perkakas yang sudah dikuasai. Remotion sendiri punya
  permintaan fitur terbuka untuk ini.
- **Tidak ada jalan masuk.** Dalang punya CLI dan UI, tapi bukan server MCP.
  Claude Code, ChatGPT, atau agent lain tidak bisa mengedit video lewat Dalang.
  Pesaing terdekat (ChatCut) sudah bisa dipanggil dari dalam keduanya.

Roadmap menempatkan §8.4 sebagai satu dari tiga hal terpenting yang bisa
dikerjakan: "mengubah Dalang dari aplikasi jadi **kemampuan**".

## Keputusan

### 1. Satu garis waktu perantara, dua format

`buildEditTimeline(plan)` menghasilkan model netral — trek, klip, gap,
peralihan, penanda — dan `toOtio` serta `toFcpxml` hanya menuliskannya.

Alasannya bukan kerapian. Kedua format butuh jawaban atas pertanyaan yang
persis sama (klip apa, trek mana, mulai frame berapa, potongan dari detik ke
berapa), dan menghitungnya dua kali berarti dua kesempatan untuk menyimpang.
Penyimpangan pada garis waktu adalah cacat yang baru ketahuan setelah orang
lain membuka hasilnya di Resolve — jenis cacat yang paling mahal.

### 2. Potongan jatuh di TENGAH tumpang-tindih transisi

Scene Dalang saling menindih selama transisi; trek NLE tidak bisa begitu.
Klipnya dipotong adu-tumpul, dan titik potongnya adalah **tengah**
tumpang-tindih — ambang yang dipakai `activeSceneIndex` untuk memutuskan scene
mana yang sedang tampil.

Memakai awal tumpang-tindih akan menggeser seluruh ekspor setengah transisi
terhadap video yang dirender Dalang sendiri: sinkron dengan narasinya rusak,
dan tidak ada yang menyadarinya sampai seseorang membandingkan keduanya
berdampingan.

### 3. Laporan "yang tidak ikut menyeberang" adalah bagian dari fiturnya

Format interchange selalu kehilangan sesuatu — itu sifatnya, bukan cacat
implementasi. Yang jadi cacat adalah kalau kehilangannya DIAM.

Setiap ekspor mengembalikan daftar terstruktur: caption karaoke, teks bergaya,
grafis, Ken Burns, filter warna, anotasi tutorial, kecepatan putar, ducking
musik, scene tanpa berkas aset. Daftar itu dicetak CLI, ditampilkan Studio,
dikembalikan tool MCP, **dan ikut masuk ke dalam berkasnya** (metadata OTIO,
komentar XML) — karena berkas ekspor sering berpindah tangan tanpa log yang
menyertainya.

Tanpa daftar ini, orang membuka hasilnya, melihat klip polos, lalu mengira
Dalang yang rusak.

### 4. Yang lebih baik hilang daripada dikarang

Tiga keputusan yang bentuknya sama:

- **Efek suara tanpa panjang tercatat dilewati**, bukan diberi panjang tebakan.
  Klip NLE wajib punya durasi; durasi karangan adalah kebohongan yang duduk di
  garis waktu, sedangkan klip yang hilang beserta namanya bisa ditambahkan
  kembali dalam sepuluh detik.
- **`available_range` OTIO ditulis `null`** saat panjang sumber tidak diketahui
  (gambar diam, aset yang belum di-probe). `null` di OTIO memang berarti "tidak
  diketahui".
- **Scene tanpa berkas aset jadi gap**, bukan klip yang menunjuk berkas hantu.
  Scene `template-anim` (judul, penutup) memang digambar Dalang sendiri.

### 5. FCPXML 1.8, tanpa transisi dan tanpa judul

Versi 1.8 dipilih di atas yang lebih baru: pada 1.9 letak berkas sumber pindah
dari atribut `src` ke elemen `<media-rep>`, dan 1.8 dibaca oleh semua yang jadi
sasaran ekspor ini. Ekspor yang bisa dibuka lebih berguna daripada ekspor yang
paling mutakhir.

Transisi dan `<title>` sengaja tidak ditulis: keduanya butuh sumber daya
`<effect>` yang menunjuk berkas `.motn` di dalam bundel aplikasi Final Cut —
id-nya berbeda antar versi dan tidak berarti apa-apa di Resolve. Adapter FCPXML
resmi OpenTimelineIO pun menandai transisi "tidak didukung" di matriks
fiturnya. Naskah tiap scene tetap ikut, sebagai `<marker>`.

### 6. Impor membaca KEDUA format, dan menghasilkan kerangka

Berkas OTIO hanya tahu klip, waktu, dan berkas. Ia tidak tahu naskah, gaya,
format konten, atau maksud. Jadi hasil impor adalah kerangka: urutan, durasi,
dan titik masuk yang benar, dengan naskah kosong — dan catatan impor
mengatakan itu apa adanya, lalu menunjuk langkah berikutnya.

Aset di LUAR folder proyek tidak dirujuk. Path relatif yang keluar dari proyek
akan gagal saat render dan saat proyeknya dipindah; yang ditawarkan adalah
kebenarannya, bukan tautan yang rusak.

**Amandemen (31 Agustus 2026): FCPXML ikut dibaca.** Versi pertama ADR ini
menolak impor FCPXML dengan alasan "membaca separuhnya lebih berbahaya
daripada tidak membacanya" — dan alasannya benar, tapi kesimpulannya keliru.
Yang berbahaya bukan pembaca yang tidak lengkap, melainkan pembaca yang DIAM
soal ketidaklengkapannya. Begitu kaidahnya dibalik jadi "yang tidak dimengerti
DIHITUNG dan DILAPORKAN", membaca FCPXML jadi hal yang sama amannya dengan
membaca OTIO.

Yang dibaca: spine UTAMA sebuah sequence, dalam bentuk `<asset-clip ref>`
maupun `<clip><video ref></clip>`, dengan berkas sumber dari atribut `src`
(FCPXML <= 1.8) maupun elemen `<media-rep>` (>= 1.9). Yang dilaporkan
hitungannya: klip di lane (connected clip — Dalang baru punya satu jalur
video, roadmap §9.2), gap, elemen yang waktunya tidak sah, dan versi FCPXML di
luar yang diuji.

Kedua pembaca berbagi satu `clipsToPlan`: begitu keduanya menjawab "klip apa,
berapa lama, dari berkas mana, mulai detik ke berapa", sisanya persis sama —
dan menuliskannya dua kali berarti dua tempat yang bisa menyimpang.

Impor juga TIDAK lagi hanya di CLI: lobi Studio punya tombol **Impor**, dan
berkasnya dikenali dari BENTUKNYA, bukan dari ekstensinya — berkas dari
perkakas lain sering tiba dengan nama yang salah.

### 7. Server MCP memberi TIMELINE, bukan otak kedua

Yang diberikan ke agent lain: membaca rencana, mengubahnya lewat patch op
tervalidasi, mengurungkan, memeriksa strukturnya, mengekspornya. Yang sengaja
TIDAK diberikan:

- **Tidak ada tool yang memanggil model.** Pemanggil server ini SUDAH agent.
  Memberinya otak kedua hanya menambah biaya, latensi, dan satu tempat lagi
  yang bisa berhalusinasi. Yang tidak dipunyainya adalah garis waktu.
- **Tidak ada tool yang mengunduh aset atau menyintesis suara.** Keduanya
  berbiaya nyata dan tidak ada manusia di lingkaran ini untuk menyetujui
  tagihannya. `dalang generate` tetap ada, dan yang menjalankannya tahu apa
  yang ia belanjakan.
- **Render hanya kalau portnya disuntikkan** (`--izinkan-render`). Tanpa itu
  tool-nya tidak didaftarkan sama sekali — bukan didaftarkan lalu menolak:
  klien menyusun rencana dari daftar tool, dan tool yang selalu menolak adalah
  rencana yang selalu gagal di tengah jalan. Portnya juga menjaga paket
  `@dalang/mcp` tetap ringan; server yang menyeret Remotion dan Chromium
  adalah server yang tidak jadi dipasang orang.

Pagar ruang kerja: server dijalankan dengan satu folder akar, dan tiap path
yang masuk lewat tool harus berada di dalamnya. Galat pagar dikembalikan
sebagai HASIL bertanda error, bukan dilempar — model perlu tahu kenapa
panggilannya ditolak supaya bisa memperbaikinya.

## Bukti

**Bentuk kedua format disalin dari berkas contoh resmi, bukan dari ingatan.**
Struktur OTIO diambil dari `tests/sample_data/multiple_track.otio` di repo
OpenTimelineIO; struktur FCPXML dari berkas contoh yang dipakai adapter
`otio-fcpx-xml-adapter` resmi. Nama field OTIO seragam sampai membosankan
(`source_range`, `available_range`, `media_reference`) dan satu huruf yang
salah menghasilkan berkas yang ditolak pembaca mana pun tanpa memberi tahu
bagian mana yang salah.

**Gerbang interop memakai implementasi rujukan.** `gate:interop` menulis
kedua berkas lalu menyuruh pustaka OpenTimelineIO resmi (Python) membaca
`.otio` dan adapter `fcpx_xml` resmi membaca `.fcpxml`, lalu membandingkan
posisi tiap klip. Adapter rujukan membaca berkas FCPXML kita dengan offset dan
durasi tepat sampai frame di 30fps.

**Versi pertama gerbang itu adalah tautologi, dan mengujinya yang
membuktikannya.** Ia membandingkan hasil baca pustaka rujukan dengan angka
yang dihitung ulang oleh modul yang sedang diuji. Saat titik potong digeser
satu frame untuk memastikan gerbangnya menyala, kedua sisi ikut bergeser dan
gerbangnya tetap hijau. Jangkarnya diganti jadi `activeSceneIndex` milik
renderer — fungsi yang MEMUTUSKAN scene mana yang tampil di frame tertentu —
dan pergeseran satu frame yang sama langsung menghasilkan 12 keluhan di kedua
format. Gerbang yang tidak pernah dilihat gagal adalah gerbang yang belum
terbukti ada.

**Pagar ruang kerja server MCP bocor, dan tesnya menemukannya.** Versi pertama
memakai `path.resolve` untuk memeriksa apakah plan.json berada di dalam akar.
`resolve` hanya menormalkan string dan tidak pernah menyentuh disk, jadi
plan.json berupa symlink ke luar akar lolos begitu saja — ia baru gagal
belakangan, karena isinya kebetulan bukan scene-plan yang sah. Sekarang
memakai `realpathSync` di kedua sisi (akarnya ikut, karena `/tmp` sendiri lazim
berupa symlink).

**Dialog Ekspor tumbuh melewati layar, dan gerbang tata letak tidak
melihatnya.** Bagian interop membuat dialognya lebih tinggi daripada
viewport-nya: kedua tepi terpotong dan tombol "Mulai ekspor" jadi tak
terjangkau — tapi gerbangnya tetap hijau, karena ia mengukur topbar dan tab
properti, bukan dialog yang belum dibuka. Perbaikannya dua lapis: `.dialog`
kini dibatasi `max-height` dan menggulir di dalam dirinya sendiri, dan gerbang
tata letak sekarang MEMBUKA empat dialog di tiap lebar layar lalu mengukur
kotaknya. Pemeriksaan itu dibuktikan menyala: dengan `max-height` dilepas, ia
melaporkan dialog Gaya keluar layar di 420px dan 380px. Batasnya dinyatakan di
bawah.

**Pembaca FCPXML diuji terhadap bacaan implementasi rujukan atas berkas yang
SAMA.** Contoh resmi adapter `otio-fcpx-xml-adapter` dibaca oleh keduanya:
adapter rujukan memulihkan enam item di trek video utamanya (IMG_0715 10s,
compound_clip_1 30s, IMG_0233 10s, IMG_0687 10s, IMG_0268 10s, compound_clip_1
10s), dan pembaca kami menghasilkan enam scene dengan urutan dan durasi yang
persis sama — termasuk penomoran ulang id untuk nama yang kembar.

**Gerbang interop kini menguji DUA arah.** Selain "penulis kami dibaca
rujukan", pustaka rujukan sekarang MENULIS .otio dan .fcpxml, lalu pembaca
kami membacanya. Berkas dari pustaka resmi adalah contoh terbaik dari "berkas
yang datang dari perkakas lain" — persis kasus yang impor ada untuk
melayaninya. Arah baru ini juga dibuktikan menyala: durasi impor yang digeser
setengah detik menghasilkan lima keluhan.

**Penulis FCPXML rujukan menolak berkas yang PEMBACA-nya terima.** Ia melempar
`AttributeError` pada klip yang `available_range`-nya None — nilai yang kami
tulis dengan sengaja untuk gambar diam (butir 4). Gerbang mengisinya HANYA di
dalam skrip Python-nya, semata untuk memperoleh berkas tulisan rujukan yang
bisa dibaca balik. Itu keterbatasan penulis rujukan, bukan cacat berkas kami.

**Parser XML mengubah atribut jadi array, dan semua klip jadi tak terbaca.**
`isArray: () => true` di fast-xml-parser berlaku untuk atribut juga, sehingga
`offset` menjadi `["0s"]` dan tiap klip gagal diurai — pembaca FCPXML pertama
menghasilkan nol scene dari berkas yang isinya enam. Argumen keempat
(`isAttribute`) yang membedakannya.

**Server MCP diuji lewat klien MCP sungguhan** di atas transport in-memory,
bukan dengan memanggil fungsinya langsung. Yang paling mudah salah di server
MCP bukan logikanya melainkan kontraknya: skema input yang tidak bisa
diserialkan ke JSON Schema, tool yang terdaftar padahal tidak seharusnya,
galat yang dilempar alih-alih dikembalikan. Semua itu hanya kelihatan lewat
protokolnya — dan satu tes memang langsung menemukan nama field patch op yang
salah di tes lain, lewat pesan validasi yang datang dari sisi klien.

## Batas yang dinyatakan

- **Belum pernah dibuka di Resolve, Premiere, atau Final Cut yang sungguhan.**
  Tidak ada satu pun dari ketiganya di lingkungan ini. Yang terverifikasi:
  pustaka OpenTimelineIO resmi dan adapter FCPXML resmi membaca kedua berkas
  dan memulihkan posisi klip yang tepat. Yang belum: apakah ketiga aplikasi itu
  menerima berkasnya tanpa keluhan, dan apakah tautan asetnya tersambung.
- **Impor FCPXML membaca spine UTAMA saja.** Connected clip di lane
  (overlay, PiP, audio tempelan), `<ref-clip>` yang menunjuk klip majemuk, dan
  `<spine>` bersarang tidak dipulihkan — semuanya dihitung dan disebut di
  catatan impor. Batas sebenarnya bukan di pembacanya melainkan di skema
  Dalang: garis waktu Dalang baru punya satu jalur video (roadmap §9.2).
- **Pembaca FCPXML diuji terhadap 1.8 dan bentuk `<media-rep>` 1.9+**, bukan
  terhadap seluruh rentang versi. Berkas berversi lain tetap dibaca, dengan
  catatan yang menyebut versinya dan menyarankan memeriksa hasilnya.
- **Ekspor memakai path absolut.** Berkasnya hanya berguna di mesin yang memuat
  proyeknya; memindahkan proyek memutus semua tautan. Ini disebutkan di CLI dan
  di Studio, dan itulah alasan Studio menulis berkasnya di samping plan.json
  alih-alih mengunduhnya ke folder Downloads.
- **Riwayat undo server MCP hanya seumur sesinya**, dan hanya mencakup
  perubahan yang dibuat lewat server itu — bukan yang dibuat Studio atau CLI.
  Tool-nya mengatakan itu saat riwayatnya kosong.
- **Gerbang tata letak mengukur dialog dalam keadaan AWAL**, sebelum isinya
  bertambah oleh hasil (laporan interop, temuan tinjauan). Yang menjaga keadaan
  setelah tumbuh adalah `max-height` pada `.dialog`, bukan gerbangnya.
- ~~**Server MCP tidak menyelaraskan diri dengan Studio yang sedang terbuka.**~~
  *DICABUT.* Keduanya masih menulis plan.json yang sama, tetapi kini tidak
  saling menimpa. Sisi server MCP: setiap tool membaca berkas segar (tanpa
  salinan di memori) dan menulis dengan BANDINGKAN-DAN-TUKAR terhadap hash
  yang dibacanya; bila Studio menulis di antara baca dan tulis, plan dibaca
  ulang dan patch-nya diterapkan lagi pada plan yang segar — patch op adalah
  niat, bukan salinan berkas, jadi penerapan ulang adalah penggabungan yang
  benar. Sisi Studio: pengawas berkas memuat ulang editan luar saat senggang
  (sudah sejak Fase 3), dan dua jalan yang dulu menimpa kini tidak lagi —
  tahap pipeline yang lama (TTS, aset, transkrip) menyimpan hasilnya sebagai
  DELTA renderState di atas plan terbaru dari disk (`rebaseRenderState`,
  murni di core), dan setiap job eksklusif membaca plan yang segar sebelum
  menulis (`freshPlan`). Tes server Studio memaksa kedua jalan itu dan
  keduanya gagal sebelum pembetulan: judul yang ditulis "dari luar" selagi
  TTS berjalan, atau tepat sebelum rekaman didaftarkan, kembali ke judul lama.
  Yang tersisa: riwayat undo server MCP tetap seumur sesinya (butir di
  bawah), dan proses ketiga yang menulis tanpa henti akan ditolak server MCP
  setelah lima percobaan, dengan pesan.

## Konsekuensi

- Rough cut Dalang bisa dilanjutkan di perkakas profesional, dan orang yang
  melanjutkannya tahu persis apa yang harus dibangun ulang di sana.
- Dalang bisa dipanggil agent mana pun yang bicara MCP — tanpa memberi agent
  itu akses ke uang penggunanya.
- Paket `@dalang/interop` tidak bergantung pada Remotion maupun SDK model, jadi
  ia bisa dipakai di mana saja termasuk oleh perkakas lain.
- Satu ketergantungan baru di CI: dua paket Python untuk gerbang interop. Itu
  harga yang dibayar supaya klaim "bisa dibuka perkakas lain" punya bukti.

## Alternatif yang ditolak

- ~~**Tidak membaca FCPXML sama sekali.**~~ DICABUT di amandemen 31 Agustus
  2026 — lihat butir 6. Alasan aslinya (setengah pembacaan yang diam itu
  berbahaya) tetap benar; yang berubah adalah pembacanya tidak lagi diam.
- **Menulis EDL.** Ditolak: EDL tidak bisa membawa banyak trek, penanda, atau
  path aset yang bermakna — ia akan kehilangan lebih banyak daripada OTIO tanpa
  menambah satu pun pembaca yang belum terjangkau.
- **Menyalin aset ke samping berkas ekspor supaya path-nya relatif.** Ditolak
  untuk sekarang: menggandakan gigabyte footage tanpa diminta adalah kejutan
  yang lebih besar daripada tautan yang perlu disambungkan ulang.
- **Membungkus caption jadi `<title>` FCPXML.** Ditolak: judul FCP menunjuk
  `.motn` milik aplikasi, jadi hasilnya hanya bekerja di Final Cut versi
  tertentu dan tampil rusak di tempat lain. Naskahnya dibawa sebagai marker.
- **Mengunduh berkas ekspor lewat browser di Studio.** Ditolak: asetnya dirujuk
  dengan path absolut mesin server, jadi berkas di folder Downloads justru
  berisi tautan yang putus semua.
- **Server MCP dengan tool `dalang_chat` yang memanggil agent Dalang.**
  Ditolak, dan ini keputusan yang paling menentukan bentuk §8.4: kliennya sudah
  agent. Yang berharga dari Dalang bagi agent lain adalah timeline-nya yang
  tervalidasi dan bisa diurungkan, bukan model kedua di belakangnya.
