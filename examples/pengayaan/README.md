# Katalog pengayaan — Filter, Efek, Transisi, Bunyi

Enam scene yang masing-masing memakai **satu** hal baru dari
[ADR-0041](../../docs/decisions/0041-pengayaan.md), supaya kalau salah satunya
rusak, yang merah hanya bingkai scene itu.

```bash
pnpm dalang validate examples/pengayaan/plan.json
pnpm dalang still    examples/pengayaan/plan.json -t 2 8 14 -o out
```

## Kenapa contoh ini ada

Preset warna, efek lapisan, transisi, gerak, gaya caption, dan animasi teks
semuanya adalah data yang **lolos skema apa pun**. Nilai `preset: "senja"` yang
tidak terdaftar di peta CSS akan menghasilkan gambar yang terlihat persis
seperti tanpa filter — tidak ada galat, tidak ada tes yang merah, tidak ada
yang tahu sampai seseorang membandingkan dua bingkai.

Gerbang CI `gate:pengayaan` merender contoh ini lalu **mengukur** bingkainya:
vignette harus menggelapkan sudut relatif terhadap tengah, butiran harus
menaikkan beda piksel bertetangga, dan keduanya harus melakukannya tanpa
saling meniru.

## Yang diperagakan

| Scene | Hal baru |
| --- | --- |
| `sc-0` | Filter `noir` + `vignette` 0,55 + caption `pita` + gerak `punch-in` + teks `blur-in` + bunyi `pustaka:whoosh` |
| `sc-1` | Filter `senja` + `grain` 0,5 + caption `karaoke` + gerak `tilt` + teks `slide-in` |
| `sc-2` | Filter `malam` + transisi keluar `clock-wipe` + gerak `pan-diagonal` + bunyi `pustaka:impact` |
| `sc-3` | Filter `pudar` + transisi keluar `flip-left` |
| `sc-4` | Filter `pastel` + transisi keluar `flip-up` + bunyi `pustaka:ding` |
| `sc-5` | Kartu outro; bed musik `pustaka:tenang` berbunyi sepanjang video |

Ketiga bunyi memakai `pustaka:<id>` — pustaka bawaan yang ikut repo. Contoh ini
karena itu berbunyi **tanpa jaringan sama sekali**, dan tidak ada satu berkas
pun yang perlu diunduh sebelum bisa dirender.

## Yang TIDAK diperagakan

Transisi berbasis shader (`dissolve`, `zoom-blur`, `swap`, `linear-blur` milik
`@remotion/transitions`) tidak ada di sini karena tidak ada di Dalang: Chromium
yang dipakai renderer menolak HTML-in-Canvas yang mereka butuhkan. Itu
diketahui dengan **merender**, bukan dari tipenya — TypeScript menerima
keempatnya tanpa keluhan.
