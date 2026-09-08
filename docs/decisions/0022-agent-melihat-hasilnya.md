# ADR-0022 — Agent melihat hasil kerjanya sendiri, dan bisa diukur

**Status:** diterima · **Tanggal:** 31 Agustus 2026 · **Fase:** 7

## Konteks

Sampai fase keenam, agent Dalang menilai pekerjaannya lewat **struktur saja**:

- `critiqueDraft` membaca scene-plan sebagai JSON — 27 heuristik atas musik,
  irama, gerak, panjang narasi, klise;
- `analyzeImage` melihat aset **SUMBER** sebuah scene.

Tak satu pun pernah melihat **frame jadi**. Yang hanya muncul setelah render:
teks overlay yang tertimpa teks lain, caption yang tenggelam di atas footage
terang, grafis yang keluar bingkai aman, komposisi yang memotong subjek dengan
janggal. Semua itu lolos dari JSON yang sempurna.

Ada masalah kedua yang lebih dalam. Tidak ada cara **mengukur** apakah
perubahan prompt atau pergantian model membuat keluaran agent lebih baik —
yang ada hanya kesan setelah membaca beberapa hasil. Tanpa itu, setiap
"perbaikan" pada agent adalah tebakan yang tidak pernah diverifikasi.

Roadmap Fase 7 menuliskan keduanya sebagai satu paket, dengan catatan bahwa
§7.4 (eval) **harus ikut**, "kalau tidak kita cuma menebak apakah
perubahannya membantu". ADR ini mengerjakan keduanya.

## Keputusan

### 1. `reviewRender`: agent merender, melihat, lalu menilai

Tool baru yang merender beberapa frame kunci, mengirimnya ke model vision
sebagai SATU pesan multi-gambar, dan mengembalikan temuan terstruktur.

Satu panggilan berisi semua frame, bukan satu panggilan per frame — bukan
sekadar lebih murah: model bisa membandingkan antar-frame dan melihat hal yang
tidak terlihat dari satu gambar (pengulangan, tampilan yang tidak konsisten).

### 2. Frame dipilih dengan alasan, bukan diambil dari titik tengah

Agent tidak bisa menonton seluruh video; tiap frame berbiaya. Maka
pertanyaannya bukan "berapa frame" melainkan "frame MANA yang paling mungkin
memperlihatkan kesalahan". Dua lapis jawabannya:

- **Di dalam scene**: momen paling ramai — saat paling banyak teks dan grafis
  tampil bersamaan. Di situlah tabrakan tata letak terjadi; frame kosong di
  detik pertama tidak memberi tahu apa pun. Overlay punya jendela
  `startFrac`/`endFrac`, jadi momen ini **dihitung**, bukan ditebak.
- **Antar scene**: pembuka lebih dulu (kesan pertama menentukan apakah ada
  yang menonton sampai habis), lalu penutup, lalu yang paling banyak
  elemennya.

Tiap frame membawa **alasan dipilihnya** ke dalam prompt, supaya model tahu
apa yang sedang ia lihat.

### 3. Loop dibatasi di KODE, bukan di prompt

"Render → lihat → perbaiki → render lagi" adalah pola yang paling mudah
berputar tanpa ujung: tiap putaran memberi model gambar baru untuk
dikomentari, dan selalu ada yang bisa dikomentari. Step cap tidak cukup karena
satu putaran memakai beberapa step.

`reviewRenderCap` (bawaan 3 per giliran) yang membuatnya berhingga. Saat jatah
habis, tool menjawab dengan instruksi yang jelas: terapkan dulu temuan
sebelumnya, tinjau lagi di giliran berikutnya. Jatahnya pulih di `beginTurn()`.

Loopnya sendiri **tetap milik agent**, bukan disembunyikan di dalam tool.
Membungkusnya jadi loop internal akan menghilangkan kendali user atas setiap
langkah — dan approval gate serta patch log yang jadi kekuatan Dalang justru
hidup di level itu.

### 4. Satu laporan, dua sudut

`reviewRender` mengembalikan `temuanGambar` DAN `temuanStruktur` dalam satu
respons. Keduanya tidak saling menggantikan: gambar tidak bisa melihat musik
yang hilang atau irama kalimat yang datar; JSON tidak bisa melihat teks yang
tertimpa.

### 5. Parsing TOLERAN pada bungkus, KETAT pada isi

Model menjawab teks bebas, dan jawaban yang "hampir JSON" adalah keadaan
normal. Pagar kode, prosa pembuka, dan trailing comma dimaafkan. Tapi entri
yang kehilangan field wajib **dibuang dan dilaporkan**, bukan diloloskan
dengan nilai karangan — temuan yang menuding scene yang salah jauh lebih mahal
daripada temuan yang hilang.

Dan pembedaan yang paling menentukan: jawaban yang **tidak bisa diurai sama
sekali** ditandai `peringatan`, bukan dilaporkan sebagai "bersih". "Tidak ada
temuan" dan "jawabannya tidak terbaca" adalah dua hal yang sangat berbeda, dan
menyamakannya membuat agent yakin videonya baik padahal belum pernah dinilai.

### 6. Suite eval: skor yang bisa dibandingkan antar-jalan

`scorePlan(plan, expectation)` memberi angka 0-100 dari dua kelompok:

- **kepatuhan brief** (rasio, bahasa, format, durasi, topik tersentuh) —
  berbobot lebih besar, karena mengabaikan permintaan yang jelas adalah
  kegagalan yang berbeda kelas dari transisi yang monoton;
- **struktur & kerajinan** (jumlah scene sesuai resep format, scene isi
  bernarasi, penutup ada, dan jumlah catatan `critiquePlan` yang tersisa).

Lima kasus eval dipilih supaya **sumbunya berbeda**, bukan sekadar banyak:
mematuhi rasio/durasi eksplisit, menyimpulkan format dari brief yang tidak
menyebutnya, menahan struktur pada durasi panjang, membawa angka konkret, dan
brief satu kalimat tanpa arahan. Briefnya ditulis seperti orang menulis —
kalimat pendek, tidak lengkap; eval yang briefnya rapi hanya mengukur
kemampuan mengisi formulir.

### 7. Satu runner, tiga permukaan — dan gerbang biaya di ketiganya

`reviewRender` mulanya hanya tool agent. Itu tidak cukup: tinjauan paling
berguna justru pada plan yang TIDAK sedang dikerjakan agent — setelah editan
manual di Studio, atau sebagai pemeriksaan terakhir sebelum ekspor, dari
terminal, tanpa membuka sesi chat. Fase 6 memberi transkrip tiga permukaan
(tool, tab Studio, `dalang transcribe`); tinjauan mendapat tiga yang sama:

- tool `reviewRender` untuk agent;
- `POST /api/review` + tombol **Tinjau** di toolbar Studio;
- `dalang review <proyek>`.

Ketiganya memanggil **satu** fungsi `runRenderReview`. Diekstrak sebelum
pemakai keduanya ada, bukan sesudah: jalur "pilih frame → render still → satu
panggilan vision multi-gambar → urai temuan" punya beberapa detail yang mudah
menyimpang kalau disalin (pemetaan nomor scene ke id, geseran waktu,
perlakuan jawaban tak terurai).

Yang TIDAK dibagi adalah gerbangnya, karena keadaannya memang berbeda:

- **Tool agent** melewati `Guardrails` — jatah `reviewRenderCap`, izin
  (`tinjauan-render`), dan anggaran proyek. Agent bisa memutuskan meninjau
  berkali-kali tanpa ada yang menyadarinya; gerbang biaya inilah yang hilang
  di versi pertama ADR ini dan ditambahkan setelah audit.
- **Studio dan CLI** dijalankan MANUSIA yang menekan tombol atau mengetik
  perintah. Perintah eksplisit adalah persetujuannya sendiri; yang wajib di
  sana bukan gerbang melainkan **kejujuran angka** — CLI mencetak perkiraan
  sebelum jalan dan biaya nyata sesudahnya, Studio menampilkan biaya nyata di
  dialog dan mencatatnya ke buku besar proyek.

Tidak satu pun dari ketiganya mengubah plan. Temuan model adalah pendapat, dan
pendapat tidak menulis ke sumber kebenaran tanpa ada yang memutuskannya
(PRD §5.1).

### 8. Eval `--self-check` jadi gerbang CI

Mode `--self-check` menilai plan contoh repo tanpa memanggil model sama
sekali. Ia tidak mengukur mutu agent — mustahil tanpa model berbayar di CI —
tapi ia menangkap dua kemunduran yang tidak ditangkap tes mana pun: **penilai
yang rusak diam-diam**, dan **plan contoh repo yang diedit sampai melanggar
kaidahnya sendiri**.

Agar berguna sebagai gerbang, modenya harus bisa GAGAL: versi pertamanya
mencetak "GAGAL" per pemeriksaan lalu tetap keluar dengan kode 0. Itu
diperbaiki dan dibuktikan dua arah sebelum dipasang di CI.

## Bukti

**Penilai eval menolak fixture "bagus" buatan sendiri, dan itu buktinya
bekerja.** Versi pertama fixture uji punya 4 scene dan langsung mendapat 72 —
bukan karena penilainya salah, tapi karena format "edukasi" menuntut 6-14
scene. Setelah diperpanjang, ia masih memberi 92 dengan alasan yang benar:
durasi 39 detik di bawah minimum format (45), tiga scene di luar rentang kata
yang enak, dan irama kalimat nyaris seragam (burstiness 0,09 dari sehat 0,18).
Fixture akhirnya diperbaiki — narasinya, bukan penilaiannya — dan barulah
mencapai bersih. Plan contoh repo (`examples/borobudur-60s`) mendapat 100.

**Folder `scripts/` ternyata tidak pernah ditypecheck.** Runner eval mengimpor
`pickDefaultModels` dari modul yang salah dan membaca field `stopReason` yang
tidak ada; `pnpm typecheck` LULUS, dan galatnya baru muncul saat dijalankan.
Penyebabnya: `tsconfig.json` tiap paket hanya memuat `src` dan `test`. Ketiga
paket berskrip (agent, renderer, studio) kini memuat `scripts` juga, dan kedua
galat itu langsung tertangkap kompiler. Skrip yang tidak ditypecheck adalah
persis cara cacat semacam ini bertahan.

**Pemilihan frame diuji terhadap sifat yang bisa salah diam-diam.** Satu tes
memastikan frame selalu jatuh DI DALAM scene-nya sendiri: kalau meleset ke
frame tetangga (transisi yang menindih membuat ini mudah terjadi), temuannya
akan menuding scene yang salah, dan itu jenis kesalahan yang sangat sulit
dilacak balik.

**Batas tinjauan dibuktikan dua arah:** panggilan ketiga dengan cap 2 ditolak
dengan instruksi yang benar, dan jatahnya pulih setelah `beginTurn()`.

**Gerbang CI dibuktikan menyala, bukan diasumsikan.** Satu scene penutup
dibuang dari `examples/borobudur-60s`, `--self-check` melaporkan "GAGAL ada
penutup" dan keluar dengan kode 1; plan dikembalikan, kode 0. Gerbang yang
tidak pernah dilihat gagal adalah gerbang yang belum terbukti ada.

**Rute Studio mencatat biaya NYATA, dan itu ditemukan karena diuji.** Versi
pertama `POST /api/review` memanggil model berbayar lalu memanggil
`logUiEvent(..., 0, ...)` — chip biaya di topbar dan anggaran proyek akan
melaporkan tinjauan sebagai gratis. Sekarang biayanya dihitung dari `usage`
yang dikembalikan model, dan dua tes menguncinya: satu memastikan angkanya
masuk buku besar proyek, satu lagi memastikan model tanpa harga melaporkan
biaya **tidak diketahui** — bukan nol.

**Satu tombol menggeser seluruh tangga responsif.** Menambahkan "Tinjau" ke
toolbar membuat gerbang tata letak gagal di 1536/1512px (sakelar rasio
tergunting, lalu menindih tombol Chat) dan di 768px (tombol Proyek
tergunting). Ambang label-jadi-ikon dinaikkan ke 1600px dan zona aksi mulai
digulir pada 860px; gerbang lulus lagi di 18 lebar layar. Satu kontrol
tambahan pada baris yang sudah padat bukan perubahan lokal — dan hanya
gerbang yang MENGUKUR geometri yang bisa mengatakan itu.

**Bagian gambar yang usang diganti di seluruh repo.** Menjalankan tes
tinjauan memunculkan peringatan deprecation AI SDK v7: bentuk
`{ type: "image", image }` sudah usang. Lima pemanggilan (tinjauan render,
chat multimodal, `analyzeImage`, dan dua langkah grounding tutorial) diubah ke
`{ type: "file", data, mediaType }`.

## Batas yang dinyatakan

- **Belum pernah dijalankan terhadap model vision sungguhan.** Repo ini tidak
  punya kunci API. Yang terverifikasi: pemilihan frame, penguraian jawaban
  (termasuk lima bentuk jawaban yang rusak), batas jatah, penggabungan dengan
  kritik struktur, dan semua jalur galat. Yang belum: apakah model vision
  benar-benar menemukan masalah yang berguna pada frame Dalang.
- **Skor eval mengukur KEPATUHAN dan KERAJINAN, bukan apakah naskahnya
  menarik.** Plan yang membosankan tapi rapi bisa mendapat 100. Skor ini
  berguna untuk menangkap KEMUNDURAN, bukan untuk memutuskan sebuah video
  bagus. Runner mencetak batas ini di akhir tiap jalan supaya tidak terlupa.
- Eval butuh model orkestrator sungguhan; menjalankannya terhadap mock akan
  mengukur skrip mock-nya, bukan agent-nya. Mode `--self-check` hanya
  membuktikan rangkanya jalan, dan pesannya mengatakan itu.
- Tinjauan memakai still, jadi ia buta terhadap gerak dan audio — persis yang
  dilarang keras dilaporkan di dalam promptnya.
- Studio dan CLI **tidak** memakai `reviewRenderCap`: batas itu ada untuk
  mengekang loop agent, dan manusia yang menekan tombol tidak sedang berputar
  dalam loop. Konsekuensinya jujur: seseorang yang menekan "Tinjau sekarang"
  sepuluh kali akan membayar sepuluh kali, dan angkanya terlihat setiap kali.

## Konsekuensi

- Agent bisa menemukan cacat yang mustahil terlihat dari JSON, lalu
  memperbaikinya lewat `applyPatch` biasa — jadi undo tetap bekerja.
- Perubahan prompt dan pergantian model bisa **dibandingkan dengan angka**,
  bukan kesan. Itu prasyarat untuk semua penyetelan agent sesudah ini.
- `scripts/` yang kini ditypecheck menutup satu kelas cacat untuk seluruh repo,
  bukan hanya untuk berkas yang memicunya.
- Tinjauan bisa dijalankan tanpa agent sama sekali — dari toolbar Studio atau
  dari terminal — jadi ia berguna juga bagi orang yang mengedit sepenuhnya
  dengan tangan.
- CI kini menjaga penilai eval dan plan contoh repo, tanpa kunci API dan tanpa
  biaya.

## Alternatif yang ditolak

- **Loop revisi otomatis di dalam tool.** Ditolak: menyembunyikan langkah dari
  user, melewati approval gate, dan membuat patch log tidak lagi menceritakan
  apa yang terjadi.
- **Satu panggilan vision per frame.** Ditolak: lebih mahal, dan menghilangkan
  kemampuan model membandingkan antar-frame.
- **Frame di titik tengah tiap scene.** Ditolak: titik tengah sering justru
  saat layar paling kosong, dan scene tanpa risiko ikut memakan jatah.
- **`generateObject` untuk keluaran terstruktur.** Ditolak demi netralitas
  vendor: tidak semua model yang bisa dipakai user mendukungnya, dan repo ini
  memang memilih `generateText` + penguraian toleran di semua tempat lain.
- **Skor eval dari model penilai (LLM-as-judge).** Ditolak sebagai fondasi:
  penilai yang tidak deterministik membuat perbandingan antar-jalan kehilangan
  arti, dan biayanya menghalangi eval dijalankan sesering yang seharusnya.
  Bisa ditambahkan kelak sebagai lapisan KEDUA di atas skor deterministik ini.
