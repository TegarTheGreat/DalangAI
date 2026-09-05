import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  CAPABILITIES,
  type Capability,
  capabilityStatuses,
  findWhisperCpp,
  isFilled,
  isProbeable,
  maskSecret,
  parseEnv,
  probeSetting,
  type Setting,
  upsertEnv,
} from "@dalang/providers";
import { findBrowserExecutable } from "@dalang/renderer";
import type { Command } from "commander";

/**
 * `dalang setup` dan `dalang doctor` (ADR-0032).
 *
 * Berkas ini SENGAJA tipis: seluruh pengetahuannya — setelan apa yang ada,
 * apa yang dibukanya, cara mendapatkannya, cara mengujinya, dan cara menulis
 * `.env` tanpa merusak isi orang — ada di paket providers dan sudah diuji di
 * sana. Yang tinggal di sini hanya urutan pertanyaan dan cara mencetaknya.
 *
 * Nada yang dituju: orang yang belum pernah memakai terminal harus bisa
 * menyelesaikannya. Karena itu setiap kemampuan diperkenalkan dengan apa yang
 * bisa DILAKUKAN, bukan nama teknologinya, dan setiap langkah menyebutkan apa
 * yang tetap berjalan kalau dilewati.
 */

const CENTANG = "  ok   ";
const KOSONG = "  -    ";
const SILANG = "  x    ";

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length);

/** Titik-titik perata supaya kolom status mudah dipindai mata. */
const dotted = (label: string, width = 42): string => {
  const dots = Math.max(1, width - label.length);
  return `${label} ${".".repeat(dots)}`;
};

interface Scan {
  envPath: string;
  envText: string;
  fromFile: Record<string, string>;
  whisper: { binPath: string; modelPath: string } | null;
  browser: string | null;
}

const scan = (envPath: string): Scan => {
  const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  return {
    envPath,
    envText,
    fromFile: parseEnv(envText),
    whisper: findWhisperCpp(process.env),
    browser: findBrowserExecutable() ?? null,
  };
};

/** Kemampuan yang hidup karena hal di luar variabel lingkungan. */
const detectedFrom = (scanned: Scan): Record<string, boolean> => ({
  transkrip: scanned.whisper !== null,
});

const printMachine = (scanned: Scan): void => {
  console.log("\n  Mesin ini");
  console.log(`${CENTANG}Node ${process.version}`);
  console.log(
    scanned.browser
      ? `${CENTANG}Chromium untuk render ditemukan`
      : `${KOSONG}Chromium belum ditemukan; Remotion akan mengunduhnya saat render pertama`,
  );
  console.log(
    scanned.whisper
      ? `${CENTANG}whisper.cpp terpasang, transkripsi bisa jalan tanpa kirim rekaman ke mana pun`
      : `${KOSONG}whisper.cpp belum terpasang (opsional)`,
  );
  console.log(
    existsSync(scanned.envPath)
      ? `${CENTANG}${scanned.envPath} sudah ada, isinya akan dijaga`
      : `${KOSONG}${scanned.envPath} belum ada, akan dibuat bila perlu`,
  );
};

const printStatus = (scanned: Scan): ReturnType<typeof capabilityStatuses> => {
  const statuses = capabilityStatuses(
    process.env as Record<string, string | undefined>,
    detectedFrom(scanned),
  );
  const hidup = statuses.filter((status) => status.active);
  const belum = statuses.filter((status) => !status.active);

  console.log("\n  Sudah bisa dipakai sekarang");
  for (const status of hidup) {
    const why = status.activeByDetection
      ? "terdeteksi di mesin ini"
      : status.filled.length > 0
        ? `${status.filled.length} setelan terisi`
        : "tanpa perlu kunci apa pun";
    console.log(`${CENTANG}${dotted(status.title)} ${why}`);
  }
  if (belum.length > 0) {
    console.log("\n  Belum menyala");
    for (const [index, status] of belum.entries()) {
      console.log(`${KOSONG}${index + 1}. ${status.title}`);
      console.log(`       butuh ${needsSentence(status)}`);
    }
  }
  return statuses;
};

/** Kalimat "yang dibutuhkan", memakai kata sambung yang benar per aturan. */
const needsSentence = (status: {
  rule: string;
  missing: string[];
  alsoActiveWhen?: string;
}): string => {
  const joined = status.missing.join(status.rule === "semua" ? " dan " : " atau ");
  return status.alsoActiveWhen ? `${joined}; atau ${status.alsoActiveWhen}` : joined;
};

const printSettingHelp = (setting: Setting): void => {
  console.log(`\n  ${setting.label}`);
  console.log(`    ${setting.effect}`);
  for (const [index, step] of (setting.howTo ?? []).entries()) {
    console.log(`    ${index + 1}. ${step}`);
  }
};

/** Setelan wajib sebuah kemampuan, yang jadi bahan pertanyaan wizard. */
const requiredSettings = (capability: Capability): Setting[] =>
  capability.settings.filter((setting) => setting.required);

export const registerSetupCommands = (program: Command): void => {
  program
    .command("setup")
    .description(
      "Pandu penyiapan Dalang: memindai yang sudah ada di mesin ini, menanyakan sisanya dengan bahasa biasa, menguji tiap kunci, lalu menulis .env",
    )
    .option("--env <path>", "berkas .env yang disunting", ".env")
    .option("--tanpa-uji", "jangan menghubungi layanan untuk menguji kunci")
    .action(async (options: { env: string; tanpaUji?: boolean }) => {
      const envPath = resolve(options.env);
      const scanned = scan(envPath);

      console.log("\n  Dalang setup");
      console.log(
        "  Semua langkah boleh dilewati. Tanpa satu kunci pun, Dalang tetap\n" +
          "  menyusun, merender, dan mengekspor video.",
      );
      printMachine(scanned);
      const statuses = printStatus(scanned);
      const belum = statuses.filter((status) => !status.active);

      if (!process.stdin.isTTY) {
        console.log(
          "\n  Terminal ini tidak interaktif, jadi berhenti di laporan saja.\n" +
            "  Jalankan `dalang setup` di terminal biasa untuk mengisi setelannya.",
        );
        return;
      }
      if (belum.length === 0) {
        console.log("\n  Semuanya sudah menyala. Tidak ada yang perlu diisi.");
        return;
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      /**
       * Berhenti rapi saat masukan habis. Tanpa ini, Ctrl+D atau pipa yang
       * tertutup membuat `question` menunggu selamanya dan prosesnya
       * menggantung — yang persis terjadi saat wizard ini pertama diuji.
       */
      const stop = new AbortController();
      rl.on("close", () => stop.abort());
      const ask = async (prompt: string): Promise<string | null> => {
        if (stop.signal.aborted) return null;
        try {
          return (await rl.question(prompt, { signal: stop.signal })).trim();
        } catch {
          return null;
        }
      };

      const updates: Record<string, string> = {};
      try {
        const jawaban = await ask(
          "\n  Mau menyalakan yang mana? Ketik nomornya, pisah dengan koma.\n" +
            "  Enter = semuanya, atau ketik l untuk keluar: ",
        );
        if (jawaban === null || jawaban.toLowerCase() === "l") return;
        const dipilih =
          jawaban === ""
            ? belum
            : jawaban
                .split(",")
                .map((part) => belum[Number(part.trim()) - 1])
                .filter(
                  (status): status is (typeof belum)[number] => status !== undefined,
                );

        for (const status of dipilih) {
          const capability = CAPABILITIES.find((item) => item.id === status.id);
          if (!capability) continue;
          console.log(`\n  ── ${capability.title} ──`);
          console.log(`  ${capability.plain}`);
          console.log(`  Kalau dilewati: ${capability.withoutIt}`);
          if (capability.alsoActiveWhen)
            console.log(`  Jalan lain: ${capability.alsoActiveWhen}`);

          const wajib = requiredSettings(capability);
          let target: Setting[] = wajib;
          if (capability.rule === "salah-satu" && wajib.length > 1) {
            console.log("\n  Cukup pilih SATU:");
            for (const [index, setting] of wajib.entries()) {
              console.log(`    ${index + 1}. ${setting.label} — ${setting.effect}`);
            }
            const pilihan = await ask("  Nomor pilihanmu, atau Enter untuk melewati: ");
            if (pilihan === null) break;
            const dipilihSetting = wajib[Number(pilihan) - 1];
            if (!dipilihSetting) {
              console.log("  Dilewati.");
              continue;
            }
            target = [dipilihSetting];
          }

          for (const setting of target) {
            printSettingHelp(setting);
            const current = process.env[setting.key];
            if (isFilled(current)) {
              console.log(`    sudah terisi sekarang: ${maskSecret(current as string)}`);
            }
            // Isi sampai benar: kunci yang ditolak layanannya ditanya ulang,
            // bukan disimpan diam-diam untuk gagal nanti saat dipakai.
            let berhenti = false;
            for (;;) {
              const nilai = await ask("    Tempel nilainya di sini (Enter = lewati): ");
              if (nilai === null) {
                berhenti = true;
                break;
              }
              if (nilai === "") {
                console.log("    Dilewati.");
                break;
              }
              if (options.tanpaUji || !isProbeable(setting.key)) {
                updates[setting.key] = nilai;
                console.log("    Disimpan tanpa diuji.");
                break;
              }
              process.stdout.write("    Menguji ke layanannya... ");
              const hasil = await probeSetting(setting.key, nilai);
              console.log(hasil.detail);
              if (hasil.status !== "gagal") {
                updates[setting.key] = nilai;
                break;
              }
              const lagi = await ask("    Coba nilai lain? (y/T) ");
              if (lagi === null) {
                berhenti = true;
                break;
              }
              if (!lagi.toLowerCase().startsWith("y")) break;
            }
            // Masukan habis: simpan yang sudah terkumpul, jangan menggantung.
            if (berhenti) break;
          }
        }
      } finally {
        rl.close();
      }

      if (Object.keys(updates).length === 0) {
        console.log("\n  Tidak ada yang diubah.");
        return;
      }
      const hasil = upsertEnv(scanned.envText, updates, {
        heading: `Ditambahkan oleh dalang setup pada ${new Date().toISOString().slice(0, 10)}`,
      });
      writeFileSync(envPath, hasil.text);
      console.log(`\n  Tersimpan ke ${envPath}`);
      for (const key of [...hasil.replaced, ...hasil.added]) {
        console.log(`${CENTANG}${key}`);
      }
      console.log(
        "\n  Berkas .env tidak pernah ikut ter-commit, dan isinya tidak pernah\n" +
          "  dicetak ke layar. Lanjutkan dengan: pnpm dalang studio",
      );
    });

  program
    .command("doctor")
    .description(
      "Periksa keadaan Dalang di mesin ini: apa yang menyala, apa yang kurang, dan setelan mana yang isinya ditolak layanannya",
    )
    .option("--env <path>", "berkas .env yang dibaca sebagai rujukan", ".env")
    .option("--uji", "hubungi tiap layanan untuk menguji kunci yang terisi")
    .action(async (options: { env: string; uji?: boolean }) => {
      const scanned = scan(resolve(options.env));
      console.log("\n  Dalang doctor");
      printMachine(scanned);
      const statuses = capabilityStatuses(
        process.env as Record<string, string | undefined>,
        detectedFrom(scanned),
      );

      console.log("\n  Kemampuan");
      for (const status of statuses) {
        const mark = status.active ? CENTANG : KOSONG;
        const note = status.active
          ? status.activeByDetection
            ? "terdeteksi di mesin ini"
            : status.readyWithoutConfig && status.filled.length === 0
              ? "jalan tanpa kunci"
              : `${status.filled.length} setelan terisi`
          : `butuh ${needsSentence(status)}`;
        console.log(`${mark}${dotted(status.title)} ${note}`);
      }

      let bermasalah = 0;
      if (options.uji) {
        console.log("\n  Uji ke layanan sungguhan");
        const terisi = CAPABILITIES.flatMap((capability) => capability.settings).filter(
          (setting) => isFilled(process.env[setting.key]) && isProbeable(setting.key),
        );
        if (terisi.length === 0)
          console.log(`${KOSONG}Tidak ada setelan terisi yang bisa diuji.`);
        for (const setting of terisi) {
          const hasil = await probeSetting(
            setting.key,
            process.env[setting.key] as string,
          );
          const mark = hasil.status === "gagal" ? SILANG : CENTANG;
          if (hasil.status === "gagal") bermasalah += 1;
          console.log(`${mark}${pad(setting.key, 32)} ${hasil.detail}`);
        }
      } else {
        console.log(
          "\n  Tambahkan --uji untuk menghubungi tiap layanan dan memastikan kuncinya diterima.",
        );
      }

      const belum = statuses.filter((status) => !status.active);
      if (belum.length > 0) {
        console.log(
          `\n  ${belum.length} kemampuan belum menyala. Jalankan \`dalang setup\` untuk dipandu mengisinya.`,
        );
      }
      if (bermasalah > 0) {
        process.exitCode = 1;
        console.error(
          `\n  ${bermasalah} setelan terisi tapi ditolak layanannya. Perbaiki dengan \`dalang setup\`.`,
        );
      }
    });
};
