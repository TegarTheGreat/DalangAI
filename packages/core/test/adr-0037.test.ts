import { describe, expect, it } from "vitest";
import {
  applyPatch,
  BUILT_IN_TEMPLATES,
  builtInTemplate,
  critiquePlan,
  describeStrip,
  parseTemplatePack,
  planFromTemplate,
  TEMPLATE_FORMAT,
  templateFromPlan,
  templateLookOps,
  templateManifestSchema,
} from "../src/index";
import { makePlan } from "./fixtures";

/**
 * Paket template (ADR-0037, roadmap §10.2).
 *
 * Yang dijaga di sini adalah janji yang paling mudah dilanggar tanpa sadar:
 * template TIDAK boleh membawa apa pun yang menunjuk berkas, sebab tautan yang
 * putus di komputer orang lain tidak menghasilkan galat — ia menghasilkan
 * video yang gambarnya hilang, dan yang memasangnya akan mengira Dalang-nya
 * yang rusak.
 */

const manifest = (id = "uji-template") =>
  templateManifestSchema.parse({
    id,
    name: "Template uji",
    createdAt: "2026-09-08T00:00:00.000Z",
  });

describe("templateFromPlan", () => {
  it("melepas SEMUA rujukan berkas, dan mengatakan apa saja yang dilepas", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.clips[0]!.assetId = "aset-1";
      input.scenes[0]!.clips[0]!.pinned = true;
      input.audio = {
        ...input.audio,
        music: { assetId: "musik-unggahan.mp3", volume: 0.2 },
      };
    });
    const { pack, stripped } = templateFromPlan(plan, manifest());

    expect(pack.plan.scenes[0]?.clips[0]?.assetId).toBeNull();
    expect(pack.plan.scenes[0]?.clips[0]?.pinned).toBe(false);
    expect(pack.plan.audio.music).toBeUndefined();
    expect(stripped.clipAssets).toBe(1);
    expect(stripped.music).toBe(true);
    // Dikatakan, bukan cuma dilakukan: yang mengekspor berhak tahu sebelum
    // ia mengira paketnya lengkap.
    expect(describeStrip(stripped).join(" ")).toContain("musik latar dibuang");
  });

  it("renderState dikosongkan seluruhnya", () => {
    const plan = makePlan();
    const withState = {
      ...plan,
      renderState: {
        ...plan.renderState,
        clipAssets: {
          "sc-001-k1": { file: "a.jpg", kind: "image" as const, source: "lokal" },
        },
      },
    };
    const { pack } = templateFromPlan(withState, manifest());
    expect(pack.plan.renderState.clipAssets).toEqual({});
  });

  it("musik dan bunyi dari PUSTAKA ter-bundle tetap ikut", () => {
    // Berkasnya ada di setiap pemasangan, jadi ia tetap berarti di komputer
    // orang lain — dan bed musik adalah pembeda terbesar antara slideshow dan
    // film menurut kritikus repo ini sendiri.
    const plan = makePlan((input) => {
      input.audio = {
        ...input.audio,
        music: { assetId: "pustaka:tenang", volume: 0.12 },
      };
    });
    const { pack, stripped } = templateFromPlan(plan, manifest());
    expect(pack.plan.audio.music?.assetId).toBe("pustaka:tenang");
    expect(stripped.music).toBe(false);
    expect(describeStrip(stripped)).toEqual([]);
  });

  it("kata-kata IKUT — narasi adalah yang sengaja dibagikan pembuatnya", () => {
    const plan = makePlan();
    const { pack } = templateFromPlan(plan, manifest());
    expect(pack.plan.scenes[0]?.narration).toBe(plan.scenes[0]?.narration);
  });

  it("id template dibatasi bentuknya supaya tidak jadi nama berkas sembarang", () => {
    // Registrinya menulis <id>.json; id bebas akan berujung pada template
    // bernama "../../.bashrc".
    expect(() => manifest("../../.bashrc")).toThrow();
    expect(() => manifest("Huruf Besar")).toThrow();
  });
});

describe("planFromTemplate", () => {
  it("mengganti judul dan projectId, menyisakan sisanya apa adanya", () => {
    // Dua proyek berbagi projectId akan berbagi entri ledger pipeline, dan
    // judul pembuatnya yang tertinggal akan menerbitkan video atas nama orang
    // lain.
    const pack = builtInTemplate("esai-video");
    if (!pack) throw new Error("template bawaan esai-video hilang");
    const plan = planFromTemplate(pack, { title: "Video Saya", projectId: "video-saya" });
    expect(plan.meta.title).toBe("Video Saya");
    expect(plan.projectId).toBe("video-saya");
    expect(plan.meta.stylePreset).toBe(pack.plan.meta.stylePreset);
    expect(plan.scenes).toHaveLength(pack.plan.scenes.length);
  });

  it("judul kosong ditolak, bukan menghasilkan proyek tanpa nama", () => {
    const pack = BUILT_IN_TEMPLATES[0];
    if (!pack) throw new Error("tidak ada template bawaan");
    expect(() => planFromTemplate(pack, { title: "  ", projectId: "x" })).toThrow();
  });
});

describe("templateLookOps", () => {
  it("mengganti TAMPILAN dan tidak menyentuh narasi, klip, atau durasi", () => {
    const pack = builtInTemplate("klip-tiga-detik");
    if (!pack) throw new Error("template bawaan klip-tiga-detik hilang");
    const plan = makePlan();
    const hasil = applyPatch(plan, templateLookOps(pack, plan), { origin: "user" });

    expect(hasil.plan.meta.stylePreset).toBe("klip-01");
    expect(hasil.plan.meta.aspectRatio).toBe("9:16");
    expect(hasil.plan.meta.safeArea.bottom).toBeCloseTo(0.2, 4);
    expect(hasil.plan.scenes[0]?.caption.style).toBe("tegas");
    // Yang dipinjam rupanya, bukan isinya.
    expect(hasil.plan.scenes[0]?.narration).toBe(plan.scenes[0]?.narration);
    expect(hasil.plan.scenes[0]?.clips).toEqual(plan.scenes[0]?.clips);
    expect(hasil.plan.scenes.map((s) => s.duration)).toEqual(
      plan.scenes.map((s) => s.duration),
    );
  });

  it("template tanpa token MENGOSONGKAN token, bukan membiarkan yang lama", () => {
    // "Tidak menyebut token" pada sebuah template berarti "pakai warna bawaan
    // preset". Membiarkan token lama menghasilkan campuran yang bukan
    // tampilan mana pun.
    const pack = builtInTemplate("esai-video");
    if (!pack) throw new Error("template bawaan esai-video hilang");
    const plan = makePlan((input) => {
      input.meta.tokens = { accent: "#FF0000" };
    });
    const hasil = applyPatch(plan, templateLookOps(pack, plan), { origin: "user" });
    expect(hasil.plan.meta.tokens?.accent).toBeUndefined();
  });

  it("scene TERKUNCI tidak ikut berubah gaya caption-nya", () => {
    const pack = builtInTemplate("klip-tiga-detik");
    if (!pack) throw new Error("template bawaan klip-tiga-detik hilang");
    const plan = makePlan((input) => {
      input.scenes[0]!.locked = true;
      input.scenes[0]!.caption = {
        enabled: true,
        style: "klasik",
        size: "m",
        position: "bottom",
      };
    });
    const hasil = applyPatch(plan, templateLookOps(pack, plan), { origin: "user" });
    expect(hasil.plan.scenes[0]?.caption.style).toBe("klasik");
    expect(hasil.plan.scenes[1]?.caption.style).toBe("tegas");
  });
});

describe("template bawaan", () => {
  it("ketiganya sah dan berbeda id", () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(3);
    const ids = new Set(BUILT_IN_TEMPLATES.map((pack) => pack.manifest.id));
    expect(ids.size).toBe(3);
    for (const pack of BUILT_IN_TEMPLATES) {
      expect(parseTemplatePack(pack).format).toBe(TEMPLATE_FORMAT);
    }
  });

  it("tidak satu pun melanggar kaidah sutradara repo ini sendiri", () => {
    // Contoh yang melanggar aturannya sendiri mengajarkan hal yang salah, dan
    // template dipakai sebagai TITIK AWAL — kesalahannya ikut disalin ke tiap
    // proyek yang lahir darinya.
    for (const pack of BUILT_IN_TEMPLATES) {
      const plan = planFromTemplate(pack, { title: "Uji", projectId: "uji" });
      const notes = critiquePlan(plan);
      expect(
        notes.map((note) => `${pack.manifest.id}: ${note.code}`),
        `template ${pack.manifest.id} tidak bersih`,
      ).toEqual([]);
    }
  });

  it("tidak membawa satu pun rujukan berkas proyek", () => {
    for (const pack of BUILT_IN_TEMPLATES) {
      for (const scene of pack.plan.scenes) {
        for (const clip of scene.clips) expect(clip.assetId).toBeNull();
      }
      expect(pack.plan.audio.tracks).toEqual([]);
      const music = pack.plan.audio.music;
      if (music) expect(music.assetId.startsWith("pustaka:")).toBe(true);
    }
  });
});
