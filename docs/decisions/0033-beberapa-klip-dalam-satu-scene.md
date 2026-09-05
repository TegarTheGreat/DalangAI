# ADR-0033 — Beberapa klip dalam satu scene

**Status:** diterima (diterapkan) · **Tanggal:** 2 September 2026 · **Fase:** 9 (§9.6, baru)

## Konteks

Pertanyaan yang melahirkan ADR ini: apakah Dalang sudah handal untuk menyunting
rekaman mentah? Pemeriksaan ke skema menjawabnya dengan tepat: **satu scene
punya tepat satu visual dasar.**

```
sceneSchema = { id, narration, visual, duration, transition, texts,
                graphics, layers (maks 2), annotations, caption }
```

Lapisan media mentahnya sendiri sudah kuat dan terbukti. Proxy 540p dibuat di
latar untuk rekaman berat, unggahan berpotongan bisa dilanjutkan setelah putus,
`findCutPoints` mencari jeda hening, transkrip memberi potongan per kalimat, dan
transkodernya diuji terhadap ffmpeg SUNGGUHAN dengan berkas H.264/AAC nyata —
kodek, dimensi, laju bingkai, proxy, ekstraksi bingkai, dekode AAC, sampai
pengukuran kenyaringan.

Yang tidak ada adalah bentuk datanya. Memotong wawancara 40 menit jadi dua belas
potongan hari ini berarti membuat **dua belas scene**, masing-masing menunjuk
berkas yang sama dengan `trimStartSec` berbeda. Akibatnya bukan sekadar
merepotkan, melainkan salah secara semantik:

- **Scene adalah unit MAKNA**, bukan unit potongan. Narasi, caption, transisi
  keluar, dan anotasi semuanya melekat di scene. Dua belas potongan dari satu
  kalimat yang sama dipaksa jadi dua belas unit makna, masing-masing membawa
  bagasi yang tidak dibutuhkannya.
- **Ripple tidak bisa dinyatakan.** Memendekkan potongan ketiga seharusnya
  menggeser potongan keempat sampai kedua belas. Lintas scene, tidak ada
  operasi yang mengatakan itu; yang ada hanya mengubah `duration` satu per satu.
- **Agent kehilangan pijakan.** Ia menalar per scene. Dua belas scene untuk satu
  gagasan membuat kritik struktur (`critiqueDraft`) melaporkan naskah yang
  seolah-olah pecah, padahal yang pecah cuma potongannya.

Jadi pertanyaannya bukan "fitur apa yang kurang", melainkan **satu keputusan
bentuk data yang belum pernah diambil**: apakah satu scene boleh memuat
beberapa klip berurutan.

Dua temuan lain dari pemeriksaan ikut membentuk keputusan di bawah:

1. `renderState.resolvedAssets` **dikunci id SCENE**. Dengan beberapa klip per
   scene, klip kedua akan menimpa berkas klip pertama. Masalah yang sama persis
   sudah pernah ditemui dan diselesaikan untuk lapisan video, dan komentarnya
   masih ada di skema: `layerAssets` dikunci ID LAPISAN "karena satu scene boleh
   punya beberapa lapisan dan lapisan kedua akan menimpa berkas lapisan pertama
   kalau kuncinya scene".
2. **Fungsi migrasi skema belum pernah ada.** `parseScenePlan` menolak versi
   selain 1 dengan pesan yang sudah menyebut kebutuhannya sendiri: "Bump versi
   skema membutuhkan fungsi migrasi (lihat ADR-0003)". ADR-0003 juga sudah
   menetapkan kebijakannya: penambahan field wajib lewat ADR + bump `version` +
   fungsi migrasi. Sampai hari ini kebijakan itu belum pernah ditagih karena
   belum ada yang membump versi. ADR ini yang pertama menagihnya.

## Keputusan

### 1. `scene.clips[]` MENGGANTIKAN `scene.visual` — satu bentuk, bukan dua

```
scene.clips: Clip[]   // minimal 1, maksimal MAX_CLIPS
Clip = Visual & { id, durationSec?, transition? }
```

`Clip` memakai bentuk `Visual` yang SUDAH ADA apa adanya — `assetId`, `motion`,
`filter`, `speed`, `trimStartSec`, `flipH`, `focusX/Y`, `audio`, `pinned` —
ditambah identitas dan waktu. Ini pola yang sama dengan lapisan video: lapisan
memakai bentuk `visual` yang sama supaya Ken Burns, filter, kecepatan, trim,
cermin, dan titik fokus berlaku tanpa rumus kedua. Klip mendapat warisan yang
sama, dan ikut bertambah pintar setiap kali `visual` bertambah.

`scene.visual` DIHAPUS, bukan dipertahankan berdampingan. Dua bentuk untuk satu
gagasan adalah cara paling andal melahirkan penyimpangan: setiap penambahan
field berikutnya harus diputuskan dua kali, dan suatu saat hanya salah satunya
yang ikut. `clips[0]` ADALAH `visual` yang lama.

### 2. Klip BERURUTAN, dan begitu ada dua klip, waktu datang dari potongannya

Aturannya sengaja dibuat tajam, bukan bermode:

- **Satu klip** (`clips.length === 1`): perilakunya SAMA PERSIS dengan hari ini.
  `duration: "auto"` mengikuti narasi, klip mengisi seluruh scene, `durationSec`
  klip diabaikan. Seluruh plan yang ada sekarang jatuh ke jalur ini.
- **Dua klip atau lebih**: durasi scene = JUMLAH `durationSec` klipnya, dan
  `scene.duration` wajib `"auto"`. Angka tetap di `scene.duration` bersamaan
  dengan banyak klip ditolak skema.

Alasannya satu kalimat: **begitu kamu memotong, kamu sedang menyunting waktu,
dan waktu datang dari potongannya.** Menskala klip agar muat ke durasi scene
yang ditetapkan tangan adalah keajaiban yang tidak akan pernah bisa ditebak
siapa pun.

Narasi yang lebih panjang daripada jumlah klipnya BUKAN galat skema — itu
keputusan penyuntingan yang mungkin disengaja. Ia jadi temuan `critique`
(`narasi-lebih-panjang-dari-gambar`), sama seperti temuan kerajinan lain.

### 3. Titik keluar diturunkan, tidak disimpan

Satu klip menyimpan `trimStartSec` dan `durationSec`. Titik keluar di rekaman
sumber adalah `trimStartSec + durationSec * speed`, dihitung, bukan disimpan.

Menyimpan `trimEndSec` di samping keduanya berarti tiga angka untuk dua derajat
kebebasan, dan angka ketiga itu akan bertentangan dengan yang lain begitu salah
satunya disunting. Skema ini menolak keadaan yang bisa saling bertentangan; itu
prinsip yang sama dengan keyframe yang rentang nilainya dijepit sama dengan
properti statisnya (ADR-0027).

### 4. Berkas dikunci per ID KLIP

`renderState.clipAssets`, dikunci id klip, menggantikan `resolvedAssets` yang
dikunci id scene. Ini bukan preferensi gaya: dengan kunci scene, klip kedua
menimpa berkas klip pertama. Persis alasan yang sudah tertulis untuk
`layerAssets` sejak ADR-0025 — dan karena alasannya sudah terbukti sekali,
tidak ada gunanya menemukannya lagi lewat cacat.

Id klip WAJIB unik se-plan, bukan cuma se-scene, mengikuti aturan yang sama
dengan id lapisan, grafis, cue SFX, dan trek audio.

### 5. Operasi ripple ada di CORE, bukan di pemanggilnya

Empat op baru, masing-masing membawa inversnya seperti op lain:

| Op | Arti |
| --- | --- |
| `splitClip` | Belah satu klip di titik waktu; bagian kedua mewarisi aset dan trim |
| `trimClip` | Ubah `trimStartSec`/`durationSec`; mode `ripple` menggeser saudaranya, `roll` menukar durasi dengan tetangganya |
| `removeClip` | Buang satu klip; ripple menutup celahnya |
| `reorderClips` | Susun ulang di dalam scene |

Aritmetikanya hidup di `@dalang/core`, bukan di Studio dan bukan di agent.
Kalau ia hidup di pemanggilnya, Studio dan agent akan menghitungnya sendiri
sendiri, dan suatu saat berbeda — persis kelas cacat yang dihindari resep format
dengan memakai satu sumber untuk menasihati DAN memeriksa (ADR-0017).

Inversnya adalah **daftar klip sebelumnya**, bukan operasi kebalikan yang
dihitung ulang. Ripple menyentuh banyak klip sekaligus; membalikkannya dengan
aritmetika terbalik adalah cara halus kehilangan satu klip di ujung. Menyimpan
daftar sebelum-dan-sesudah selalu benar, dan biayanya beberapa ratus byte per
langkah undo.

### 6. Di dalam scene, bawaannya POTONG

`clip.transition` opsional dan bawaannya potong keras. `scene.transition` tetap
apa adanya: transisi KELUAR ke scene berikutnya.

Ini mengikuti kaidah penyuntingan, bukan selera: di dalam satu gagasan, potongan
adalah bawaan, dan larut adalah pilihan sadar. Membuat larut jadi bawaan di
dalam scene akan menghasilkan wawancara yang meleleh setiap tiga detik.

### 7. Skema naik ke versi 2, dengan fungsi migrasi yang pertama

`SCHEMA_VERSION = 2`. `parseScenePlan` tidak lagi menolak versi 1; ia
MEMIGRASIKANNYA lebih dulu, lalu memvalidasi hasilnya.

```
v1 -> v2:
  scene.visual                  -> scene.clips = [{ ...visual, id: `${scene.id}-k1` }]
  renderState.resolvedAssets[s] -> renderState.clipAssets[`${s}-k1`]
```

Tiga sifat yang dijaga:

- **Murni dan satu arah.** Migrasi adalah fungsi tanpa efek; ia tidak menulis
  berkas. Plan yang dimigrasikan baru tersimpan saat plan itu memang disimpan,
  lewat jalur tulis yang biasa.
- **Id yang deterministik.** `${sceneId}-k1` bisa dihitung ulang kapan saja,
  jadi migrasi yang dijalankan dua kali menghasilkan id yang sama dan
  `clipAssets` tidak pernah kehilangan jejak berkasnya.
- **Cache tidak dibatalkan.** Kunci cache pipeline adalah hash ISI, bukan bentuk
  plan. Plan yang bermigrasi tanpa perubahan isi tidak mensintesis ulang suara
  atau mengunduh ulang aset apa pun.

## Penerapan: fase 1 (3 September 2026)

Yang SUDAH ada di kode:

- `scene.clips[]` menggantikan `scene.visual` di seluruh repo — 8 paket,
  sekitar 330 titik sentuh. `clipSchema` memakai bentuk `Visual` apa adanya
  plus `id`, `durationSec?`, dan `transition?`.
- `renderState.clipAssets` dikunci id KLIP menggantikan `resolvedAssets` yang
  dikunci id scene.
- `SCHEMA_VERSION = 2`, `migrateV1ToV2`, dan `migrateScenePlan` — rantai
  migrasi pertama repo ini. `parseScenePlan` DAN `safeParseScenePlan`
  keduanya memigrasikan; dua jalur parse yang berbeda pendapat soal versi
  adalah cara termudah membuat Studio menerima plan yang ditolak CLI.
- Artefak JSON Schema ikut berganti nama jadi `scene-plan.v2.schema.json`, dan
  kedua plan contoh di repo dimigrasikan LEWAT fungsi migrasinya sendiri.
- Helper `primaryClip`, `primaryClipId`, `clipAsset`, `sceneAsset`, `allClips`
  di core. `primaryClipId` ada khusus untuk seam yang paling berbahaya:
  permukaan luar (tool agent, rute Studio, server MCP) bicara dalam id SCENE
  sementara lumbungnya dikunci id KLIP, dan keduanya bertipe `string` — jadi
  TypeScript tidak bisa menangkap tertukarnya.
- Gerbang paritas byte (`pnpm --filter @dalang/renderer migrasi-paritas`) di CI
  untuk kedua plan contoh.

Empat cacat yang ditemukan gerbang dan test selama penerapan, semuanya kelas
yang sama — kunci scene dipakai di tempat yang menuntut kunci klip:

| Ditemukan oleh | Cacat |
| --- | --- |
| uji kritik | temuan hak pakai aset menyebut id KLIP kepada orang yang mencari id SCENE |
| uji sumber Studio | panel Sumber menampilkan `sc-batu-k1` di kolom yang menjanjikan id scene |
| uji audio | `setLoudness` menulis ke kunci yang tidak dibaca siapa pun, jadi kritik "belum diukur" tidak pernah diam |
| pembacaan diff | `splitScene` menyalin id klip induk ke scene baru — id klip wajib unik se-plan, jadi plan hasil belahan ditolak skema |

## Penerapan: fase 2 (5 September 2026)

Keempat op klipnya ada, renderernya menyusun potongannya, timeline-nya bisa
disentuh, dan kedua arah interop memetakannya satu-ke-satu.

**Core.** `clips.ts` memegang seluruh aritmetikanya — `splitClipAt`,
`trimClipEdge`, `removeClipAt`, `reorderClipsTo`, plus `trimBounds` /
`splitBounds` / `clampTrimDelta` yang DIEKSPOR supaya seretan pointer memakai
rumus yang sama dengan yang dipakai op untuk menolak. Op-nya sendiri di
`patch.ts`, dan invers keempatnya `setClips` yang membawa daftar klip
sebelumnya apa adanya beserta durasi scene-nya.

`setClips` adalah op KELIMA yang tidak disebut ADR ini. Ia lahir dari
inversnya: daftar klip sebelumnya harus punya op yang bisa memasangnya
kembali. Ia sekaligus jalan bagi agent untuk mengarang seluruh strip sekaligus,
dan bagi rute belah-scene untuk membagi potongan ke dua scene dalam satu patch.

**Renderer.** `ClipStrip` dipakai kedua preset lewat render-prop. Potong keras
memakai petak `Sequence` yang menutup rapat; larut memakai `TransitionSeries`
dengan separuh tumpang tindih di tiap sisi, sehingga panjang scene tidak
berubah dan titik tengah larut mendarat tepat di batas potongan.
`clipFrameSpans` membulatkan dari jumlah KUMULATIF — membulatkan tiap durasi
sendiri-sendiri menumpuk selisih setengah bingkai sampai potongan terakhir
berakhir sebelum scene-nya.

**Studio.** Titik potong digambar di dalam kotak scene dan bisa diseret
(`roll`, supaya kotak sesudahnya tidak melompat di bawah jari). Pisau di
transport membelah KLIP; tombol kedua membelah SCENE. Panel Properti punya
daftar potongan, dan seluruh kendali visualnya menyasar potongan terpilih —
memilih potongan juga MEMBAWA preview ke tengah potongan itu, karena kendali
yang menyasar sesuatu yang tidak terlihat adalah kendali yang disetel dengan
mata tertutup. Di bawah daftar itu ada kartu potongan: bawaannya potong keras,
dan larut dipasang per potongan kalau memang dibutuhkan.

**Potongan antar klip (§6) punya jalan masuk.** `updateScene.patch.clip`
menerima `transition`, dan `null` mengembalikannya ke potong keras. Sebelum ini
satu-satunya cara menyilangkan dua potongan adalah menulis ulang SELURUH daftar
lewat `setClips` — jalur yang tidak dipakai UI mana pun dan tidak pernah dipakai
agent, jadi kemampuan yang sudah ada di skema dan di renderer praktis tidak
terjangkau. Ia duduk di `clip`, bukan sebagai op sendiri, karena ini properti
sebuah klip persis seperti `motion` dan `filter`; op klip mengubah SUSUNAN
potongan, bukan isi salah satunya. Kartunya menghapus field-nya alih-alih
menyetel tipe `none`: keduanya terlihat sama di layar tapi yang satu tidak
memakai tumpang-tindih sama sekali sementara yang lain tetap memakan durasinya.

**Pipeline.** Tahap aset bersatuan KLIP, bukan scene. Sebelumnya ia membaca
`primaryClip(scene)` saja, jadi scene berklip tiga dengan tiga kueri berbeda
hanya bisa mendapat berkas untuk potongan pertama — dua sisanya tidak pernah
dicari, dan kegagalannya baru muncul jauh di hilir sebagai latar prosedural di
tengah video. Kunci cache klip pertama tetap id SCENE apa adanya supaya proyek
yang sudah ada tidak mengunduh ulang seluruh asetnya; potongan berikutnya
memakai `scene@klip`, pola yang sama dengan `scene#lapisan` milik ADR-0025.
Kueri turunan dari narasi tetap hanya untuk potongan pertama: menurunkannya
untuk potongan kedua memberi kueri yang sama persis, dan dua potongan berisi
gambar yang sama bukan penyuntingan. Tahap ukur kenyaringan ikut per klip —
potongan bersuara yang tidak pernah diukur adalah lompatan kenyaringan di
tengah scene.

**Permukaan aset per klip.** `replaceAsset` menerima `clipId` (setara `layerId`
milik ADR-0025), rute Sumber Studio meneruskannya, dan panel Sumber menyasar
potongan TERPILIH. Sebelum ini menaruh rekaman ke scene berklip banyak selalu
mendarat di potongan pertama — dan yang menaruhnya baru sadar setelah melihat
potongan yang salah berganti gambar.

**Tool rekaman agent.** `ingestVideo`, `getTranscript`, `findMoments`,
`cutByWords`, dan `analyzeImage` menerima `clipId`. Sebelum ini semuanya
membaca potongan pertama diam-diam, dan `cutByWords` bahkan selalu GAGAL di
scene berklip banyak: ia menulis angka ke `scene.duration`, yang ditolak skema
(§2) — persis di satu-satunya jenis scene yang lahir dari memotong rekaman
panjang, yaitu alasan ADR ini ada. Jalur berklip banyak menyetel titik masuk
lalu menggeser tepi KELUAR lewat `trimClip` ripple: aritmetikanya sudah ada di
core, batas ujung rekaman ikut dijaga di sana, dan inversnya membuat undo
mengembalikan titik masuk sekaligus panjang potongan. Klip yang DISEBUT tapi
tidak ada ditolak beserta daftar id yang tersedia, bukan jatuh diam-diam ke
potongan pertama: memotong potongan yang salah jauh lebih sulit dilihat
daripada galat. `locateUiElement` sengaja TETAP membaca potongan pertama —
anotasi tutorial-01 milik scene (lihat Batas yang dinyatakan), jadi ia harus
menunjuk screenshot yang sama dengan yang digambar preset itu.

**Interop.** Ekspor: satu klip Dalang = satu klip OTIO/FCPXML, transisi di
dalam scene ikut. Impor: potongan berurutan dari BERKAS yang sama jadi satu
scene berklip banyak, bukan satu scene per potongan. Catatan "yang tidak ikut
menyeberang" dihitung ulang per KLIP: sebelumnya semuanya membaca klip pertama
saja, jadi scene berklip dua belas yang sebelas potongannya ber-Ken Burns
melaporkan nol.

**Penyimpangan fase 1 DITUTUP.** `updateScene.patch.visual` kini bernama
`patch.clip`, dan op-nya menerima `clipId`. Alasan penundaannya — "belum ada
kemampuan baru untuk ditunjukkan" — habis begitu penyuntingan per-klip ada:
tanpa `clipId`, scene wawancara berklip dua belas hanya bisa disetel gerak dan
filternya di potongan pertama. Nama `visual` tetap dipakai LAPISAN video; di
sana ia memang bukan klip.

Cacat yang ditemukan test dan gerbang selama fase ini:

| Ditemukan oleh | Cacat |
| --- | --- |
| pembacaan diff Studio | pegangan trim tepi kanan mengirim `updateScene { duration }`, yang untuk scene berklip banyak DITOLAK skema (§2) — seretan terlihat berhasil lalu gagal merah |
| pembacaan rute | belah scene menyalin `clips[0]` saja, jadi potongan kedua dan seterusnya hilang tanpa memberi tahu siapa pun |
| uji impor | tiga potongan dari satu berkas jadi tiga scene; setelah dikelompokkan, penempelan lapisan masih memakai indeks KLIP sebagai indeks SCENE |
| uji `clipFrameSpans` | scene yang lebih pendek dari jumlah klipnya melahirkan petak nol bingkai — ditolak Remotion, dan mustahil dilacak balik ke pembulatan |
| uji mutasi pada gerbang interop | harapan jumlah peralihan dibaca dari `timeline` yang sedang diuji: mematikan ekspor transisi di dalam scene membuat kedua sisi turun bersamaan dan gerbangnya tetap hijau — tautologi yang persis diperingatkan komentar gerbang itu sendiri |
| pembacaan permukaan | `clip.transition` ada di skema dan dipakai renderer, tapi tidak ada op yang bisa menyetelnya selain menulis ulang seluruh daftar; kemampuannya nyata dan tidak terjangkau |
| pembacaan pipeline | tahap aset, tahap kenyaringan, dan `materializeCandidate` semuanya bersatuan SCENE: scene berklip banyak hanya bisa meresolusi potongan pertamanya |
| audit permukaan lanjutan | lencana aset timeline, kritik gerak monoton, tab Audio, panel Sumber, rute Sumber, dan `recordingsInPlan` semuanya membaca potongan pertama saja — masing-masing menjawab dengan yakin tentang seluruh scene |
| gerbang paritas migrasi di CI | gerbangnya menuduh "ada field yang tidak ikut pindah" untuk selisih byte apa pun, padahal kedua plan sudah terbukti identik setelah parse — selisihnya mustahil datang dari migrasi. Kini tiap sisi dirender dua kali sebagai kontrol, dan render yang tidak deterministik dilaporkan sebagai dirinya sendiri |
| hitungan piksel gerbang paritas | render kontrol membuktikan sumbernya bukan migrasi, dan hitungan pikselnya memberi angkanya: 248 piksel (0,191% bidang), selisih kanal terbesar 2/255 — pembulatan rasterisasi, bukan gambar yang berganti. Kedua gerbang paritas kini memakai satu ambang bersama (`withinRasterNoise`), dan setiap toleransi dicetak beserta angkanya. Diuji mutasi: mengganti satu teks memberi 3060 piksel dengan selisih kanal 165/255 — tetap jatuh |
| tes tool agent | `cutByWords` selalu gagal di scene berklip banyak; `ingestVideo`, `getTranscript`, `findMoments`, dan `analyzeImage` menyunting potongan pertama tanpa satu pun tanda |

## Rencana verifikasi

Belum diterapkan; ini yang akan membuktikannya, ditulis lebih dulu supaya
tidak dikarang belakangan agar cocok dengan hasil.

1. **Paritas render byte per byte.** SUDAH — `migrasi-paritas` di CI, tiga
   frame per plan contoh, identik byte per byte. Di luar itu, sekali secara
   manual saat penerapan: tiga still 1080p dari plan demo ditangkap SEBELUM
   core disentuh, lalu dibandingkan dengan hasil setelah skema naik. Ketiga
   sha256-nya sama persis, jadi perpindahan ini benar-benar tidak menggeser
   satu piksel pun — bukan cuma konsisten dengan dirinya sendiri.
2. **Ripple diuji sebagai aritmetika murni**, bukan lewat UI: memendekkan klip
   ketiga dari lima menggeser klip empat dan lima persis sebesar selisihnya, dan
   jumlah durasi scene ikut berubah persis sebesar itu juga. SUDAH —
   `adr-0033-klip.test.ts`.
3. **Undo satu langkah mengembalikan SEMUA klip** yang tersentuh ripple —
   properti yang paling mudah rusak kalau invers dihitung ulang. SUDAH.
4. **Belah lalu gabung kembali** menghasilkan klip yang identik dengan aslinya,
   termasuk `trimStartSec` dan asetnya. SUDAH.
5. **Migrasi dijalankan pada setiap plan contoh di repo**, dan hasilnya lolos
   skema versi 2 tanpa satu pun field hilang. SUDAH — keduanya dimigrasikan
   lewat fungsinya sendiri lalu disimpan sebagai v2.
6. **Gerbang interaksi** menyeret tepi klip di timeline dengan pointer sungguhan
   lewat CDP, lalu memeriksa PLAN DI SERVER — seretan yang cuma menggeser kotak
   di layar tanpa patch adalah cacat yang tidak ditangkap unit test mana pun.
   SUDAH: seretan 40 px menggeser potongan pertama +1,67 dtk sementara jumlah
   durasi scene tidak bergeser satu milidetik pun (roll), dan pisau menambah
   satu potongan tanpa menambah scene.
7. **Paritas render setelah renderer disentuh.** Tiga still dari plan demo
   dirender SEBELUM dan SESUDAH `ClipStrip` masuk; ketiga sha256-nya sama
   persis, jadi scene berklip satu benar-benar tidak bergeser satu piksel pun.
8. **Gerbang interop membaca plan BERKLIP BANYAK**, bukan cuma plan contoh yang
   kebetulan berklip satu. SUDAH: gerbangnya menjalankan tiap plan dua kali —
   apa adanya, lalu sebagai varian yang satu scene-nya dibelah jadi tiga lewat
   op `splitClip` sungguhan dengan satu batas disilangkan. Dibuktikan menggigit
   dengan dua mutasi: menggeser awal klip satu bingkai dan mematikan ekspor
   transisi di dalam scene, dua-duanya merah sekarang dan salah satunya hijau
   sebelum ini.
9. **Contoh yang benar-benar berklip banyak, dirender CI.** SUDAH —
   `examples/klip-borobudur`: satu narasi, tiga potongan, satu potong keras dan
   satu larut. Sebelum ini kedua contoh repo berklip satu, jadi `ClipStrip`
   tidak pernah dirender di CI sama sekali dan klaimnya bersandar pada satu
   render manual. Contohnya ikut render smoke (termasuk bingkai tepat di tengah
   larut antar klip) dan gerbang interop, tapi TIDAK ikut gerbang paritas
   migrasi: v1 tidak punya bentuk untuk scene berklip banyak, jadi
   menurunkannya mustahil.
10. **Kartu potongan mengirim patch, bukan cuma menyala.** SUDAH — gerbang
   interaksi menekan kartunya lewat pointer CDP dan memeriksa PLAN DI SERVER:
   `transition` muncul sebagai cross-fade, lalu benar-benar HILANG (bukan jadi
   tipe `none`) setelah kartu potong keras ditekan.

## Batas yang dinyatakan

Yang TIDAK diberikan ADR ini, supaya tidak ada yang menyangka sebaliknya:

- **Bukan J/L cut.** Audio tetap melekat pada kliknya sendiri dan tidak bisa
  mendahului atau melewati batas kliknya. Suara yang mendahului gambar butuh
  trek audio terpisah, yang sudah ada (`audio.tracks`), tapi bukan sebagai
  operasi penyuntingan pada klipnya.
- **Bukan speed ramp.** `speed` tetap satu angka tetap per klip; ia belum masuk
  daftar properti yang bisa di-keyframe.
- **Bukan multicam.** Tidak ada sinkronisasi banyak sumber pada satu garis
  waktu.
- **Lapisan tetap milik SCENE, bukan klip**, dan tetap maksimal dua. Menjadikan
  lapisan milik klip adalah keputusan tersendiri dengan pertanyaannya sendiri
  soal apa yang terjadi saat klip di bawahnya dibelah.
- **Visual dasar tetap tidak bisa di-keyframe.** Batas ini dari ADR-0027 tidak
  ikut dicabut di sini.
- **Preset tutorial-01 menggambar potongannya, tapi ANOTASINYA tetap milik
  scene.** Sorotan, panah, dan zoom berjangkar pada satu screenshot dengan
  waktu relatif terhadap scene; potongan kedua yang menampilkan layar lain
  tidak membawa anotasinya sendiri. Menjadikan anotasi milik klip adalah
  keputusan tersendiri dengan pertanyaannya sendiri soal apa yang terjadi saat
  klipnya dibelah.
- **Belum ada rekaman kamera asli** yang melewati pipeline di repo ini; media
  ujinya disintesis ffmpeg. ADR ini tidak mengubah keadaan itu.

## Konsekuensi

- Memotong rekaman panjang berhenti melahirkan scene sampah. Satu wawancara jadi
  satu scene dengan dua belas klip, dengan satu narasi, satu caption, dan satu
  transisi keluar.
- **Ekspor interop jadi lebih setia.** Selama ini satu scene dipetakan ke satu
  klip OTIO/FCPXML; dengan klip yang sungguhan, pemetaannya jadi satu-ke-satu
  dan impor dari editor lain bisa menghasilkan scene berklip banyak alih-alih
  satu scene per potongan. Laporan "yang tidak ikut menyeberang" bertambah
  entri setingkat klip.
- **Fungsi migrasi pertama repo ini lahir**, beserta gerbang yang menjaganya.
  Bump versi berikutnya jadi jauh lebih murah karena jalurnya sudah ada.
- Biayanya nyata: skema, patch op, resolusi durasi, tahap pipeline, template
  renderer, timeline Studio, tool agent, dan kedua arah interop semuanya
  tersentuh. Ini bukan perubahan sore hari.

## Alternatif yang ditolak

**Tetap satu klip per scene, dan permanis di UI.** Tombol "belah scene" sudah
ada. Ditolak karena ripple lintas scene tidak bisa dinyatakan sama sekali, dan
setiap potongan tetap melahirkan narasi, caption, dan transisi yang tidak
diminta. Yang dipermanis cuma gejalanya.

**Model trek global ala NLE sungguhan** — satu garis waktu, klip di mana saja,
scene dihapus. Ditolak karena scene adalah unit yang membuat Dalang berbeda:
agent menalar per scene, narasi dan caption melekat padanya, resep format
mengukurnya. Menukarnya dengan trek berarti membuang alasan produk ini ada, demi
menyamai perkakas yang sudah lebih baik dalam hal itu selama dua puluh tahun.

**`visual` bertahan dan `clips[]` ditambahkan di sampingnya**, demi migrasi yang
lebih mudah. Ditolak: dua bentuk untuk satu gagasan berarti setiap field
berikutnya diputuskan dua kali, dan suatu saat hanya salah satunya yang ikut.
Migrasi sekali lebih murah daripada percabangan selamanya.

**Klip dengan `startFrac`/`endFrac` di dalam scene**, mengikuti pola lapisan dan
keyframe. Ditolak untuk klip berurutan: fraksi bagus untuk elemen yang MENUMPANG
di atas jendela scene, tetapi klip berurutan justru yang MENENTUKAN jendela itu.
Memakai fraksi berarti durasi scene harus diketahui sebelum klipnya diketahui,
padahal urutannya terbalik.
