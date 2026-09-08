# Demo klip — Satu Kalimat, Banyak Potongan

Plan terkecil yang memperagakan [ADR-0033](../../docs/decisions/0033-beberapa-klip-dalam-satu-scene.md):
**satu scene, tiga potongan gambar**. Satu narasi, satu caption, satu transisi
keluar — yang berganti hanya gambarnya.

```bash
# dari root repo
pnpm dalang validate examples/klip-borobudur/plan.json
pnpm dalang still    examples/klip-borobudur/plan.json -t 5 9.13 11
pnpm dalang render   examples/klip-borobudur/plan.json --profile draft
```

## Kenapa contoh ini ada

Kedua contoh lain di repo ini berklip satu, jadi jalur `ClipStrip` —
kuantisasi bingkai, potong keras, dan `TransitionSeries` di dalam scene —
tidak pernah benar-benar dirender oleh CI. Kemampuan yang tidak pernah
dijalankan gerbang mana pun adalah kemampuan yang tidak terbukti ada. Plan ini
yang menjalankannya, dan sekaligus jadi peragaan yang bisa dibuka orang alih-
alih klaim di README.

## Yang diperagakan

| Hal | Di mana |
| --- | --- |
| Durasi scene = JUMLAH durasi klipnya (§2) | `sc-batu`, `duration: "auto"`, 3,2 + 2,6 + 3,4 = 9,2 dtk |
| Potong keras sebagai bawaan di dalam scene (§6) | batas `sc-batu-k1` → `sc-batu-k2`, tanpa field `transition` |
| Larut ANTAR KLIP, titik tengahnya tepat di potongan | `sc-batu-k2.transition`, cross-fade 18 bingkai |
| Caption menyeberangi seluruh potongan | satu narasi untuk ketiganya; frame 225 jatuh di tengah kalimat |
| Gerak kamera per potongan | `pan-right`, `kenburns-in`, `kenburns-out` |
| Aset dikunci per KLIP | `renderState.clipAssets` memakai id klip, bukan id scene |

Transisi pada klip TERAKHIR sengaja tidak dipasang: batas itu milik scene, dan
`clipFrameSpans` mengabaikannya. Contoh yang menyimpan field mati di sana akan
mengajarkan pola yang salah kepada siapa pun yang menyalinnya.

## Yang TIDAK diperagakan

Plan ini **tidak** ikut gerbang paritas migrasi, dan itu bukan kelalaian:
skema v1 tidak punya bentuk untuk scene berklip banyak, jadi menurunkannya ke
v1 mustahil. Gerbang itu tetap berjalan atas dua contoh berklip satu, yang
memang bisa diwakili v1.

Asetnya menumpang ilustrasi demo Borobudur (lihat `assets/LICENSE.md`) supaya
contoh ini tetap ringan; yang diuji di sini susunan potongannya, bukan seninya.
