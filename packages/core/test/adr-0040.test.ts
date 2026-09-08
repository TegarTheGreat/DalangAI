import { describe, expect, it } from "vitest";
import {
  applyPatch,
  computeTimeline,
  critiquePlan,
  DUB_DRIFT_LIMIT,
  dubCoverage,
  dubDrift,
  MAX_DUB_LANGUAGES,
  narrationAudioIn,
  narrationIn,
  parseScenePlan,
  planInLanguage,
  planLanguages,
  type ScenePlanInput,
  untranslatedScreenText,
} from "../src/index";

/**
 * Sulih suara (ADR-0040).
 *
 * Seluruh fitur ini berdiri di atas satu fungsi — `planInLanguage` — dan yang
 * dijaga di sini adalah bahwa hasilnya benar-benar SCENE-PLAN BIASA: bahasa
 * lain, suara lain, durasi yang ikut bahasanya, dan tidak ada sisa data
 * bahasa lain yang bisa terbaca keliru oleh jalur di hilir.
 */

const plan = (mutate?: (input: ScenePlanInput) => void) => {
  const input: ScenePlanInput = {
    version: 2,
    projectId: "uji-sulih",
    meta: { title: "Uji Sulih", language: "id", stylePreset: "documentary-01" },
    audio: { voice: { provider: "silence", voiceId: "id-1", speed: 1 } },
    scenes: [
      {
        id: "sc-judul",
        narration: "",
        clips: [{ id: "sc-judul-k1", type: "template-anim", variant: "title" }],
      },
      {
        id: "sc-1",
        narration: "Candi ini berdiri sejak abad kesembilan.",
        dubs: { en: "This temple has stood since the ninth century." },
        clips: [{ id: "sc-1-k1", type: "solid" }],
        texts: [
          { id: "t-judul", content: "Abad ke-9", dubs: { en: "Ninth century" } },
          { id: "t-tempat", content: "Jawa Tengah" },
        ],
      },
      {
        id: "sc-2",
        narration: "Batunya disusun tanpa satu pun perekat.",
        dubs: { en: "Its stones were laid without a single binder." },
        clips: [{ id: "sc-2-k1", type: "solid" }],
      },
    ],
  };
  mutate?.(input);
  return parseScenePlan(input);
};

describe("planLanguages", () => {
  it("bahasa utama selalu pertama, sisanya urut", () => {
    expect(planLanguages(plan())).toEqual(["id", "en"]);
  });

  it("bahasa yang teksnya KOSONG tidak dihitung ada", () => {
    // Pilihan bahasa yang menghasilkan video bisu lebih buruk daripada
    // pilihan yang tidak ada sama sekali.
    const kosong = plan((input) => {
      for (const scene of input.scenes) {
        if (scene.dubs) scene.dubs.jv = "   ";
      }
    });
    expect(planLanguages(kosong)).toEqual(["id", "en"]);
  });
});

describe("planInLanguage", () => {
  it("menukar narasi dan MENGOSONGKAN sisa data bahasa lain", () => {
    // Sisa `dubs` di hasilnya adalah cara termudah jalur di hilir membaca
    // bahasa yang salah tanpa satu pun galat.
    const en = planInLanguage(plan(), "en");
    expect(en.meta.language).toBe("en");
    expect(en.scenes[1]?.narration).toBe(
      "This temple has stood since the ninth century.",
    );
    expect(en.scenes[1]?.dubs).toEqual({});
    expect(en.renderState.dubAudio).toEqual({});
    expect(en.audio.dubVoices).toEqual({});
  });

  it("bahasa utama mengembalikan plan yang SAMA PERSIS, bukan salinan", () => {
    // Kalau salinan, gerbang paritas byte akan hijau tapi jalur bahasa utama
    // diam-diam berjalan lewat kode yang berbeda dari yang selama ini teruji.
    const asli = plan();
    expect(planInLanguage(asli, "id")).toBe(asli);
  });

  it("suara ikut berganti kalau bahasanya punya suaranya sendiri", () => {
    // Tanpa ini, sulih suara cuma berarti suara Indonesia membaca teks
    // Inggris — yang terdengar persis seperti itu.
    const en = planInLanguage(
      plan((input) => {
        input.audio = {
          ...input.audio,
          dubVoices: { en: { provider: "elevenlabs", voiceId: "en-natural", speed: 1 } },
        };
      }),
      "en",
    );
    expect(en.audio.voice).toMatchObject({ voiceId: "en-natural" });
  });

  it("tanpa suara khusus, suara bahasa utama dipakai apa adanya", () => {
    const en = planInLanguage(plan(), "en");
    expect(en.audio.voice).toMatchObject({ voiceId: "id-1" });
  });

  it("scene yang BELUM disulih jadi bisu, bukan dibuang", () => {
    // Membuangnya mengubah SUSUNAN video antar bahasa, dan dua video yang
    // susunannya berbeda bukan lagi satu video yang disulih.
    const sebagian = plan((input) => {
      delete input.scenes[2]?.dubs?.en;
    });
    const en = planInLanguage(sebagian, "en");
    expect(en.scenes).toHaveLength(3);
    expect(en.scenes[2]?.narration).toBe("");
  });

  it("durasi IKUT bahasanya — itu inti keputusannya", () => {
    // Sulihan yang jauh lebih panjang menghasilkan video yang lebih panjang.
    // Alternatifnya adalah mempercepat ucapannya, dan itu terdengar.
    const panjang = plan((input) => {
      const scene = input.scenes[1];
      if (scene?.dubs) {
        scene.dubs.en =
          "This temple has stood since the ninth century, and every single one of its stones was carried here by hand across the river valley below.";
      }
    });
    const idSec = computeTimeline(panjang).totalSec;
    const enSec = computeTimeline(planInLanguage(panjang, "en")).totalSec;
    expect(enSec).toBeGreaterThan(idSec);
  });

  it("audio sulih masuk ke narrationAudio, jadi jalur di hilir tidak tahu bedanya", () => {
    const dengan = plan((input) => {
      input.renderState = {
        narrationAudio: {},
        dubAudio: {
          en: { "sc-1": { file: "narasi/en-sc-1.wav", durationSec: 3.5 } },
        },
        clipAssets: {},
      };
    });
    const en = planInLanguage(dengan, "en");
    expect(en.renderState.narrationAudio["sc-1"]).toMatchObject({ durationSec: 3.5 });
    expect(narrationAudioIn(dengan, "sc-1", "en")).toMatchObject({ durationSec: 3.5 });
    expect(narrationAudioIn(dengan, "sc-1", "id")).toBeUndefined();
  });
});

describe("narrationIn / dubCoverage", () => {
  it("penyebutnya scene BERNARASI, bukan jumlah scene", () => {
    // Kartu judul tanpa narasi tidak perlu disulih; menghitungnya sebagai
    // "belum selesai" membuat proyek yang lengkap tidak pernah capai 100%.
    const cakupan = dubCoverage(plan(), "en");
    expect(cakupan.perlu).toBe(2);
    expect(cakupan.diterjemahkan).toBe(2);
    expect(cakupan.bersuara).toBe(0);
    expect(cakupan.belumBersuara).toEqual(["sc-1", "sc-2"]);
  });

  it("narrationIn untuk bahasa utama mengembalikan narration, bukan dubs", () => {
    const p = plan();
    const scene = p.scenes[1];
    if (!scene) throw new Error("scene hilang");
    expect(narrationIn(scene, p, "id")).toBe("Candi ini berdiri sejak abad kesembilan.");
    expect(narrationIn(scene, p, "jv")).toBe("");
  });
});

describe("op setDub", () => {
  it("inversnya mengembalikan teks lama PERSIS, dan menghapus yang baru dibuat", () => {
    const awal = plan();
    const { plan: sesudah, applied } = applyPatch(
      awal,
      [{ op: "setDub", sceneId: "sc-1", language: "jv", text: "Candhi iki ngadeg." }],
      { origin: "user" },
    );
    expect(sesudah.scenes[1]?.dubs.jv).toBe("Candhi iki ngadeg.");
    const { plan: balik } = applyPatch(sesudah, applied.inverse, { origin: "user" });
    expect(balik.scenes[1]?.dubs.jv).toBeUndefined();
    expect(balik.scenes[1]?.dubs.en).toBe(
      "This temple has stood since the ninth century.",
    );
  });

  it("text null menghapus satu bahasa saja", () => {
    const { plan: sesudah } = applyPatch(
      plan(),
      [{ op: "setDub", sceneId: "sc-1", language: "en", text: null }],
      { origin: "user" },
    );
    expect(sesudah.scenes[1]?.dubs).toEqual({});
    expect(sesudah.scenes[2]?.dubs.en).toBeDefined();
  });

  it("kode bahasa ngawur ditolak SKEMA — kode itu jadi nama berkas", () => {
    expect(() =>
      applyPatch(
        plan(),
        [{ op: "setDub", sceneId: "sc-1", language: "../../etc", text: "x" }],
        { origin: "user" },
      ),
    ).toThrow();
  });

  it("scene terkunci menolak sulihan dari agent", () => {
    const terkunci = plan((input) => {
      const scene = input.scenes[1];
      if (scene) scene.locked = true;
    });
    expect(() =>
      applyPatch(
        terkunci,
        [{ op: "setDub", sceneId: "sc-1", language: "jv", text: "x" }],
        {
          origin: "agent",
        },
      ),
    ).toThrow(/terkunci|locked/i);
  });

  it(`bahasa ke-${MAX_DUB_LANGUAGES + 1} ditolak sebelum proyek separuh tersulih`, () => {
    let current = plan();
    for (let i = 0; i < MAX_DUB_LANGUAGES - 1; i++) {
      const kode = `x${String.fromCharCode(97 + i)}`;
      current = applyPatch(
        current,
        [{ op: "setDub", sceneId: "sc-1", language: kode, text: "teks" }],
        { origin: "user" },
      ).plan;
    }
    expect(() =>
      applyPatch(
        current,
        [{ op: "setDub", sceneId: "sc-1", language: "zz", text: "t" }],
        {
          origin: "user",
        },
      ),
    ).toThrow(/12 bahasa/);
  });
});

describe("kaidah sutradara sulih", () => {
  it("sulihan SEPARUH jadi perhatian — scene sisanya tampil bisu, bukan gagal", () => {
    const sebagian = plan((input) => {
      delete input.scenes[2]?.dubs?.en;
    });
    const notes = critiquePlan(sebagian);
    const note = notes.find((n) => n.code === "sulih-separuh");
    expect(note?.level).toBe("perhatian");
    expect(note?.message).toContain("sc-2");
    expect(note?.message).toContain("BISU");
  });

  it("sulihan yang jauh lebih panjang jadi saran, dengan angkanya", () => {
    const melar = plan((input) => {
      const scene = input.scenes[1];
      if (scene?.dubs) {
        scene.dubs.en =
          "This particular temple has been standing here since the ninth century of the common era, without interruption.";
      }
    });
    const note = critiquePlan(melar).find((n) => n.code === "sulih-kepanjangan");
    expect(note?.sceneId).toBe("sc-1");
    expect(note?.message).toMatch(/\d+% lebih panjang/);
    expect(note?.message).toContain("ditaksir dari suku kata");
  });

  it("plan tanpa sulihan tidak menghasilkan satu pun catatan sulih", () => {
    const tanpa = plan((input) => {
      for (const scene of input.scenes) scene.dubs = {};
    });
    const codes = critiquePlan(tanpa).map((n) => n.code);
    expect(codes).not.toContain("sulih-separuh");
    expect(codes).not.toContain("sulih-kepanjangan");
  });

  it("selisih di bawah ambang tidak dikeluhkan", () => {
    const drift = dubDrift(plan(), "en");
    expect(drift.length).toBe(2);
    for (const item of drift) expect(item.rasio).toBeLessThan(DUB_DRIFT_LIMIT + 0.5);
    expect(drift[0]?.terukur).toBe(false);
  });
});

describe("teks LAYAR ikut disulih (ADR-0040)", () => {
  it("judul proyek dan teks overlay ditukar ke bahasanya", () => {
    // Video yang terdengar Inggris tapi kartu judulnya Indonesia bukan video
    // yang disulih — dan yang itu terlihat di SETIAP bingkai.
    const en = planInLanguage(
      plan((input) => {
        input.meta.dubTitles = { en: "Borobudur in Sixty Seconds" };
      }),
      "en",
    );
    expect(en.meta.title).toBe("Borobudur in Sixty Seconds");
    expect(en.scenes[1]?.texts[0]?.content).toBe("Ninth century");
    expect(en.scenes[1]?.texts[0]?.dubs).toEqual({});
  });

  it("teks yang BELUM disulih dipakai apa adanya, tidak dihilangkan", () => {
    // Mengosongkannya membuang elemen dari bingkai, dan itu mengubah tata
    // letak video antar bahasa.
    const en = planInLanguage(plan(), "en");
    expect(en.scenes[1]?.texts[1]?.content).toBe("Jawa Tengah");
    expect(en.meta.title).toBe("Uji Sulih");
  });

  it("yang tertinggal dilaporkan, dengan tempatnya", () => {
    const kurang = untranslatedScreenText(plan(), "en");
    expect(kurang.map((item) => item.where)).toEqual(["meta.title", "sc-1/t-tempat"]);
  });

  it("kaidah sutradara mengangkatnya sebagai perhatian", () => {
    const note = critiquePlan(plan()).find((n) => n.code === "sulih-teks-layar");
    expect(note?.level).toBe("perhatian");
    expect(note?.message).toContain("meta.title");
  });

  it("setDub dengan textId menyulih TEKS, bukan narasinya", () => {
    const { plan: sesudah, applied } = applyPatch(
      plan(),
      [
        {
          op: "setDub",
          sceneId: "sc-1",
          language: "en",
          textId: "t-tempat",
          text: "Central Java",
        },
      ],
      { origin: "user" },
    );
    expect(sesudah.scenes[1]?.texts[1]?.dubs.en).toBe("Central Java");
    expect(sesudah.scenes[1]?.dubs.en).toBe(
      "This temple has stood since the ninth century.",
    );
    expect(applied.summary).toContain("teks t-tempat");
    const { plan: balik } = applyPatch(sesudah, applied.inverse, { origin: "user" });
    expect(balik.scenes[1]?.texts[1]?.dubs).toEqual({});
  });

  it("textId yang tidak ada ditolak, bukan diam-diam tidak berefek", () => {
    expect(() =>
      applyPatch(
        plan(),
        [
          {
            op: "setDub",
            sceneId: "sc-1",
            language: "en",
            textId: "tidak-ada",
            text: "x",
          },
        ],
        { origin: "user" },
      ),
    ).toThrow(/tidak ada di scene/);
  });
});
