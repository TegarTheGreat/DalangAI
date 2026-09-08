# Lisensi efek suara

Kedelapan berkas di folder ini **DISINTESIS** secara deterministik oleh
`packages/templates/scripts/buat-sfx.mjs` — pembangkitnya ikut di repo, jadi
siapa pun bisa membuatnya ulang, mengubah panjangnya, atau menyetel nadanya
tanpa menebak cara membuatnya.

Karena lahir dari angka (osilator sinus, noise LCG ber-seed tetap, dan filter
satu kutub), tidak ada rekaman pihak ketiga di dalamnya. Dirilis sebagai
**CC0 1.0 / public domain** — bebas dipakai, diubah, dan didistribusikan,
termasuk komersial, tanpa atribusi.

| Berkas | Panjang | Untuk |
| --- | --- | --- |
| `whoosh.wav` | 0,55 dtk | Sapuan udara di transisi |
| `pop.wav` | 0,12 dtk | Letup pendek saat teks masuk |
| `klik.wav` | 0,06 dtk | Klik antarmuka di tutorial |
| `ding.wav` | 0,90 dtk | Dentang lembut penanda selesai |
| `tap.wav` | 0,14 dtk | Ketukan kayu, aksen ritmis |
| `swipe.wav` | 0,32 dtk | Geser layar di potongan cepat |
| `impact.wav` | 1,10 dtk | Hentakan rendah untuk judul |
| `riser.wav` | 1,60 dtk | Naikan tegangan sebelum reveal |

Format: WAV PCM 16-bit **mono 44,1 kHz**, dinormalisasi **puncak -1 dBFS**
supaya kedelapannya setara satu sama lain — yang menyetel kekerasannya adalah
`volume` cue, bukan kebetulan sintesisnya.

Kenyaringan terintegrasi (LUFS) dicatat di `BUNDLED_SFX` hanya untuk bunyi
yang lebih panjang dari satu blok 400 ms; empat bunyi terpendek tidak punya
angka itu karena kenyaringan terintegrasi memang tidak berarti di bawah
durasi tersebut.

Direferensikan dari scene-plan sebagai `pustaka:<nama>`.
