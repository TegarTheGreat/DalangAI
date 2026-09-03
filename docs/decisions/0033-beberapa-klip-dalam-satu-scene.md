# ADR-0033 — Beberapa klip dalam satu scene

**Status:** diterima (fase 1 diterapkan) · **Tanggal:** 2 September 2026 · **Fase:** 9 (§9.6, baru)

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

Yang BELUM: keempat op klip (`splitClip`, `trimClip`, `removeClip`,
`reorderClips`), pengeditan klip di timeline Studio, dan pemetaan interop satu
ke satu. Sampai op-nya ada, tidak ada jalur yang bisa MEMBUAT klip kedua;
skema sudah menerimanya dan aturan waktunya (§2) sudah berlaku, tapi renderer
belum menyusun lebih dari satu klip per scene.

**Satu penyimpangan dari ADR ini, dinyatakan:** field payload
`updateScene.patch.visual` BELUM berganti nama jadi `clip`. Ia sekarang
menyasar `clips[0]`. Alasannya: mengganti nama di wire menyentuh Studio,
agent, dan MCP tanpa satu pun kemampuan baru untuk ditunjukkan, dan
penyuntingan per-klip yang membuat nama itu berarti baru datang di fase 2.
Bentuk DATA-nya tunggal seperti yang diputuskan ADR ini — yang ditunda hanya
nama field di satu payload patch.

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
   jumlah durasi scene ikut berubah persis sebesar itu juga.
3. **Undo satu langkah mengembalikan SEMUA klip** yang tersentuh ripple —
   properti yang paling mudah rusak kalau invers dihitung ulang.
4. **Belah lalu gabung kembali** menghasilkan klip yang identik dengan aslinya,
   termasuk `trimStartSec` dan asetnya.
5. **Migrasi dijalankan pada setiap plan contoh di repo**, dan hasilnya lolos
   skema versi 2 tanpa satu pun field hilang. SUDAH — keduanya dimigrasikan
   lewat fungsinya sendiri lalu disimpan sebagai v2.
6. **Gerbang interaksi** menyeret tepi klip di timeline dengan pointer sungguhan
   lewat CDP, lalu memeriksa PLAN DI SERVER — seretan yang cuma menggeser kotak
   di layar tanpa patch adalah cacat yang tidak ditangkap unit test mana pun.

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
