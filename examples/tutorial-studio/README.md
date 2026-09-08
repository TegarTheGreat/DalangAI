# Demo Mode Tutorial (Fase 4, PRD §9)

Tutorial "Cara Membuat Video di Dalang Studio" — di-render preset
`tutorial-01` dari tiga tangkapan layar NYATA aplikasi Dalang Studio
(`assets/step-*.png`, milik proyek sendiri) plus scene pembuka/penutup.

Yang didemokan:

- `visual.type: "screenshot"` + `visual.assetId` path lokal — dimaterialkan
  stage assets sebagai aset `source: "local"` (di sini sudah prefilled di
  `renderState` agar demo berjalan tanpa pipeline).
- Keempat jenis anotasi §9 sebagai animasi murni: `zoom` (kamera diklem agar
  tidak menyingkap luar gambar), `highlight` (ring + peredup sekitar),
  `arrow` (memilih sisi lapang, dari bawah bila bisa), `blur` (redaksi).
- Chip nomor langkah otomatis, caption karaoke tema terang, kartu screenshot
  ber-titlebar.

Coba:

```bash
pnpm dalang still examples/tutorial-studio/plan.json -t 8 21.5 -o out
pnpm dalang render examples/tutorial-studio/plan.json -o tutorial.mp4
pnpm dalang studio examples/tutorial-studio   # edit anotasi di tab Anotasi
```

Koordinat target anotasi diukur presisi dari boundingBox elemen asli saat
tangkapan layar dibuat — bukan dikira-kira.
