import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILT_IN_TEMPLATES, templateFromPlan } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultTemplateDir,
  findTemplate,
  installTemplate,
  listTemplates,
  removeTemplate,
} from "../src/runtime/template-store";

/**
 * Registri template (ADR-0037).
 *
 * Folder biasa berisi JSON — jadi yang bisa salah adalah hal-hal yang biasa
 * terjadi pada folder: berkas rusak, berkas hilang, dan dua template yang
 * memperebutkan satu id.
 */

const cleanups: Array<() => void> = [];
const dirBaru = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-template-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const packBawaan = () => {
  const pack = BUILT_IN_TEMPLATES[0];
  if (!pack) throw new Error("tidak ada template bawaan");
  return pack;
};

describe("defaultTemplateDir", () => {
  it("mengikuti DALANG_HOME, sama seperti memori preferensi", () => {
    expect(defaultTemplateDir({ DALANG_HOME: "/rumah" } as NodeJS.ProcessEnv)).toBe(
      join("/rumah", "templates"),
    );
  });
});

describe("listTemplates", () => {
  it("folder kosong tetap mengembalikan template bawaan", () => {
    const { templates, broken } = listTemplates(dirBaru());
    expect(templates).toHaveLength(BUILT_IN_TEMPLATES.length);
    expect(templates.every((item) => item.builtIn)).toBe(true);
    expect(broken).toEqual([]);
  });

  it("satu berkas rusak tidak menghapus seluruh daftarnya", () => {
    // Kalau satu salah ketik membuat daftar kosong, yang terbaca oleh
    // pemakainya adalah "fitur ini tidak jalan" — padahal yang rusak satu
    // berkas.
    const dir = dirBaru();
    writeFileSync(join(dir, "rusak.json"), "{{{");
    const { templates, broken } = listTemplates(dir);
    expect(templates).toHaveLength(BUILT_IN_TEMPLATES.length);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.file).toContain("rusak.json");
  });

  it("template terpasang MENANG atas bawaan ber-id sama", () => {
    // Memasang versi sendiri adalah pernyataan pilihan; registri yang tetap
    // mengembalikan bawaan akan terlihat seperti pemasangannya gagal.
    const dir = dirBaru();
    const bawaan = packBawaan();
    const sendiri = {
      ...bawaan,
      manifest: { ...bawaan.manifest, name: "Punya saya", author: "Saya" },
    };
    installTemplate(dir, sendiri);
    const { templates } = listTemplates(dir);
    const cocok = templates.filter(
      (item) => item.pack.manifest.id === bawaan.manifest.id,
    );
    expect(cocok).toHaveLength(1);
    expect(cocok[0]?.pack.manifest.name).toBe("Punya saya");
    expect(cocok[0]?.builtIn).toBe(false);
  });
});

describe("installTemplate + removeTemplate", () => {
  it("pasang lalu temukan lagi lewat id-nya", () => {
    const dir = dirBaru();
    const bawaan = packBawaan();
    const { pack } = templateFromPlan(bawaan.plan, {
      ...bawaan.manifest,
      id: "punya-saya",
      name: "Punya saya",
    });
    installTemplate(dir, pack);
    expect(findTemplate(dir, "punya-saya")?.pack.manifest.name).toBe("Punya saya");
  });

  it("mencopot yang BAWAAN ditolak dengan alasan, bukan gagal diam-diam", () => {
    // Gagal diam-diam di sini berarti orang mengira template-nya hilang lalu
    // bingung kenapa ia muncul lagi.
    const dir = dirBaru();
    expect(() => removeTemplate(dir, packBawaan().manifest.id)).toThrow(/bawaan/);
  });

  it("mencopot yang tidak terpasang mengatakan begitu", () => {
    expect(() => removeTemplate(dirBaru(), "tidak-pernah-ada")).toThrow(
      /tidak terpasang/,
    );
  });
});
