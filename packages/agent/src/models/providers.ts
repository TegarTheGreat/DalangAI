import type { ModelRegistry, ProviderInfo } from "./registry";
import { normalizeOllamaHost, SYNTHETIC_PROVIDERS } from "./synthetic-providers";

/**
 * Dari metadata registry ke CARA MEMANGGIL provider (ADR-0044).
 *
 * models.dev menyimpan, per provider, paket SDK yang dipakainya, base URL API,
 * dan nama env var kredensialnya. Dari tiga fakta itu saja, 185 dari 226
 * provider (per 2026-10-03) adalah endpoint OpenAI-compatible yang bisa
 * dipanggil dengan `createOpenAICompatible` — tanpa satu pun dikodekan tangan.
 * Modul ini adalah penerjemahnya, dan SENGAJA tidak mengimpor satu pun SDK:
 * ia hanya memutuskan, resolve.ts yang membangun modelnya.
 *
 * Dua tahap, supaya daftar provider bisa ditampilkan tanpa menyentuh env:
 *  - `describeProvider`  — STATIS: bisakah provider ini dipanggil, lewat jalur
 *    apa, dan env var apa yang dibutuhkannya.
 *  - `routeProvider`     — menerapkan env: rute siap, atau env apa yang kurang.
 */

export type EnvLike = Readonly<Record<string, string | undefined>>;

/** Pustaka klien yang membangun modelnya. */
export type ProviderSdk = "anthropic" | "openai" | "google" | "openai-compatible";

/**
 * Dari mana pengetahuan cara-memanggilnya berasal:
 *  bawaan   — SDK yang kita bundel (anthropic, openai, google)
 *  registry — dibaca dari metadata models.dev
 *  kurasi   — tabel kecil di bawah, untuk provider ber-SDK-sendiri
 *  lokal    — berjalan di mesin pengguna (ollama)
 */
export type ProviderVia = "bawaan" | "registry" | "kurasi" | "lokal";

export interface ProviderSupport {
  providerId: string;
  executable: boolean;
  /** Bila tidak bisa dieksekusi: alasan yang bisa dibaca manusia. */
  reason?: string;
  sdk?: ProviderSdk;
  via?: ProviderVia;
  /** Base URL (boleh memuat ${VAR}); kosong = bawaan SDK. */
  baseUrl?: string;
  /** Variabel ${VAR} di baseUrl — dibaca dari env saat rute dibuat. */
  templateVars: string[];
  /** Env var yang menyimpan API key. */
  keyEnv?: string;
  /** Nama env lain yang diterima sebagai key yang sama (urutan prioritas). */
  keyEnvFallbacks: string[];
  /** Endpoint lokal tidak mewajibkan key. */
  keyOptional: boolean;
  /** Env var yang menimpa seluruh base URL bila diisi. */
  endpointEnv?: string;
  /**
   * Env var yang, bila terpasang, dihitung sebagai "kredensial provider ini"
   * untuk memilih model default (lihat defaults.ts). Sengaja sempit.
   */
  autoDetectEnvs: string[];
}

export interface ReadyRoute {
  ok: true;
  providerId: string;
  sdk: ProviderSdk;
  via: ProviderVia;
  /** Kosong = pakai bawaan SDK. */
  baseURL?: string;
  apiKey?: string;
}

export interface BlockedRoute {
  ok: false;
  providerId: string;
  /** Kalimat siap-tampil: apa yang kurang atau mengapa ditolak. */
  reason: string;
  /** Env var yang harus diisi, bila itu penyebabnya. */
  missingEnv: string[];
}

export type ProviderRoute = ReadyRoute | BlockedRoute;

// ---------------------------------------------------------------------------
// Pengetahuan yang dikodekan — sengaja kecil
// ---------------------------------------------------------------------------

interface BuiltinSpec {
  sdk: ProviderSdk;
  keyEnv: string;
  fallbacks: string[];
  detect: string[];
}

const BUILTIN: Readonly<Record<string, BuiltinSpec>> = {
  anthropic: {
    sdk: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    fallbacks: [],
    detect: ["ANTHROPIC_API_KEY"],
  },
  openai: {
    sdk: "openai",
    keyEnv: "OPENAI_API_KEY",
    fallbacks: [],
    detect: ["OPENAI_API_KEY"],
  },
  // Registry mendaftar tiga nama untuk Google; Gemini CLI memakai
  // GEMINI_API_KEY. GOOGLE_API_KEY diterima saat pengguna memilih google/…
  // eksplisit, tetapi TIDAK dipakai untuk menebak provider: nama itu dipakai
  // juga oleh layanan Google lain (Maps, dsb.).
  google: {
    sdk: "google",
    keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    fallbacks: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    detect: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  },
};

/** Env var milik provider bawaan — tak boleh dipinjam provider registry mana pun. */
const PROTECTED_ENV = new Set(
  Object.values(BUILTIN).flatMap((spec) => [spec.keyEnv, ...spec.fallbacks]),
);

/**
 * Provider yang di registry memakai SDK-nya sendiri (jadi tanpa `api`), tetapi
 * juga menyediakan endpoint OpenAI-compatible publik. Dengan tabel ini mereka
 * bisa dipanggil tanpa menambah satu dependensi pun.
 *
 * Sumber: dokumentasi tiap provider. Diperiksa 2026-10-03 dengan permintaan
 * tanpa key (HTTP 401/403 = endpoint ada dan menuntut kredensial; 200 untuk
 * daftar model yang publik). Ini BUKAN uji panggilan sungguhan — itu butuh key.
 */
export const CURATED_OPENAI_COMPATIBLE: Readonly<Record<string, string>> = {
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  togetherai: "https://api.together.xyz/v1",
  cerebras: "https://api.cerebras.ai/v1",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  perplexity: "https://api.perplexity.ai",
  cohere: "https://api.cohere.ai/compatibility/v1",
  venice: "https://api.venice.ai/api/v1",
};

// Penggolongan nama env var. Akhiran, bukan daftar nama: registry menambah
// provider tiap minggu dan konvensinya (…_API_KEY, …_TOKEN) stabil.
const KEY_ENV = /(?:_KEY|_APIKEY|_TOKEN|_PAT)$/;
const ENDPOINT_ENV = /(?:_ENDPOINT|_BASE_URL|_URL|_HOST)$/;
/** Hanya *_API_KEY yang dipakai menebak provider — GITHUB_TOKEN, HF_TOKEN dkk. dipasang untuk keperluan lain. */
const DETECT_ENV = /_API_KEY$/;
const TEMPLATE_VAR = /\$\{([A-Za-z0-9_]+)\}/g;
const LOOPBACK = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;

const blocked = (
  providerId: string,
  reason: string,
  missingEnv: string[] = [],
): BlockedRoute => ({
  ok: false,
  providerId,
  reason,
  missingEnv,
});

// ---------------------------------------------------------------------------
// Tahap 1 — statis
// ---------------------------------------------------------------------------

const unsupported = (provider: ProviderInfo, reason: string): ProviderSupport => ({
  providerId: provider.id,
  executable: false,
  reason,
  templateVars: [],
  keyEnvFallbacks: [],
  keyOptional: false,
  autoDetectEnvs: [],
});

export const describeProvider = (provider: ProviderInfo): ProviderSupport => {
  const builtin = BUILTIN[provider.id];
  if (builtin) {
    return {
      providerId: provider.id,
      executable: true,
      sdk: builtin.sdk,
      via: "bawaan",
      templateVars: [],
      keyEnv: builtin.keyEnv,
      keyEnvFallbacks: builtin.fallbacks,
      keyOptional: false,
      autoDetectEnvs: builtin.detect,
    };
  }

  // Ollama lokal: tanpa key, dan HANYA dipilih eksplisit (OLLAMA_HOST sering
  // terpasang di sisi server; itu bukan niat memakainya untuk Dalang).
  if (SYNTHETIC_PROVIDERS[provider.id] === provider && provider.id === "ollama") {
    return {
      providerId: provider.id,
      executable: true,
      sdk: "openai-compatible",
      via: "lokal",
      ...(provider.api ? { baseUrl: provider.api } : {}),
      templateVars: [],
      keyEnvFallbacks: [],
      keyOptional: true,
      endpointEnv: "OLLAMA_HOST",
      autoDetectEnvs: [],
    };
  }

  const { npm, api } = provider;
  let sdk: ProviderSdk | undefined;
  let via: ProviderVia = "registry";
  let baseUrl = api;

  if (npm === "@ai-sdk/openai-compatible" || npm === "@openrouter/ai-sdk-provider") {
    sdk = "openai-compatible";
  } else if (npm === "@ai-sdk/openai" && api) {
    sdk = "openai";
  } else if (npm === "@ai-sdk/anthropic" && api) {
    sdk = "anthropic";
  } else if (!api && CURATED_OPENAI_COMPATIBLE[provider.id]) {
    sdk = "openai-compatible";
    via = "kurasi";
    baseUrl = CURATED_OPENAI_COMPATIBLE[provider.id];
  }

  if (!sdk) {
    return unsupported(
      provider,
      `memakai paket SDK ${npm ? `"${npm}"` : "yang tak dikenal"} yang tidak dibundel Dalang. ` +
        "Jalur lain: endpoint OpenAI-compatible miliknya lewat DALANG_OPENAI_COMPAT_BASE_URL, " +
        "atau pilih provider lain (dalang models provider)",
    );
  }
  if (!baseUrl) {
    return unsupported(provider, "registry tidak memuat base URL API-nya");
  }

  const templateVars = [...baseUrl.matchAll(TEMPLATE_VAR)].map(
    (match) => match[1] as string,
  );
  const rest = provider.env.filter((name) => !templateVars.includes(name));
  const keys = rest.filter((name) => KEY_ENV.test(name));
  const endpoints = rest.filter((name) => ENDPOINT_ENV.test(name) && !KEY_ENV.test(name));
  const unknown = rest.filter(
    (name) => !keys.includes(name) && !endpoints.includes(name),
  );

  if (unknown.length > 0 || keys.length > 1 || endpoints.length > 1) {
    return unsupported(
      provider,
      `butuh konfigurasi yang belum dipahami Dalang (${provider.env.join(", ")})`,
    );
  }

  const keyEnv = keys[0];
  if (keyEnv && PROTECTED_ENV.has(keyEnv)) {
    return unsupported(
      provider,
      `registry mengarahkan ${keyEnv} — kunci milik provider lain — ke ${baseUrl}; ditolak demi keamanan`,
    );
  }
  if (keyEnv && /^http:\/\//i.test(baseUrl) && !LOOPBACK.test(baseUrl)) {
    return unsupported(
      provider,
      `endpoint ${baseUrl} tanpa TLS di luar mesin ini, padahal butuh ${keyEnv}; ditolak`,
    );
  }

  return {
    providerId: provider.id,
    executable: true,
    sdk,
    via,
    baseUrl,
    templateVars,
    ...(keyEnv ? { keyEnv } : {}),
    keyEnvFallbacks: [],
    keyOptional: !keyEnv || LOOPBACK.test(baseUrl),
    ...(endpoints[0] ? { endpointEnv: endpoints[0] } : {}),
    // Server lokal (LM Studio dkk.) tak ikut ditebak: daftar modelnya di registry
    // hanyalah katalog, yang termuat di server pengguna bisa lain sama sekali.
    autoDetectEnvs:
      keyEnv && DETECT_ENV.test(keyEnv) && !LOOPBACK.test(baseUrl) ? [keyEnv] : [],
  };
};

// ---------------------------------------------------------------------------
// Tahap 2 — menerapkan env
// ---------------------------------------------------------------------------

const present = (env: EnvLike, name: string | undefined): string | undefined => {
  if (!name) return undefined;
  const value = env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
};

/** Nilai untuk ${VAR} yang diletakkan tepat setelah "://" adalah nama host: buang skema dan garis miring. */
const templateValue = (template: string, name: string, value: string): string => {
  const afterScheme = template.includes(`://\${${name}}`);
  return afterScheme ? value.replace(/^https?:\/\//i, "").replace(/\/+$/, "") : value;
};

export const routeProvider = (provider: ProviderInfo, env: EnvLike): ProviderRoute => {
  const support = describeProvider(provider);
  if (!support.executable || !support.sdk || !support.via) {
    return blocked(
      provider.id,
      `Provider "${provider.id}" ${support.reason ?? "tidak bisa dipanggil"}`,
    );
  }

  const missing: string[] = [];
  let baseURL = support.baseUrl;

  const override = present(env, support.endpointEnv);
  if (override) {
    baseURL = provider.id === "ollama" ? normalizeOllamaHost(override) : override;
  }

  if (baseURL?.includes("${")) {
    const template = baseURL;
    baseURL = template.replace(TEMPLATE_VAR, (_, name: string) => {
      const value = present(env, name);
      if (!value) {
        if (!missing.includes(name)) missing.push(name);
        return "";
      }
      return templateValue(template, name, value);
    });
  }

  const keyNames = support.keyEnv ? [support.keyEnv, ...support.keyEnvFallbacks] : [];
  const apiKey = keyNames.map((name) => present(env, name)).find(Boolean);
  if (!apiKey && support.keyEnv && !support.keyOptional) missing.push(support.keyEnv);

  if (missing.length > 0) {
    return blocked(
      provider.id,
      `Provider model "${provider.id}" membutuhkan env ${missing.join(", ")} (belum diset)`,
      missing,
    );
  }

  if (baseURL !== undefined) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(baseURL);
    } catch {
      parsed = undefined;
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      return blocked(
        provider.id,
        `Base URL provider "${provider.id}" tidak sah: ${baseURL}`,
      );
    }
    // Server tanpa key (Ollama di mesin lain di LAN) boleh http; yang ditolak
    // hanyalah mengirim KUNCI lewat kabel tanpa enkripsi.
    if (apiKey && parsed.protocol === "http:" && !LOOPBACK.test(baseURL)) {
      return blocked(
        provider.id,
        `Base URL ${baseURL} memakai http di luar mesin ini — kunci API akan terkirim tanpa enkripsi; ditolak`,
      );
    }
  }

  return {
    ok: true,
    providerId: provider.id,
    sdk: support.sdk,
    via: support.via,
    ...(baseURL !== undefined ? { baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
};

/** Host tujuan permintaan — untuk ditampilkan ke pengguna, TANPA key. */
export const routeHost = (route: ReadyRoute): string | undefined => {
  if (!route.baseURL) return undefined;
  try {
    return new URL(route.baseURL).host;
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Status & deteksi
// ---------------------------------------------------------------------------

export type ProviderState = "siap" | "butuh-env" | "tidak-didukung";

export interface ProviderStatus {
  provider: ProviderInfo;
  support: ProviderSupport;
  state: ProviderState;
  missingEnv: string[];
  /** Key terpasang di env (provider lokal tanpa key: selalu false). */
  keyPresent: boolean;
}

export const providerStatus = (provider: ProviderInfo, env: EnvLike): ProviderStatus => {
  const support = describeProvider(provider);
  if (!support.executable) {
    return {
      provider,
      support,
      state: "tidak-didukung",
      missingEnv: [],
      keyPresent: false,
    };
  }
  const route = routeProvider(provider, env);
  const keyNames = support.keyEnv ? [support.keyEnv, ...support.keyEnvFallbacks] : [];
  const keyPresent = keyNames.some((name) => present(env, name) !== undefined);
  return route.ok
    ? { provider, support, state: "siap", missingEnv: [], keyPresent }
    : { provider, support, state: "butuh-env", missingEnv: route.missingEnv, keyPresent };
};

/** Provider registry + yang selalu dikenal (bawaan, ollama) bila registry tak memuatnya. */
export const allProviders = (registry: ModelRegistry | undefined): ProviderInfo[] => {
  const fromRegistry = registry?.providers ?? [];
  const known = new Set(fromRegistry.map((provider) => provider.id));
  return [
    ...fromRegistry,
    ...Object.values(SYNTHETIC_PROVIDERS).filter((provider) => !known.has(provider.id)),
  ];
};

export interface DetectedProvider {
  provider: string;
  envVar: string;
}

export interface AmbiguousCredential {
  envVar: string;
  providers: string[];
}

export interface IncompleteCredential {
  provider: string;
  envVar: string;
  missingEnv: string[];
}

export interface CredentialScan {
  detected: DetectedProvider[];
  /** Satu env var, banyak provider (varian regional/paket) — tak bisa dipilihkan. */
  ambiguous: AmbiguousCredential[];
  /** Key ada, tetapi konfigurasi pendampingnya belum (mis. Cloudflare tanpa ACCOUNT_ID). */
  incomplete: IncompleteCredential[];
}

/**
 * Provider mana yang kunci *_API_KEY-nya terpasang. Tidak ada urutan
 * kesukaan di sini: hasilnya daftar fakta, dan keputusan menolak-atau-memilih
 * ada di defaults.ts.
 */
export const scanCredentials = (
  env: EnvLike,
  providers: readonly ProviderInfo[],
): CredentialScan => {
  const supports = providers
    .map((provider) => ({ provider, support: describeProvider(provider) }))
    .filter(({ support }) => support.executable && support.autoDetectEnvs.length > 0);

  const owners = new Map<string, typeof supports>();
  for (const entry of supports) {
    for (const envVar of entry.support.autoDetectEnvs) {
      if (present(env, envVar) === undefined) continue;
      owners.set(envVar, [...(owners.get(envVar) ?? []), entry]);
    }
  }

  const scan: CredentialScan = { detected: [], ambiguous: [], incomplete: [] };
  const seen = new Set<string>();
  for (const [envVar, group] of owners) {
    // Pemilik bawaan menang: registry tak boleh merebut env var anthropic/openai/google.
    const builtinOwner = group.filter(({ support }) => support.via === "bawaan");
    const effective = builtinOwner.length > 0 ? builtinOwner : group;
    if (effective.length > 1) {
      scan.ambiguous.push({
        envVar,
        providers: effective.map(({ provider }) => provider.id),
      });
      continue;
    }
    const only = effective[0];
    if (!only || seen.has(only.provider.id)) continue;
    const route = routeProvider(only.provider, env);
    if (route.ok) {
      seen.add(only.provider.id);
      scan.detected.push({ provider: only.provider.id, envVar });
    } else {
      scan.incomplete.push({
        provider: only.provider.id,
        envVar,
        missingEnv: route.missingEnv,
      });
    }
  }
  return scan;
};
