# Berkontribusi ke Dalang AI

Dokumen produk: [docs/PRD.md](docs/PRD.md). Keputusan arsitektur:
[docs/decisions/](docs/decisions/). Fase dikerjakan **berurutan** (PRD §11) —
kerjakan sesuai fase aktif, dan setiap tugas riset R-x menghasilkan ADR
sebelum implementasinya.

## Setup

```bash
# Node 22 (lihat .nvmrc) + pnpm (via corepack)
pnpm install
```

## Perintah harian

| Perintah | Fungsi |
|---|---|
| `pnpm test` | Unit test semua paket (tanpa browser, <5 dtk) |
| `pnpm typecheck` | `tsc --noEmit` semua paket |
| `pnpm lint` / `pnpm lint:fix` | Biome (lint + format + organize imports) |
| `pnpm dalang validate\|still\|render …` | CLI (lihat README) |
| `pnpm studio` | Remotion Studio dengan demo ter-stage |
| `pnpm schema:gen` | Regenerasi artefak JSON Schema setelah mengubah skema |

CI menjalankan lint → typecheck → test → validate → **render smoke** (2 frame
nyata). Semuanya harus hijau sebelum merge.

## Boundary paket (ADR-0001)

- `core` hanya bergantung pada zod. Tidak boleh mengimpor paket lain.
- Komponen React hanya hidup di `templates` (kelak `ui`). Logika yang bisa
  murni **harus** murni: timing, layout, pagination, tipografi → modul `.ts`
  ber-unit-test; komponen tinggal me-render.
- Renderer/CLI tidak pernah mengimpor komponen — hanya
  `@dalang/templates/paths` dan `/layout` (bebas-remotion).
- `providers/*` (Fase 1) mengimplementasikan interface milik `pipeline`,
  bukan sebaliknya.

## Konvensi kode

- TypeScript strict; import relatif **tanpa ekstensi** (webpack Remotion tidak
  memetakan `.js`→`.ts`).
- Versi dependensi dipin eksak (PRD §13: risiko perubahan API Remotion).
- Komponen Remotion mengikuti **Remotion Agent Skills** di
  `packages/templates/.agents/skills/` (`<Video>/<Audio>` dari
  `@remotion/media`, animasi via `useCurrentFrame` + `interpolate` inline,
  CSS `scale`/`translate`/`rotate`).
- Determinisme adalah kontrak (PRD prinsip #4): tidak ada `Math.random`/waktu
  sistem di jalur render — pakai `random(seed)` Remotion atau konstanta.

## Mengubah skema scene-plan

1. Usulkan lewat ADR (skema §5.1 tidak diubah diam-diam).
2. Ubah zod di `packages/core/src/scene-plan.ts` + test.
3. `pnpm schema:gen` (unit test akan gagal kalau artefak basi).
4. Perubahan yang memutus kompatibilitas ⇒ bump `SCHEMA_VERSION` + fungsi
   migrasi.

## Menguji perubahan visual template

```bash
pnpm dalang still examples/borobudur-60s/plan.json -t 2.6 8 15 22 29 36 44 49.5 -o out
```

Bandingkan dengan frame acuan di `docs/media/`. Snapshot timeline di
`packages/templates/test/layout.test.ts` sengaja mengunci timing demo — kalau
kamu memang mengubah timing, perbarui snapshot itu secara sadar di commit yang
sama.
