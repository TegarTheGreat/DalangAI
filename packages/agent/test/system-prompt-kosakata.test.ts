import {
  CAPTION_STYLES,
  FILTER_PRESETS,
  MOTIONS,
  TEXT_ANIMS,
  TEXT_EMPHASES,
  TRANSITION_TYPES,
} from "@dalang/core";
import { FONT_CHOICES } from "@dalang/templates/fonts";
import { BUNDLED_SFX, SFX_LIBRARY_PREFIX } from "@dalang/templates/sfx";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../src/index";

/**
 * Kosakata kreatif di system prompt.
 *
 * Fitur yang tidak disebut di prompt tidak pernah dipakai agent. Setelah
 * ADR-0041 menambah lima preset warna dan tiga transisi, prompt masih
 * menyebut daftar lama — dan tidak ada satu tes pun yang gagal. Tes ini yang
 * menutupnya: setiap anggota enum skema, setiap keluarga font, dan setiap
 * efek suara bawaan HARUS tersebut di prompt.
 */
describe("system prompt menyebut seluruh kosakata yang tersedia", () => {
  const harusAda = (nama: string, daftar: readonly string[]) => {
    for (const butir of daftar) {
      expect(SYSTEM_PROMPT, `${nama}: "${butir}" tidak disebut di prompt`).toContain(
        butir,
      );
    }
  };

  it("preset filter, transisi, gerak, animasi teks, gaya caption, penekanan", () => {
    harusAda("FILTER_PRESETS", FILTER_PRESETS);
    harusAda("TRANSITION_TYPES", TRANSITION_TYPES);
    harusAda("MOTIONS", MOTIONS);
    harusAda("TEXT_ANIMS", TEXT_ANIMS);
    harusAda("CAPTION_STYLES", CAPTION_STYLES);
    harusAda("TEXT_EMPHASES", TEXT_EMPHASES);
  });

  it("setiap keluarga font ter-bundle", () => {
    harusAda(
      "FONT_CHOICES",
      FONT_CHOICES.map((font) => font.family),
    );
  });

  it("setiap efek suara bawaan, dengan id lengkapnya", () => {
    harusAda(
      "BUNDLED_SFX",
      BUNDLED_SFX.map((sfx) => `${SFX_LIBRARY_PREFIX}${sfx.id}`),
    );
  });

  it("vignette dan grain disebut — keduanya bukan preset, jadi mudah terlewat", () => {
    expect(SYSTEM_PROMPT).toContain("vignette");
    expect(SYSTEM_PROMPT).toContain("grain");
  });

  it("bahasa render disebut supaya agent tahu bisa merender versi sulih", () => {
    expect(SYSTEM_PROMPT).toContain("renderPreview dan renderFinal menerima { bahasa }");
    expect(SYSTEM_PROMPT).toContain("publishVideo membaca bahasa dari NAMA berkas");
  });
});
