# ADR-0039: Berkas subtitle yang berjalan bersama video

**Status:** diterima (diterapkan) · **Tanggal:** 8 September 2026 · **Fase:** roadmap §10.3 (lanjutan)

## Konteks

Dalang sudah bisa membakar caption ke dalam gambar sejak ADR-0016, dan sejak
ADR-0030 bisa mengunggah video langsung ke YouTube. Yang tidak ada di antara
keduanya: **berkas subtitle**.

Bedanya bukan soal selera. Caption yang dibakar adalah PIKSEL — ia tidak bisa
dimatikan, tidak bisa diterjemahkan otomatis, tidak terbaca oleh pembaca layar,
dan tidak satu kata pun darinya masuk ke indeks pencarian YouTube. Berkas
subtitle adalah TEKS: penonton bisa mematikannya, YouTube bisa menerjemahkannya
ke bahasa lain, mesin pencari membacanya, dan penonton yang tuli mendapat akses
yang tidak diberikan oleh video tanpa teks.

Bahan untuk membuatnya sudah lengkap di dalam plan sejak lama, dan itu yang
membuat ADR ini kecil:

- **Narasi** ada di `scene.narration`.
- **Waktu per kata** ada di `renderState.narrationAudio[sceneId].wordTimestamps`
  begitu TTS berjalan (ADR-0006), dan ditaksir dari panjang kata kalau belum.
- **Transkrip rekaman** ada di `renderState.transcripts` (ADR-0021), lengkap
  dengan waktunya sendiri.
- **Tata letak bingkai** — kapan tiap scene benar-benar mulai di video jadi —
  dihitung `computeFrameLayout` (ADR-0003).

Yang belum ada cuma satu fungsi yang menyusunnya jadi berkas, dan permukaan
yang memanggilnya.

## Keputusan

### 1. Sumber kebenarannya WAKTU PER KATA, bukan halaman caption di layar

Caption layar dan berkas subtitle dibangun dari data yang sama —
`sceneCaptionWords()`, satu-satunya tempat yang tahu cara membaca narasi maupun
transkrip per potongan — tapi **pengelompokannya berbeda, dan sengaja**.

Caption layar bergaya `tegas` menampilkan tiga kata sekaligus supaya mata bisa
mengikuti irama ucapan. Kalau berkas subtitle memakai pengelompokan yang sama,
hasilnya adalah kartu tiga kata yang berganti tiap 700 milidetik: di pemutar
YouTube itu bukan irama, itu **kedipan**. Ukuran kartu subtitle punya aturannya
sendiri — satu frasa yang bisa dibaca sekali lihat — dan aturan itu tidak boleh
diikatkan pada gaya tampilan yang dipilih orang untuk gambarnya.

Konsekuensi yang dipilih dengan sadar: mematikan `caption.enabled` **tidak**
mematikan berkas subtitle. Justru sebaliknya — alasan paling sering mematikan
caption bakar adalah karena berkas subtitle akan diunggah terpisah.

### 2. Waktunya diambil dari TATA LETAK RENDER, bukan jumlah durasi scene

Ada dua "waktu" di dalam Dalang, dan keduanya benar untuk pertanyaan yang
berbeda:

| Fungsi | Menjawab | Contoh `klip-borobudur` |
| --- | --- | --- |
| `computeTimeline` | berapa lama MATERINYA | 16,0 dtk |
| `computeFrameLayout` | scene ini mulai di bingkai berapa di VIDEONYA | 17,2 dtk |

Selisihnya lahir dari transisi: `TransitionSeries` membuat scene bertumpuk
selama transisi berlangsung, jadi scene ketiga tidak mulai di "durasi 1 +
durasi 2". Subtitle yang dihitung dari jumlah durasi melenceng **makin jauh
tiap transisi** — dan melencengnya ke arah yang paling menyesatkan: teksnya
muncul sesudah kalimatnya diucapkan.

Subtitle memakai `computeFrameLayout`. Ini bukan detail implementasi; ini
alasan modulnya tinggal di `@dalang/templates` dan bukan di `@dalang/core`.

### 3. Pemotongan kartu: tiga alasan, dengan urutan yang tidak sama derajatnya

Kartu diputus karena salah satu dari:

1. **Jeda ucapan lebih dari 700 ms, atau kata berakhiran tanda titik/tanya/seru.**
   Ini potongan ALAMI — ia jatuh di tempat orang berhenti bicara.
2. **Kelebaran** (lebih dari 84 karakter) atau **kelamaan** (lebih dari 7 detik).
   Ini potongan PAKSA, dan potongan paksa yang jatuh sembarangan menghasilkan
   kartu yang terbaca sebagai kalimat selesai padahal belum:
   "…candi Buddha" / "terbesar yang pernah dibangun manusia." Mata membaca
   kartu pertama sebagai kalimat utuh, lalu harus mengoreksi diri di kartu
   berikutnya.

Karena itu potongan paksa **melihat ke belakang 45% panjang kartu** mencari
batas anak kalimat — koma, titik koma, titik dua, tanda pisah — dan memotong di
sana kalau ketemu. Kalau teksnya tidak punya satu pun tanda baca, potongannya
memang jatuh di kelebaran; yang tidak boleh terjadi adalah kartu yang tumbuh
tanpa batas.

### 4. Kartu pendek dipanjangkan UJUNGNYA, tidak pernah dimajukan AWALNYA

Kartu di bawah 1,2 detik sulit dibaca. Memperbaikinya punya dua arah, dan cuma
satu yang benar: **memundurkan ujungnya**. Memajukan awalnya akan menampilkan
teks sebelum kalimatnya diucapkan — cacat yang terlihat oleh setiap penonton,
bukan cuma yang teliti. Perpanjangan berhenti sebelum kartu berikutnya mulai;
kalau tidak ada ruang, kartunya tetap pendek. Kartu bertindihan lebih buruk
daripada kartu pendek.

### 5. Dua format, dan bedanya satu karakter

SRT memakai `00:00:04,583` (koma). WebVTT memakai `00:00:04.583` (titik) dan
**harus** diawali baris `WEBVTT`. Pembaca SRT menolak berkas yang memakai titik;
pembaca VTT menolak yang memakai koma. Satu karakter memutuskan berkasnya
terbaca atau ditolak mentah-mentah, jadi keduanya diuji sebagai string, bukan
diperiksa dengan mata.

Berkas ditulis LF tanpa BOM. Berkas kosong tetap berkas yang sah: `""` untuk
SRT, `"WEBVTT\n\n"` untuk VTT.

### 6. Berkasnya ditulis di samping plan, dan SELALU ditulis ulang saat publikasi

Empat permukaan menulis berkasnya, dan keempatnya memanggil fungsi yang sama:
`dalang subtitle`, tombol SRT/WebVTT di dialog Ekspor Studio, tool agent
`writeSubtitle`, dan tool MCP `dalang_write_subtitle` untuk agent lain. Semuanya
menulis `<projectId>.<bahasa>.<format>` di folder proyek — di samping plan.json,
bukan lewat unduhan peramban. Berkas subtitle dipakai bersama berkas render, dan
keduanya harus mudah ditemukan di satu folder saat orang membuka pengunggah.

Menulis subtitle **tidak mengubah plan sama sekali**, jadi ia tidak lewat patch
op dan tidak lewat gerbang persetujuan: yang dihasilkannya berkas teks, dan
menulisnya ulang tidak merusak apa pun. Server MCP hanya-baca tetap menolaknya,
karena "hanya-baca" berarti tidak menulis berkas ke folder orang.

Saat publikasi, subtitle **ditulis segar** ke `.dalang/subtitle.<bahasa>.srt`,
bukan dipungut dari berkas yang kebetulan tertinggal di folder. Teks lama yang
tidak lagi cocok dengan suaranya adalah cacat yang cuma ketahuan oleh penonton
yang menyalakan teksnya — yaitu justru orang yang paling membutuhkannya.

### 7. Subtitle gagal BUKAN publikasi gagal

Unggahan caption ke YouTube adalah permintaan KEDUA, sesudah videonya jadi.
Kalau permintaan itu gagal — kuota habis, token tidak punya cakupan
`youtube.force-ssl` — videonya **sudah tayang**. Melempar galat di titik itu
akan membuat perintahnya tampak gagal padahal separuh berhasil, dan orang yang
mengulanginya akan mendapat video kedua di kanalnya.

Jadi `uploadCaption` mengembalikan pesan galat sebagai nilai, bukan lemparan.
CLI dan Studio mengatakannya apa adanya: video naik, subtitle tidak, ini
berkasnya, unggah manual dari YouTube Studio.

### 8. Waktu yang DITAKSIR dikatakan, bukan disembunyikan

Sebelum `dalang generate` berjalan, tidak ada satu pun `wordTimestamps` asli —
waktunya ditaksir dari panjang kata. Taksiran itu cukup untuk melihat bentuk,
tapi tidak cukup untuk diunggah: pada `borobudur-60s` selisihnya sampai
setengah detik per kalimat dan menumpuk.

Ketiga permukaan melaporkan angkanya: "N dari M scene bernarasi waktunya masih
DITAKSIR". Angka, bukan kata sifat, dan hilang sendiri begitu TTS berjalan.

## Konsekuensi

**Yang didapat.** Berkas `.srt`/`.vtt` dari data yang sudah ada, tanpa
provider baru dan tanpa biaya. Lima permukaan: `dalang subtitle`, tombol SRT/
WebVTT di dialog Ekspor Studio, tool agent `writeSubtitle`, tool MCP
`dalang_write_subtitle`, dan unggahan otomatis bersama video ke YouTube (di CLI,
Studio, maupun tool agent `publishVideo`). Penonton tuli mendapat teks; YouTube
mendapat teks untuk diterjemahkan dan diindeks.

**Yang dibuktikan, bukan diklaim.** Gerbang CI `gate:subtitle` menjalankan dua
pemeriksaan atas empat plan contoh. Pertama, pembaca RUJUKAN — pustaka
`webvtt-py`, bukan pembaca kami sendiri — membaca `.srt` maupun `.vtt` dan harus
melihat kartu yang sama persis, sampai ke milidetiknya. Kedua, jangkar waktunya
`activeSceneIndex` milik renderer: tiap kartu dicocokkan ke scene yang narasinya
memuat teksnya, dan titik tengah kartu itu harus jatuh di scene yang sama
menurut renderer. Gerbang ini diuji dengan disabotase — mengganti jamnya ke
jumlah durasi scene membuatnya merah dengan tiga kartu belakang mendarat di
scene yang keliru dan kartu terakhir melewati ujung video.

**Yang dibayar.** Aturan pemotongan kartu adalah tebakan tipografis yang bisa
saja tidak cocok untuk bahasa yang kata-katanya jauh lebih panjang — 42 karakter
per baris adalah angka yang lazim untuk latin, bukan hukum alam. Angkanya
diekspor sebagai konstanta supaya bisa diubah tanpa membongkar logikanya.

**Yang belum.** Satu plan tetap satu bahasa: `meta.language` tunggal berarti
satu berkas subtitle per proyek. Subtitle terjemahan — dan sulih suara yang
mengikutinya — butuh narasi per bahasa di dalam satu plan, dan itu perubahan
skema §5.1 yang pantas mendapat ADR-nya sendiri.

## Alternatif yang ditolak

**Membangkitkan subtitle dari halaman caption layar.** Sudah dibahas di §1:
kartu tiga kata yang berganti tiap 700 ms adalah kedipan, bukan subtitle. Yang
dibagi antara keduanya adalah waktu per kata, bukan pengelompokannya.

**Mengunduh berkasnya lewat peramban.** Studio menulis di samping plan.json
karena berkas subtitle selalu dipakai berbarengan dengan berkas render. Berkas
yang mendarat di folder Downloads terpisah dari videonya justru menambah satu
langkah pencarian.

**Memakai `computeTimeline` karena lebih sederhana.** Melenceng makin jauh tiap
transisi. Sederhana dan salah.

**Menunggu sampai multi-bahasa siap.** Subtitle satu bahasa berguna hari ini
untuk aksesibilitas, pencarian, dan penonton yang menonton tanpa suara —
tiga hal yang tidak menunggu terjemahan.
