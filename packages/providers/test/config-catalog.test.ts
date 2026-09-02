import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_SETTINGS,
  CAPABILITIES,
  capabilityStatuses,
  isFilled,
  maskSecret,
  renderEnvExample,
  settingOf,
} from "../src";

/**
 * Katalog konfigurasi (ADR-0032). Tes pertama di bawah adalah alasan katalog
 * ini ada: ia MEMBACA kode sumber dan menolak variabel lingkungan yang dibaca
 * program tetapi tidak pernah dijelaskan ke siapa pun. Sebelum katalog ada,
 * dua belas variabel lolos begitu, sembilan di antaranya tidak disebut di
 * berkas mana pun.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Variabel yang sengaja TIDAK dianggap setelan Dalang, beserta alasannya.
 * Daftar ini pendek dengan sengaja: setiap tambahan adalah hal yang kami
 * putuskan untuk tidak jelaskan kepada pengguna.
 */
const BUKAN_SETELAN: Record<string, string> = {
  PATH: "milik sistem operasi; dibaca untuk mencari program, bukan untuk diatur",
  DALANG_STUDIO_PORT:
    "hanya untuk server dev Vite saat mengembangkan Dalang, bukan setelan pemakai",
};

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Folder titik memuat skill dan contoh pihak ketiga, bukan kode kami.
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

describe("katalog menutup seluruh konfigurasi yang dibaca program", () => {
  it("tidak ada variabel lingkungan di kode yang tidak dijelaskan katalog", () => {
    const packagesDir = join(repoRoot, "packages");
    const found = new Map<string, string>();
    for (const file of sourceFiles(packagesDir)) {
      if (file.includes(`${join("packages", "providers", "test")}`)) continue;
      const text = readFileSync(file, "utf8");
      for (const pattern of [
        /process\.env\.([A-Z_][A-Z0-9_]*)/g,
        // ProviderEnv dan sejenisnya dibaca lewat parameter `env`.
        /\benv\.([A-Z_][A-Z0-9_]{3,})/g,
      ]) {
        for (const match of text.matchAll(pattern)) {
          const key = match[1] as string;
          if (!found.has(key)) found.set(key, file.replace(`${repoRoot}/`, ""));
        }
      }
    }
    const undocumented = [...found.entries()]
      .filter(([key]) => !BUKAN_SETELAN[key] && settingOf(key) === undefined)
      .map(([key, file]) => `${key} (dibaca di ${file})`);
    expect(undocumented, "tambahkan ke config-catalog.ts atau ke BUKAN_SETELAN").toEqual(
      [],
    );
  });

  it(".env.example di repo sama persis dengan yang dibangkitkan katalog", () => {
    const onDisk = readFileSync(join(repoRoot, ".env.example"), "utf8");
    expect(onDisk, "jalankan: pnpm env:gen").toBe(renderEnvExample());
  });

  it("setiap kunci unik, punya efek, dan yang wajib punya cara mendapatkannya", () => {
    const keys = ALL_SETTINGS.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const setting of ALL_SETTINGS) {
      expect(setting.effect.length, setting.key).toBeGreaterThan(10);
      expect(setting.key, `${setting.key} bukan nama variabel lingkungan`).toMatch(
        /^[A-Z][A-Z0-9_]*$/,
      );
    }
    for (const capability of CAPABILITIES) {
      expect(capability.settings.length, capability.id).toBeGreaterThan(0);
      expect(capability.plain.length, capability.id).toBeGreaterThan(20);
      expect(capability.withoutIt.length, capability.id).toBeGreaterThan(20);
    }
  });
});

describe("keadaan kemampuan dari env", () => {
  it("aturan salah-satu hidup dengan satu kunci; aturan semua menuntut lengkap", () => {
    const satuStok = capabilityStatuses({ PEXELS_API_KEY: "abc" });
    const stok = satuStok.find((status) => status.id === "stok");
    expect(stok?.active).toBe(true);
    expect(stok?.filled).toEqual(["PEXELS_API_KEY"]);
    expect(stok?.missing).toEqual([]);

    const cloudSebagian = capabilityStatuses({
      AWS_REGION: "ap-southeast-1",
      DALANG_LAMBDA_FUNCTION: "fn",
    }).find((status) => status.id === "cloud");
    expect(cloudSebagian?.active).toBe(false);
    expect(cloudSebagian?.missing).toContain("DALANG_LAMBDA_BUCKET");
    expect(cloudSebagian?.missing).not.toContain("AWS_REGION");
  });

  it("nilai kosong atau spasi tidak dianggap terisi", () => {
    expect(isFilled(undefined)).toBe(false);
    expect(isFilled("   ")).toBe(false);
    expect(isFilled(" x ")).toBe(true);
    const kosong = capabilityStatuses({ PEXELS_API_KEY: "  " }).find(
      (status) => status.id === "stok",
    );
    expect(kosong?.active).toBe(false);
  });

  it("kemampuan yang jalan tanpa kunci dilaporkan aktif sejak awal", () => {
    const statuses = capabilityStatuses({});
    expect(statuses.find((status) => status.id === "suara")?.active).toBe(true);
    expect(statuses.find((status) => status.id === "sfx")?.active).toBe(true);
    expect(statuses.find((status) => status.id === "chat")?.active).toBe(false);
    // Transkripsi TIDAK termasuk: whisper.cpp harus terpasang dulu.
    expect(statuses.find((status) => status.id === "transkrip")?.active).toBe(false);
  });

  it("deteksi di luar env, mis. whisper.cpp terpasang, ikut menghidupkan", () => {
    const tanpa = capabilityStatuses({}).find((status) => status.id === "transkrip");
    expect(tanpa?.active).toBe(false);
    const dengan = capabilityStatuses({}, { transkrip: true }).find(
      (status) => status.id === "transkrip",
    );
    expect(dengan?.active).toBe(true);
    expect(dengan?.activeByDetection).toBe(true);
    expect(dengan?.missing).toEqual([]);
  });
});

describe("penyamaran rahasia", () => {
  it("hanya empat karakter terakhir yang terlihat, dan panjangnya tidak bocor", () => {
    expect(maskSecret("sk-ant-rahasia-panjang-sekali-1234")).toBe("••••1234");
    expect(maskSecret("abcd")).toBe("••••");
    expect(maskSecret("")).toBe("");
    expect(maskSecret("   ")).toBe("");
  });
});
