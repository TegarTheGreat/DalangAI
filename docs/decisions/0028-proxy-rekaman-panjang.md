# ADR-0028 — Proxy pratinjau dan rekaman panjang (roadmap §9.5)

**Status:** diterima · **Tanggal:** 2 September 2026 · **Menyentuh:** skema
§5.1 (`resolvedAsset.proxy`, `codec`, `fps`), pipeline (port `MediaTranscoder`,
tahap `proxy`), renderer (ffmpeg bawaan Remotion), agent, CLI, Studio.
**Mengubah:** ADR-0026 (dua batasnya dicabut), ADR-0017 (`ingestVideo`).

## Konteks

Sampai ADR-0027, Dalang bisa MENGKLIP rekaman panjang (ADR-0017) dan
menranskripnya (ADR-0021), tetapi tidak pernah benar-benar MENGURUSNYA:

1. **Preview memutar berkas aslinya.** Player Studio dan setiap `Thumbnail`
   filmstrip adalah satu dekoder `<video>` browser di atas berkas sumber.
   Rekaman 4K satu jam berarti puluhan dekoder 4K yang menyeret di setiap
   scrub; rekaman HEVC/ProRes berarti kotak HITAM, karena Chromium tanpa kodek
   proprietary tidak memutarnya sama sekali.
2. **Tidak ada jalan membawa rekaman masuk dari Studio.** Unggahan hanya
   menerima PNG/JPEG ≤ 8 MB sebagai data URL base64 — bentuk yang mustahil
   untuk rekaman berukuran gigabyte. Satu-satunya jalan adalah menaruh berkas
   di folder proyek dengan tangan lalu meminta agent memanggil `ingestVideo`,
   dan agent butuh API key.
3. **Titik masuk dipilih BUTA.** Tidak ada slider `trimStartSec` di panel
   mana pun; titik masuk hanya bisa diketik agent atau dipilih dari kalimat
   transkrip. Memotong podcast satu jam tanpa pernah melihat satu bingkai pun
   adalah pekerjaan meraba.
4. **Batas ADR-0026 yang menjengkelkan:** AAC/MP4 — yakni hampir semua klip
   stok dan musik unggahan — tidak terukur kenyaringannya di Chromium tanpa
   kodek proprietary, jadi tidak dinormalisasi; dan campuran akhir setiap
   render tidak pernah diukur sama sekali.

Yang mengejutkan saat inventaris: `@remotion/compositor-*`, dependensi yang
SUDAH terpasang untuk merender, membawa biner `ffmpeg` dan `ffprobe` lengkap
dengan dekoder h264/hevc/vp8/vp9/av1/prores/mpeg4 dan aac/mp3/opus/vorbis/
flac/pcm, enkoder libx264/aac, serta filter `scale` dan `aresample`.
Remotion sendiri memanggilnya lewat `RenderInternals.callFf` untuk
`extractAudio` dan `getVideoMetadata`. Semua yang dibutuhkan §9.5 ada di
situ — tanpa satu biner baru pun.

## Keputusan

### 1. Proxy adalah data turunan per BERKAS, di `renderState`

`resolvedAssetSchema` bertambah tiga bidang opsional: `codec`, `fps` (fakta
ffprobe), dan `proxy: { file, width, height, fps? }`. Proxy hidup di
`.dalang/proxies/<hash>-540p.mp4`, dikunci per berkas sumber (isi + ukuran +
mtime) di ledger pipeline — pola yang sama dengan transkrip (ADR-0021) dan
kenyaringan (ADR-0026): satu rekaman yang dipakai lima scene di-proxy sekali,
dan proxy-nya tetap sah saat scene-nya dipotong ulang, karena trim adalah
keputusan kreatif milik scene sedangkan proxy milik berkasnya.

`setProxy(plan, file, proxy | null, { codec, fps })` menulis ke SEMUA entri
lumbung VIDEO (`resolvedAssets`, `layerAssets`) yang menunjuk berkas itu;
`null` menghapus proxy lama (sumber yang berubah jadi ringan) sambil tetap
mencatat kodeknya. Proxy tidak pernah ikut ekspor OTIO/FCPXML dan tidak pernah
masuk patch log: ia bisa dibuat ulang kapan saja dari aslinya.

### 2. "Perlu proxy" adalah fungsi murni dengan alasan yang terbaca

`proxyDecision(info)` di `@dalang/core` memutuskan dari empat aturan, dalam
urutan yang paling menentukan lebih dulu:

| Aturan | Alasan yang ditampilkan |
| --- | --- |
| kodek di luar {h264, vp8, vp9} | `kodek hevc tidak diputar browser` |
| durasi ≥ 60 dtk | `rekaman panjang (1 j 2 mnt)` |
| sisi pendek > 720 px | `resolusi 3840×2160` |
| laju > 30 fps | `60 fps` |

Sisanya: `ringan (1280×720, 8 dtk) — preview memakai aslinya`. Daftar kodek
amannya sengaja PENDEK: kotak hitam di preview jauh lebih mahal daripada satu
proxy yang sebenarnya tidak perlu. Ukuran proxy: sisi pendek dibawa ke 540
(tepat setengah 1080p = skala render draf), rasio dipertahankan, keduanya
GENAP (libx264 yuv420p menolak dimensi ganjil), dan sumber yang sudah lebih
kecil tidak diperbesar. Laju bingkai mengikuti sumber, dipangkas ke 30.

### 3. Penukaran terjadi di satu tempat, dan hanya untuk preview + draf

`substituteProxies(plan)` mengembalikan plan yang SAMA dengan setiap berkas
ber-proxy ditukar proxy-nya (file, width, height, fps) — dan tidak menyentuh
trim, kecepatan, fokus, maupun hasil ukur kenyaringan, karena semuanya milik
rekamannya, bukan resolusinya. Hasilnya plan yang sah, jadi seluruh tumpukan
render tidak perlu tahu proxy itu ada: `planAssetFiles` memilih berkasnya,
preset memutarnya, tanpa satu cabang khusus pun.

Pemakainya tepat tiga: Player Studio, `Thumbnail` filmstrip, dan render dengan
`useProxies: true` — yang dipasang oleh `renderPreview` milik agent, ekspor
draf Studio, `generate --render draft`, dan `render --proxy`. Render final dan
ekspor eksplisit SELALU membaca berkas aslinya; target Lambda menukar sebelum
menyusun daftar unggahan, supaya yang diunggah untuk draf pun proxy-nya.

### 4. Port `MediaTranscoder`, implementasi di renderer

Pipeline mendeklarasikan `MediaTranscoder` (`probe`, `makeProxy`,
`extractFrame`, `toWav`, `decodeMonoPcm`); `@dalang/renderer` mengimplementasi-
kannya di atas `RenderInternals.callFf` — alasan yang sama seperti `AudioProbe`
(ADR-0026) dan `RenderTarget` (ADR-0019): biner ffmpeg milik paket renderer,
dan pipeline tidak boleh bergantung pada renderer. Build ffmpeg Remotion
SENGAJA ramping (kebanyakan filter dimatikan); modul ini hanya memakai yang
terbukti ada, dan tes nyata menjalankannya terhadap biner sungguhan — bukan
mock — dengan video sintetis yang di-mux oleh ffmpeg yang sama.

Perintah proxy: `-map 0:v:0 -map 0:a:0?` (audio opsional — rekaman bisu tetap
dapat proxy), `scale=W:H`, `-r` bila perlu, `libx264 veryfast crf 26`,
`-g 30` (keyframe tiap detik supaya scrub tidak macet), `aac 96k stereo
48 kHz`, `-movflags +faststart` (indeks di depan supaya browser bisa seeking
sebelum berkasnya terunduh).

### 5. Rekaman masuk dari Studio lewat unggah streaming

`POST /api/sources/upload?name=` menerima body MENTAH dan mengalirkannya ke
disk sambil menghitung SHA-256 — rekaman satu jam tidak pernah dimuat ke
memori dan tidak pernah di-base64-kan. Nama akhirnya `assets/rekaman/
<nama-aman>-<hash10>.<ext>`; unggahan yang ISINYA sama tidak disalin dua
kali, apa pun namanya. Batasnya `DALANG_MAX_UPLOAD_MB` (bawaan 4096), ditegakkan
dari `content-length` maupun selama streaming, dan berkas parsial dibersihkan.

`GET /api/sources` mendaftar rekaman di folder proyek beserta fakta ffprobe,
pemakainya, proxy-nya, dan keputusan proxy-nya; `POST /api/sources/register`
memasangnya ke scene atau lapisan sebagai SATU patch user ter-pin (bisa
di-undo, terlihat agent) lalu langsung membuat proxy-nya. `GET /api/sources/
thumb` dan `/peaks` memberi bingkai pada detik tertentu dan bentuk gelombang,
keduanya di-cache di `.dalang/thumbs` dan `.dalang/peaks`.

### 6. Titik masuk dipilih dengan melihat

Panel Visual (dan tiap kartu Lapisan) mendapat bagian sumber: fakta rekaman
(kodek, dimensi, laju, durasi), lencana proxy atau tombol "Buat proxy", strip
BINGKAI sepanjang seluruh rekaman dengan bentuk gelombang di bawahnya, jendela
scene digambar di atasnya, dan seluruh strip adalah slider titik masuk —
klik, seret, atau panah kiri/kanan (Shift = 10 detik). Keluarannya patch
`updateScene` biasa. Jumlah bingkainya mengikuti lebar panel, bukan angka
tetap.

### 7. Agent dan CLI

`ingestVideo` mencatat kodek/laju, membuat proxy untuk berkas yang baru
didaftarkan, dan melaporkan `catatanProxy` apa adanya. `analyzeImage` menerima
aset VIDEO: satu bingkai diambil pada `trimStartSec + detikKe` — tool yang
sebelumnya menjawab "belum didukung". `renderPreview` merender dari proxy dan
meneruskan kenyaringan campuran akhir. CLI: `dalang proxy`, kolom Proxy di
`generate`, `render --proxy`; keduanya mencetak campuran akhir di samping
sasaran.

### 8. Dua batas ADR-0026 dicabut oleh dekoder yang sama

`remotionAudioProbe` mendapat lapisan kedua: dekode lewat ffmpeg bawaan
Remotion, sebelum browser. AAC/MP4 kini terukur di mesin mana pun tanpa kodek
proprietary. Dan `renderPlanToVideo` mengukur berkas HASIL render dengan
pengukur EBU R128 yang sama (`mixLufs`): angka yang benar-benar akan didengar
penonton, bukan janji normalisasi per klip. Kegagalan mengukur tidak pernah
menggagalkan render yang sudah jadi.

### 9. Campuran akhir DIKOREKSI ke sasaran, dengan penguatan rata

Mengukur saja ternyata setengah jalan: angka "-21,3 LUFS · sasaran -16" di
samping berkas yang sudah jadi hanya memindahkan pekerjaan ke pengguna.
`finalizeMix` (renderer) kini mengukur berkas hasil, menghitung penguatan lewat
`mixCorrection` (pipeline, murni), menerapkannya dengan ffmpeg bawaan Remotion
— video DISALIN apa adanya, hanya jalur audio yang lewat `volume` — lalu
mengukur lagi. Empat pagar yang disengaja:

- **Penguatan RATA, bukan kompresi atau limiter.** Normalisasi per klip
  (ADR-0026) sudah menyetarakan sumbernya; yang tersisa hanya selisih program
  terhadap sasaran, dan penguatan rata mempertahankan keseimbangan yang sengaja
  dipilih per klip — itulah kekhawatiran yang membuat koreksi ini dulu ditunda.
- **Toleransi ±1 LU (EBU R128).** Di dalamnya berkas tidak disentuh sama
  sekali; enkode ulang tanpa manfaat hanya menambah satu generasi AAC.
- **Langit-langit puncak -1 dBFS.** Kenaikan dipangkas supaya puncak sampel
  tidak melewatinya; yang dipangkas DILAPORKAN ("dinaikkan +5,0 dB, dibatasi
  puncak (butuh +7,0 dB)"), dan penurunan tidak pernah dipangkas.
- **Format yang audionya tidak bisa dienkode ulang dilaporkan, bukan
  dipaksa.** Build ramping Remotion punya enkoder aac dan pcm, tidak punya
  opus: MP4/HEVC/MOV dikoreksi, WebM dilaporkan apa adanya beserta selisihnya.

Render Lambda ikut: koreksinya berjalan di mesin lokal pada berkas yang sudah
diunduh — Lambda merender, mesin lokal memaster. `meta.loudnessTarget: null`
mematikannya bersama normalisasi per klip; tidak ada sakelar kedua.

Di saat yang sama `proxyDecision` mendapat aturan kelima: laju bit di atas
25 Mbps diberi proxy walau ringan menurut aturan lain, karena byte per detik —
bukan jumlah piksel — yang membuat browser tersendat pada rekaman layar.

### 10. Proxy dibuat DI LATAR, dengan kemajuan per berkas dan bisa dibatalkan

Versi pertama menjalankan tahap proxy di dalam kunci mutasi Studio: satu
rekaman satu jam berarti editor terkunci beberapa menit tanpa satu angka pun.
Kini:

- **`makeProxy` melaporkan kemajuan dan menghormati pembatalan.** ffmpeg
  dijalankan langsung lewat `spawn` (biner, cwd, dan env yang sama dengan
  yang dipakai Remotion) dengan `-progress pipe:1`; `out_time_us` dibagi
  durasi sumber jadi 0..1, `progress=end` jadi 1. `AbortSignal` membunuh
  prosesnya dan berkas setengah jadi dibuang.
- **Tahap proxy punya tiga kait:** `onProgress` (indeks/total + fraksi),
  `onFile` (satu berkas selesai, membawa proxy yang harus ditulis), dan
  `signal` (sisa antrean dilaporkan "dibatalkan", bukan gagal; ledger tidak
  menganggapnya selesai sehingga jalan berikutnya membuatnya lagi). Proxy
  ditulis ke berkas sementara lalu di-rename: dua penulis untuk berkas yang
  sama (Studio di latar, agent `ingestVideo`) tidak saling merusak.
- **Studio menjalankannya sebagai pekerjaan latar** (`ProxyJobRunner`): POST
  `/api/pipeline/proxies` membalas 202 segera, kemajuan lewat SSE
  `proxy-progress`, ada `/cancel`, dan permintaan selagi berjalan ANTRE. Kunci
  mutasi TIDAK dipegang — patch, undo, dan render tetap jalan — dan setiap
  berkas yang selesai ditulis ke plan hidup lewat `setProxy` (data turunan di
  luar log patch). Karena mutasi lain memegang snapshot plan dan menulisnya
  kembali saat selesai, proxy diterapkan ulang setiap kali plan berubah atau
  kunci lepas: idempoten, hanya menulis yang hilang.
- **Mendaftarkan rekaman tidak lagi menunggu proxy-nya.** Jawabannya segera
  dengan catatan "proxy dibuat di latar"; preview beralih ke proxy begitu
  selesai. CLI `dalang proxy` dan `generate` mencetak persen per berkas.

## Verifikasi

- **Pengukur & keputusan (murni):** 13 tes core — keputusan proxy per aturan
  beserta alasannya, dimensi genap tanpa pembesaran, pemangkasan laju,
  `setProxy` ke semua pemakai berkas, `substituteProxies` yang tidak menyentuh
  trim/kenyaringan dan mengembalikan objek yang sama bila tidak ada proxy.
- **Koreksi campuran akhir (Keputusan 9):** 6 tes murni `mixCorrection`
  (toleransi, naik, turun tanpa pangkas, dipangkas puncak dengan laporan yang
  menyebut kebutuhan, tanpa ruang) dan 5 tes `finalizeMix` di atas ffmpeg
  SUNGGUHAN: nada -10 dBFS (-10,7 LUFS) ke sasaran -16 diturunkan -5,3 dB dan
  berkasnya terukur ulang -16,0; amplitudo 0,5 (-6,7 LUFS, puncak -6 dBFS) ke
  sasaran 0 dinaikkan +5,0 dB "dibatasi puncak (butuh +6,7)"; di dalam
  toleransi berkas tidak disentuh (mtime sama); Opus dilaporkan; berkas bukan
  media "tidak terukur" tanpa lemparan. Aturan laju bit: 2 tes core. Ujung ke
  ujung lewat CLI pada proyek uji rekaman panjang: `dalang render --proxy`
  melaporkan "campuran akhir -16,0 LUFS · sasaran -16 · pas sasaran ·
  dinaikkan +17,1 dB dari -33,1 LUFS" — draf 54,9 detik yang sebelumnya 17 LU
  terlalu pelan kini tepat sasaran, videonya disalin tanpa enkode ulang.
- **Proxy di latar (Keputusan 10):** 3 tes tahap pipeline (kemajuan per
  berkas dengan indeks/total dan `onFile` yang membawa proxy; pembatalan yang
  menghentikan berkas berikutnya sebagai "dibatalkan", bukan gagal; pembatalan
  di tengah ffmpeg tanpa proxy setengah jadi dan ledger yang membuatnya lagi
  di jalan berikutnya), 2 tes ffmpeg SUNGGUHAN (kemajuan tidak pernah turun
  dan berakhir tepat di 1; sinyal yang sudah dibatalkan tidak memulai ffmpeg),
  3 tes server Studio (202 segera dan `proxy-progress` sampai `running:false`
  dengan hasil di plan hidup; tanpa kandidat 200 dengan alasan; patch user
  diterima selagi proxy dibuat dan `/cancel` menghentikannya dengan
  `cancelled: true`). Di CLI: `dalang proxy --force` pada proyek uji mencetak
  0% → 19% → 49% → 80% → 99% → 100% untuk rekaman 70 detik.
- **Tahap pipeline (transkoder palsu):** 10 tes — kandidat per berkas video
  (lapisan yatim tidak ikut), cache dan `--force`, cache yang berkas proxy-nya
  hilang dibuat ulang, sumber yang berubah isi mendapat proxy baru dan yang
  lama dihapus, sumber yang berubah jadi ringan kehilangan proxy-nya, kegagalan
  transkoder dilaporkan per berkas, tanpa transkoder dilewati dan dikatakan.
- **ffmpeg NYATA (renderer):** 11 tes terhadap biner Remotion dengan video
  sintetis (bingkai PNG + nada sinus, di-mux oleh ffmpeg yang sama): probe
  membaca h264/aac/30 fps/48 kHz; proxy 160×90 @ 15 fps ber-`faststart`
  (atom `moov` sebelum `mdat`); proxy sumber bisu berhasil tanpa jalur audio;
  bingkai detik ke-0 dan ke-1 BERBEDA; `toWav` mendekode AAC jadi PCM stereo
  48 kHz; `measureMediaLoudness` mengukur MP4; `remotionAudioProbe` mengukur
  MP4 tanpa membuka browser.
- **Studio (HTTP, transkoder palsu):** 14 tes — daftar sumber, unggah
  streaming 300 KB byte-per-byte + dedup isi + batas 413 sebelum/selama
  streaming + pembersihan `.part`, daftar ke scene (patch user ter-pin, proxy,
  undo) dan ke lapisan (dengan titik masuk), penolakan path keluar folder /
  bukan video / scene terkunci, thumb ber-cache dan dipangkas ke durasi, peaks
  ber-cache, mount `/.dalang/proxies/*` terbuka sementara `pipeline.db` dan
  `thumbs` tetap tertutup.
- **Agent:** 5 tes — `ingestVideo` membuat proxy dan melaporkan kodek;
  tanpa transkoder proxy null dan dikatakan; `analyzeImage` menolak video
  tanpa transkoder dengan alasan; `renderPreview` meminta `useProxies`.
- **End-to-end NYATA lewat CLI** (rekaman sintetis 1600×900, 70 dtk, h264 +
  aac, 1,2 MB, dipasang ke scene pembuka contoh Borobudur dengan
  `trimStartSec` 30): `dalang proxy` membuat `.dalang/proxies/<hash>-540p.mp4`
  960×540 (5 fps mengikuti sumber, 999 KB) dengan alasan "rekaman panjang
  (1 mnt 10 dtk)" dan menulis `renderState`; jalan kedua sepenuhnya cache dan
  tidak menulis ulang plan. `dalang render --proxy` (draf) menghasilkan MP4
  540×960, 54,9 dtk, 2,6 MB dalam 89,8 dtk dengan "1 berkas dari proxy", dan
  mencetak campuran akhir -33,1 LUFS di samping sasaran -16 (proyek uji tidak
  punya narasi dan suara klipnya bisu, jadi memang pelan — yang dibuktikan di
  sini PENGUKURANNYA, bukan sasarannya). Bingkai detik 1,5 dari render
  ber-proxy dan `dalang still` dari berkas ASLI pada frame yang sama
  menampilkan gambar yang sama: batang kuning di ~45 % lebar, persis
  posisi detik 31,5 dari rekaman 70 detik (titik masuk 30 + 1,5).
- Lint, typecheck sepuluh paket, 964 unit test, eval self-check, gerbang tata
  letak 18 lebar, gerbang interop (OTIO/FCPXML rujukan), dan gerbang paritas
  aset semuanya hijau.

## Batas

- ~~**Proxy dibuat SERIAL, satu berkas per waktu, dan sinkron di jalur
  `register`/`ingestVideo`.**~~ *DICABUT (Keputusan 10) untuk yang sinkron:*
  Studio membuatnya di latar dengan kemajuan per berkas dan tombol batal;
  editor tidak terkunci, dan mendaftarkan rekaman menjawab segera. Yang
  tersisa: tetap SATU ffmpeg pada satu waktu — dua ffmpeg paralel berebut
  inti yang sama dengan Player, dan yang terasa lambat justru previewnya;
  dan `ingestVideo` milik agent tetap menunggu proxy-nya selesai, karena
  laporan tool-nya memang menyebut hasilnya.
- **Strip bingkai, gelombang, dan proxy butuh transkoder.** Di mesin tanpa
  `@remotion/compositor-*` (tidak ada dalam pemasangan normal) rekaman tetap
  bisa dipasang; UI mengatakan apa yang tidak ia dapat.
- ~~**Keputusan proxy tidak melihat laju bit.**~~ *DICABUT (Keputusan 9):*
  di atas 25 Mbps diberi proxy, alasannya menyebut Mbps-nya.
- **Proxy adalah AAC stereo 96 kbps.** Preview dan render draf mendengar
  itu, bukan audio aslinya; render final tidak.
- ~~**Campuran akhir DIUKUR, belum DIKOREKSI.**~~ *DICABUT (Keputusan 9):*
  dikoreksi dengan penguatan rata ke sasaran, toleransi ±1 LU, dipangkas oleh
  langit-langit puncak -1 dBFS. Yang tersisa: WebM (Opus) hanya dilaporkan,
  dan koreksi hanya menggeser, tidak pernah memampatkan — program yang
  puncaknya sudah di langit-langit tetapi rata-ratanya jauh di bawah sasaran
  dilaporkan "tidak ada ruang", bukan dilimit.
- **Unggahan tidak bisa dilanjutkan** setelah putus; ia diulang dari awal.
  Dedup isi membuat pengulangan yang sudah sampai tidak menyalin dua kali,
  tapi byte-nya tetap dikirim ulang.
- **Tanpa transkoder, `probe` jatuh ke `getVideoMetadata`** milik Remotion:
  durasi dan dimensi ada, kodek/laju tidak — dan keputusan proxy tanpa kodek
  hanya memakai tiga aturan lain.

## Konsekuensi

- Fase 9 selesai seluruhnya: editor yang memutar rekaman satu jam tanpa
  membeku, menerima rekaman dari peramban, dan membiarkan orang MELIHAT apa
  yang dipotongnya.
- Tidak ada dependensi biner baru; permukaan `RenderInternals` yang dipakai
  dipin oleh versi Remotion yang sudah dipin, dan tes nyata menjaganya.
- Skema §5.1 bertambah tiga bidang opsional pada `resolvedAsset`; plan lama
  tetap sah tanpa perubahan.
- ADR-0026 kehilangan dua batasnya (AAC tidak terukur; campuran akhir tidak
  diukur) — keduanya dicatat di sana sebagai dicabut oleh ADR ini.
