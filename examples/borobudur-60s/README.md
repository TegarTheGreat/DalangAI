# Demo Fase 0 — Sejarah Borobudur dalam 60 Detik

Scene-plan hardcoded (tanpa AI, sesuai gate Fase 0) yang men-demonstrasikan
preset `documentary-01`: title card tipografis, 6 scene bernarasi dengan
caption karaoke tersinkron estimasi, dan outro CTA — 9:16, 1080p.

```bash
# dari root repo
pnpm dalang validate examples/borobudur-60s/plan.json
pnpm dalang still    examples/borobudur-60s/plan.json -t 8 29 44
pnpm dalang render   examples/borobudur-60s/plan.json --profile draft
pnpm dalang render   examples/borobudur-60s/plan.json --profile final
```

Yang sengaja diperagakan oleh plan ini:

- `template-anim` + `variant` ("title"/"outro") untuk scene tipografis murni.
- `renderState.resolvedAssets` yang diisi tangan — mensimulasikan keluaran
  pipeline Fase 1, lengkap dengan metadata lisensi per aset.
- `duration: "auto"` (badan video) vs durasi eksplisit (title/outro).
- Semua motion preset: `kenburns-in/out`, `pan-left/right`.
- Aset ter-`pinned` — pipeline auto-resolve kelak tidak akan menimpanya.
