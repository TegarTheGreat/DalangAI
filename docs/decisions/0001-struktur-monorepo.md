# ADR-0001 — Struktur Monorepo (menjawab R-7)

**Status:** Diterima (Fase 0) · **Tanggal:** 2026-08-29

## Konteks

PRD §14 R-7 meminta usulan struktur monorepo dengan boundary yang membuat tiap
paket bisa diuji terisolasi, mempertimbangkan pola hexagonal (core vs adapters).
Kebutuhan konkret: (1) skema + patch ops dipakai oleh agent, pipeline, UI, dan
template Remotion sekaligus; (2) template Remotion harus bisa di-preview di
Studio, di-render headless, dan kelak diputar di `@remotion/player` di UI; (3)
provider eksternal (TTS, stock, LLM) wajib bisa ditukar (pola fallback PRD §7.2).

## Opsi

1. **Satu paket monolitik.** Sederhana, tapi `core` akan ikut menyeret dependensi
   Remotion/Chromium ke consumer yang tidak butuh (mis. agent runtime), dan uji
   terisolasi jadi sulit.
2. **pnpm workspaces, paket per lapisan (dipilih).** `core` bebas dependensi
   berat (hanya zod); lapisan luar bergantung ke dalam, tidak pernah sebaliknya.
3. **Nx/Turborepo.** Menambah kompleksitas tooling yang belum dibutuhkan pada
   skala ≤10 paket; bisa diadopsi belakangan tanpa mengubah struktur.

## Keputusan

pnpm workspaces dengan boundary hexagonal-ringan (core di tengah, adapters di tepi):

```
packages/
  core/        skema scene-plan (zod), patch ops + lock, patch log, resolusi durasi
               → dependensi: zod saja. Diuji penuh dengan vitest tanpa browser.
  templates/   preset Remotion terkurasi (documentary-01) + font vendored
               → satu-satunya paket yang berisi komponen React/Remotion.
               Sub-export `./paths` & `./layout` bebas-remotion agar consumer
               Node tidak perlu mengevaluasi komponen.
  renderer/    RenderTarget lokal: staging publicDir, deteksi Chromium,
               bundling + renderMedia/renderStill, profil draft|final.
  cli/         perintah `dalang validate|still|render`.
  (fase 1+)    pipeline/, providers/* (tts-elevenlabs, stock-pexels, …), agent/, ui/
```

Aturan boundary:

- `core` tidak boleh mengimpor dari paket lain. Semua paket lain boleh
  mengimpor `core`.
- Komponen React hanya hidup di `templates` (kelak juga `ui`). Renderer dan CLI
  tidak pernah mengimpor komponen — mereka mem-bundle entry point via
  `@remotion/bundler`.
- `providers/*` (Fase 1) mengimplementasikan interface yang dideklarasikan
  `pipeline`, bukan sebaliknya — agar fallback antar provider (PRD §7.2) berupa
  penukaran adapter murni.
- Paket internal mengekspor sumber TS langsung (`main: src/index.ts`, tanpa
  build step) — dikonsumsi via tsx (Node), webpack (Remotion), dan vitest.

## Konsekuensi

- (+) `core` diuji 51 kasus dalam <1 dtk tanpa Chromium; kontrak produk
  (lock, pin, inverse ops) terkunci oleh test, bukan konvensi.
- (+) Menambah RenderTarget cloud (Fase 5) = paket baru yang meniru interface
  `renderer`, tanpa menyentuh pipeline.
- (+) Satu versi Remotion dipin di dua paket saja (templates, renderer) —
  mitigasi risiko "perubahan API Remotion" (PRD §13).
- (−) Tanpa build step, mem-publish paket ke npm kelak butuh menambah tsup/tsc
  build — diterima, karena semua paket masih private.
- (−) Ekspor sumber TS menuntut konsistensi `moduleResolution: Bundler` dan
  import relatif tanpa ekstensi (webpack Remotion tidak menerapkan
  extensionAlias `.js`→`.ts`).
