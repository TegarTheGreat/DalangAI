# Demo sulih suara — Satu Video, Dua Bahasa

Plan terkecil yang memperagakan [ADR-0040](../../docs/decisions/0040-sulih-suara.md):
**satu scene-plan, dua bahasa**. Gambarnya sama persis; yang berganti hanya
narasi, suaranya, teks di layar, dan judul di bilah atas.

```bash
# dari root repo
pnpm dalang sulih     examples/sulih-dua-bahasa            # keadaan tiap bahasa
pnpm dalang validate  examples/sulih-dua-bahasa --bahasa en
pnpm dalang still     examples/sulih-dua-bahasa -t 6.5 -o out --bahasa en
pnpm dalang subtitle  examples/sulih-dua-bahasa --bahasa en
```

## Kenapa contoh ini ada

Sulih suara adalah kemampuan yang paling mudah terlihat "sudah jalan" padahal
belum: plan yang menyimpan terjemahan lolos setiap pemeriksaan skema, dan
cacatnya — gambar bahasa Indonesia dengan suara bahasa Inggris, atau sebaliknya
— baru terlihat setelah videonya dirender dan ditonton. Contoh ini yang
dijalankan gerbang CI `gate:sulih`, dan bingkai yang sama dirender **dua kali**
lalu dituntut BERBEDA. Dua PNG yang identik berarti bahasanya tidak sampai ke
layar.

## Yang diperagakan

| Hal | Di mana |
| --- | --- |
| Narasi per bahasa | `scenes[].dubs.en` |
| Suara sendiri per bahasa | `audio.dubVoices.en` — tanpa ini, suara Indonesia membaca teks Inggris |
| Judul proyek ikut disulih | `meta.dubTitles.en` — tampil di bilah atas SETIAP bingkai |
| Teks layar ikut disulih | `sc-judul/tx-kicker` dan `sc-durasi/tx-hook` |
| Durasi IKUT bahasanya | 20,7 dtk (id) vs 18,3 dtk (en) — sulihan yang lebih ringkas menghasilkan video yang lebih pendek |
| Subtitle memakai jam bahasanya | `dalang subtitle --bahasa en` berakhir di 17,6 dtk, di dalam 18,3 dtk |

Nomor scene di bilah atas (`02 / 04`) sengaja ikut: ia membuktikan SUSUNAN
videonya tidak berubah antar bahasa. Sulih suara yang membuang scene yang belum
diterjemahkan akan menghasilkan dua video yang bukan lagi video yang sama.

## Yang TIDAK diperagakan

Plan ini tidak memakai aset gambar sama sekali — latar belakangnya prosedural
(`solid` dengan `variant`), dan itu disengaja: yang diuji di sini pergantian
BAHASA, bukan penanganan berkas. Contoh lain di repo ini sudah menjalankan
jalur aset.

Berkas suaranya juga tidak ikut repo. `dalang sulih --bahasa en --suara`
membuatnya dengan provider `silence` yang berjalan offline dan tanpa biaya —
cukup untuk membuktikan waktunya benar, tidak cukup untuk didengarkan.
