import { CAPABILITIES, type Capability, type Setting } from "./config-catalog";

/**
 * `.env.example` DIBANGKITKAN dari katalog konfigurasi (ADR-0032), bukan
 * ditulis tangan. Berkas yang ditulis tangan akan basi pada fitur berikutnya,
 * dan itu persis yang sudah terjadi: dua belas variabel dibaca kode tanpa
 * pernah masuk ke sana.
 *
 * Semua baris dikomentari. Berkas ini adalah katalog untuk dibaca, bukan
 * konfigurasi untuk dipakai apa adanya: menyalinnya jadi `.env` dengan
 * variabel kosong yang aktif hanya menimbulkan tebakan soal mana yang sudah
 * diisi. `dalang setup` menulis `.env` yang sebenarnya.
 */

const WIDTH = 76;

const rule = (title: string): string => {
  const prefix = `# ── ${title} `;
  const dashes = Math.max(3, WIDTH - prefix.length);
  return `${prefix}${"─".repeat(dashes)}`;
};

/** Bungkus teks jadi baris komentar selebar WIDTH. */
const wrap = (text: string, prefix = "# "): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (`${prefix}${candidate}`.length > WIDTH && line !== "") {
      lines.push(`${prefix}${line}`);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(`${prefix}${line}`);
  return lines;
};

const settingBlock = (setting: Setting): string[] => {
  const lines: string[] = [];
  const tag = setting.required ? "WAJIB" : "opsional";
  lines.push(`#`, `# [${tag}] ${setting.label}`);
  lines.push(...wrap(setting.effect, "#   "));
  for (const [index, step] of (setting.howTo ?? []).entries()) {
    lines.push(...wrap(`${index + 1}. ${step}`, "#   "));
  }
  if (setting.example) lines.push(`#   contoh: ${setting.example}`);
  if (setting.fallback) lines.push(...wrap(`bila kosong: ${setting.fallback}`, "#   "));
  lines.push(`# ${setting.key}=`);
  return lines;
};

const capabilityBlock = (capability: Capability): string[] => {
  const lines: string[] = ["", rule(capability.title)];
  lines.push(...wrap(capability.plain));
  lines.push(...wrap(`Tanpa ini: ${capability.withoutIt}`));
  if (capability.alsoActiveWhen) {
    lines.push(...wrap(`Jalan lain: ${capability.alsoActiveWhen}`));
  }
  const required = capability.settings.filter((setting) => setting.required);
  if (required.length > 1) {
    lines.push(
      ...wrap(
        capability.rule === "salah-satu"
          ? "Cukup SATU dari yang bertanda WAJIB."
          : "SEMUA yang bertanda WAJIB harus diisi.",
      ),
    );
  }
  for (const setting of capability.settings) lines.push(...settingBlock(setting));
  return lines;
};

/** Isi `.env.example` apa adanya, termasuk baris baru penutup. */
export const renderEnvExample = (): string => {
  const header = [
    "# Konfigurasi Dalang. DIBANGKITKAN dari katalog; jangan disunting tangan.",
    "# Perbarui dengan: pnpm env:gen   (tes menolak bila berkas ini basi)",
    "#",
    "# Cara termudah: jalankan `pnpm dalang setup`. Ia memindai apa yang sudah",
    "# ada di mesinmu, menanyakan sisanya dengan bahasa biasa, menguji tiap",
    "# kunci ke layanannya, lalu menulis .env untukmu. Yang tidak memakai",
    "# terminal bisa memakai bagian Pengaturan di lobi Studio.",
    "#",
    "# SEMUA baris di bawah opsional. Tanpa satu kunci pun, Dalang tetap",
    "# menyusun, merender, dan mengekspor video: suara memakai Edge TTS gratis",
    "# atau trek hening berdurasi tepat, dan aset memakai berkasmu sendiri.",
    "#",
    "# Simpan salinanmu sebagai .env di folder ini. Berkas .env tidak pernah",
    "# ikut ter-commit, dan Dalang tidak pernah mencetak isi kunci ke layar.",
  ];
  const body = CAPABILITIES.flatMap((capability) => capabilityBlock(capability));
  return `${[...header, ...body].join("\n")}\n`;
};
