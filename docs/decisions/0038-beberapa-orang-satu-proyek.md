# ADR-0038: Beberapa orang pada satu proyek

**Status:** diterima (diterapkan) · **Tanggal:** 8 September 2026 · **Fase:** roadmap §10.4

## Konteks

Roadmap §10.4 menulis "Multi-user pada satu proyek". Yang menarik: sebagian
besar bahannya sudah ada sejak lama, dan tidak satu pun sengaja dibuat untuk
ini.

Plan hanya berubah lewat **patch op** yang masing-masing membawa inversnya
(ADR-0002). Ada **satu penulis** di server, dengan kunci sibuk supaya job
panjang tidak ditimpa (ADR-0010). Setiap perubahan sudah **disiarkan lewat
SSE** dengan nomor revisi. Editan dari LUAR — CLI, server MCP, editor teks —
sudah terdeteksi dan di-rebase (ADR-0023).

Artinya susunan datanya sudah benar. Yang belum ada persis tiga hal, dan
ketiganya soal ORANG, bukan soal data:

1. **Tidak ada identitas.** `PatchOrigin` cuma "user" atau "agent". Suntingan
   orang kedua tidak bisa dibedakan dari suntingan sendiri, di log maupun di
   layar.
2. **Tidak ada deteksi bentrok.** Dua panel yang menyunting scene yang sama
   sama-sama berhasil, dan yang belakangan MENANG. Tidak ada galat, tidak ada
   peringatan; pekerjaan orang pertama hilang tanpa satu pun tanda.
3. **Tidak ada cara ikut.** Studio mendengar di 127.0.0.1 saja (ADR-0031), dan
   itu benar sebagai bawaan — tapi tanpa satu pun cara sadar untuk membukanya,
   "multi-user" berarti dua tab di komputer yang sama.

## Keputusan

### 1. Bentrok dideteksi per PETAK, dan petaknya sebesar SCENE

Klien mengirim `baseRevision` — revisi yang ia lihat saat menyunting. Server
menghitung petak yang disentuh patch itu, membandingkannya dengan petak yang
berubah sejak revisi tersebut, dan **menolak** kalau beririsan.

Ukuran petak adalah keputusan utama ADR ini.

**Bukan seluruh plan.** Dua orang yang menyunting dua scene berbeda tidak
saling mengganggu, dan penolakan yang menuntut mereka bergantian adalah cara
tercepat membuat fitur ini dimatikan orang.

**Bukan pula per-field.** Penggabungan tingkat field menuntut aturan gabung
untuk tiap field, dan aturan gabung yang salah kehilangan pekerjaan orang
DIAM-DIAM — persis penyakit yang sedang diobati. Petak sebesar scene bisa
dijelaskan dalam satu kalimat kepada yang ditolak — "scene ini baru saja
diubah Rina" — dan penolakan yang bisa dijelaskan adalah penolakan yang bisa
diterima.

Empat jenis petak: `scene:<id>`, `struktur` (tambah/buang/urut scene), `meta`,
`audio`. `struktur` bertabrakan dengan petak scene mana pun — membuang scene
ketiga sementara orang lain menyuntingnya akan membuat suntingan itu mendarat
di scene yang sudah tidak ada, atau di scene lain yang kebetulan naik ke
posisinya. `meta` dan `audio` berdiri sendiri: mengganti judul tidak
mengganggu siapa pun yang sedang menulis narasi.

Op yang tidak dikenal jatuh ke `struktur` — sisi AMAN. Op baru yang lupa
didaftarkan lalu bentrok dengan segalanya, dan itu jauh lebih baik daripada op
baru yang diam-diam tidak pernah dianggap bentrok dengan apa pun.

### 2. `baseRevision` OPSIONAL, dan opsionalnya bagian dari keputusan

CLI, server MCP, dan klien lama tidak mengirimnya, dan mereka bekerja persis
seperti sebelumnya — "terakhir menang", seperti dulu. Yang mengirimnya
mendapat jaminan tambahan.

Fitur kolaborasi yang memecahkan hal-hal yang sudah bekerja bukan fitur
tambahan; ia perubahan yang menyamar sebagai fitur.

Riwayat petaknya berupa cincin 64 revisi. Klien yang tertinggal lebih jauh
dari itu bukan klien yang perlu digabungkan per-scene, melainkan klien yang
harus memuat ulang — dan permintaannya ditolak dengan mengatakan itu.
Revisi yang tidak bisa dijawab diperlakukan sebagai BENTROK, bukan sebagai
aman: menjawab "aman" untuk pertanyaan yang tidak bisa dijawab adalah cara
paling halus kehilangan pekerjaan orang.

### 3. Identitas dibuat PERAMBAN, dikirim lewat header

Id dibuat di peramban dan disimpan di localStorage; satu server melayani
beberapa orang, jadi server tidak punya cara membedakan mereka kecuali
masing-masing menyebut dirinya. Id bertahan antar muat ulang, sehingga "orang
yang me-refresh" tidak terbaca sebagai orang baru yang datang.

Lewat HEADER (`x-dalang-editor-id`, `x-dalang-editor-name`), bukan badan
permintaan: tiap rute punya bentuk badannya sendiri, dan menyelipkan identitas
ke masing-masing berarti menuliskannya belasan kali. Ada keuntungan yang tidak
disengaja tapi nyata: header kustom memaksa preflight CORS, sehingga
permintaan `<form>` lintas asal tidak bisa membawanya — menguatkan ADR-0031.

Nama bawaannya JELAS-JELAS sementara ("Penyunting 4f2a") dan bisa diklik untuk
diganti. Nama yang terlihat sementara mengundang orang menggantinya; bilah
kehadiran berisi tiga "Pengguna" tidak menolong siapa pun.

### 4. Kehadiran: siapa yang ada, dan sedang di scene mana

Disiarkan lewat SSE, disimpan DI MEMORI. Siapa yang sedang membuka editor
bukan bagian dari video, dan menuliskannya ke `plan.json` akan membuat setiap
orang yang membuka proyek menghasilkan perubahan berkas.

Bilah kehadiran TIDAK ADA saat sendirian — bukan bilah kosong, dan bukan pula
nama sendiri. Menampilkan diri sendiri memakai tempat untuk mengatakan hal
yang sudah diketahui pemiliknya, dan bilah yang selalu ada berhenti
diperhatikan justru saat isinya mulai berarti. Nama bisa diganti begitu ada
orang lain yang akan membacanya — yaitu saat namanya mulai berarti.

Ini bukan penalaran belakangan: versi pertama menampilkan nama sendiri saat
sendirian, dan gerbang tata letak repo ini langsung merah — saklar rasio
tergunting di 1680px, tombol kembali-ke-lobi tergunting di 900px. Bilah atas
sudah diperebutkan judul, saklar rasio, dan tujuh tombol; keterangan tidak
boleh menggunting kendali.

Inisial berwarna, bukan foto: Dalang tidak punya akun, jadi tidak punya wajah
untuk ditampilkan — dan lingkaran abu-abu berisi siluet orang adalah
kebohongan kecil tentang fitur yang tidak ada. Warnanya diturunkan
deterministik dari id, jadi orang yang sama berwarna sama di semua layar.

Kehadiran tidak langsung hilang saat sambungan tertutup: memuat ulang halaman
menutup lalu membuka SSE, dan kehadiran yang lenyap di antaranya membuat rekan
kerja melihat orang itu keluar-masuk tiap kali me-refresh.

### 5. Membuka ke jaringan itu SADAR, dan tautannya berkunci

`dalang studio --lan` mengikat ke semua antarmuka, membuat kunci acak, dan
mencetak URL lengkap untuk tiap alamat IPv4 non-internal — bukan `0.0.0.0`,
yang tidak menunjuk apa pun dari komputer orang lain.

Tanpa kunci, "buka ke jaringan" berarti siapa pun di kafe yang sama bisa
menyunting proyek, memicu render berbayar, dan mengunggah ke YouTube. Dengan
kunci, yang bisa cuma orang yang diberi tautannya.

Penjaganya memakai **alamat soket**, bukan header `Host`: header bisa ditulis
siapa saja, alamat soket tidak. Pemakai loopback lolos tanpa kunci — membuka
ke jaringan tidak boleh berarti pemiliknya sendiri harus menempelkan kunci di
URL-nya. Dan penjaganya menjaga GET juga: kalau hanya penulisan yang dijaga,
"buka ke jaringan" berarti siapa pun sejaringan bisa MEMBACA seluruh proyek.

Di peramban, kunci dibaca sekali dari query lalu **dihapus dari bilah alamat**
dan disimpan di sessionStorage. Kunci yang menetap di URL ikut ke setiap
tangkapan layar, setiap riwayat peramban, dan setiap tautan yang tidak sengaja
dibagikan.

## Konsekuensi

- Dua orang bisa menyunting satu proyek tanpa saling menimpa diam-diam. Yang
  kalah dalam bentrok mendapat kalimat yang menyebut siapa dan apa, lalu
  layarnya disegarkan — bukan kata "gagal" di atas versi lama.
- Studio tetap loopback secara bawaan. Tidak ada satu pun perilaku lama yang
  berubah tanpa `--lan`.
- Satu cacat LAMA ikut ketahuan dan diperbaiki: `/api/events` mengirim sapaan
  SEBELUM berlangganan bus. Badan `streamSSE` berjalan setelah responsnya
  dikembalikan, jadi tiap `await` sebelum `subscribe` adalah jendela tempat
  perubahan yang terjadi persis saat itu hilang tanpa jejak — panel yang baru
  dibuka lalu diam sampai perubahan berikutnya. Sekarang berlangganan dulu,
  menyapa kemudian.
- Helper tes `call`/`hostCall` dulu MEMBUANG header pemanggil demi memasang
  `content-type` sendiri. Tidak pernah terlihat karena belum ada tes yang
  mengirim header; begitu ada, yang tampak cuma "rutenya menolak".

## Bukti

Dua puluh empat test menjaga hal-hal yang salahnya mahal di kedua arah:

- patch TANPA `baseRevision` masih diterima berturut-turut — klien lama tidak
  patah;
- dua orang di scene yang SAMA: yang kedua ditolak 409, dan tulisan yang
  pertama **masih ada** saat plan dibaca ulang;
- dua orang di scene BERBEDA: keduanya diterima;
- revisi terlalu tua ditolak, bukan dianggap aman;
- `struktur` bentrok dengan petak scene mana pun, `meta` tidak bentrok dengan
  scene;
- op yang tidak dikenal jatuh ke sisi aman;
- kehadiran muncul di daftar dengan warna deterministik, dan kedatangannya
  disiarkan ke panel yang sudah terbuka;
- tamu jaringan tanpa kunci ditolak 401 **termasuk untuk membaca**, dengan
  kunci diterima lewat header maupun query, kunci salah ditolak, dan pemakai
  loopback lolos tanpa kunci — termasuk bentuk `::ffff:127.0.0.1` yang
  dilaporkan Node saat soketnya IPv6.

## Batas yang dinyatakan

- **Tidak ada akun, tidak ada izin per-orang.** Yang punya tautan punya
  segalanya: menyunting, merender, mengunggah. Mencabut akses berarti
  menghentikan Studio dan menjalankannya lagi (kunci baru). Kalau yang
  dibutuhkan adalah "Rina boleh menyunting, Budi hanya melihat", itu belum
  ada.
- **Bentrok DITOLAK, tidak digabungkan.** Tidak ada penggabungan otomatis
  tingkat field, tidak ada CRDT, tidak ada operational transform. Dua orang
  yang benar-benar menyunting scene yang sama harus bergantian — dan itu
  keputusan, bukan tahap sementara: penggabungan yang salah kehilangan
  pekerjaan tanpa suara, dan itu lebih buruk daripada penolakan yang jelas.
- **Tidak ada kursor bersama, tidak ada seleksi bersama, tidak ada suntingan
  huruf-per-huruf.** Kehadiran menunjukkan siapa dan di scene mana; tidak
  lebih halus dari itu.
- **Satu proses, satu penulis.** Semua orang berbagi satu server Dalang di
  satu komputer. Kalau komputer itu tidur, semua orang berhenti. Ini bukan
  layanan.
- **Chat agent tidak dibagi per orang.** Percakapan agent adalah satu utas
  untuk proyek, jadi dua orang yang mengetik ke chat sedang berbicara ke utas
  yang sama — terlihat oleh keduanya, tanpa penanda siapa yang bertanya.
- **Kunci tautan tidak dienkripsi di jalan.** Ini HTTP polos di jaringan
  lokal; siapa pun yang bisa menyadap jaringan itu bisa membaca kuncinya.
  Pakai di jaringan yang kamu percaya.
