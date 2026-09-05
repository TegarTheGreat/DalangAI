# Roadmap Dalang AI

**Disusun:** 30 Agustus 2026 · **Dasar:** inventaris kode yang benar-benar ada
di repo ini + riset lapangan (editor video, kerangka agentik, format
interchange, model generatif dan ASR) per Agustus 2026.

Dokumen ini bukan daftar keinginan. Tiap celah di bawah punya bukti — entah
dari kode yang tidak ada di repo ini, atau dari kemampuan yang sudah jadi
standar di tempat lain. Tiap item roadmap menyebut **apa yang ia buka** dan
**apa yang ia minta**, karena butir yang tidak bisa menjawab keduanya belum
layak masuk rencana.

---

## 1. Posisi Dalang hari ini

Yang sudah nyata, bukan rencana:

| Lapisan | Isi |
| --- | --- |
| Model data | scene-plan JSON v2 (Zod ketat, dengan rantai migrasi), 13 patch op, tiap op punya inversnya → undo/redo lintas restart |
| Pipeline | TTS + aset, cache content-hash, resume, fallback berjenjang, ledger biaya SQLite |
| Agent | 21 tool, guardrail (batas langkah, batas anggaran, approval gate), resep per format konten, `critiqueDraft` |
| Render | Remotion 4.0.518, lokal + Lambda lewat port `RenderTarget`, 4 format × 3 resolusi × 3 mutu |
| Studio | lobi + editor 3 panel, timeline NLE, pustaka media (ikon/stiker/SFX), gerbang tata letak 18 lebar + gerbang interaksi (seretan sungguhan lewat CDP) |
| Preset | `documentary-01`, `tutorial-01` |

**Kekuatan yang tidak dimiliki kebanyakan pesaing.** Riset agent 2026
(MAGE, TrajAD) bergerak ke arah "memori sebagai manajemen state eksekusi
dengan rollback", bukan retrieval semantik. Patch log Dalang — tiap mutasi
punya invers, tersimpan, bisa diputar mundur — **sudah** bentuk itu, dan
dibangun sejak ADR-0002 bukan karena mengikuti tren. Sama halnya: satu
sumber kebenaran JSON yang bisa dibaca dan ditulis LLM adalah persis yang
disebut praktisi sebagai fondasi editing agentik.

**Kelemahan struktural yang harus dinyatakan.** Dalang hari ini adalah
**generator video**, bukan **editor rekaman orang lain**. Ia menulis naskah,
membuat suara, mengambil stok, lalu menyusunnya. Ia belum bisa menerima satu
jam rekaman podcast dan mengeditnya — dan itulah yang dilakukan Descript,
Opus Clip, dan ChatCut.

---

## 2. Peta lapangan

Editing video 2026 terbelah tiga, dan Dalang berdiri di celah antara dua di
antaranya:

1. **Editor tradisional + fitur AI** — Premiere, DaVinci, CapCut, Veed. AI
   membantu alur yang sudah ada.
2. **Editor AI-first** — Descript, ChatCut, Opus Clip. AI adalah antarmuka
   utamanya; hampir semuanya **transcript-first**.
3. **Generatif** — Runway, Pika, Sora, Veo, Kling. AI membuat footage-nya.

Dalang adalah kategori keempat yang belum ramai: **timeline sebagai kode,
dipiloti agent, dengan render deterministik**. Yang paling dekat:

- **ChatCut** — satu-satunya yang menyebut diri "agentic editor". Tauri + Next
  + FastAPI, Gemini/Groq, mengembalikan timeline multi-track yang bisa
  disunting. **Sudah bisa dipanggil dari dalam ChatGPT dan Claude.**
- **Remotion** — fondasi render Dalang. Bukan pesaing, tapi **risiko lisensi**
  (lihat §5).
- **OpenTimelineIO** — bukan editor, tapi format interchange yang kini punya
  plugin native untuk FCP, Premiere, dan Resolve. Formatnya JSON, jadi LLM
  bisa membaca dan menulisnya langsung.

Satu celah yang disebut praktisi sebagai **belum terselesaikan siapa pun**:
"purpose-built headless NLE" — CLI NLE siap produksi dengan timeline
terprogram. Dalang paling dekat ke sana dibanding proyek mana pun yang
terlihat di riset ini. Itu posisi yang layak dipertahankan.

---

## 3. Celah, dengan buktinya

### 3.1 Tidak ada transkripsi sama sekali — celah terbesar

`grep -rln "transcri|whisper|asr" packages/*/src` → **nol hasil.** Port di
`packages/pipeline/src/ports.ts` hanya `TtsProvider`, `StockProvider`,
`IconProvider`, `SfxProvider`. Word timestamp **hanya** datang dari TTS.

Akibatnya berantai: tanpa transkrip, Dalang tidak bisa memotong berdasarkan
kata, tidak bisa membuang "emm" dan pengulangan, tidak bisa mencari momen
kunci di rekaman, tidak bisa memberi caption pada footage orang, dan agent
tidak punya cara memahami isi rekaman selain melihat frame-nya satu-satu.
`findCutPoints` dan `detectSilence` bekerja di level energi audio, bukan
makna.

Semua editor AI-first membangun di atas transkrip. Ini bukan fitur tambahan;
ini fondasi yang hilang.

### 3.2 Loop "agent melihat hasilnya sendiri" belum tertutup

Ada `analyzeImage` (vision atas gambar yang diberikan) dan `critiqueDraft`
(kritik atas struktur plan). Yang **tidak** ada: agent merender preview
murah, melihat hasilnya sendiri, lalu memperbaiki. Padahal itu persis pola
yang dianjurkan untuk editing agentik: `baca timeline → render preview
rendah → model multimodal menilai → agent iterasi`.

Dalang punya semua bahannya (`renderPreview`, `analyzeImage`, patch ops) —
yang kurang hanya perekatnya.

### 3.3 Tidak bisa keluar ke perkakas profesional

Tidak ada ekspor OTIO/FCPXML/EDL. Hasil kerja Dalang berakhir sebagai berkas
video; tidak ada jalan membawa rough cut-nya ke Resolve atau Premiere untuk
finishing. Remotion sendiri punya permintaan fitur terbuka untuk ini.

Ini memotong Dalang dari seluruh alur kerja profesional — dan biayanya
relatif kecil karena scene-plan sudah berupa JSON terstruktur.

### 3.4 Tidak bisa dipanggil agent lain

Dalang punya CLI dan UI, tapi bukan **server MCP**. Artinya Claude Code,
ChatGPT, atau agent lain tidak bisa mengedit video lewat Dalang. ChatCut
sudah bisa. Setiap kerangka agent besar 2026 mendukung MCP — native (Claude
Agent SDK, OpenAI Agents SDK, Microsoft Agent Framework) atau lewat adapter
(LangGraph, CrewAI).

### 3.5 Manipulasi langsung di kanvas

Teks dan grafis hanya bisa dipindah lewat form di panel Properti. Tidak ada
seret-dan-ubah-ukuran di atas preview. Ini celah paling kentara dibanding
editor mana pun.

### 3.6 Audio masih satu lapis tipis

Ada musik latar dengan ducking dan cue SFX. Tidak ada: volume/fade per klip,
lebih dari satu track audio, normalisasi loudness (EBU R128), atau kontrol
mix. Untuk video bernarasi ini terasa cepat.

### 3.7 Satu track video

Timeline punya satu track video; overlay (grafis, teks, anotasi) hidup
sebagai properti scene, bukan sebagai lapisan yang bisa disusun bebas.
Picture-in-picture, split screen, dan B-roll di atas A-roll belum mungkin.

### 3.8 Tanpa keyframe sembarang

Gerak tersedia sebagai preset (`zoom masuk`, `pan kiri`, …). Tidak ada
keyframe manual: nilai properti apa pun pada waktu apa pun.

### 3.9 Agent tanpa eval dan tanpa memori lintas proyek

Tidak ada suite eval untuk kualitas keluaran agent — tidak ada cara mengukur
apakah perubahan prompt/model membuatnya lebih baik atau lebih buruk. Tidak
ada memori preferensi lintas proyek ("saya selalu pakai caption tegas").

### 3.10 Rekaman panjang belum ditangani

Tidak ada proxy, tidak ada strategi untuk rekaman satu jam. `MAX_FILMSTRIP_FRAMES`
membatasi thumbnail, tapi tidak ada jalur khusus untuk sumber besar.
*(Ditutup oleh ADR-0028 — proxy per berkas, unggah streaming, strip bingkai +
gelombang untuk memilih titik masuk — dan ADR-0033, yang memberi BENTUK DATA
untuk potongannya: satu scene, banyak klip, dengan ripple di core.)*

### 3.11 Tanpa footage generatif

Tidak ada integrasi Veo/Kling/Runway. Ini **bukan** celah mendesak (lihat
§6), tapi perlu dicatat sebagai pilihan sadar, bukan kelalaian.

---

## 4. Roadmap

Urutannya bukan selera: tiap fase membuka fase berikutnya.

### Fase 6 — Transkrip sebagai fondasi

**Sudah dikerjakan** (ADR-0021) — 6.1 sampai 6.5. Batas yang tersisa ada di
"Batas yang dinyatakan" ADR-0021: jalur API dan whisper.cpp belum pernah
dijalankan terhadap layanan/binari sungguhan.

> Membuka: memotong berdasarkan kata, buang jeda/filler, caption untuk
> footage orang, agent yang memahami isi rekaman.

| # | Item | Minta |
| --- | --- | --- |
| 6.1 | Port `AsrProvider` + word timestamp + diarisasi opsional | Pola port yang sama dengan `TtsProvider` |
| 6.2 | Rantai provider: lokal (whisper.cpp/WhisperX) → API (AssemblyAI/Deepgram/ElevenLabs Scribe) | Jalur offline wajib ada, seperti `silence` di TTS |
| 6.3 | Transkrip masuk scene-plan (`renderState.transcripts`) + cache content-hash | Perubahan skema → butuh ADR |
| 6.4 | Tool agent: `transcribeVideo`, `findMoments`, `cutByWords` | Patch op baru untuk trim berbasis kata |
| 6.5 | UI: panel transkrip yang bisa diklik untuk seek dan dipotong | Panel baru |

**Kenapa duluan:** §3.1 memblokir §3.2, §3.6, dan sebagian besar nilai
"editor" (bukan "generator"). Tanpa ini Dalang tidak pernah bisa mengedit
rekaman orang.

**Catatan pemilihan provider (per Agustus 2026):** WhisperX untuk jalur
self-host (word timestamp + diarisasi, ~4× lebih cepat dari Whisper);
AssemblyAI Universal-3.5 Pro memimpin akurasi kata; Speechmatics memimpin
WER; ElevenLabs Scribe v2 Realtime untuk latensi rendah. Titik impas
self-host vs API kira-kira 500 jam/bulan — relevan untuk keputusan default.

### Fase 7 — Agent yang melihat hasil kerjanya

**Sudah dikerjakan** (ADR-0022) — 7.1 sampai 7.4, plus dua hal yang tidak ada
di tabel ini tapi ternyata dibutuhkan: tinjauan mendapat permukaan Studio dan
CLI (bukan hanya tool agent), dan `--self-check` eval dipasang sebagai gerbang
CI. Batas yang tersisa ada di "Batas yang dinyatakan" ADR-0022: jalur vision
belum pernah dijalankan terhadap model sungguhan.

> Membuka: kritik yang berdasar pada gambar nyata, bukan pada struktur JSON.

| # | Item | Minta |
| --- | --- | --- |
| 7.1 | Tool `reviewRender`: render still murah di beberapa titik → vision → temuan terstruktur | Sudah ada `renderPreview` + `analyzeImage` |
| 7.2 | Loop revisi berbatas: temuan → patch → render ulang, dengan batas iterasi dan biaya | Guardrail baru (jangan sampai loop tak berujung) |
| 7.3 | Gabungkan dengan `critiqueDraft`: kritik struktur + kritik gambar jadi satu laporan | — |
| 7.4 | Suite eval agent: sekumpulan brief, penilaian otomatis + rubrik | Investasi nyata; tanpa ini §7.2 tidak bisa diukur |

**Kenapa di sini:** ini yang mengubah "agent yang mengisi form" jadi "agent
yang punya penilaian". Dan §7.4 harus ikut, kalau tidak kita cuma menebak
apakah perubahannya membantu.

### Fase 8 — Keluar dan masuk

**Sudah dikerjakan** (ADR-0023) — 8.1 sampai 8.4 penuh. Impor membaca OTIO dan
FCPXML (spine utama), lewat CLI maupun lobi Studio. Batas yang tersisa ada di
"Batas yang dinyatakan" ADR-0023: belum pernah dibuka di Resolve/Premiere/Final
Cut yang sungguhan, dan connected clip di lane tidak dipulihkan karena garis
waktu Dalang baru punya satu jalur video — batas terakhir ini DICABUT oleh
ADR-0025 (§9.2): lane positif kini dipulihkan jadi lapisan video.
Batas "server MCP tidak menyelaraskan diri dengan Studio" DICABUT: keduanya kini
boleh memegang proyek yang sama tanpa saling menimpa (bandingkan-dan-tukar di
server MCP, delta renderState di tahap pipeline Studio).

> Membuka: Dalang jadi bagian alur kerja profesional, bukan pulau.

| # | Item | Minta |
| --- | --- | --- |
| 8.1 | Ekspor OTIO dari scene-plan | Pemetaan scene → clip/track; efek tidak terpetakan penuh (batas OTIO) |
| 8.2 | Ekspor FCPXML (lebih ekspresif untuk keyword/marker) | — |
| 8.3 | Impor OTIO/FCPXML jadi scene-plan | Lebih sulit; boleh menyusul |
| 8.4 | **Server MCP Dalang** — timeline sebagai tool untuk agent lain | Permukaan tool baru; guardrail harus ikut |

**Kenapa penting:** §8.1–8.2 murah relatif nilainya, karena scene-plan sudah
JSON terstruktur. §8.4 mengubah Dalang dari aplikasi jadi **kemampuan** yang
bisa dipakai agent mana pun.

### Fase 9 — Editor yang terasa seperti editor

**§9.1 sudah dikerjakan** (ADR-0024): teks dan grafis bisa diseret dan diubah
ukurannya langsung di atas preview, keluarannya patch op biasa. Skema teks
bertambah `offsetX`/`offsetY`. Anotasi tutorial menyusul: preset menandainya di
DOM dan kotak `target`-nya bisa diseret dan diubah ukurannya di kanvas — batas
awal ADR-0024 dicabut. Elemen yang diseret kini menempel ke elemen lain (pusat,
tepi, bersebelahan) dengan garis bantu di tepi yang disejajarkan.

**§9.2 sudah dikerjakan** (ADR-0025): satu scene bisa punya dua lapisan video di
atas visual dasarnya — B-roll, picture-in-picture, sisipan bukti. Lapisan
ter-render di kedua preset, bisa diseret & diubah ukurannya di kanvas, punya
kartu sendiri di panel Properti dan bar sendiri di timeline, di-resolve pipeline
seperti aset lain, dan diekspor sebagai lane OTIO/FCPXML. Impor lane pun ikut
terbuka — batas ADR-0023 soal connected clip dicabut. Batas yang tersisa ada di
"Batas yang dinyatakan" ADR-0025 (maks 2 lapisan, sisipan lintas scene ditulis
dua kali, suara cuma satu angka gain).

**§9.4 sudah dikerjakan** (ADR-0026): satu bentuk amplop audio — volume, fade
masuk/keluar, ducking, normalisasi — dipakai suara aset visual, suara lapisan,
dan trek audio tambahan; utang `visual.volume` milik ADR-0025 lunas. Kenyaringan
diukur dengan pengukur EBU R128 / ITU-R BS.1770-4 yang ditulis sendiri (tanpa
ffmpeg), tiap klip dibawa ke `meta.loudnessTarget` sebelum volumenya
diterapkan, dan narasi ikut disamakan. Berkas mono dikoreksi 3,01 LU karena
campurannya stereo. Diverifikasi lewat render sungguhan: sumber mono dan stereo
sama-sama mendarat di -16,00 LUFS. Batasnya ada di "Batas" ADR-0026 — yang
terbesar: AAC/MP4 tidak terukur pada Chromium tanpa kodek proprietary, dan
klip seperti itu dilewati dengan alasan yang disebutkan, bukan ditebak.
Fade masuk/keluar musik dan trek kini juga bisa DISERET di timeline (pegangan di
ujung bar, ramp digambar) — batas "tidak bisa di-fade lewat kanvas" dicabut.

**§9.3 sudah dikerjakan** (ADR-0027): keyframe kini DATA PLAN, bukan lagi kode
preset. `tracks` pada grafis, teks, dan lapisan menganimasikan properti yang
daftarnya tertutup dan rentang nilainya sama persis dengan properti statisnya;
waktunya fraksi jendela elemen (scene yang dipanjangkan membawa animasinya),
easing-nya bernama, dan properti yang punya track ditentukan PENUH olehnya —
tanpa mematikan preset untuk properti lain. Dipasang di posisi playhead lewat
Studio, terlihat sebagai berlian di timeline, dan diverifikasi dari PIKSEL
render: teks ber-track mendarat di 0,2888 / 0,4295 / 0,5688 lebar bingkai
(ramalan 0,290 / 0,430 / 0,570), sementara plan yang sama tanpa track diam di
0,4988. Berlian di timeline kini bisa diseret dan digeser dari papan ketik
(batas awalnya dicabut); yang tersisa: visual dasar scene belum bisa
di-keyframe — selengkapnya di "Batas" ADR-0027.

**§9.5 sudah dikerjakan** (ADR-0028; campuran akhir kini juga DIKOREKSI ke
sasaran dengan penguatan rata — Keputusan 9 — dan proxy dibuat DI LATAR dengan
kemajuan per berkas serta tombol batal — Keputusan 10): rekaman panjang dan berkas berat kini
punya PROXY pratinjau — H.264 sisi pendek 540, laju bingkai dipangkas ke 30 —
yang dibuat ffmpeg bawaan Remotion (tanpa biner baru), dikunci per berkas di
`renderState`, dan dipakai HANYA oleh preview Studio dan render draf; render
final selalu membaca berkas aslinya. Keputusan "perlu proxy" adalah fungsi
murni dengan alasan yang terbaca (kodek yang tidak diputar browser, rekaman
≥ 60 detik, resolusi di atas 720p, laju di atas 30 fps). Rekaman masuk proyek
dari Studio lewat unggah STREAMING ke disk (bukan data URL), lalu dipilih
titik masuknya dengan MELIHAT rekamannya: strip bingkai dan bentuk gelombang
sepanjang seluruh rekaman, jendela scene digambar di atasnya. Efek
sampingnya yang paling berharga: dekoder ffmpeg yang sama mencabut batas
"AAC/MP4 tidak terukur" milik ADR-0026 dan mengukur CAMPURAN AKHIR setiap
render.

**§9.6 sudah dikerjakan** (ADR-0033): satu scene boleh memuat beberapa klip
berurutan. Ini bentuk data yang menutup kelemahan struktural yang dinyatakan
di §1 dokumen ini — memotong satu jam rekaman berhenti melahirkan puluhan
scene sampah, karena dua belas potongan dari satu wawancara sekarang satu
scene dengan dua belas klip, satu narasi, satu caption. Skema naik ke v2
dengan fungsi migrasi pertama repo ini (dijaga gerbang paritas byte), empat op
klip beserta aritmetika ripple/roll hidup di core, renderer menyusun stripnya,
titik potong bisa diseret di timeline, pipeline meresolusi aset per KLIP, dan
interop memetakan klip satu-ke-satu di kedua arah — dijaga gerbang yang membaca varian berklip banyak dengan
OpenTimelineIO resmi, bukan cuma plan contoh yang kebetulan berklip satu. Di
antara dua potongan bawaannya potong keras; larut dipasang per potongan lewat
`updateScene.clip.transition`. Batasnya di "Batas yang dinyatakan" ADR-0033 (bukan J/L cut,
bukan speed ramp, bukan multicam; lapisan dan anotasi tetap milik scene).

> Membuka: pekerjaan yang hari ini harus dilakukan lewat form.

| # | Item | Minta |
| --- | --- | --- |
| 9.1 | Manipulasi langsung di kanvas: seret/ubah ukuran teks & grafis di preview | Selesai (ADR-0024; anotasi, penempelan ke elemen lain, dan pemilihan jamak menyusul) |
| 9.2 | Multi-track video: overlay/PiP/B-roll sebagai lapisan | Selesai (ADR-0025) |
| 9.3 | Keyframe sembarang untuk properti | Selesai (ADR-0027) |
| 9.4 | Audio: volume/fade per klip, normalisasi EBU R128, track audio tambahan | Selesai (ADR-0026) |
| 9.5 | Proxy + penanganan rekaman panjang | Selesai (ADR-0028) |
| 9.6 | Beberapa klip dalam satu scene: belah, trim ripple/roll, buang, susun ulang | Selesai (ADR-0033) |

**Catatan urutan:** 9.1 memberi rasa paling besar per biaya. 9.2 memang yang
paling mahal — ia menyentuh skema, kedua preset, pipeline, Studio, dan kedua
arah interop sekaligus.

### Fase 10 — Skala dan kolaborasi

**§10.1 sudah dikerjakan** (ADR-0029): agent punya memori preferensi lintas
proyek — kalimat pendek milik user ("selalu pakai caption tegas untuk klip")
dalam satu berkas di rumah Dalang, disuntikkan tiap giliran, disimpan agent
HANYA bila user menyatakannya eksplisit sebagai kebiasaan tetap, dan selalu
terlihat serta bisa dihapus di lobi Studio dan `dalang memori`. Batasnya di
"Batas" ADR-0029: tidak belajar diam-diam, satu memori per rumah Dalang, tanpa
sinkronisasi antar mesin.

**§10.3 sudah dikerjakan untuk YouTube** (ADR-0030): port `PublishTarget`,
unggahan resumable lewat YouTube Data API v3 dengan token milik user, tahap
`publish` di ledger supaya berkas yang sama tidak naik dua kali, dan tiga
permukaan — tombol Unggah di riwayat render Studio, `dalang publish`, tool
agent `publishVideo` — yang semuanya lewat konfirmasi dan bawaannya privat.
Batasnya di "Batas" ADR-0030: belum pernah dijalankan terhadap YouTube
sungguhan, token akses tanpa refresh, TikTok/Instagram belum.

| # | Item |
| --- | --- |
| 10.1 | Memori preferensi lintas proyek — **sudah dikerjakan** (ADR-0029) |
| 10.2 | Marketplace preset/template |
| 10.3 | Publikasi langsung — **YouTube sudah dikerjakan** (ADR-0030); TikTok/Instagram belum |
| 10.4 | Multi-user pada satu proyek |

---

## 5. Risiko yang harus diputuskan, bukan didiamkan

**Lisensi Remotion.** Seluruh tumpukan render Dalang berdiri di atas
Remotion. Lisensinya: gratis untuk open source dan perusahaan di bawah $1 juta
ARR, $50/bulan untuk $1–10 juta, $200/bulan di atas itu. Motion Canvas dan
Revideo (fork-nya) berlisensi MIT. Ini **bukan** alasan pindah sekarang —
Remotion jauh lebih matang dan `RenderTarget` sudah jadi port — tapi ini
keputusan komersial yang harus diambil sadar, bukan ditemukan belakangan.

**Sora 2 API berhenti 24 September 2026.** Jangan bangun di atasnya. Kalau
footage generatif masuk roadmap, Veo (punya audio native) dan Kling (termurah
per detik) lebih aman.

**Ketergantungan provider.** Sudah diredam pola port + rantai fallback.
Pertahankan: setiap kemampuan baru masuk lewat port, dengan jalur offline.

---

## 6. Yang sengaja TIDAK dikerjakan

Roadmap tanpa daftar ini akan terus melar.

- **Footage generatif (Veo/Kling/Runway) sebagai fitur inti.** Mahal per
  detik, kualitas belum stabil untuk potongan panjang, dan menjauhkan Dalang
  dari yang membedakannya: kerajinan penyuntingan. Boleh masuk sebagai satu
  provider stok di antara yang lain, bukan sebagai pilar.
- **Color grading tingkat sinema.** Konsensus industri: pekerjaan warna butuh
  monitor terkalibrasi dan umpan balik haptik. Bahkan API Resolve sengaja
  tidak membuka kontrol warna primer.
- **Menggantikan editor manusia.** 80–90% pekerjaan editing yang mekanis
  (organisasi, conform, delivery) memang bisa diotomasi sekarang; 10–20% yang
  kreatif tidak. Dalang harus jadi **sutradara pendamping**, bukan pengganti.
- **Menjadi Premiere.** Dalang tidak akan menang di kedalaman fitur NLE
  tradisional. Yang bisa dimenangkannya: jalan dari maksud ke video jadi.

---

## 7. Kalau hanya boleh mengerjakan tiga hal

1. **ASR (6.1–6.4).** Tanpa ini Dalang tetap generator, bukan editor.
2. **Server MCP (8.4).** Mengubah Dalang dari aplikasi jadi kemampuan.
3. **Manipulasi langsung di kanvas (9.1).** Celah paling kentara bagi siapa
   pun yang pernah memakai editor.

---

## Sumber

Riset lapangan Agustus 2026:

- [Best AI Video Editors 2026 (ChatCut)](https://chatcut.io/blog/best-ai-video-editors) ·
  [What is ChatCut — AI Video Editing Agent](https://chatcut.io/docs/what-is-chatcut)
- [AI Agent Frameworks 2026: 8 SDKs Compared](https://www.morphllm.com/ai-agent-framework) ·
  [Claude Agent SDK vs LangGraph 2026](https://www.developersdigest.tech/blog/claude-agent-sdk-vs-langgraph)
- [Remotion vs Motion Canvas vs Revideo 2026](https://www.pkgpulse.com/blog/remotion-vs-motion-canvas-vs-revideo-programmatic-video-2026)
- [Agent-Driven Editing 2026 (open-source-cinema)](https://github.com/ismael-joffroy-chandoutis/open-source-cinema/blob/master/Agent-Driven-Editing-2026.md) ·
  [Remotion issue #10235 — ekspor EDL/OTIO](https://github.com/remotion-dev/remotion/issues/10235)
- [AI Video API Pricing 2026](https://www.cometapi.com/ai-video-api-pricing/) ·
  [Veo 3.1 vs Kling 3.0 vs Sora 2](https://modelslab.com/blog/api/veo-3-1-vs-kling-3-sora-2-ai-video-api-cost-2026)
- [Best Speech-to-Text APIs 2026](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/) ·
  [WhisperX diarization & word-level timestamps](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/whisperx-diarization-word-level-timestamps)
- [Long-Horizon Agents roadmap](https://github.com/RUC-NLPIR/Awesome-Long-Horizon-Agents) ·
  [Long-Running AI Agent Runtime 2026](https://slavadubrov.github.io/blog/2026/05/26/ai-agent-runtime/)
- [Gemini 2.5 video understanding](https://developers.googleblog.com/en/gemini-2-5-video-understanding/)
