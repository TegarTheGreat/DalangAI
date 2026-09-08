/**
 * Menyunting berkas `.env` milik orang lain (ADR-0032).
 *
 * Aturan utamanya: JANGAN MERUSAK APA PUN yang tidak diminta. Berkas `.env`
 * sering berisi komentar, urutan yang berarti bagi pemiliknya, dan variabel
 * yang sama sekali bukan urusan Dalang. Menulis ulang berkas dari katalog akan
 * membuang semuanya, dan itu cara cepat kehilangan kepercayaan orang.
 *
 * Jadi: baris yang tidak disebut tidak disentuh, kunci yang sudah ada diganti
 * di tempatnya, kunci yang ada tapi dikomentari dihidupkan di tempatnya juga,
 * dan yang benar-benar baru ditambahkan di akhir. Murni: teks masuk, teks
 * keluar, tidak ada berkas yang dibuka di sini.
 */

/** Nilai perlu tanda kutip bila ada spasi, tanda pagar, atau kutip di dalamnya. */
const quoteIfNeeded = (value: string): string =>
  /[\s#"']/.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;

const assignment = (key: string, value: string): string =>
  `${key}=${quoteIfNeeded(value)}`;

/** Baris yang menyetel `key`, aktif maupun dikomentari. */
const lineSets = (line: string, key: string): boolean =>
  new RegExp(`^\\s*(#\\s*)?${key}\\s*=`).test(line);

export interface UpsertResult {
  text: string;
  /** Kunci yang menimpa nilai lama. */
  replaced: string[];
  /** Kunci yang baru ditambahkan di akhir. */
  added: string[];
  /** Kunci yang dihapus karena nilainya dikosongkan. */
  removed: string[];
}

/**
 * Terapkan `updates` ke isi `.env`.
 *
 * Nilai kosong berarti HAPUS setelan itu: baris aktifnya dijadikan komentar
 * lagi, bukan dibiarkan menjadi `KEY=` yang membingungkan. Nilai baru
 * ditambahkan di bawah satu judul supaya orang tahu dari mana asalnya.
 */
export const upsertEnv = (
  text: string,
  updates: Record<string, string>,
  options: { heading?: string } = {},
): UpsertResult => {
  const entries = Object.entries(updates);
  const lines = text === "" ? [] : text.split("\n");
  const replaced: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [key, raw] of entries) {
    const value = raw.trim();
    const index = lines.findIndex((line) => lineSets(line, key));
    if (index >= 0) {
      if (value === "") {
        // Dikomentari, bukan dibuang: pemiliknya masih bisa melihat
        // nilainya pernah ada, dan barisnya tetap di tempat semula.
        const current = lines[index] as string;
        if (!current.trimStart().startsWith("#")) {
          lines[index] = `# ${current.trim()}`;
          removed.push(key);
        }
      } else {
        lines[index] = assignment(key, value);
        replaced.push(key);
      }
      continue;
    }
    if (value === "") continue;
    added.push(key);
  }

  if (added.length > 0) {
    if (lines.length > 0 && (lines.at(-1) as string).trim() !== "") lines.push("");
    if (options.heading) lines.push(`# ${options.heading}`);
    for (const key of added) lines.push(assignment(key, (updates[key] as string).trim()));
  }

  const joined = lines.join("\n");
  return {
    text: joined.endsWith("\n") || joined === "" ? joined : `${joined}\n`,
    replaced,
    added,
    removed,
  };
};

/**
 * Baca pasangan kunci-nilai dari isi `.env`. Cukup untuk menampilkan apa yang
 * sudah terisi; bukan pengurai lengkap dotenv, dan tidak perlu.
 */
export const parseEnv = (text: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    let value = (match[2] as string).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    out[key] = value;
  }
  return out;
};
