import {
  type EnvLike,
  formatModelRows,
  formatProviderRows,
  listProviders,
  loadModelRegistry,
  type ModelRegistry,
  type ModelSort,
  pickDefaultModels,
  type RegistrySource,
  searchModels,
} from "@dalang/agent";
import { type Command, InvalidArgumentError } from "commander";

/**
 * `dalang models` — melihat apa yang bisa dipakai Dalang (ADR-0044).
 *
 * Registry models.dev memuat ratusan provider dan ribuan model; yang ingin
 * diketahui pengguna hanya tiga hal: model apa yang ada, berapa harganya, dan
 * yang mana bisa dipakai SEKARANG dengan environment-nya. Perintah ini menjawab
 * itu tanpa memanggil model mana pun — membaca registry saja, jadi gratis.
 *
 * `--offline`, `--segarkan`, dan `--json` ada di perintah induk dan dikenali di
 * posisi mana pun (sebelum maupun sesudah subperintah).
 */

const SORTS: readonly ModelSort[] = ["biaya", "konteks", "nama"];

const parseSort = (value: string): ModelSort => {
  if (!SORTS.includes(value as ModelSort)) {
    throw new InvalidArgumentError(`urutan harus salah satu: ${SORTS.join(", ")}`);
  }
  return value as ModelSort;
};

const parseLimit = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`"${value}" bukan bilangan bulat ≥ 1`);
  }
  return parsed;
};

const sourceLabel = (registry: ModelRegistry): string => {
  const labels: Record<RegistrySource, string> = {
    network: "diambil dari jaringan barusan",
    cache: "cache lokal (kurang dari 24 jam)",
    "stale-cache": "cache LAMA — jaringan tidak terjangkau",
    snapshot: `snapshot bawaan ${registry.snapshotDate} (hanya Anthropic) — jaringan tidak terjangkau dan cache kosong`,
  };
  return labels[registry.source];
};

interface CommonOptions {
  offline?: boolean;
  segarkan?: boolean;
  json?: boolean;
}

const load = (options: CommonOptions): Promise<ModelRegistry> =>
  loadModelRegistry({
    offline: options.offline === true,
    // TTL 0: cache dianggap basi, jadi jaringan dicoba dulu (cache tetap jadi cadangan).
    ...(options.segarkan ? { ttlMs: 0 } : {}),
  });

const env = (): EnvLike => process.env;

export const registerModelsCommand = (program: Command): void => {
  const models = program
    .command("models")
    .option("--offline", "jangan sentuh jaringan; pakai cache atau snapshot")
    .option("--segarkan", "paksa ambil ulang dari models.dev (abaikan cache 24 jam)")
    .option("--json", "keluaran JSON untuk skrip")
    .description(
      "Registry models.dev: model, harga, kapabilitas, dan provider yang bisa dipakai Dalang",
    )
    .action(async (options: CommonOptions) => {
      const registry = await load(options);
      const providers = listProviders(registry, env());
      const withKey = providers.filter((p) => p.state === "siap" && p.keyPresent);
      const partial = providers.filter((p) => p.state === "butuh-env" && p.keyPresent);
      const local = providers.filter(
        (p) => p.state === "siap" && !p.keyPresent && p.support.keyOptional,
      );
      const unsupported = providers.filter((p) => p.state === "tidak-didukung");
      const choice = pickDefaultModels(process.env, registry);

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              source: registry.source,
              providers: registry.providers.length,
              models: registry.models.length,
              toolCallModels: registry.models.filter((m) => m.toolCall).length,
              withKey: withKey.map((p) => p.provider.id),
              incomplete: partial.map((p) => ({
                provider: p.provider.id,
                missingEnv: p.missingEnv,
              })),
              local: local.map((p) => p.provider.id),
              unsupported: unsupported.map((p) => p.provider.id),
              defaultModel: choice,
            },
            null,
            2,
          ),
        );
        return;
      }

      const toolCalling = registry.models.filter((m) => m.toolCall).length;
      console.log(
        `Registry models.dev — ${sourceLabel(registry)}\n` +
          `  ${registry.providers.length} provider, ${registry.models.length} model ` +
          `(${toolCalling} bisa tool-calling, syarat orkestrator)\n`,
      );
      // Token generik (GITHUB_TOKEN, HF_TOKEN) dipasang orang untuk keperluan lain:
      // dipakai bila provider dipilih eksplisit, tetapi tak pernah menentukan default.
      const label = (p: (typeof withKey)[number]) =>
        p.support.autoDetectEnvs.length === 0
          ? `${p.provider.id} [hanya bila dipilih eksplisit]`
          : p.provider.id;
      console.log(
        `Kunci terpasang di environment ini (${withKey.length}): ` +
          (withKey.length > 0
            ? withKey.map(label).join(", ")
            : "belum ada — set salah satu *_API_KEY provider, mis. OPENROUTER_API_KEY"),
      );
      if (partial.length > 0) {
        console.log(
          `Kunci ada tetapi konfigurasinya belum lengkap: ${partial
            .map((p) => `${p.provider.id} (kurang ${p.missingEnv.join(", ")})`)
            .join("; ")}`,
        );
      }
      console.log(
        `Server lokal tanpa key (${local.length}; pastikan servernya berjalan): ${local
          .map((p) => p.provider.id)
          .join(", ")}`,
      );
      console.log(
        `Tidak bisa dipanggil lewat Dalang (${unsupported.length}; butuh SDK khusus): ${unsupported
          .map((p) => p.provider.id)
          .join(", ")}\n`,
      );
      console.log(
        choice.orchestrator
          ? `Model default saat ini: ${choice.orchestrator}` +
              `${choice.volume ? ` (volume: ${choice.volume})` : ""}\n  ${choice.reason}`
          : `Model default: belum bisa dipilih\n  ${choice.reason}`,
      );
      console.log(
        "\nPerintah lanjutan:\n" +
          "  dalang models cari <kata> [--provider id] [--alat] [--vision] [--siap] [--urut biaya|konteks|nama]\n" +
          "  dalang models provider [kata] [--siap]\n" +
          "Memilih model: DALANG_MODEL=provider/model-id  (volume/vision: DALANG_MODEL_VOLUME)",
      );
    });

  models
    .command("cari")
    .argument("[kata...]", "kata kunci pada id/nama model (semua harus cocok)")
    .option("--provider <id>", "hanya satu provider (id registry, mis. openrouter)")
    .option("--alat", "hanya model yang mendukung tool-calling (syarat orkestrator)")
    .option("--vision", "hanya model dengan input gambar (syarat tier-volume/vision)")
    .option("--siap", "hanya provider yang konfigurasinya lengkap di environment ini")
    .option("--urut <urutan>", "biaya | konteks | nama", parseSort, "nama")
    .option("-n, --batas <n>", "jumlah baris yang ditampilkan", parseLimit, 25)
    .description(
      "Cari model: harga per 1 juta token, konteks, tool-calling, input gambar",
    )
    .action(
      async (
        kata: string[],
        options: {
          provider?: string;
          alat?: boolean;
          vision?: boolean;
          siap?: boolean;
          urut: ModelSort;
          batas: number;
        },
        command: Command,
      ) => {
        const common = command.optsWithGlobals<CommonOptions>();
        const registry = await load(common);
        const query = {
          text: kata.join(" "),
          ...(options.provider ? { provider: options.provider } : {}),
          ...(options.alat ? { toolCall: true } : {}),
          ...(options.vision ? { vision: true } : {}),
          ...(options.siap ? { ready: true } : {}),
          sort: options.urut,
          limit: options.batas,
        };
        const { rows, total } = searchModels(registry, env(), query);

        if (common.json) {
          console.log(
            JSON.stringify(
              {
                source: registry.source,
                total,
                models: rows.map(({ model, state }) => ({
                  ...model,
                  providerState: state,
                })),
              },
              null,
              2,
            ),
          );
          return;
        }
        if (rows.length === 0) {
          console.log(
            `Tidak ada model yang cocok (registry: ${registry.source}). ` +
              "Longgarkan kata kunci, atau lihat provider: dalang models provider",
          );
          return;
        }
        console.log(formatModelRows(rows).join("\n"));
        console.log(
          `\n${rows.length} dari ${total} model · harga USD per 1 juta token · registry: ${registry.source}` +
            (total > rows.length ? ` · tambah --batas ${total} untuk semuanya` : ""),
        );
        console.log(
          "Pakai: DALANG_MODEL=<provider>/<id>  (kolom MODEL sudah berbentuk itu)" +
            (rows.some((r) => r.state !== "siap")
              ? "\nStatus 'siap' = konfigurasi lengkap di environment ini; lihat syarat tiap provider: dalang models provider"
              : ""),
        );
      },
    );

  models
    .command("provider")
    .argument("[kata...]", "kata kunci pada id/nama provider")
    .option("--siap", "hanya provider yang konfigurasinya lengkap di environment ini")
    .description("Daftar provider: status, jalur pemanggilan, dan env yang dibutuhkan")
    .action(async (kata: string[], options: { siap?: boolean }, command: Command) => {
      const common = command.optsWithGlobals<CommonOptions>();
      const registry = await load(common);
      const rows = listProviders(registry, env(), {
        text: kata.join(" "),
        ...(options.siap ? { ready: true } : {}),
      });
      if (common.json) {
        console.log(
          JSON.stringify(
            rows.map((row) => ({
              id: row.provider.id,
              name: row.provider.name,
              state: row.state,
              via: row.support.via ?? null,
              models: row.provider.modelCount,
              keyEnv: row.support.keyEnv ?? null,
              missingEnv: row.missingEnv,
              reason: row.support.reason ?? null,
              doc: row.provider.doc ?? null,
            })),
            null,
            2,
          ),
        );
        return;
      }
      if (rows.length === 0) {
        console.log("Tidak ada provider yang cocok.");
        return;
      }
      console.log(formatProviderRows(rows).join("\n"));
      console.log(
        `\n${rows.length} provider · registry: ${registry.source}\n` +
          "siap = konfigurasi lengkap (tidak memeriksa apakah akun/servernya benar-benar aktif) · " +
          "jalur: bawaan (SDK terpasang) / registry (dari metadata models.dev) / kurasi (endpoint OpenAI-compatible) / lokal",
      );
    });
};
