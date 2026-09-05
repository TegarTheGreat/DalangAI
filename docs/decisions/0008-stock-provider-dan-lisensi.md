# ADR-0008 — Stock Provider & Metadata Lisensi (menjawab R-10; fondasi R-4)

**Status:** Diterima · **Tanggal:** 2026-08-29

## Konteks

PRD §4.2 memilih Pexels + Pixabay (gratis) dengan abstraksi provider; §10
mewajibkan metadata sumber + lisensi per aset (audit-ready); R-10 meminta
pemetaan kewajiban lisensi untuk konten termonetisasi. Endpoint kedua provider
terblokir di lingkungan dev ini — implementasi diuji lewat fixture; jalur
live tinggal butuh API key gratis.

## Keputusan

### 1. Dua provider di balik port `StockProvider`

- **Pexels** (utama): `/v1/search` (foto) + `/videos/search`, parameter
  `orientation` diturunkan dari aspect ratio plan (9:16→portrait, dst.).
- **Pixabay** (cadangan): `/api/` + `/api/videos/`; orientasi dipetakan
  (portrait→vertical; square→all karena tidak didukung).
- **Seleksi deterministik** (PRD prinsip #4): kandidat pertama; video
  dicoba sebelum foto; rendisi file = terkecil yang sisi pendeknya ≥1080
  (cukup untuk cover-crop 1080p), else terbesar — aturan sama di kedua
  provider, teruji unit. Reranking kandidat oleh vision model adalah R-4
  (Fase 2) dan akan duduk DI ATAS seleksi ini, bukan menggantikan porosnya.

### 2. Metadata lisensi tersimpan per aset (R-10)

`renderState.resolvedAssets[sceneId]` menyimpan verbatim: `license`,
`source`, `sourceUrl`, `author`, dimensi. Pemetaan kewajiban (dari ketentuan
resmi kedua layanan, per Agustus 2026):

| Kewajiban utk konten termonetisasi (YouTube/TikTok dsb.) | Pexels License | Pixabay Content License |
|---|---|---|
| Boleh dipakai komersial dalam karya turunan (video ini) | ya | ya |
| Atribusi | Tidak wajib (dihargai) — kita simpan `author`+`sourceUrl` agar kredit bisa dibuat otomatis | Tidak wajib — sama |
| Menjual/meredistribusi aset apa adanya (tanpa transformasi) | dilarang | dilarang |
| Memakai orang/merek yang tampak utk endorse produk | butuh izin | butuh izin |
| Konten sensitif dgn orang yang dapat dikenali | Hati-hati (hak model tidak dijamin) | Hati-hati — sama |

Implikasi produk: video hasil compose = karya turunan ⇒ aman dimonetisasi;
yang TIDAK boleh adalah fitur "unduh aset mentah" — dicatat sebagai batasan
desain untuk Fase 3 (UI hanya mengekspor hasil render). Musik library (bagian
R-10 yang tersisa) menyusul saat stage musik dibangun.

### 3. Perilaku tanpa kunci

Tanpa `PEXELS_API_KEY`/`PIXABAY_API_KEY`, setiap scene stock yang belum
resolved gagal dengan pesan yang menyebut nama env var (exit ≠ 0). Scene
`pinned`/`locked`/sudah-resolved tidak tersentuh — demo repo tetap jalan
offline.

## Konsekuensi

- (+) Kredit otomatis ("Footage: Pexels/…") bisa dirender preset kelak tanpa
  migrasi data.
- (−) Uji live + precision@1 utk 30 topik (R-4) menunggu key & egress;
  kerangka seleksi deterministik sudah menjadi baseline pembandingnya.
