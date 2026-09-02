import { describe, expect, it } from "vitest";
import {
  BROWSER_SAFE_CODECS,
  clockLabel,
  PROXY_MAX_FPS,
  PROXY_SHORT_SIDE,
  parseScenePlan,
  proxiedFiles,
  proxyDecision,
  proxyDimensions,
  proxyFps,
  resolvedAssetSchema,
  type ScenePlan,
  setLayerAsset,
  setProxy,
  setResolvedAsset,
  substituteProxies,
} from "../src";

/**
 * ADR-0028: proxy pratinjau & rekaman panjang (roadmap §9.5).
 *
 * Yang diuji kontraknya: keputusan "perlu proxy" beserta ALASANNYA, ukuran
 * proxy yang selalu genap dan tidak pernah memperbesar, penulisan proxy ke
 * semua pemakai berkas yang sama, dan penukaran proxy yang tidak menyentuh
 * satu pun keputusan kreatif.
 */

const plan = (): ScenePlan =>
  parseScenePlan({
    version: 1,
    projectId: "uji-0028",
    meta: { title: "Uji Proxy" },
    scenes: [
      {
        id: "a",
        narration: "Satu.",
        visual: { type: "image", assetId: "assets/podcast.mp4", trimStartSec: 120 },
        duration: 8,
        layers: [
          {
            id: "lap-a",
            visual: { type: "image", assetId: "assets/podcast.mp4" },
            anchor: "kanan-bawah",
            width: 0.3,
            height: 0.3,
          },
        ],
      },
      {
        id: "b",
        narration: "Dua.",
        visual: { type: "image", assetId: "assets/broll.mp4" },
        duration: 5,
      },
    ],
  });

const video = (file: string) => ({
  file,
  kind: "video" as const,
  source: "local",
  width: 3840,
  height: 2160,
  durationSec: 3600,
  lufs: -19.5,
  channels: 2,
});

describe("proxyDecision — kenapa sebuah berkas perlu proxy", () => {
  it("kodek yang tidak diputar browser selalu perlu, dan menyebut kodeknya", () => {
    const decision = proxyDecision({
      width: 640,
      height: 360,
      durationSec: 3,
      codec: "hevc",
    });
    expect(decision.needed).toBe(true);
    expect(decision.reason).toContain("hevc");
    // Daftar amannya sengaja pendek: yang tidak tercantum dianggap perlu.
    expect(BROWSER_SAFE_CODECS.has("prores")).toBe(false);
    expect(
      proxyDecision({ width: 640, height: 360, durationSec: 3, codec: "prores" }).needed,
    ).toBe(true);
  });

  it("rekaman panjang perlu walau ringan, dan alasannya menyebut durasi", () => {
    const decision = proxyDecision({
      width: 640,
      height: 360,
      durationSec: 3725,
      codec: "h264",
    });
    expect(decision.needed).toBe(true);
    expect(decision.reason).toContain("1 j 2 mnt");
  });

  it("1080p perlu, 720p tidak, dan 60 fps perlu", () => {
    expect(
      proxyDecision({ width: 1920, height: 1080, durationSec: 10, codec: "h264" }).needed,
    ).toBe(true);
    expect(
      proxyDecision({ width: 1080, height: 1920, durationSec: 10, codec: "h264" }).reason,
    ).toContain("1080×1920");
    const light = proxyDecision({
      width: 1280,
      height: 720,
      durationSec: 10,
      codec: "h264",
    });
    expect(light.needed).toBe(false);
    expect(light.reason).toContain("aslinya");
    expect(
      proxyDecision({
        width: 1280,
        height: 720,
        durationSec: 10,
        codec: "h264",
        fps: 59.94,
      }).reason,
    ).toBe("60 fps");
    // 29.97 fps bukan "di atas 30".
    expect(
      proxyDecision({
        width: 1280,
        height: 720,
        durationSec: 10,
        codec: "h264",
        fps: 29.97,
      }).needed,
    ).toBe(false);
  });

  it("tanpa kodek (belum diperiksa) keputusan jatuh ke aturan lain", () => {
    expect(proxyDecision({ width: 640, height: 360, durationSec: 5 }).needed).toBe(false);
  });
});

describe("proxyDimensions / proxyFps", () => {
  it("membawa sisi pendek ke 540 dan menjaga rasio, hasilnya genap", () => {
    expect(proxyDimensions(3840, 2160)).toEqual({ width: 960, height: 540 });
    expect(proxyDimensions(1080, 1920)).toEqual({ width: 540, height: 960 });
    // 1920x1080 → 960x540; 1280x720 → 960x540; 4096x2160 → 1024x540.
    expect(proxyDimensions(4096, 2160)).toEqual({ width: 1024, height: 540 });
    // Rasio ganjil: 1366x768 → 960.47 → dibulatkan ke genap.
    const odd = proxyDimensions(1366, 768);
    expect(odd.width % 2).toBe(0);
    expect(odd.height).toBe(PROXY_SHORT_SIDE);
  });

  it("tidak pernah memperbesar sumber yang sudah kecil", () => {
    expect(proxyDimensions(640, 360)).toEqual({ width: 640, height: 360 });
    expect(proxyDimensions(641, 361)).toEqual({ width: 642, height: 362 });
  });

  it("laju bingkai dipangkas ke 30, sisanya mengikuti sumber (tanpa nilai)", () => {
    expect(proxyFps(59.94)).toBe(PROXY_MAX_FPS);
    expect(proxyFps(25)).toBeUndefined();
    expect(proxyFps(null)).toBeUndefined();
    expect(proxyFps(Number.NaN)).toBeUndefined();
  });

  it("clockLabel membaca detik jadi jam/menit/detik", () => {
    expect(clockLabel(12)).toBe("12 dtk");
    expect(clockLabel(185)).toBe("3 mnt 5 dtk");
    expect(clockLabel(3725)).toBe("1 j 2 mnt");
  });
});

describe("skema: proxy pada resolvedAsset", () => {
  it("menerima proxy lengkap dan menolak yang kurang", () => {
    const ok = resolvedAssetSchema.parse({
      ...video("assets/podcast.mp4"),
      codec: "hevc",
      fps: 29.97,
      proxy: { file: ".dalang/proxies/x-540p.mp4", width: 960, height: 540, fps: 29.97 },
    });
    expect(ok.proxy?.width).toBe(960);
    expect(() =>
      resolvedAssetSchema.parse({
        ...video("assets/podcast.mp4"),
        proxy: { file: ".dalang/proxies/x.mp4", width: 960 },
      }),
    ).toThrow();
    expect(() =>
      resolvedAssetSchema.parse({
        ...video("assets/podcast.mp4"),
        proxy: { file: "", width: 960, height: 540 },
      }),
    ).toThrow();
  });
});

describe("setProxy — ditulis ke semua pemakai berkas, lumbung video saja", () => {
  const withAssets = (): ScenePlan => {
    let next = plan();
    next = setResolvedAsset(next, "a", video("assets/podcast.mp4"));
    next = setLayerAsset(next, "lap-a", video("assets/podcast.mp4"));
    next = setResolvedAsset(next, "b", video("assets/broll.mp4"));
    return next;
  };

  it("menulis proxy ke aset scene DAN lapisan yang menunjuk berkas yang sama", () => {
    const next = setProxy(
      withAssets(),
      "assets/podcast.mp4",
      { file: ".dalang/proxies/p-540p.mp4", width: 960, height: 540 },
      { codec: "hevc", fps: 29.97 },
    );
    expect(next.renderState.resolvedAssets.a?.proxy?.file).toBe(
      ".dalang/proxies/p-540p.mp4",
    );
    expect(next.renderState.layerAssets["lap-a"]?.proxy?.width).toBe(960);
    expect(next.renderState.resolvedAssets.a?.codec).toBe("hevc");
    expect(next.renderState.resolvedAssets.a?.fps).toBe(29.97);
    // Berkas lain tidak tersentuh.
    expect(next.renderState.resolvedAssets.b?.proxy).toBeUndefined();
    expect(proxiedFiles(next).size).toBe(1);
  });

  it("null menghapus proxy lama tapi tetap mencatat kodek", () => {
    const first = setProxy(withAssets(), "assets/podcast.mp4", {
      file: ".dalang/proxies/p-540p.mp4",
      width: 960,
      height: 540,
    });
    const cleared = setProxy(first, "assets/podcast.mp4", null, { codec: "h264" });
    expect(cleared.renderState.resolvedAssets.a?.proxy).toBeUndefined();
    expect(cleared.renderState.layerAssets["lap-a"]?.proxy).toBeUndefined();
    expect(cleared.renderState.resolvedAssets.a?.codec).toBe("h264");
    expect(proxiedFiles(cleared).size).toBe(0);
  });

  it("tidak mengubah plan aslinya dan menolak proxy yang tidak sah", () => {
    const base = withAssets();
    setProxy(base, "assets/podcast.mp4", { file: "x", width: 2, height: 2 });
    expect(base.renderState.resolvedAssets.a?.proxy).toBeUndefined();
    expect(() =>
      setProxy(base, "assets/podcast.mp4", { file: "x", width: -1, height: 2 }),
    ).toThrow();
  });
});

describe("substituteProxies — preview & render draf memakai proxy, tanpa menyentuh yang kreatif", () => {
  it("menukar file+dimensi, mempertahankan trim/kenyaringan, dan mengembalikan plan yang sah", () => {
    let base = plan();
    base = setResolvedAsset(base, "a", video("assets/podcast.mp4"));
    base = setLayerAsset(base, "lap-a", video("assets/podcast.mp4"));
    base = setResolvedAsset(base, "b", video("assets/broll.mp4"));
    base = setProxy(
      base,
      "assets/podcast.mp4",
      { file: ".dalang/proxies/p-540p.mp4", width: 960, height: 540, fps: 30 },
      { codec: "hevc", fps: 59.94 },
    );

    const swapped = substituteProxies(base);
    expect(swapped).not.toBe(base);
    const a = swapped.renderState.resolvedAssets.a;
    expect(a?.file).toBe(".dalang/proxies/p-540p.mp4");
    expect(a?.width).toBe(960);
    expect(a?.height).toBe(540);
    expect(a?.fps).toBe(30);
    expect(a?.proxy).toBeUndefined(); // tidak rekursif
    expect(a?.lufs).toBe(-19.5); // hasil ukur milik rekamannya
    expect(a?.codec).toBe("hevc"); // fakta sumber tetap tercatat
    expect(swapped.renderState.layerAssets["lap-a"]?.file).toBe(
      ".dalang/proxies/p-540p.mp4",
    );
    expect(swapped.renderState.resolvedAssets.b?.file).toBe("assets/broll.mp4");
    // Keputusan kreatif tidak tersentuh: trim, durasi, id.
    expect(swapped.scenes[0]?.visual.trimStartSec).toBe(120);
    expect(swapped.scenes[0]?.visual.assetId).toBe("assets/podcast.mp4");
    // Plan aslinya utuh, dan hasilnya lolos skema.
    expect(base.renderState.resolvedAssets.a?.file).toBe("assets/podcast.mp4");
    expect(() => parseScenePlan(swapped)).not.toThrow();
  });

  it("mengembalikan objek yang SAMA bila tidak ada proxy — pemoize tidak merender ulang", () => {
    const base = setResolvedAsset(plan(), "a", video("assets/podcast.mp4"));
    expect(substituteProxies(base)).toBe(base);
  });
});

describe("proxyDecision — laju bit (batas ADR-0028 dicabut)", () => {
  it("720p 30 fps yang laju bitnya 50 Mbps tetap perlu proxy, dan menyebut Mbps-nya", () => {
    const heavy = proxyDecision({
      width: 1280,
      height: 720,
      durationSec: 10,
      codec: "h264",
      fps: 30,
      bitrate: 50_000_000,
    });
    expect(heavy.needed).toBe(true);
    expect(heavy.reason).toBe("laju bit 50 Mbps");
  });

  it("di bawah 25 Mbps, atau laju bit tidak diketahui, tidak mengubah keputusan", () => {
    expect(
      proxyDecision({
        width: 1280,
        height: 720,
        durationSec: 10,
        codec: "h264",
        bitrate: 12_000_000,
      }).needed,
    ).toBe(false);
    expect(
      proxyDecision({
        width: 1280,
        height: 720,
        durationSec: 10,
        codec: "h264",
        bitrate: null,
      }).needed,
    ).toBe(false);
  });
});
