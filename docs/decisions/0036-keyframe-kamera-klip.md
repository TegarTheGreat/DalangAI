# ADR-0036: Kamera visual dasar bisa di-keyframe

**Status:** diterima (diterapkan) · **Tanggal:** 8 September 2026 · **Fase:** pelengkap ADR-0027

## Konteks

[ADR-0027](0027-keyframe-properti.md) memberi keyframe kepada grafis tempelan,
teks overlay, dan lapisan video. Yang TIDAK ikut waktu itu adalah yang paling
banyak dilihat orang: **gambar dasar scene-nya sendiri.**

Gerak visual dasar sejak awal datang dari satu enum: `clip.motion` —
`kenburns-in`, `pan-left`, `drift`, dan lima lainnya. Delapan gerakan yang
sudah dinamai, masing-masing berjalan rata dari awal sampai akhir potongan.

Delapan sudah cukup untuk sebagian besar potongan, dan itu sebabnya enum ini
tetap ada. Yang tidak bisa dinyatakan sama sekali adalah gerak yang **berubah
di tengah potongan**: diam dulu, lalu menghentak masuk tepat saat kalimatnya
sampai; masuk cepat lalu berhenti; mundur pelan dari satu detail ke seluruh
bidang. Ketiganya adalah tata bahasa dasar penyuntingan, dan tidak satu pun
punya nama di enum mana pun — sebab yang membedakannya bukan bentuk geraknya
melainkan KAPAN gerak itu terjadi.

README repo ini menyebutkan batas itu apa adanya: "Visual dasar scene belum
bisa di-keyframe." ADR ini mencabutnya.

## Keputusan

### 1. `clip.tracks`, memakai bentuk keyframe yang SUDAH ADA

Bentuk datanya persis `keyframeTrackSchema` milik ADR-0027 — `{ property,
points: [{ at, value, easing }] }`, waktu sebagai fraksi jendela elemen, easing
bernama, maksimal 4 track dan 8 titik. Tidak ada bentuk kedua, tidak ada
penyunting kedua, tidak ada aturan waktu kedua.

Konsekuensinya langsung: `setKeyframe`, `moveKeyframe`, `snapKeyframeTime`,
`KeyframeControls`, dan seluruh perkakas keyframe yang sudah ada bekerja pada
klip tanpa satu baris pun ditulis ulang.

Field-nya duduk di `clipSchema`, **bukan** di `visualSchema`. Media di dalam
lapisan video memakai bentuk visual yang sama, dan lapisan sudah punya
`tracks`-nya sendiri; menaruhnya satu tingkat lebih atas akan memberi satu
lapisan dua daftar track yang keduanya mengaku mengatur benda yang sama.

### 2. Properti baru `zoom`, rentang 1..3

Bukan memakai `size` yang sudah ada. `size` adalah fraksi bidang untuk grafis
tempelan (0,02–0,6); zum visual dasar adalah pengali atas bidang yang di-crop
`cover`, dan nilainya wajar mulai dari 1. Satu nama dengan dua rentang persis
yang dilarang komentar `ANIMATABLE_RANGE` sendiri.

Batas bawah **1** karena di bawah itu gambar berhenti menutupi bingkainya dan
yang muncul di tepi adalah warna latar preset — bukan efek yang diminta siapa
pun, melainkan cacat yang kebetulan terlihat seperti efek. Batas atas **3**
karena di atas itu tidak ada lagi piksel yang tersisa: aset selebar 1080 pada
zum 3 menyisakan 360 piksel untuk selebar bingkai.

### 3. Empat properti, dan `rotate` sengaja bukan salah satunya

Yang boleh: `zoom`, `offsetX`, `offsetY`, `opacity`. Tepat empat, dan
`MAX_TRACKS_PER_ELEMENT` juga empat — seluruhnya bisa dipasang sekaligus tanpa
memilih mana yang dikorbankan.

`rotate` tidak ada, dan itu geometri bukan selera: bidang `cover` yang diputar
θ berhenti menutupi bingkainya sendiri kecuali diperbesar sekitar (W·|cos θ| +
H·|sin θ|)/W. Pada 9:16, sepuluh derajat saja sudah menuntut zum sekitar 1,35
hanya supaya sudutnya tidak kosong. Tuas yang hampir selalu menghasilkan sudut
hitam bukan kelengkapan — itu jebakan yang dipasang sendiri.

### 4. Track kamera mengambil alih SELURUH jalur kamera, bukan per properti

Ini yang membedakan klip dari grafis, teks, dan lapisan — dan bedanya
disengaja.

Di sana tiap properti berdiri sendiri (`size` grafis tidak ada hubungannya
dengan `rotate`-nya), jadi satu track mengambil alih tepat satu properti.

Di sini `clip.motion` bukan kumpulan properti melainkan **satu gerakan kamera
bernama**: "pan-left" adalah skala 1,1 DAN geseran 2,2% yang diputuskan
bersama. Membiarkan satu track mengambil separuhnya menghasilkan gerak yang
bukan preset dan bukan pula yang digambar keyframe — dan tidak ada yang bisa
menebak bentuknya dari plan.

Jadi: begitu SALAH SATU dari `zoom`/`offsetX`/`offsetY` punya track, seluruh
jalur kamera jadi milik keyframe dan `motion` diabaikan. Sumbu yang tidak
di-track duduk di netral, bukan di nilai presetnya.

`opacity` berdiri di luar itu. Ia tidak menggerakkan kamera, jadi memberi satu
klip sebuah kedipan tidak boleh diam-diam mematikan Ken Burns yang sudah
dipilih orang.

`flipH` dan titik fokus tetap berlaku di kedua cabang: keduanya PEMBINGKAIAN,
bukan gerak.

### 5. Track `opacity` mengambil alih `filter.opacity`

Opasitas statis visual dasar sudah ada sejak [ADR-0011](0011-pengayaan-editor.md):
`clip.filter.opacity`. Track opasitas mengambil alihnya penuh — aturan yang
sama persis dengan `graphic.opacity` terhadap track-nya.

Karena itu `clipCamera` mengembalikan `opacity: undefined` (bukan 1) ketika
tidak ada track-nya, dan gaya opasitasnya dipasang SESUDAH `filterToCss`.
Urutan sebaliknya membuat satu klip berfilter transparan diam-diam menelan
seluruh animasi opasitasnya, dan angka 1 sebagai bawaan membuat setiap klip
berfilter transparan mendadak legap.

### 6. Jam keyframe LINEAR, jam preset ber-easing

Gerak preset dihitung dari progres yang sudah dilewatkan `easeDolly` — itu yang
membuat Ken Burns mendarat halus, dan itu tidak berubah.

Keyframe TIDAK melewati easing itu. Tiap segmen keyframe sudah membawa
easing-nya sendiri; melewatkan jamnya lewat `easeDolly` berarti mengenakan
easing dua kali, sehingga easing "linear" pun akan melambat di ujung — dan
tidak akan ada satu pun tempat di plan yang menjelaskan kenapa.

### 7. Latar prosedural ikut, tapi hanya bagian keyframe-nya

Latar prosedural (`type: "solid"` dan aset yang belum ter-resolve) tidak pernah
menuruti `clip.motion` — ia punya nafasnya sendiri. Itu tetap begitu:
membuatnya mulai menuruti preset sekarang akan menggeser setiap latar
prosedural di setiap plan yang sudah ada, perubahan yang tidak diminta siapa
pun.

Yang ditambahkan hanya kamera dari TRACK, dan pembungkusnya cuma dipasang kalau
memang ada keyframe kamera. Plan tanpa keyframe menghasilkan pohon DOM yang
sama persis seperti sebelumnya.

### 8. Tiga saran sutradara, karena ketiganya tak terlihat dari JSON

`dalang validate` dan konteks agent sekarang menyebut:

| Kode | Kapan | Kenapa perlu dikatakan |
| --- | --- | --- |
| `keyframe-pan-melebihi-zum` | geseran melebihi bidang yang ditutup zum | `offsetX: 0.3` terbaca sopan dan menghasilkan sepertiga bingkai kosong |
| `keyframe-menimpa-gerak-preset` | klip punya keyframe kamera SEKALIGUS `motion` | plan-nya menyimpan gerak yang sudah tidak berlaku, dan membaca seolah keduanya dipakai |
| `keyframe-kamera-diabaikan-preset` | preset tutorial-01 | panggung tangkapan layarnya mengarahkan kamera dari ANOTASI; keyframe di situ hilang tanpa jejak di gambar |

Yang pertama memakai geometri yang bisa ditulis: gambar ber-zum `z` menjulur
`(z − 1) / 2` bingkai di tiap sisi. `panBeyondCover` MENCICIPI kurvanya di
titik-titik keyframe kedua track plus kisi rapat — bukan membuktikan — dan ia
mengaku begitu, sebab hasilnya memang saran, bukan penolakan.

## Konsekuensi

- Gerak yang berubah di tengah potongan akhirnya bisa dinyatakan. Plan lama
  **tidak** berubah sendiri: `tracks` bawaannya kosong dan klip tanpa track
  menempuh jalur yang sama persis seperti sebelumnya.
- `ANIMATABLE_PROPERTIES` bertambah satu (`zoom`), jadi setiap permukaan yang
  memetakan properti ke label harus tahu — Studio sudah didaftarkan.
- Catatan interop sekarang menghitung klip berkeyframe sebagai "ada gerak"
  meski `motion`-nya "none". Sebelumnya ia akan melaporkan kamera yang paling
  banyak dipikirkan orang sebagai "tidak ada yang hilang".
- Satu pembaca track kedua lahir di core (`linearTrackValue`, untuk kritik),
  karena kurva easing tinggal di `@dalang/templates` dan core tidak boleh
  bergantung padanya. Dua implementasi berarti dua yang bisa menyimpang, jadi
  ada test yang mengunci keduanya pada track ber-easing linear.

## Bukti

Dirender sungguhan, tanpa satu kunci API pun, di KEDUA jalur gambar — sebab
jalur aset dan jalur prosedural adalah dua kode yang berbeda dan satu bingkai
tidak membuktikan keduanya:

| Jalur | Contoh | Yang terlihat |
| --- | --- | --- |
| Aset | `klip-borobudur`, `sc-batu-k2` | f200 relief melebar; f235 sudah masuk dan bergeser — punch-in yang menahan dulu lalu menghentak, gerak yang tidak punya nama di enum mana pun |
| Prosedural | `klip-hook`, `sc-terang-k1` | f321 cincin raksasa nyaris hilang di luar bingkai (zum 1,6); f417 lengkungnya menyapu layar (zum 1,1) |

Keduanya masuk gerbang render CI, jadi regresi kamera keyframe tertangkap
tanpa ada yang perlu merender manual.

**Paritas dibuktikan dengan merender, bukan dengan menalar.** `borobudur-60s`
— plan tanpa satu keyframe pun — dirender pada f240 dan f870 sebelum dan
sesudah perubahan ini: **identik byte per byte.** Penalaran "opasitas 1 itu
nilai awal CSS, jadi tidak mengubah apa-apa" kebetulan benar, tapi penalaran
yang kebetulan benar dan penalaran yang terbukti benar tidak bisa dibedakan
sebelum ada yang mengukur.

Satu cacat ditemukan sebelum sempat dirender, dan justru itu yang paling mahal:
`filterToCss` juga memancarkan `opacity`, dan pada versi pertama ia di-spread
SESUDAH opasitas kamera. Satu klip berfilter transparan akan menelan seluruh
animasi opasitasnya — tanpa galat, tanpa peringatan, tanpa apa pun di gambar
yang menunjukkan track-nya pernah ada.

Cacat sekelas itu juga yang menentukan bentuk skema patch-nya. `tracksSchema`
membawa `.default([])`, dan zod tetap menerapkan bawaan itu di dalam field
yang OPSIONAL: `{ clip: { motion: "none" } }` — patch yang tidak menyebut
keyframe sama sekali — akan ikut mengirim `tracks: []` dan menghapus seluruh
animasi klip itu. Karena itu `tracksArraySchema` (tanpa bawaan) dipisahkan dari
`tracksSchema` (dengan bawaan): yang opsional harus benar-benar boleh tidak
ada. Ditemukan dengan menjalankan skemanya, bukan dengan membacanya.

Dua puluh tujuh test menjaga aturan-aturan yang tidak terlihat di gambar mana
pun sampai seseorang bertanya kenapa: delapan preset gerak menghasilkan
transform yang identik dengan sebelum ADR ini, satu track kamera membuang
preset seluruhnya, track opasitas tidak membuangnya, jam keyframe tidak
ber-easing dua kali, `panBeyondCover` menangkap kebocoran yang jatuh di TENGAH
segmen — bukan di titik keyframe mana pun — dan jendela keyframe potongan
kedua diukur dari awal POTONGANNYA, bukan awal scene-nya.

## Batas yang dinyatakan

- **Preset tutorial-01 tidak memakai kamera klip.** Panggung tangkapan layarnya
  mengarahkan kamera dari anotasi (zum ke langkah yang disorot), dan dua kamera
  pada satu gambar tidak bisa dipilih salah satunya di tengah render. Yang bisa
  dilakukan sekarang: mengatakannya lewat `dalang validate`.
- **Belum ada berlian keyframe klip di timeline.** Berlian yang bisa diseret
  baru ada untuk lapisan video; keyframe klip disunting di panel Properti, di
  posisi playhead. Waktunya tetap terlihat — sebagai persentase, bukan sebagai
  titik di garis waktu.
- **`panBeyondCover` mencicipi, tidak membuktikan.** Puncak selisih antara dua
  track yang ber-easing berbeda bisa jatuh di antara dua cicipan. Ia saran,
  bukan gerbang.
- **Zum tidak menambah resolusi.** Zum 3 pada aset 1080 memang sah menurut
  skema dan memang akan terlihat lunak. Yang dijaga skema adalah rentang yang
  masuk akal, bukan mutu aset yang dipilih.
