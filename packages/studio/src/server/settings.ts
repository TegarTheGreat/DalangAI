import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CAPABILITIES,
  capabilityStatuses,
  findWhisperCpp,
  isFilled,
  isProbeable,
  maskSecret,
  parseEnv,
  probeSetting,
  type Setting,
  settingOf,
  upsertEnv,
} from "@dalang/providers";
import { findBrowserExecutable } from "@dalang/renderer";
import type { Hono } from "hono";
import { z } from "zod";
import type { CapabilityLite, SettingLite, SettingsPayload } from "../shared/api-types";

/**
 * Panel Pengaturan (ADR-0032): permukaan keempat katalog konfigurasi, untuk
 * orang yang tidak memakai terminal.
 *
 * `dalang setup` sudah memandu penyiapan lewat baris perintah, tetapi orang
 * yang membuka Studio dari ikon di desktop tidak pernah melihatnya. Rute di
 * sini memberi mereka hal yang sama: apa yang menyala, apa yang kurang, cara
 * mendapatkannya, dan tombol untuk menguji kunci, tanpa mengetik perintah.
 *
 * Tiga aturan yang tidak boleh dilanggar berkas ini:
 *
 *  1. Isi rahasia TIDAK PERNAH sampai ke peramban. Yang dikirim untuk setelan
 *     berjenis rahasia hanya samarannya. Nilai yang BUKAN rahasia (path, URL,
 *     angka) dikirim apa adanya, karena justru itu yang perlu dilihat mata
 *     saat sesuatu salah.
 *  2. HANYA kunci katalog yang boleh ditulis. Tanpa ini, satu permintaan bisa
 *     menitipkan `NODE_OPTIONS` atau `PATH` ke `.env`, yaitu menjalankan kode
 *     di mesin orang lewat kotak teks di halaman web.
 *  3. Nilai tidak boleh memuat baris baru. Satu baris baru cukup untuk
 *     menyelundupkan variabel kedua yang tidak pernah dilihat siapa pun.
 */

/**
 * Kunci yang perubahannya BARU berlaku setelah Studio dijalankan ulang.
 *
 * Sisanya berlaku seketika karena rantai penyedia dibangun tiap kali dipakai:
 * `buildStockChain()` dan kawan-kawan membaca `process.env` saat dipanggil,
 * bukan saat start. Yang ada di daftar ini tidak begitu: model orkestrator
 * dipilih sekali di CLI sebelum server berdiri, dan berkas memori dibuka
 * sekali di konstruktor host.
 */
const NEEDS_RESTART: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "DALANG_OPENAI_COMPAT_BASE_URL",
  "DALANG_OPENAI_COMPAT_API_KEY",
  "DALANG_MODEL",
  "DALANG_MODEL_VOLUME",
  "DALANG_HOME",
];

/** Baris baru, tab, NUL: apa pun yang bisa memecah satu baris `.env`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: justru itu yang ditolak
const CONTROL = /[\u0000-\u001f\u007f]/;

const valueSchema = z
  .string()
  .max(4096, "Nilai terlalu panjang")
  .refine((value) => !CONTROL.test(value), {
    message: "Nilai tidak boleh memuat baris baru atau karakter kendali",
  });

const saveBody = z.object({ updates: z.record(z.string(), valueSchema) });
const testBody = z.object({ key: z.string().min(1), value: valueSchema.optional() });

export interface SettingsRoutesOptions {
  /** Berkas `.env` yang dibaca dan disunting panel. */
  envPath: string;
  /** Pengganti fetch saat menguji kunci; tes memakainya agar tidak keluar jaringan. */
  fetchImpl?: typeof fetch;
  /** Pengganti pemeriksa berkas untuk setelan berjenis path. */
  exists?: (path: string) => boolean;
}

const liveEnv = (): Record<string, string | undefined> =>
  process.env as Record<string, string | undefined>;

/**
 * Dari mana nilai yang dipakai server ini sebenarnya datang.
 *
 * Bukan detail sepele: `process.loadEnvFile` TIDAK menimpa variabel yang sudah
 * ada di lingkungan terminal. Kalau seseorang meng-export kunci di shell-nya,
 * menyimpan nilai lain lewat panel ini akan berlaku sekarang lalu seolah-olah
 * hilang begitu Studio dijalankan ulang. Panel harus bisa mengatakan itu,
 * jadi asal nilainya ikut dikirim.
 */
const sourceOf = (
  key: string,
  fromFile: Record<string, string>,
): SettingLite["source"] => {
  const live = process.env[key];
  if (!isFilled(live)) return null;
  return fromFile[key] === live ? "berkas" : "lingkungan";
};

/** Nilai yang aman ditampilkan: rahasia disamarkan, sisanya apa adanya. */
const shownValue = (setting: Setting): string => {
  const value = process.env[setting.key];
  if (!isFilled(value)) return "";
  return setting.kind === "rahasia" ? maskSecret(value as string) : (value as string);
};

const settingLite = (
  setting: Setting,
  fromFile: Record<string, string>,
): SettingLite => ({
  key: setting.key,
  label: setting.label,
  kind: setting.kind,
  required: setting.required,
  effect: setting.effect,
  howTo: [...(setting.howTo ?? [])],
  ...(setting.example ? { example: setting.example } : {}),
  ...(setting.fallback ? { fallback: setting.fallback } : {}),
  filled: isFilled(process.env[setting.key]),
  shown: shownValue(setting),
  source: sourceOf(setting.key, fromFile),
  testable: isProbeable(setting.key),
  needsRestart: NEEDS_RESTART.includes(setting.key),
});

export const settingsPayload = (envPath: string): SettingsPayload => {
  const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const fromFile = parseEnv(envText);
  const whisper = findWhisperCpp(process.env) !== null;
  const statuses = capabilityStatuses(liveEnv(), { transkrip: whisper });
  const byId = new Map(statuses.map((status) => [status.id, status]));

  const capabilities: CapabilityLite[] = CAPABILITIES.map((capability) => {
    const status = byId.get(capability.id);
    return {
      id: capability.id,
      title: capability.title,
      plain: capability.plain,
      withoutIt: capability.withoutIt,
      rule: capability.rule,
      active: status?.active ?? false,
      readyWithoutConfig: capability.readyWithoutConfig,
      activeByDetection: status?.activeByDetection ?? false,
      ...(capability.alsoActiveWhen ? { alsoActiveWhen: capability.alsoActiveWhen } : {}),
      missing: status?.missing ?? [],
      settings: capability.settings.map((setting) => settingLite(setting, fromFile)),
    };
  });

  return {
    envPath,
    envExists: existsSync(envPath),
    machine: {
      node: process.version,
      browser: findBrowserExecutable() !== undefined,
      whisper,
    },
    capabilities,
  };
};

export const registerSettingsRoutes = (
  app: Hono,
  options: SettingsRoutesOptions,
): void => {
  const probeOptions = {
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.exists ? { exists: options.exists } : {}),
  };

  app.get("/api/workspace/settings", (c) =>
    c.json({ ok: true, settings: settingsPayload(options.envPath) }),
  );

  app.post("/api/workspace/settings", async (c) => {
    const body = saveBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const first = body.error.issues[0]?.message ?? "butuh updates berisi kunci-nilai";
      return c.json({ error: `Body tidak valid: ${first}` }, 400);
    }
    const updates = body.data.updates;
    // Kunci di luar katalog menolak SELURUH permintaan, bukan dilewati
    // diam-diam: menulis sebagian dari yang diminta lebih membingungkan
    // daripada menolak sambil menyebut kuncinya.
    const asing = Object.keys(updates).filter((key) => settingOf(key) === undefined);
    if (asing.length > 0) {
      return c.json(
        {
          error: `Bukan setelan Dalang: ${asing.join(", ")}. Panel ini hanya boleh menulis setelan yang ada di katalog.`,
        },
        400,
      );
    }
    if (Object.keys(updates).length === 0) {
      return c.json({ error: "Tidak ada yang diubah" }, 400);
    }

    const before = existsSync(options.envPath)
      ? readFileSync(options.envPath, "utf8")
      : "";
    const hasil = upsertEnv(before, updates, {
      heading: `Ditambahkan lewat panel Pengaturan pada ${new Date().toISOString().slice(0, 10)}`,
    });
    try {
      writeFileSync(options.envPath, hasil.text);
    } catch (error) {
      const sebab = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Gagal menulis ${options.envPath}: ${sebab}` }, 500);
    }

    // Berlaku SEKARANG untuk yang dibaca saat dipakai: rantai penyedia
    // dibangun ulang tiap panggilan, jadi kunci stok yang baru disimpan
    // langsung terpakai pada pencarian berikutnya, tanpa menjalankan ulang.
    for (const [key, raw] of Object.entries(updates)) {
      const value = raw.trim();
      if (value === "") delete process.env[key];
      else process.env[key] = value;
    }

    const disentuh = [...hasil.replaced, ...hasil.added, ...hasil.removed];
    return c.json({
      ok: true,
      replaced: hasil.replaced,
      added: hasil.added,
      removed: hasil.removed,
      needsRestart: disentuh.filter((key) => NEEDS_RESTART.includes(key)),
      settings: settingsPayload(options.envPath),
    });
  });

  app.post("/api/workspace/settings/test", async (c) => {
    const body = testBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const first = body.error.issues[0]?.message ?? "butuh key";
      return c.json({ error: `Body tidak valid: ${first}` }, 400);
    }
    const setting = settingOf(body.data.key);
    if (!setting) return c.json({ error: `Bukan setelan Dalang: ${body.data.key}` }, 400);
    // Tanpa nilai = uji yang sedang terpasang. Nilai yang dikirim TIDAK pernah
    // ikut dikembalikan, supaya jawaban rute ini tidak jadi cara membaca ulang
    // kunci lewat riwayat jaringan peramban.
    const value = body.data.value ?? process.env[setting.key] ?? "";
    if (!isFilled(value)) {
      return c.json({
        ok: true,
        key: setting.key,
        status: "tak-diuji" as const,
        detail: "Belum ada nilainya.",
      });
    }
    const hasil = await probeSetting(setting.key, value, probeOptions);
    return c.json({
      ok: true,
      key: setting.key,
      status: hasil.status,
      detail: hasil.detail,
    });
  });
};
