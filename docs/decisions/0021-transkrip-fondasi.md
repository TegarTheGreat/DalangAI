# ADR-0021 — Transkrip sebagai fondasi: Dalang mulai mendengar

**Status:** diterima · **Tanggal:** 31 Agustus 2026 · **Fase:** 6

## Konteks

Sampai fase kelima, Dalang adalah **generator video**: ia menulis naskah,
membuat suara, mengambil stok, lalu menyusunnya. Ia belum bisa menerima satu
jam rekaman orang bicara dan mengeditnya.

Celahnya bisa ditunjukkan, bukan sekadar dirasakan:

```
$ grep -rlniE "transcri|whisper|asr" packages/*/src
→ nol hasil

$ grep -nE "^export interface .*Provider" packages/pipeline/src/ports.ts
35:  TtsProvider    79:  StockProvider
114: IconProvider   143: SfxProvider
```

Word timestamp **hanya** lahir dari TTS — dari suara yang Dalang buat sendiri.
Akibatnya berantai: tidak bisa memotong berdasarkan kata, tidak bisa membuang
bunyi ragu dan pengulangan, tidak bisa mencari momen di rekaman, tidak bisa
memberi caption pada footage orang, dan agent tidak punya cara memahami isi
rekaman selain melihat frame-nya satu per satu. `findCutPoints` dan
`detectSilence` bekerja di level energi audio: mereka tahu di mana orang
berhenti bicara, tidak tahu apa yang dikatakan.

Semua editor AI-first membangun di atas transkrip. Ini bukan fitur tambahan;
ini fondasi yang hilang (roadmap §3.1, §7.1).

## Keputusan

### 1. Transkrip dikunci per BERKAS, bukan per scene

`renderState.transcripts` adalah peta `path-berkas-relatif-plan -> Transcript`.

Ini keputusan yang menentukan bentuk semua yang lain. Kunci per scene terasa
lebih alami — semua entri `renderState` lain begitu — tapi salah untuk
rekaman: satu podcast satu jam yang dipakai lima scene akan ditranskrip lima
kali, dan transkripnya jadi basi setiap kali scene dipotong ulang, diurutkan
ulang, atau dibuang. Dikunci per berkas, rekaman itu ditranskrip **sekali**,
dan hasilnya bertahan melewati seluruh pengeditan.

Waktunya pun waktu REKAMAN (0 = awal berkas), bukan waktu scene. Penerjemahan
ke waktu scene dilakukan pemakainya, yang tahu `visual.trimStartSec` dan
`visual.speed`.

### 2. TranscriptWord adalah superset WordTimestamp, bukan penggantinya

`wordTimestampSchema` (kata + waktu) tetap jadi kontrak caption. Transkrip
menambahkan `confidence` dan `speaker`, karena editing berbasis rekaman perlu
tahu seberapa yakin mesinnya dan siapa yang bicara — sementara caption tidak.
Menggabungkan keduanya akan memaksa setiap pemakai caption memikirkan
diarisasi yang tidak relevan baginya.

### 3. Port `AsrProvider` sesempit `TtsProvider`

Satu kata kerja, satu hasil. **Tidak ada `available()`**: ketersediaan
diputuskan saat RANTAI dibangun (binari ada? kunci API ada?), bukan saat
transkripsi berjalan — supaya pemakainya tahu ada-tidaknya jalur ASR sebelum
pekerjaan panjang dimulai, bukan sesudahnya.

### 4. Jalur offline TIDAK BOLEH mengarang

Setiap kemampuan Dalang punya jalur yang berjalan di mesin sendiri; untuk TTS
itu `silence`. Untuk ASR jalur itu adalah whisper.cpp.

Bedanya penting dan sengaja: `silence` boleh mengarang audio senyap yang jujur
karena naskahnya **sudah diketahui**. ASR offline tidak punya masukan seperti
itu — tidak ada dasar apa pun untuk menebak isi rekaman. Maka whisper.cpp hanya
masuk rantai kalau binari DAN modelnya benar-benar ada; kalau tidak, rantainya
kosong dan pemakainya mendapat pesan yang menyebut persis apa yang kurang.
**Tidak ada transkrip palsu, dalam keadaan apa pun.**

### 5. Urutan rantai: offline dulu, karena privasi — bukan karena akurasi

whisper.cpp di depan Deepgram dan ElevenLabs Scribe. Bukan karena paling
akurat (tidak), tapi karena rekaman mentah adalah materi paling pribadi yang
dipegang Dalang, dan mengirimnya ke pihak ketiga harus jadi pilihan sadar
pemiliknya — bukan bawaan diam-diam. Yang tidak memasang whisper.cpp otomatis
memakai jalur API yang kuncinya memang sudah ia set sendiri.

ElevenLabs Scribe ada di rantai karena repo ini **sudah** memakai
`ELEVENLABS_API_KEY` untuk TTS: pemilik yang sudah menyiapkan suara langsung
dapat transkripsi tanpa mendaftar layanan baru.

### 6. Kunci cache = ISI berkas, bukan path atau mtime

Rekaman yang sama disalin ke folder lain tidak boleh ditranskrip dua kali, dan
berkas berbeda dengan nama sama tidak boleh memakai cache yang salah. Hash-nya
mengalir (streaming), jadi rekaman satu jam tidak dimuat ke memori.

### 7. TIDAK ada patch op baru — dan ini temuan, bukan penghematan

Roadmap Fase 6.4 menuliskan "patch op baru untuk trim berbasis kata". Setelah
inventaris, itu ternyata **tidak dibutuhkan**: memotong scene ke rentang kata
berarti menyetel `visual.trimStartSec` dan `duration`, dan `updateScene` sudah
melakukan keduanya secara atomik dengan inversnya.

Jadi `cutByWords` adalah tool agent yang menghitung waktu dari transkrip lalu
memancarkan `updateScene` biasa. Hasilnya: undo/redo untuk potongan berbasis
kata bekerja sejak hari pertama, tanpa satu baris pun kode undo baru. Menambah
op yang tidak menambah kemampuan hanya memperlebar permukaan yang harus dijaga
selamanya.

### 8. Caption untuk footage orang

`buildCaptionPages` kini punya tiga sumber kata, berurut: word timestamp TTS,
estimasi deterministik dari teks narasi, lalu **transkrip rekaman** untuk scene
yang menampilkan orang bicara tanpa narasi tulis.

Geserannya beda dan itu bukan detail: narasi disisipkan setelah jeda pembuka
(`NARRATION_LEAD_IN_SEC`), sedangkan rekaman sudah berbunyi sejak frame pertama
scene. Memberi keduanya geseran yang sama membuat caption tertinggal dari bibir
orangnya.

`visual.speed` ikut dihitung: scene pada 2x memutar rekaman dua kali lebih
cepat, jadi kata di detik ke-10 rekaman muncul di detik ke-5 scene. Melewatkan
pembagian ini menghasilkan caption yang makin lama makin melenceng — kesalahan
yang tidak menggagalkan tes apa pun dan hanya terlihat kalau ada yang
benar-benar menonton sampai habis.

## Bukti

**Bentuk respons API divalidasi, bukan dipercaya.** Dokumen Deepgram dan
ElevenLabs tidak bisa dijangkau dari lingkungan kerja repo ini (proxy egress
memblokir keduanya), jadi bentuk responsnya disusun dari rujukan publik dan
**divalidasi Zod di jalur panas**. Konsekuensinya disengaja: kalau bentuknya
meleset, provider GAGAL DENGAN PESAN yang menyebut field mana yang tidak cocok
— bukan diam-diam menghasilkan transkrip kosong yang lolos ke plan dan baru
ketahuan saat caption tidak muncul. Dua tes mengunci perilaku itu, satu per
provider.

**Dua jebakan penguraian yang ditangani sadar:**

- whisper.cpp memberi waktu per TOKEN, dan tokennya sub-kata: "Borobudur"
  keluar sebagai "Boro"+"budur". Menyerahkannya apa adanya membuat caption
  tercacah dan pencarian frasa gagal. Token yang tidak diawali spasi
  disambungkan ke kata sebelumnya.
- ElevenLabs Scribe memuat tiga jenis entri: `word`, `spacing`, dan
  `audio_event`. Memperlakukan ketiganya sebagai kata menghasilkan caption
  berisi spasi kosong dan "(laughs)" di tengah kalimat. Entri **tanpa** `type`
  tetap dianggap kata: itu bentuk lama API-nya, dan menganggapnya bukan-kata
  akan membuang seluruh transkrip tanpa satu pun galat.

**Daftar kata pengisi sengaja konservatif.** "Kayak", "terus", dan "jadi"
memang sering jadi pengisi, tapi ketiganya juga kata biasa yang membawa arti
("kayak gini", "terus dipanaskan", "jadi hasilnya"); membuangnya otomatis
merusak kalimat. Yang masuk daftar hanya bunyi ragu yang tidak pernah menjadi
bagian kalimat, plus dua penegas percakapan yang selalu berdiri sendiri. Satu
tes mengunci ini dengan kalimat yang memuat ketiga kata itu.

**Transkrip kosong = kegagalan, bukan keberhasilan.** Rekaman yang tidak
menghasilkan satu kata pun hampir selalu berarti berkas atau bahasanya salah.
Menyimpannya sebagai sukses akan menyembunyikan itu di balik panel transkrip
yang kosong.

**Narasi buatan sendiri tidak ditranskrip ulang.** Word timestamp untuk suara
yang Dalang hasilkan sudah ada sejak stage TTS; menjalankan ASR di atasnya
berarti membayar mesin untuk menebak ulang apa yang sudah diketahui persis.
`narrationTranscripts()` memakainya langsung, ditandai `fromNarration` supaya
tidak pernah disamakan dengan hasil mendengarkan rekaman sungguhan.

**Gerbang biaya.** Menranskrip rekaman panjang di provider berbayar adalah
pengeluaran nyata, dan panjangnya diketahui dari aset — bukan dari jumlah
scene. Rantai yang dipimpin provider offline melewati gerbang; yang dipimpin
API melewati approval §6.3 dan batas anggaran proyek.

## Batas yang dinyatakan

- **Belum pernah dijalankan terhadap API sungguhan.** Repo ini tidak punya
  kunci Deepgram maupun ElevenLabs, dan proxy lingkungan kerjanya memblokir
  kedua domain. Yang terverifikasi: seluruh penguraian (dengan fixture),
  seluruh jalur rantai/cache/fallback (dengan fake), dan kegagalan keras saat
  bentuk respons meleset. Yang belum: apakah kedua API benar-benar
  mengembalikan bentuk itu. Pemilik repo yang punya kunci bisa
  memverifikasinya dengan satu perintah `dalang transcribe`.
- **whisper.cpp belum dijalankan di sini** — binari dan modelnya tidak ada di
  container ini. Yang terverifikasi: deteksi binari+model, penguraian keluaran
  JSON-nya, dan penyambungan token sub-kata.
- Diarisasi diteruskan apa adanya dari provider; Dalang tidak melakukan
  pemisahan pembicara sendiri.
- Transkrip disimpan **inline** di `plan.json`. Rekaman satu jam menambah
  ratusan kilobyte. Itu diterima demi satu sumber kebenaran yang portabel,
  tapi jalur transportnya yang menyesuaikan: `/api/project` di Studio
  **membuang** `renderState.transcripts` dan melayaninya lewat endpoint
  terpisah, supaya setiap siaran state tidak membawa seluruh transkrip.

## Konsekuensi

- Dalang bisa mengedit rekaman orang, bukan hanya menyusun materi buatannya
  sendiri. Itu batas antara "generator video" dan "editor".
- Agent punya akses ke ISI rekaman: `getTranscript` untuk membaca,
  `findMoments` untuk menemukan frasa dan kata pengisi, `cutByWords` untuk
  memotong. Penilaian "momen mana yang menarik" tetap pekerjaan agent yang
  membaca transkripnya — tool hanya menjembatani kata ke waktu.
- Fase 7 (agent melihat hasil rendernya sendiri) jadi mungkin dinilai: kritik
  bisa membandingkan apa yang terucap dengan apa yang tampil.

## Alternatif yang ditolak

- **Kunci transkrip per scene.** Ditolak: satu rekaman untuk lima scene akan
  ditranskrip lima kali, dan transkripnya basi setiap kali scene dipotong.
- **Menyimpan transkrip sebagai berkas terpisah di `.dalang/`.** Ditolak
  sebagai bawaan: melanggar sifat "satu dokumen yang portabel" yang dipegang
  seluruh `renderState`. Beban transportnya diselesaikan di Studio, bukan
  dengan memecah sumber kebenaran.
- **Provider offline yang mengarang transkrip agar rantai tidak pernah
  kosong.** Ditolak keras. Untuk TTS, `silence` jujur karena naskahnya
  diketahui; untuk ASR tidak ada padanannya, dan transkrip karangan adalah
  kebohongan yang akan merambat ke potongan, caption, dan keputusan agent.
- **Patch op `trimSceneToWords`.** Ditolak: `updateScene` sudah melakukan
  persis itu, dengan invers yang sudah teruji.
- **Menjadikan kata pengisi bisa dibuang otomatis tanpa persetujuan.**
  Ditolak: daftar sekonservatif apa pun tetap bisa salah, dan menghapus kata
  dari rekaman orang tanpa ia melihatnya lebih dulu adalah kerugian yang tidak
  sebanding dengan kenyamanannya. `findMoments` melaporkan; yang memutuskan
  tetap manusia atau agent yang menjelaskan alasannya.
