# ADR-0026 — Audio per klip

**Status:** diterima · **Tanggal:** 31 Agustus 2026 · **Fase:** 9 (§9.4)

## Konteks

ADR-0025 menutup dirinya dengan utang yang ditulis terang-terangan: lapisan
video mendapat `visual.volume`, satu angka gain, dan "fade, ducking, serta
normalisasi kenyaringan adalah §9.4". Utang itu yang dibayar di sini.

Sebelum ADR ini, hanya **musik** yang punya amplop sungguhan — fade masuk,
fade keluar, dan ducking di bawah narasi — dan rumusnya terkubur di `music.ts`.
Semua sumber bunyi lain memakai apa adanya: narasi diputar pada volume 1,
suara aset video diputar pada satu angka, efek suara pada satu angka. Artinya
menambahkan suara ke B-roll berarti menyalin rumus musik, lalu punya dua rumus
yang harus tetap sama selamanya.

Kekurangan yang lebih dalam: **tidak ada satu pun sumber yang disamakan
kenyaringannya.** Stok video dari Pexels, suara TTS dari penyedia berbeda, dan
rekaman unggahan pengguna datang pada level yang berbeda-beda — perbedaan
10-20 dB antar berkas itu biasa. Menata video dengan bahan seperti itu berarti
menggeser slider satu per satu dengan telinga, lalu mengulanginya setiap kali
satu aset diganti. Itu pekerjaan yang seluruh industri siaran sudah berhenti
melakukannya sejak EBU R128 (2011).

Dan audio adalah tempat cacat paling mahal: tidak ada satu pun gate visual di
repo ini yang bisa melihatnya. Frame-nya sama persis. Yang salah cuma
terdengar — biasanya setelah videonya diunggah.

## Keputusan

### 1. Satu bentuk amplop untuk SEMUA yang berbunyi

`clipAudioSchema` — `volume`, `fadeInSec`, `fadeOutSec`, `ducking`,
`normalize` — dipakai oleh suara aset visual (`scene.visual.audio`), suara
lapisan (`layer.visual.audio`), dan trek audio tambahan (`track.audio`).
Menggantikan `visual.volume` milik ADR-0025.

Satu bentuk berarti satu implementasi (`buildClipVolume`) dan satu panel
kendali (`ClipAudioControls`). Tiga panel yang harus tetap sama selamanya
adalah cara paling pasti untuk punya satu panel yang diam-diam kehilangan
sakelar ducking.

### 2. Bawaannya BISU

`SILENT_CLIP_AUDIO` — `volume: 0`. Stock footage datang dengan suara ruangan,
musik toko, dan orang berbicara bahasa lain. Memutarnya secara bawaan berarti
setiap video punya suara asing di bawah narasinya sampai seseorang menyadari.
Yang berbunyi harus dinyalakan dengan sengaja.

### 3. Pengukur EBU R128 ditulis sendiri, bukan memanggil ffmpeg

`packages/pipeline/src/loudness.ts` mengimplementasikan ITU-R BS.1770-4:
penapis K dua tahap, blok 400 ms bertumpang 75%, gerbang mutlak -70 LUFS, lalu
gerbang relatif -10 LU.

Alasannya: Dalang tidak punya ffmpeg sebagai dependensi, dan menambahkannya
berarti setiap pengguna dan setiap runner CI memasang biner puluhan megabyte
untuk mendapat satu angka. Yang dibutuhkan hanya PCM, dan sisanya aritmetika
yang spesifikasinya terbuka.

Koefisien penapisnya **dihitung ulang per laju cuplik** lewat transformasi
bilinear. BS.1770 hanya menuliskan koefisien untuk 48 kHz; memakainya apa
adanya pada 44,1 kHz menggeser titik potong penapis dan menghasilkan angka yang
meleset — cukup untuk membuat dua berkas yang sama nyaring dinormalisasi ke
tempat berbeda.

### 4. Normalisasi PER KLIP, bukan per program

Tiap sumber dibawa ke `meta.loudnessTarget` (bawaan -16 LUFS) **sebelum**
`volume`-nya diterapkan. Campuran akhirnya tidak pernah diukur.

Karena itu `volume` selalu berarti hal yang sama — "seberapa keras dibanding
sumber lain yang sudah disamakan" — bukan "seberapa keras dibanding berkas ini
yang kebetulan direkam pelan". Normalisasi program akan menuntut render dua
kali (ukur lalu betulkan) dan tetap tidak memperbaiki ketimpangan ANTAR klip,
yang justru masalahnya.

Penguatan dijepit +12/-24 dB. Rekaman -45 LUFS menuntut +29 dB untuk mencapai
-16, dan yang ikut naik 29 dB bukan cuma suaranya melainkan juga desis dan
derau ruangannya.

### 5. Belum diukur berarti penguatan 1 — bukan tebakan

`lufs` yang tidak ada artinya "belum pernah diukur", dan itu dibedakan dari
"diukur dan hasilnya sunyi" (`null`). Berkas tanpa hasil ukur dipakai apa
adanya. Satu tebakan yang meleset 20 dB terdengar sebagai ledakan di tengah
video, dan tidak ada gate visual yang bisa melihatnya lebih dulu.

### 6. Yang disimpan adalah `lufs` DAN `channels`

Campurannya stereo. Berkas **mono** diputar sebagai dual-mono, dan dua kanal
identik menjumlahkan DAYA: ia terdengar 3,01 LU lebih keras daripada angka
ukurnya. Tanpa keterangan kanal, narasi — yang hampir selalu mono — mendarat
3 dB di atas sasaran sementara musik stereo mendarat tepat. Itu persis
ketimpangan yang seharusnya dihapus normalisasi.

Yang disimpan adalah angka ukur berkasnya apa adanya (bisa dibandingkan dengan
alat ukur lain, dan itu yang ditampilkan Studio); koreksinya dihitung saat
DIPAKAI, di `effectiveLufs`. Kalau suatu saat keluarannya bukan stereo, angka
yang tersimpan tetap benar dan hanya rumus itu yang berubah.

### 7. Narasi ikut dinormalisasi, tanpa amplop

Narasi tidak diberi fade dan tidak pernah diduck — ia justru yang membuat
segala sesuatu yang lain mengecil. Yang tetap dibutuhkannya adalah normalisasi:
suara TTS datang pada kenyaringan berbeda antar penyedia dan antar suara, dan
itulah sumber yang PALING penting untuk disamakan, sebab semua level lain di
video ditata relatif terhadapnya.

### 8. Trek audio sebagai data plan

`audio.tracks` (maksimal 8) untuk ambience, wawancara, atau lagu berlisensi
yang bukan bed. Berkasnya dikunci di `renderState.trackAssets` **per id trek**.
Trek tanpa panjang tercatat TIDAK digambar dan tidak diekspor: sebuah
`Sequence` wajib punya panjang, dan panjang karangan adalah kebohongan yang
terlihat sah di editor tujuan.

### 9. Port `AudioProbe` berlapis, dan "tidak bisa didekode" adalah NILAI

Pengukurnya butuh PCM. Mendapatkannya ternyata bagian tersulit dari seluruh
ADR ini, dan asumsi pertamanya salah:

1. **`extractAudio` milik Remotion** — murah, tanpa browser, tapi ia
   **menyalin aliran**, tidak mendekode ("It does not convert the audio to a
   different format", kata dokumennya sendiri). Untuk sumber WAV hasilnya PCM.
   Untuk MP4 hasilnya AAC yang DIBUNGKUS kontainer WAV: berkas `.wav` yang sah
   dan sama sekali tidak bisa diukur. Karena itu keluarannya **diperiksa**
   (`isPcmWav`), bukan dipercaya.
2. **Chromium yang memang sudah dipakai merender**, lewat `decodeAudioData`.
   Ia mendekode MP3, FLAC, Ogg/Opus, dan WAV; AAC/MP4 hanya pada build
   ber-kodek proprietary — termasuk Chrome Headless Shell yang diunduh Remotion
   sendiri, tapi bukan Chromium biasa.
3. **Menyerah dengan jujur**: `{ ok: false, reason }`, bukan lemparan. Kodek
   yang tidak didukung bukan kerusakan; ia keadaan yang harus bisa dikatakan
   apa adanya — "klip ini tidak diukur, jadi tidak dinormalisasi".

Dekodernya dikirim ke halaman sebagai **teks**, bukan sebagai fungsi:
`page.evaluate(fn)` menyerialkan hasil transformasi bundler, dan esbuild/tsx
membungkus fungsi bernama dengan pembantu `__name` yang tidak ada di dalam
halaman. Akibatnya `ReferenceError` pada saat jalan, di jalur yang jarang
dilewati. Teks tidak bisa ditransformasi diam-diam.

## Bukti

Diverifikasi dengan render sungguhan, bukan hanya unit test. Nada 440 Hz
sintetis, sasaran -16 LUFS, diukur ulang dari berkas video hasil render:

| sumber | ukur berkas | keluaran sebelum koreksi mono | sesudah |
| --- | --- | --- | --- |
| mono -26 dBFS | -26,68 LUFS | **-12,98 LUFS** (3 dB terlalu keras) | **-16,00 LUFS** |
| stereo -26 dBFS | -23,67 LUFS | -16,00 LUFS | -16,00 LUFS |

Selisih 3,01 LU antara kedua sumber itulah yang menemukan keputusan 6.
Dimatikan normalisasinya, keluarannya -23,67 LUFS — sumbernya lewat tanpa
diubah.

Pengukurnya sendiri diuji dengan sinyal yang dibangkitkan sendiri, bukan
dibandingkan dengan implementasi lain (dua program yang setuju cuma
membuktikan keduanya setuju): sinus 1 kHz -23 dBFS terbaca -23,0 LUFS sesuai
nilai acuan EBU Tech 3341, stereo identik +3 LU, hasil sama pada 44,1/32/22,05
kHz, sunyi menghasilkan `null`.

Setiap aturan di atas dibuktikan bisa GAGAL sebelum dipercaya. Delapan
perusakan sengaja pada pengukur (koefisien dipaku ke 48 kHz, kanal dirata-rata,
gerbang relatif dihapus, gerbang mutlak dilonggarkan, konstanta kalibrasi
dinolkan, pembaca WAV melompat ke byte 44, puncak dimatikan) dan enam pada
amplop (ducking memakai frame lokal, sakelar ducking diabaikan, normalisasi
dilewati, ducking terdalam jadi terakhir, syarat berkas narasi dihapus, fade
keluar bergeser satu frame) — semuanya tertangkap. Perusakan pertama pada
gerbang relatif **lolos**, dan itu menemukan bahwa tesnya memakai hening
digital yang sudah dibuang gerbang mutlak; tesnya diperbaiki memakai materi
-45 dBFS.

## Batas

- **AAC/MP4 tidak terukur pada Chromium tanpa kodek proprietary.** Di mesin
  dengan Chrome Headless Shell milik Remotion ia terukur; di lingkungan yang
  memblokir unduhannya, klip stok dilewati dengan alasan yang disebutkan
  ("audionya AAC; Chromium tidak bisa mendekodenya") dan dipakai apa adanya.
  *DICABUT oleh ADR-0028:* dekoder ffmpeg bawaan Remotion kini menjadi lapisan
  kedua `remotionAudioProbe`, jadi AAC/MP4 terukur di mesin mana pun.
- **Campuran akhirnya tidak diukur.** Normalisasi per klip tidak menjamin
  keseluruhan video mendarat di sasaran; ia menjamin sumber-sumbernya setara.
  *DICABUT oleh ADR-0028:* setiap render mengukur berkas hasilnya
  (`mixLufs`) dan CLI/Studio menampilkannya di samping sasaran — diukur,
  belum dikoreksi otomatis.
- **Ducking hanya mengikuti jendela scene bernarasi**, bukan deteksi bunyi
  narasi yang sebenarnya. Scene bernarasi dengan jeda panjang tetap menduck
  sepanjang scene.
- **Trek audio tidak bisa di-fade lewat kanvas** — hanya lewat panel.

## Konsekuensi

- Skema §5.1 bertambah: `clipAudioSchema`, `audio.tracks`, `meta.loudnessTarget`,
  `renderState.trackAssets`, serta `lufs` + `channels` pada aset dan narasi.
- Tahap pipeline baru, `loudness`, ber-cache per berkas. Gagal mengukur TIDAK
  membuat render gagal: video tanpa normalisasi tetap video.
- `critiquePlan` memberi tahu saat ada yang berbunyi tapi belum terukur, dan
  saat ada yang berbunyi tanpa ducking.
- Ekspor OTIO/FCPXML membawa treknya sebagai klip tapi **mengaku** amplopnya
  tidak ikut — itu otomatisasi milik render, bukan properti klip.
- Ditemukan sambil jalan: aturan id-unik-se-plan ternyata hanya menjaga scene
  dan lapisan. Grafis dan cue SFX dikunci di `renderState` dengan cara yang
  persis sama sejak ADR-0018 tanpa penjagaan itu. Sekarang keempat ruang id
  dijaga oleh gelung yang sama.

## Alternatif yang ditolak

- **Memanggil `ffmpeg -af ebur128`.** Ditolak: dependensi biner puluhan
  megabyte untuk setiap pengguna dan setiap runner CI, demi satu angka.
- **Menormalisasi campuran akhir.** Ditolak: menuntut render dua kali dan tetap
  tidak memperbaiki ketimpangan antar klip.
- **Menyimpan kenyaringan "seperti terdengar" (sudah dikoreksi mono).** Ditolak:
  membakukan asumsi stereo ke dalam data yang akan hidup lebih lama daripada
  asumsinya, dan angkanya tidak lagi cocok dengan alat ukur mana pun.
- **Menggabungkan kanal saat memindahkan PCM dari browser.** Ditolak: mono dan
  stereo berbeda 3 LU, jadi penghematan transfer itu akan membuat seluruh
  materi stereo dinormalisasi 3 dB terlalu keras.
- **Amplop terpisah untuk musik.** Ditolak: itu keadaan sebelum ADR ini, dan
  akibatnya rumus fade musik tidak pernah dipakai ulang oleh sumber lain.
