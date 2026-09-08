# ADR-0029: Memori preferensi lintas proyek

Status: diterima · Fase 10.1 (roadmap §10.1)

## Konteks

Sampai Fase 9, agent Dalang tidak mengingat apa pun di luar satu proyek.
Orang yang membuat klip podcast tiap minggu harus mengulang "pakai caption
tegas", "rasio 9:16", "jangan pakai musik dramatis" di setiap proyek baru —
dan kalau lupa, agent kembali ke bawaan. Roadmap §3.9 menyebutnya sebagai
celah: *tidak ada memori preferensi lintas proyek*.

Yang berbahaya dari memori bukan ketiadaannya, melainkan memori yang salah
bentuk: agent yang "belajar" dari satu pilihan lalu memaksakannya ke semua
proyek, memori yang tidak terlihat orangnya, dan memori yang menyimpan hal
yang bukan urusannya (nama orang, kontak). Keputusan di bawah mengejar tiga
sifat: **eksplisit, terlihat, milik orangnya**.

## Keputusan

### 1. Memori adalah kalimat preferensi, bukan model perilaku

Satu entri = satu kalimat pendek milik user dalam bahasanya sendiri
("Selalu pakai caption tegas untuk klip"), berjenis `gaya | suara | format |
larangan | catatan`, bersumber `user` atau `agent`, dengan waktu dan proyek
asal. Tidak ada bobot, tidak ada "kepercayaan", tidak ada pembelajaran
statistik: kalimat itu dibaca agent apa adanya, dan orang bisa membacanya
persis seperti agent membacanya. Skema dan semua operasinya murni di
`@dalang/core/memory.ts` (dedup teks yang mengabaikan kapital/spasi, batas
40 entri × 240 karakter yang MENOLAK dengan alasan alih-alih membuang yang
lama, id deterministik dari teks + waktu).

### 2. Milik orangnya: satu berkas di rumah Dalang

`$DALANG_HOME/memori.json` (bawaan `~/.dalang/memori.json`), dibaca Studio,
`dalang chat`, dan `dalang memori` — proyek di folder mana pun melihat
preferensi yang sama. Ia sengaja BUKAN di dalam scene-plan (plan adalah
dokumen satu video, memori adalah kebiasaan orangnya) dan bukan di folder
ruang kerja (orang yang punya dua ruang kerja tetap satu orang). Berkas
yang rusak dibaca sebagai kosong tetapi disalin dulu sebelum ditimpa. Tes
selalu memberi path sementara atau store di memori; tidak ada tes yang
menyentuh rumah pengguna.

### 3. Agent hanya menyimpan yang dinyatakan eksplisit

Dua tool: `rememberPreference(jenis, teks)` dan `forgetPreference(id)`.
System prompt menetapkan kaidahnya: simpan hanya yang user nyatakan sebagai
kebiasaan tetap ("selalu", "jangan pernah", "setiap video saya", "ke
depannya"); satu pilihan untuk satu video BUKAN preferensi; jangan pernah
menyimpan data pribadi; setelah menyimpan, katakan dalam satu kalimat apa
yang diingat. Preferensi yang ada disuntikkan tiap giliran sebagai blok
`[PREFERENSI USER LINTAS PROYEK]` di pesan user — bukan di system prompt,
supaya prompt-cache tetap utuh saat memori berubah — dengan id tiap entri,
sehingga `forgetPreference` punya pegangan. Instruksi di proyek ini selalu
menang atas memori.

### 4. Terlihat dan bisa dihapus di lobi

Lobi Studio punya bagian "Preferensi agent": daftar entri (jenis, teks,
siapa yang menulis), tombol hapus, dan formulir tambah. Rute
`/api/workspace/memory` (GET/POST/DELETE) milik host lobi, bukan proyek.
CLI: `dalang memori` (daftar), `dalang memori tambah --jenis gaya "…"`,
`dalang memori hapus <id>`. Tidak ada ingatan agent yang tidak bisa dilihat
dan dihapus orangnya.

## Verifikasi

- 6 tes murni core: id deterministik, perapian spasi, dedup lintas
  kapital/spasi, penolakan (pendek, panjang, penuh) dengan alasan,
  penghapusan, baris konteks per jenis, parse dengan bawaan.
- 4 tes agent (model terskrip): `rememberPreference` menulis dengan sumber
  `agent` dan proyek asal, duplikat tidak digandakan, `forgetPreference`
  menghapus dan keduanya tercatat di log tool; preferensi masuk ke prompt
  giliran (blok dan id-nya) dan blok tidak ada saat memori kosong; tanpa
  store tool mengatakan tidak tersedia; system prompt memuat kaidahnya.
- 2 tes host Studio: kosong → tambah (tersimpan di berkas) → duplikat →
  hapus → 404 untuk id yang tidak ada; jenis asing dan teks pendek ditolak 400.

## Batas

- **Agent tidak "belajar" diam-diam.** Preferensi yang tidak pernah
  diucapkan tidak akan pernah masuk memori — itu disengaja, dan artinya
  memori ini tidak menangkap kebiasaan yang orangnya sendiri tidak sadari.
- **Satu memori per rumah Dalang**, bukan per orang di mesin bersama: dua
  orang yang berbagi akun OS berbagi memori. `DALANG_HOME` memisahkannya.
- **Tidak ada sinkronisasi antar mesin.** Berkasnya boleh disalin.
- ~~**Konflik antar preferensi tidak dideteksi** ("selalu 9:16" dan "selalu
  16:9" bisa hidup bersama).~~ *DICABUT SEBAGIAN:* `memoryConflicts` (murni,
  di core) mengenali tiga bentuk yang pasti — rasio mutlak yang berbeda, gaya
  caption mutlak yang berbeda, dan keharusan vs larangan atas hal yang sama
  ("selalu pakai musik dramatis" vs "jangan pernah pakai musik dramatis") —
  lalu lobi Studio menampilkannya sebagai peringatan, `dalang memori`
  mencetaknya, dan blok konteks agent membawanya sebagai baris PERTENTANGAN
  yang menyuruh BERTANYA, bukan memilih sendiri. Heuristiknya sengaja sempit:
  pertentangan yang lebih halus (parafrasa, sinonim) tetap tidak terdeteksi,
  dan instruksi proyek tetap yang menang.

## Konsekuensi

- Paket core bertambah `memory.ts` (murni); paket agent bertambah
  `runtime/memory-store.ts`, dua tool, satu blok konteks, satu bagian
  system prompt; Studio bertambah rute lobi dan satu bagian UI; CLI
  bertambah perintah `memori`.
- Blok konteks agent bertambah beberapa baris per giliran hanya bila ada
  preferensi — tanpa preferensi tidak ada biaya token.
