# Demo klip pendek — Tiga Detik Pertama

Plan terkecil yang memperagakan [ADR-0035](../../docs/decisions/0035-preset-klip-01.md):
preset **klip-01**, bahasa visual untuk konten pendek vertikal yang ditonton
tanpa suara.

```bash
# dari root repo
pnpm dalang validate examples/klip-hook/plan.json
pnpm dalang still    examples/klip-hook/plan.json -t 0.7 2 8 13.9
pnpm dalang render   examples/klip-hook/plan.json --profile draft
```

## Kenapa contoh ini ada

Dua alasan, dan keduanya soal bukti.

**Pertama:** sampai plan ini ada, tidak ada satu pun contoh berpreset klip-01
yang dirender CI. Preset yang tidak pernah dijalankan gerbang mana pun adalah
preset yang regresinya baru ketahuan saat seseorang merender manual — dan
tidak ada yang merender manual.

**Kedua:** plan ini **tidak punya satu berkas aset pun.** Seluruh latarnya
prosedural (`type: "solid"` dengan varian `rays`/`grid`/`topo`/`duotone`),
jadi ia sekaligus menjalankan jalur offline-first: tanpa kunci API, tanpa
unduhan, tanpa menambah berkas biner ke repo.

## Yang diperagakan

| Hal | Di mana |
| --- | --- |
| Preset klip-01 dipilih plan | `meta.stylePreset: "klip-01"` bersama `meta.format: "klip"` |
| Zona aman platform (ADR-0034) yang ASIMETRIS | `meta.safeArea` 7% atas / 20% bawah / 14% kanan — rel tombol di kanan, keterangan di bawah |
| Caption berpelat yang memeluk teksnya | tiap scene isi; pelat menyempit mengikuti panjang kalimat |
| Hentakan kata aktif | kata yang sedang dibacakan membesar sesaat, bukan hanya berganti warna |
| Garis retensi di tepi atas | terlihat di semua bingkai, memanjang seiring waktu |
| Beberapa klip dalam satu scene (ADR-0033) | `sc-hook`, dua potongan berurutan |
| Chip outro | `sc-outro`, `template-anim` varian `outro` |
| Kamera keyframe di latar PROSEDURAL (ADR-0036) | `sc-terang-k1.tracks`: tarik mundur pelan dari zum 1,6 ke 1,05 — jalur kode yang berbeda dari klip beraset, jadi ia butuh bingkainya sendiri di CI |

## Yang SENGAJA tidak ada di sini

**Tidak ada kartu judul.** Kaidah sutradara repo ini menolaknya untuk format
klip — "penonton memutuskan dalam 3 detik" — dan `dalang validate` akan
memperingatkan kalau ada. Contoh yang melanggar kaidah repo sendiri
mengajarkan hal yang salah, jadi yang membuka plan ini adalah **teks hook**
(`sc-hook.texts`), persis yang disarankan kaidah agent.

Preset klip-01 tetap punya `HookScene` untuk plan yang memang memuat kartu
judul — misalnya hasil impor, atau klip yang sebenarnya potongan dari karya
lebih panjang. Ia merender kartu itu secepat mungkin (mendarat dalam 6
bingkai), tapi "cepat" tidak membuat kartu judul jadi ide bagus untuk klip
pendek. Yang tercepat tetap tidak memakainya.

Plan ini juga lulus `dalang validate` **tanpa satu pun saran sutradara** —
termasuk saran soal tempo transisi yang seragam, yang sebabnya tiap batas
scene di sini punya panjang larut berbeda (8, 22, 9, 18, 10 bingkai).
