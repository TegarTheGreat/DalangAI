import type { ProxyMedia, ResolvedAsset, ScenePlan } from "./scene-plan";

/**
 * Proxy pratinjau & rekaman panjang (ADR-0028, roadmap §9.5).
 *
 * Modul ini MURNI: keputusan "perlu proxy atau tidak" dan penukaran berkas
 * asli dengan proxy-nya adalah tempat yang paling mudah salah diam-diam (satu
 * lumbung aset terlewat, satu kodek terlupa), jadi keduanya hidup di sini
 * sebagai fungsi yang bisa diuji tanpa ffmpeg, tanpa browser, tanpa disk.
 */

/** Sisi pendek proxy, piksel. 540 = tepat setengah 1080p, ukuran render draf. */
export const PROXY_SHORT_SIDE = 540;
/** Laju bingkai tertinggi proxy; komposisi Dalang berjalan 30 fps. */
export const PROXY_MAX_FPS = 30;
/** Rekaman sepanjang ini atau lebih selalu diberi proxy, berapa pun ukurannya. */
export const PROXY_MIN_DURATION_SEC = 60;
/** Sisi pendek di atas ini (yakni 1080p ke atas) diberi proxy. */
export const PROXY_MAX_DIRECT_SHORT_SIDE = 720;
/**
 * Laju bit di atas ini (bit/detik) diberi proxy walau ringan menurut aturan
 * lain: rekaman layar 720p 30 fps pada 50 Mbps memaksa browser mendekode lebih
 * banyak byte per detik daripada 1080p biasa, dan byte per detik itulah yang
 * membuat preview tersendat — bukan jumlah pikselnya.
 */
export const PROXY_MAX_DIRECT_BITRATE = 25_000_000;

/**
 * Kodek yang diputar langsung oleh Chromium tanpa kodek proprietary. HEVC,
 * ProRes, DNxHD, AV1 pada build tertentu, MPEG-4 Part 2 — semuanya bukan.
 * Daftarnya sengaja PENDEK: yang tidak tercantum dianggap perlu proxy, karena
 * kotak hitam di preview jauh lebih mahal daripada satu proxy yang sebenarnya
 * tidak perlu.
 */
export const BROWSER_SAFE_CODECS: ReadonlySet<string> = new Set(["h264", "vp8", "vp9"]);

/** Fakta sumber yang dibutuhkan untuk memutuskan; semuanya dari ffprobe. */
export interface ProxySourceInfo {
  width: number;
  height: number;
  durationSec: number;
  fps?: number | null;
  codec?: string | null;
  /** Laju bit keseluruhan, bit/detik; tidak diisi = tidak diketahui. */
  bitrate?: number | null;
}

export interface ProxyDecision {
  needed: boolean;
  /** Alasan dalam kalimat, dipakai apa adanya di laporan tahap dan panel. */
  reason: string;
}

/** "1 j 2 mnt", "3 mnt 5 dtk", "12 dtk" — untuk kalimat alasan. */
export const clockLabel = (sec: number): string => {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h} j ${m} mnt` : m > 0 ? `${m} mnt ${s} dtk` : `${s} dtk`;
};

/**
 * Perlukah berkas ini proxy? Lima alasan, diperiksa dari yang paling
 * menentukan: kodek yang tidak diputar browser (tanpa proxy previewnya HITAM),
 * rekaman panjang, resolusi di atas 720p, laju bingkai di atas 30, laju bit
 * di atas 25 Mbps.
 */
export const proxyDecision = (info: ProxySourceInfo): ProxyDecision => {
  const codec = info.codec?.toLowerCase() ?? null;
  if (codec && !BROWSER_SAFE_CODECS.has(codec)) {
    return { needed: true, reason: `kodek ${codec} tidak diputar browser` };
  }
  if (info.durationSec >= PROXY_MIN_DURATION_SEC) {
    return { needed: true, reason: `rekaman panjang (${clockLabel(info.durationSec)})` };
  }
  const shortSide = Math.min(info.width, info.height);
  if (shortSide > PROXY_MAX_DIRECT_SHORT_SIDE) {
    return { needed: true, reason: `resolusi ${info.width}×${info.height}` };
  }
  if (info.fps && info.fps > PROXY_MAX_FPS + 0.5) {
    return { needed: true, reason: `${Math.round(info.fps)} fps` };
  }
  if (info.bitrate && info.bitrate > PROXY_MAX_DIRECT_BITRATE) {
    return {
      needed: true,
      reason: `laju bit ${Math.round(info.bitrate / 1_000_000)} Mbps`,
    };
  }
  return {
    needed: false,
    reason: `ringan (${info.width}×${info.height}, ${clockLabel(info.durationSec)}) — preview memakai aslinya`,
  };
};

/**
 * Ukuran proxy untuk sumber berdimensi tertentu: sisi pendek dibawa ke
 * PROXY_SHORT_SIDE, sisi panjang mengikuti rasio, keduanya GENAP (libx264
 * yuv420p menolak dimensi ganjil). Sumber yang sudah lebih kecil tidak
 * diperbesar.
 */
export const proxyDimensions = (
  width: number,
  height: number,
  shortSide: number = PROXY_SHORT_SIDE,
): { width: number; height: number } => {
  const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2);
  const source = Math.min(width, height);
  if (source <= shortSide) return { width: even(width), height: even(height) };
  const scale = shortSide / source;
  return { width: even(width * scale), height: even(height * scale) };
};

/** Laju bingkai proxy: mengikuti sumber, dipangkas ke PROXY_MAX_FPS. */
export const proxyFps = (sourceFps: number | null | undefined): number | undefined => {
  if (!sourceFps || !Number.isFinite(sourceFps)) return undefined;
  return sourceFps > PROXY_MAX_FPS ? PROXY_MAX_FPS : undefined;
};

const VIDEO_STORES = ["resolvedAssets", "layerAssets"] as const;

/**
 * Berkas video yang punya proxy di plan ini, sekali per berkas.
 *
 * Hanya lumbung VIDEO (aset scene dan lapisan): cue efek suara dan trek
 * audio tidak pernah punya proxy — tidak ada yang perlu diringankan dari
 * berkas yang tidak digambar.
 */
export const proxiedFiles = (plan: ScenePlan): Map<string, ProxyMedia> => {
  const files = new Map<string, ProxyMedia>();
  for (const store of VIDEO_STORES) {
    for (const asset of Object.values(plan.renderState[store])) {
      if (asset.proxy && !files.has(asset.file)) files.set(asset.file, asset.proxy);
    }
  }
  return files;
};

const withProxy = (asset: ResolvedAsset): ResolvedAsset => {
  if (!asset.proxy) return asset;
  const { proxy, ...rest } = asset;
  return {
    ...rest,
    file: proxy.file,
    width: proxy.width,
    height: proxy.height,
    ...(proxy.fps ? { fps: proxy.fps } : {}),
  };
};

/**
 * Plan yang SAMA dengan setiap berkas video ber-proxy ditukar proxy-nya.
 *
 * Dipakai preview Studio dan render draf — dan hanya keduanya. Hasilnya plan
 * yang sah (proxy adalah aset biasa dengan path relatif-plan), jadi seluruh
 * tumpukan render tidak perlu tahu proxy itu ada: `planAssetFiles` memilih
 * berkasnya, preset memutarnya, tanpa satu cabang khusus pun. Yang tidak
 * berubah: keputusan kreatif (trim, kecepatan, fokus) dan hasil ukur
 * kenyaringan, karena keduanya milik REKAMANNYA, bukan resolusinya.
 *
 * Tidak mengubah plan aslinya. Mengembalikan objek yang sama persis bila
 * tidak ada satu pun proxy, supaya pemanggil yang memoize tidak merender
 * ulang tanpa sebab.
 */
export const substituteProxies = (plan: ScenePlan): ScenePlan => {
  if (proxiedFiles(plan).size === 0) return plan;
  const next = structuredClone(plan);
  for (const store of VIDEO_STORES) {
    for (const [id, asset] of Object.entries(next.renderState[store])) {
      next.renderState[store][id] = withProxy(asset);
    }
  }
  return next;
};
