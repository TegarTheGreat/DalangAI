# ADR-0017 — Agent berkerajinan: resep format, kritik diri, dan mengklip rekaman

**Status:** Diterima · **Tanggal:** 2026-08-30

## Konteks

Pertanyaan owner menyasar tepat ke jantung produk: *"apakah sudah bisa
menyuruh agent untuk mengclip video, suruh membuat narasi, suruh mengedit
cerita, suruh membuat edukasi… apakah masih terlalu umum untuk bagian
agennya?"*

Jawaban jujur atas audit sebelum ADR ini: **ya, masih terlalu umum**, dan
satu kemampuan tidak ada sama sekali.

1. **Satu kerangka untuk semua jenis konten.** System prompt hanya punya
   SATU resep struktur — "1 kartu judul, 5–8 scene badan 12–20 kata, 1
   outro". Resep itu bagus untuk video esai, tetapi dipakai juga untuk
   tutorial (jadi terasa esai, bukan langkah), untuk klip pendek (dibuka
   kartu judul — penonton hilang di detik pertama), dan untuk berita (yang
   seharusnya lead dulu, bukan hook dramatis). Ini persis definisi "terlalu
   umum": agent yang selalu menghasilkan bentuk yang sama.
2. **Tidak bisa mengklip rekaman panjang.** Ini kekurangan kapabilitas,
   bukan gaya. Skema hanya bisa memakai satu aset video dari awal; tidak ada
   titik masuk (`trimStartSec`), jadi memotong dua momen berbeda dari satu
   podcast 40 menit mustahil — padahal itu alur kerja paling umum kreator
   Indonesia (podcast panjang → banyak klip vertikal).
3. **Kritik sutradara (ADR-0014) tidak bisa dipanggil agent.** Ia disuntikkan
   ke konteks setiap giliran, tetapi agent tidak punya cara MEMERIKSA ULANG
   hasil kerjanya sendiri setelah menulis draft. Agent menulis, lalu
   berharap.
4. **Kritik itu juga tidak terlihat manusia di Studio** — hanya di `dalang
   validate` (CLI) dan di konteks model.

## Keputusan

### 1. Resep format yang bisa diperiksa mesin (`packages/core/src/format-recipe.ts`)

Enam format konten: `bebas` (bawaan), `edukasi`, `tutorial`, `klip`,
`berita`, `cerita`. Tiap resep membawa kerangka beat, rentang jumlah scene,
rentang durasi total, rentang kata narasi per scene isi, dan tiga bendera
struktur (`needsTitle`, `needsOutro`, `needsHookText`).

Yang membedakan ini dari "menambah paragraf di prompt": **satu sumber, dua
arah pemakaian.**

- `formatBriefLines()` men-generate bagian FORMAT KONTEN di system prompt.
- `critiqueFormat()` memeriksa plan terhadap resep yang sama.

Prompt dan pemeriksa mustahil berbeda pendapat karena keduanya membaca objek
yang sama. Nasihat di prompt bisa diabaikan model; kritik yang muncul
kembali di konteks giliran berikutnya tidak bisa.

Angka pada resep adalah keputusan produk yang dikalibrasi agar terasa wajar,
bukan hasil pengukuran ilmiah. Nilainya bukan pada presisinya, melainkan
pada adanya BATAS yang memaksa pilihan — tanpa batas, model selalu memilih
titik tengah yang aman dan itulah rasa generic.

### 2. `meta.format` — field baru, default `"bebas"`

Bertipe `string` (bukan enum) dengan normalisasi lewat `recipeFor()`, pola
yang sama seperti `visual.variant` dan `caption.style`: plan lama tetap
valid, nilai tak dikenal jatuh ke `bebas`, dan format baru bisa ditambah
tanpa memecah skema.

`bebas` sengaja mempertahankan `needsOutro: true` sehingga saran outro umum
dari ADR-0014 tidak hilang untuk proyek yang tidak menyatakan format.

### 3. Tujuh kritik format baru

Ditambahkan ke `critiquePlan` sehingga muncul di CLI, di konteks agent, dan
kini juga di Studio:

| kode | ditangkap |
| --- | --- |
| `format-jumlah-scene` | jumlah scene di luar rentang resep |
| `format-durasi` | durasi total di luar rentang resep |
| `format-tanpa-pembuka` | format berpembuka kartu judul dimulai tanpa itu |
| `format-hook-tanpa-teks` | format yang hidup dari hook TERLIHAT tapi scene isi pertama tanpa teks |
| `format-panjang-narasi` | terlalu banyak scene isi di luar rentang kata resep |
| `format-langkah-tidak-imperatif` | tutorial yang langkahnya tidak dimulai kata kerja perintah |
| `format-klip-basa-basi` | klip pendek yang dibuka kartu judul |

Semuanya deterministik dan berbasis data plan — tidak ada panggilan model,
jadi gratis dan bisa diuji.

### 4. `critiqueDraft` — agent memeriksa kerjanya sendiri

Tool baru yang mengembalikan `{ format, kerangkaFormat, catatan[], bersih }`.
System prompt mewajibkannya: *"Setelah menyusun atau merevisi draft yang
berarti, panggil critiqueDraft dan tangani catatan 'perhatian' sebelum
lanjut ke suara/aset/render."*

Ini mengubah bentuk loop agent dari **tulis → harap** menjadi **tulis →
periksa → perbaiki**, dengan pemeriksa yang bukan model itu sendiri. Agent
tidak menilai selera hasilnya sendiri (yang tidak bisa dipercaya); ia
diperiksa oleh aturan yang eksplisit dan bisa dibaca manusia.

### 5. `ingestVideo` + `visual.trimStartSec` — mengklip rekaman panjang

- `visual.trimStartSec` (detik, ≥ 0, bawaan 0) diteruskan ke Remotion
  sebagai `trimBefore={Math.round(trimStartSec * fps)}`.
- `ingestVideo(sceneId, file)` membaca durasi dan dimensi rekaman NYATA
  lewat ffprobe yang sudah dibundel `@remotion/renderer`
  (`probeLocalVideo`, dijaga `assertSafeRelative` agar tidak keluar folder
  proyek), mendaftarkannya sebagai `resolvedAsset` ber-`durationSec`, dan
  **mem-pin** aset supaya tahap auto-resolve tidak menimpanya.

Satu rekaman boleh dipakai banyak scene dengan `trimStartSec` berbeda —
itulah cara memotong beberapa momen dari satu file. Alur podcast → klip
vertikal kini bisa dijalankan agent lewat tool, bukan hanya lewat tangan.

**Batas yang dinyatakan jujur di system prompt:** agent TIDAK bisa mendengar
isi rekaman. Kalau user belum memberi transkrip atau penanda waktu, agent
diperintahkan MEMINTA — bukan menebak momen menarik lalu mengarang klaim
soal isinya. Transkripsi otomatis (STT) butuh kunci API owner dan belum
dipasang; itu pekerjaan terpisah, bukan sesuatu yang boleh dipura-purakan.

### 6. Catatan sutradara terlihat manusia di Studio

Tombol "Catatan" di header dengan lencana jumlah temuan, membuka dialog
berisi kerangka format yang sedang dipakai plus daftar catatan berperingkat
(saran/perhatian) dengan tombol lompat ke scene yang bersangkutan.

Dihitung di browser dari plan yang sedang tampil — jadi selalu sinkron
dengan editan terakhir tanpa perjalanan ke server. Sifatnya saran: tidak ada
yang diubah otomatis, pengarah yang memutuskan (PRD §4, user sebagai
co-pilot).

Pemilih format ditambahkan di dialog Gaya proyek, dengan kerangka format
yang tampil hidup saat pilihan berubah — manusia dan agent memakai kendali
yang sama.

### 7. Detektor "generic" — mengukur yang selama ini hanya dirasakan

Riset atas teks buatan LLM menunjukkan bahwa "terasa generic" punya jejak
PERMUKAAN yang bisa dihitung, bukan hanya soal selera. Yang paling
diagnostik justru bukan kosakata melainkan IRAMA: model menulis kalimat
dengan panjang yang terlalu seragam, manusia tidak. Ditambahkan
`packages/core/src/prose.ts` dan enam kritik baru:

| kode | ditangkap |
| --- | --- |
| `naskah-klise` | frasa dari leksikon klise ("di era digital yang serba cepat", "tak dapat dipungkiri") |
| `naskah-ragu` | kata pagar bertumpuk ("cenderung", "pada dasarnya", "secara umum") |
| `naskah-pengisi` | kata pengisi lisan yang ikut tertulis — TTS akan membacanya |
| `kalimat-panjang` | kalimat di atas 25 kata (batas tulisan siaran untuk narasi yang DIDENGAR) |
| `irama-datar` | burstiness rendah: simpangan baku panjang kalimat dibagi reratanya |
| `narasi-berulang` | dua scene isi berurutan dengan kemiripan Jaccard kata isi di atas 0,5 |

Plus `klip-menggantung`: klip yang dibuka penghubung ("Jadi…", "Tapi…")
yang premisnya berada di luar klip — pemeriksaan referensi menggantung yang
membuat potongan tidak berdiri sendiri.

Semuanya leksikal/statistik, tanpa embedding dan tanpa model: deterministik,
gratis, dan bisa diuji. Ambangnya dipilih longgar dengan sengaja — test
`naskah wajar TIDAK dituduh apa pun` menjaga agar detektor ini tidak berubah
jadi pengganggu.

Dua aturan pelaksanaan yang ternyata menentukan benar-tidaknya detektor ini
(keduanya baru benar setelah audit pasca-rilis, lihat Jebakan 7 dan 8):
pencocokan frasa WAJIB menghormati batas kata, dan batas scene WAJIB dianggap
batas kalimat.

Catatan jujur: tidak ada korpus klise AI berbahasa Indonesia yang
tervalidasi (dicari, tidak ditemukan), jadi leksikonnya adalah kalibrasi
awal kami sendiri, bukan temuan bersumber.

### 8. Durasi diestimasi dari SUKU KATA, bukan jumlah kata

Ini koreksi kekeliruan yang sudah lama ada. `estimateNarrationSeconds`
memakai tetapan 2,4 kata/detik — memperlakukan "dan" dan
"mempertanggungjawabkan" sebagai beban ucap yang sama, dan mengabaikan angka
sepenuhnya ("2024" terucap delapan suku kata tetapi tidak dihitung).

Bahasa Indonesia berafiks berat, jadi galat ini besar dan berarah. Rujukan:
pengukuran kecepatan bicara dewasa (Surakarta, n=63) mencatat 104-149
kata/menit berbanding 225-333 suku kata/menit — rasio sekitar 2,2 suku kata
per kata untuk percakapan; naskah demo kami sendiri terukur 2,59.

`packages/core/src/syllables.ts` menghitung suku kata dengan dua aturan yang
kelihatan sepele tetapi masing-masing menyelamatkan satu suku kata pada kata
umum:

1. **Diftong (ai/au/oi) hanya di AKHIR kata.** "pandai" dan "pulau" dua suku
   kata; tetapi "air", "baik", "laut", "keajaiban" TIDAK — di tengah kata
   gugus yang sama menyeberangi batas suku kata.
2. **Angka dihitung dua suku kata per digit**, karena ia terucap.

Konsekuensi yang harus dinyatakan terus terang: durasi perkiraan proyek
tanpa suara jadi lebih panjang (demo 50,8 → 54,9 detik). Tetapan lama
setara ~373 suku kata/menit pada naskah itu — lebih cepat dari manusia mana
pun yang pernah diukur. Jadi ini koreksi, bukan regresi. Nilai lama pada
snapshot demo bahkan memuat tiga scene yang kebetulan sama persis (216, 216,
216 frame); nilai baru semuanya berbeda karena mengukur apa yang benar-benar
diucapkan. Estimasi ini juga hanya berlaku SEBELUM TTS berjalan — begitu ada
audio nyata, durasi audio itulah yang menang.

### 9. `findCutPoints` — agent tidak bisa mendengar, tapi bisa tahu kapan orang berhenti bicara

`getSilentParts` dari `@remotion/renderer` (ffmpeg yang sudah dibundel)
memberi daftar jeda hening. Ambang bawaan ffmpeg (-60 dB / 2 detik) terlalu
longgar untuk bicara — pada podcast ia nyaris tidak menemukan apa pun karena
ruangan selalu berdesir. Kami memakai **-35 dB / 0,35 detik**: jeda ruangan
sungguhan, kira-kira sepanjang jeda antar kalimat penutur.

Tool `findCutPoints(file, sekitarDetik?)` mengembalikan titik potong di
TENGAH tiap jeda — posisi paling tidak terdengar — dan `sekitarDetik`
menggeser satu batas ke jeda terdekat.

Ini menutup sebagian batas "agent tidak bisa mendengar", dan hanya sebagian:
ia tahu DI MANA memotong, tidak tahu APA yang layak dipotong. Perbedaan itu
dinyatakan eksplisit di deskripsi tool, di system prompt, dan di catatan
yang dikembalikan tool — supaya model tidak tergoda memakai hening sebagai
pengganti transkrip.

## Konsekuensi

- Agent kini punya bentuk berbeda per jenis konten, dan penyimpangan dari
  bentuk itu terdeteksi tanpa model.
- Klip dari rekaman panjang bisa dikerjakan agent; sebelumnya tidak bisa
  sama sekali.
- Kritik sutradara berubah dari nasihat sepihak menjadi lingkar umpan balik
  yang dipakai agent DAN terlihat manusia.
- Menambah format baru = menambah satu entri resep; prompt, kritik, dan
  pemilih di Studio ikut secara otomatis.

## Bukti

Gerbang unit: **345 test hijau** (core 121, templates 60, pipeline 31,
renderer 19, providers 27, agent 59, studio 28), typecheck dan lint bersih.

Gerbang E2E `verify-51.mts` menjalankan jalur klip yang SEBENARNYA lewat
tool agent atas rekaman nyata 18,45 detik — 14/14 lulus:

```
LULUS - ingestVideo membaca durasi rekaman nyata lewat ffprobe (18.45 dtk)
LULUS - dimensi terbaca (960x540)
LULUS - dua potongan berbeda dari SATU rekaman (1.5s dan 10s)
LULUS - aset sumber ter-pin (auto-resolve tidak akan menimpanya)
LULUS - critiqueDraft memakai resep format klip (klip) dan menemukan 2 catatan
LULUS - kritik menuntut hook TERLIHAT untuk format klip (musik-hening, format-hook-tanpa-teks)
LULUS - setelah perbaikan agent, kritik FORMAT bersih (sisa: tidak ada)
LULUS - resep berbeda per format (klip 90s vs edukasi 420s; outro false vs true)
LULUS - findCutPoints membaca audio nyata (durasi 18.45 dtk, 2 jeda)
LULUS - findCutPoints jujur: menyebut transkrip tetap dibutuhkan untuk memilih momen
LULUS - path di luar folder proyek ditolak sebagai data, bukan dibaca
LULUS - naskah generic tertangkap tanpa model (naskah-klise, naskah-ragu)
LULUS - naskah wajar TIDAK dituduh (sisa: tidak ada)
LULUS - jumlah kata sama (5), estimasi durasi berbeda (1.58 vs 4.39 dtk)
```

Baris terakhir adalah bukti paling ringkas untuk perubahan estimasi durasi:
dua narasi dengan jumlah kata IDENTIK, waktu ucap 2,8 kali berbeda —
perbedaan yang estimasi lama tidak bisa lihat sama sekali.

Gerbang visual render: dua still dirender dari proyek klip itu (`-t 2 9`)
dan diperiksa dengan mata. Scene 1 (`trimStartSec` 1,5) dan scene 2
(`trimStartSec` 10) menampilkan frame yang benar-benar BERBEDA dari satu
rekaman yang sama, dengan caption "tegas" terbaca rapi.

Gerbang visual Studio `verify-51-ui.mjs` (Playwright, 11/11 lulus)
menjalankan agent terskrip sampai ada plan, lalu menguji lencana jumlah
catatan di header, isi dialog Catatan sutradara, pemilih format beserta
kerangka yang ikut berubah, penyimpanan `meta.format` lewat patch yang bisa
di-undo, dan kritik yang menyesuaikan resep baru.

## Jebakan yang ditemukan (dicatat supaya tidak berulang)

1. **`resolvedAsset` belum punya `durationSec`.** Ditambahkan opsional agar
   `ingestVideo` bisa menyimpan hasil probe tanpa memecah plan lama.
2. **Membuat outro bersyarat sempat menghapus saran outro umum** untuk plan
   tanpa format. Diperbaiki dengan `bebas.needsOutro = true` — bukti bahwa
   perubahan "sekadar merapikan" pun butuh test regresi.
3. **Skenario uji yang salah, bukan pemeriksa yang salah.** E2E awal gagal di
   `format-durasi` karena 2×5 detik = 10 detik, di bawah minimum 12 detik
   format klip. Pemeriksanya benar; skenarionya yang tidak masuk akal.
   Godaan melonggarkan ambang ditolak.
4. **`--ink-dim` / `--ink-soft` dipakai di 3 aturan CSS tapi TIDAK PERNAH
   didefinisikan** — jadi aturan warnanya diam-diam tidak berpengaruh sejak
   lama. Diganti ke token nyata (`--text-dim` / `--text`).
5. **`.segmented { flex-wrap: wrap }` membuat pemilih rasio menjuntai keluar
   topbar.** Terlihat di screenshot gerbang visual, bukan di test mana pun —
   dan sudah ada sejak sebelum ADR ini; tombol "Catatan" baru hanya
   membuatnya lebih jelas. Diperbaiki dengan `flex-wrap: nowrap` khusus
   `.ratio-switch`, dan judul proyek yang mengalah (elipsis, lalu
   disembunyikan di bawah 1440px karena judul sisa satu huruf lebih buruk
   daripada tidak ada judul).
6. **Pencocokan substring polos adalah bencana untuk Bahasa Indonesia.**
   Leksikon pengisi memuat "eh", "sih", "nah", "anu" — dan `String.includes`
   menemukan keempatnya di dalam "ol-EH-", "ma-SIH", "ta-NAH", "m-ANU-sia".
   Demo Borobudur yang kami kirim sendiri akan dituduh memuat kata pengisi
   karena kata "pernah" dan "manusia". Detektor yang sering salah akan
   diabaikan orang, termasuk saat ia benar — jadi ini bukan cacat kecil.
   Diperbaiki dengan pola `(?<![a-z0-9])frasa(?![a-z0-9])`, yang sekaligus
   membuat tanda hubung tetap dihitung sebagai batas kata ("batu-batu"
   memuat "batu" dua kali).
7. **Batas scene adalah batas kalimat, apa pun tanda bacanya.** Narasi scene
   sering ditulis tanpa titik di akhir. Karena statistik dihitung atas
   gabungan seluruh narasi, kalimat terakhir sebuah scene MENYATU dengan
   kalimat pertama scene berikutnya: tiga scene sembilan kata terukur sebagai
   satu kalimat 26 kata (lalu dituduh `kalimat-panjang`) dengan burstiness
   nol. `proseStatsOf(texts[])` menggantikan `proseStats(text)` pada jalur
   plan.
8. **Satu gerbang untuk dua jenis pemeriksaan.** Ambang "minimal 25 kata" itu
   syarat agar ukuran SEBARAN berarti, tetapi ia ikut mematikan pemeriksaan
   per-scene yang tidak butuh sebaran sama sekali — sehingga klip pendek,
   justru yang paling rawan dibuka penghubung menggantung, tidak pernah
   diperiksa. Dipisah jadi `critiqueSceneLevel`.
9. **Kode catatan bukan kunci yang unik.** `narasi-padat` muncul sekali per
   scene bermasalah, jadi `key={note.code}` di daftar React bentrok. Kunci
   sekarang `kode:sceneId`.
10. **Ekspektasi test yang salah, bukan kode yang salah.** Tiga dari kasus uji
   penghitung suku kata pertama ternyata harapan penulisnya yang keliru
   ("mempertanggungjawabkan" memang 7 suku kata, bukan 8). Dua sisanya bug
   sungguhan (diftong non-final dan digit) — dan keduanya baru ketahuan
   karena kasus ujinya dihitung manual lebih dulu, bukan disalin dari
   keluaran kode.

## Alternatif yang ditolak

- **Menambah paragraf panjang di system prompt saja.** Ditolak: nasihat yang
  tidak bisa diperiksa akan diabaikan model persis ketika ia paling dibutuhkan
  (giliran panjang, konteks penuh).
- **Enum ketat untuk `meta.format`.** Ditolak: memecah plan lama dan membuat
  penambahan format jadi perubahan skema §5.1 yang butuh ADR sendiri.
- **Deteksi momen menarik otomatis dari audio.** Ditolak untuk sekarang:
  butuh STT berbayar (kunci API owner). Menyediakan tebakan tanpa mendengar
  isinya sama dengan mengarang — lebih baik meminta transkrip.
- **Menyimpan hasil kritik ke dalam plan.** Ditolak: kritik adalah fungsi
  murni dari plan; menyimpannya berarti menyimpan turunan yang bisa basi.
