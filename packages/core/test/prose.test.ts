import { describe, expect, it } from "vitest";
import {
  countSyllablesInWord,
  critiquePlan,
  HEDGING_ID,
  lexicalOverlap,
  opensWithConnector,
  PENGISI_ID,
  parseScenePlan,
  phraseDensity,
  phrasesFound,
  proseStats,
  proseStatsOf,
} from "../src";

/**
 * ADR-0017: detektor "generic". Yang diuji bukan seleranya, melainkan bahwa
 * pengukurannya benar dan tidak menuduh naskah wajar.
 */

const planWith = (narrations: string[], format = "bebas") =>
  parseScenePlan({
    version: 1,
    projectId: "uji-prosa",
    meta: { title: "Uji Prosa", format },
    scenes: narrations.map((narration, index) => ({
      id: `s${index}`,
      narration,
      visual: { type: "stock", query: "x" },
      duration: 8,
    })),
  });

const codes = (plan: ReturnType<typeof planWith>) =>
  critiquePlan(plan).map((note) => note.code);

describe("penghitung suku kata Indonesia", () => {
  it("diftong hanya di akhir kata", () => {
    expect(countSyllablesInWord("pandai")).toBe(2);
    expect(countSyllablesInWord("pulau")).toBe(2);
    // Di tengah kata gugus yang sama menyeberangi batas suku kata.
    expect(countSyllablesInWord("air")).toBe(2);
    expect(countSyllablesInWord("keajaiban")).toBe(5);
    expect(countSyllablesInWord("saudara")).toBe(4);
  });

  it("angka dihitung sebagai kata terucap", () => {
    expect(countSyllablesInWord("2024")).toBe(8);
    expect(countSyllablesInWord("ke-9")).toBe(3);
  });

  it("akronim tanpa vokal tetap terhitung", () => {
    expect(countSyllablesInWord("PLN")).toBe(1);
  });
});

describe("ukuran prosa", () => {
  it("burstiness tinggi untuk panjang kalimat yang bervariasi, rendah untuk yang seragam", () => {
    const seragam = proseStats(
      "Satu dua tiga empat lima enam. Tujuh lapan sembilan sepuluh sebelas duabelas. " +
        "Tiga belas empat belas lima belas enam belas tujuh delapan.",
    );
    const bervariasi = proseStats(
      "Dia berhenti. Selama dua belas tahun kota itu menolak menyebut namanya di depan umum. Lalu semuanya berubah.",
    );
    expect(bervariasi.burstiness).toBeGreaterThan(seragam.burstiness);
  });

  it("menghitung kalimat terpanjang dalam kata", () => {
    const stats = proseStats(
      "Pendek. Ini kalimat yang jelas lebih panjang dari yang pertama.",
    );
    expect(stats.sentences).toBe(2);
    expect(stats.longestSentenceWords).toBe(9);
  });
});

describe("kritik prosa", () => {
  const isi = (extra: string) =>
    `${extra} Candi itu berdiri di dataran tinggi yang dikelilingi gunung berapi aktif. ` +
    "Batunya disusun tanpa perekat sama sekali. Para pembangunnya menghitung sudut matahari.";

  it("menangkap frasa klise", () => {
    const found = codes(
      planWith([isi("Di era digital yang serba cepat ini semua berubah.")]),
    );
    expect(found).toContain("naskah-klise");
  });

  it("menangkap kata pengisi lisan yang ikut tertulis", () => {
    const found = codes(
      planWith([isi("Nah kayak gitu ceritanya menurut catatan lama.")]),
    );
    expect(found).toContain("naskah-pengisi");
  });

  it("menangkap kalimat kepanjangan untuk narasi lisan", () => {
    const panjang =
      "Bangunan itu didirikan pada abad kesembilan oleh dinasti yang menguasai dataran " +
      "tengah Jawa dan kemudian ditinggalkan selama berabad-abad sampai ditemukan kembali " +
      "oleh sebuah ekspedisi pada awal abad kesembilan belas.";
    expect(codes(planWith([isi(panjang)]))).toContain("kalimat-panjang");
  });

  it("naskah wajar TIDAK dituduh apa pun oleh detektor prosa", () => {
    const bersih = planWith([
      "Batu-batu itu disusun tanpa semen. Beratnya dua juta blok. Tidak ada satu pun yang bergeser.",
      "Sudut matahari menentukan letak setiap relief. Pembangunnya menghitung, bukan menebak.",
    ]);
    const proseCodes = codes(bersih).filter((code) =>
      [
        "naskah-klise",
        "naskah-ragu",
        "naskah-pengisi",
        "kalimat-panjang",
        "irama-datar",
      ].includes(code),
    );
    expect(proseCodes).toEqual([]);
  });

  it("naskah sangat pendek dilewati (data terlalu sedikit untuk statistik)", () => {
    const found = codes(planWith(["Nah gitu."]));
    expect(found).not.toContain("naskah-pengisi");
  });
});

describe("pencocokan frasa menghormati batas kata", () => {
  // Regresi: pencarian substring polos menuduh kata Indonesia paling umum —
  // "eh" di dalam "oleh", "sih" di "masih", "nah" di "tanah", "anu" di
  // "manusia". Detektor yang sering salah akan diabaikan orang.
  it.each([
    ["dibangun oleh dinasti Syailendra", "eh"],
    ["candi itu masih berdiri kokoh", "sih"],
    ["tumbuh di atas tanah vulkanik", "nah"],
    ["hasil karya manusia purba", "anu"],
    ["boleh jadi memang begitu", "eh"],
  ])("%s tidak dituduh memuat pengisi %s", (text) => {
    expect(phrasesFound(text, PENGISI_ID)).toEqual([]);
    expect(phraseDensity(text, PENGISI_ID)).toBe(0);
  });

  it("kata pengisi yang BERDIRI SENDIRI tetap tertangkap", () => {
    expect(phrasesFound("nah itu dia maksudnya", PENGISI_ID)).toContain("nah");
    expect(phrasesFound("ceritanya gitu sih", PENGISI_ID)).toEqual(
      expect.arrayContaining(["gitu", "sih"]),
    );
  });

  it("kata pagar sungguhan tetap tertangkap", () => {
    expect(phrasesFound("hasilnya secara relatif aman", HEDGING_ID)).toContain("relatif");
  });

  it("tanda hubung dihitung sebagai batas kata", () => {
    // "batu-batu" memuat "batu" dua kali sebagai kata utuh.
    expect(phraseDensity("batu-batu itu", ["batu"])).toBeGreaterThan(0);
  });
});

describe("batas scene adalah batas kalimat", () => {
  // Regresi: narasi scene sering ditulis tanpa titik di akhir. Kalau semua
  // digabung jadi satu string, kalimat menyatu lintas scene — panjang kalimat
  // menggelembung dan burstiness anjlok ke nol.
  const tanpaTitik = [
    "Candi ini dibangun pada abad kesembilan oleh dinasti Syailendra",
    "Batunya dua juta blok tanpa perekat semen sama sekali",
    "Lalu tertimbun abu vulkanik selama delapan abad lamanya",
  ];

  it("menghitung tiap scene sebagai kalimat tersendiri", () => {
    const stats = proseStatsOf(tanpaTitik);
    expect(stats.sentences).toBe(3);
    expect(stats.longestSentenceWords).toBe(9);
    expect(stats.burstiness).toBeGreaterThan(0);
  });

  it("tidak ada tuduhan kalimat-panjang palsu untuk narasi tanpa titik", () => {
    expect(codes(planWith(tanpaTitik))).not.toContain("kalimat-panjang");
  });

  it("proseStats satu teks tetap setara proseStatsOf berisi satu", () => {
    const one = "Pendek. Ini kalimat kedua yang lebih panjang sedikit.";
    expect(proseStats(one)).toEqual(proseStatsOf([one]));
  });
});

describe("pengulangan antar scene", () => {
  it("kemiripan leksikal terukur", () => {
    expect(
      lexicalOverlap(
        "Candi Borobudur dibangun dinasti Syailendra",
        "Candi Borobudur dibangun dinasti Syailendra",
      ),
    ).toBe(1);
    expect(lexicalOverlap("candi batu gunung", "kapal pelaut samudra")).toBe(0);
  });

  it("dua scene berurutan yang mengulang gagasan ditegur", () => {
    const found = codes(
      planWith([
        "Borobudur dibangun dinasti Syailendra memakai dua juta blok batu andesit.",
        "Dinasti Syailendra membangun Borobudur dengan dua juta blok batu andesit itu.",
        "Reliefnya bercerita tentang perjalanan seorang pangeran menuju pencerahan sempurna.",
      ]),
    );
    expect(found).toContain("narasi-berulang");
  });
});

describe("klip yang menggantung", () => {
  it("mendeteksi pembuka penghubung", () => {
    expect(opensWithConnector("Jadi begitulah ceritanya.")).toBe("jadi");
    expect(opensWithConnector("Tapi ada satu hal.")).toBe("tapi");
    expect(opensWithConnector("Borobudur berdiri di Jawa.")).toBeNull();
    // "Jaditahu" bukan "jadi" — batas kata dihormati.
    expect(opensWithConnector("Jaditahu maksudnya apa.")).toBeNull();
  });

  it("hanya format klip yang dikritik soal pembuka menggantung", () => {
    const narasi = [
      "Jadi yang tadi saya bilang itu ternyata terbukti setelah bertahun-tahun kemudian.",
      "Angkanya naik tiga kali lipat dalam satu dekade terakhir saja.",
      "Orang yang menertawakannya dulu sekarang memakai metode yang persis sama.",
    ];
    expect(codes(planWith(narasi, "klip"))).toContain("klip-menggantung");
    expect(codes(planWith(narasi, "bebas"))).not.toContain("klip-menggantung");
  });

  it("klip PENDEK tetap diperiksa (pemeriksaan ini tidak butuh statistik)", () => {
    // Regresi: gerbang 25 kata untuk ukuran sebaran sempat ikut mematikan
    // pemeriksaan per-scene — padahal klip pendek justru yang paling rawan.
    const pendek = ["Jadi itulah intinya semua", "Angkanya naik tiga kali lipat"];
    expect(codes(planWith(pendek, "klip"))).toContain("klip-menggantung");
  });
});

describe("hak pakai aset (ADR-0018)", () => {
  const withAsset = (license: string, source: string) =>
    parseScenePlan({
      version: 1,
      projectId: "uji-aset",
      meta: { title: "Uji Aset" },
      scenes: [
        {
          id: "s0",
          narration: "Batu itu disusun tanpa semen sama sekali.",
          clips: [{ id: "s0-k1", type: "image" }],
          duration: 6,
        },
      ],
      renderState: {
        narrationAudio: {},
        clipAssets: {
          "s0-k1": { file: "assets/a.mp4", kind: "video", source, license },
        },
      },
    });

  it("aset bertanda PERIKSA HAK PAKAI ditegur sebagai perhatian", () => {
    const plan = withAsset(
      "GIPHY API — konten unggahan pihak ketiga; PERIKSA HAK PAKAI sebelum publikasi",
      "giphy",
    );
    const note = critiquePlan(plan).find((n) => n.code === "aset-hak-pakai");
    expect(note?.level).toBe("perhatian");
    expect(note?.message).toContain("giphy");
    expect(note?.sceneId).toBe("s0");
  });

  it("aset berlisensi jelas TIDAK ditegur", () => {
    const plan = withAsset("Pexels License", "pexels");
    expect(critiquePlan(plan).map((n) => n.code)).not.toContain("aset-hak-pakai");
  });

  it("satu catatan saja walau banyak aset, dengan sumber diurut", () => {
    const plan = parseScenePlan({
      version: 1,
      projectId: "uji-aset-2",
      meta: { title: "Uji Aset" },
      scenes: [
        {
          id: "a",
          narration: "Satu.",
          clips: [{ id: "a-k1", type: "image" }],
          duration: 4,
        },
        {
          id: "b",
          narration: "Dua.",
          clips: [{ id: "b-k1", type: "image" }],
          duration: 4,
        },
      ],
      renderState: {
        narrationAudio: {},
        clipAssets: {
          "a-k1": {
            file: "x.mp4",
            kind: "video",
            source: "tenor",
            license: "Tenor — PERIKSA HAK PAKAI",
          },
          "b-k1": {
            file: "y.mp4",
            kind: "video",
            source: "giphy",
            license: "GIPHY — PERIKSA HAK PAKAI",
          },
        },
      },
    });
    const notes = critiquePlan(plan).filter((n) => n.code === "aset-hak-pakai");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toContain("2 aset dari giphy, tenor");
  });

  /**
   * Regresi. Stiker GIPHY/Tenor masuk lewat `graphicAssets`, bukan
   * `clipAssets` — justru jalur yang paling sering dipakai. Pemeriksaan
   * yang hanya membaca aset scene karenanya diam persis pada kasus yang paling
   * perlu ditegur, dan diamnya terlihat seperti "aman".
   */
  const withGraphic = (license: string) =>
    parseScenePlan({
      version: 1,
      projectId: "uji-stiker",
      meta: { title: "Uji Stiker" },
      scenes: [
        {
          id: "s0",
          narration: "Satu kalimat saja.",
          clips: [{ id: "s0-k1", type: "solid" }],
          duration: 5,
          graphics: [{ id: "g1", ref: "giphy:abc" }],
        },
      ],
      renderState: {
        narrationAudio: {},
        clipAssets: {},
        graphicAssets: {
          g1: {
            file: "assets/stickers/g1.webp",
            kind: "image",
            source: "giphy",
            license,
          },
        },
        sfxAssets: {},
      },
    });

  it("stiker yang dipasang sebagai grafis ikut ditegur", () => {
    const note = critiquePlan(withGraphic("GIPHY — PERIKSA HAK PAKAI")).find(
      (n) => n.code === "aset-hak-pakai",
    );
    expect(note?.level).toBe("perhatian");
    // sceneId menunjuk scene PEMILIK grafis, bukan id grafisnya.
    expect(note?.sceneId).toBe("s0");
  });

  it("grafis berlisensi jelas tidak ditegur", () => {
    expect(critiquePlan(withGraphic("MIT")).map((n) => n.code)).not.toContain(
      "aset-hak-pakai",
    );
  });

  it("entri grafis yatim tidak ditegur — ia tidak ikut render", () => {
    const plan = parseScenePlan({
      version: 1,
      projectId: "uji-yatim",
      meta: { title: "Uji Yatim" },
      scenes: [
        {
          id: "s0",
          narration: "Satu kalimat.",
          clips: [{ id: "s0-k1", type: "solid" }],
          duration: 5,
        },
      ],
      renderState: {
        narrationAudio: {},
        clipAssets: {},
        graphicAssets: {
          "g-terhapus": {
            file: "assets/stickers/g1.webp",
            kind: "image",
            source: "giphy",
            license: "GIPHY — PERIKSA HAK PAKAI",
          },
        },
        sfxAssets: {},
      },
    });
    expect(critiquePlan(plan).map((n) => n.code)).not.toContain("aset-hak-pakai");
  });

  it("efek suara bertanda ikut ditegur, dengan scene cue-nya", () => {
    const plan = parseScenePlan({
      version: 1,
      projectId: "uji-sfx",
      meta: { title: "Uji SFX" },
      scenes: [
        {
          id: "s0",
          narration: "Satu kalimat.",
          clips: [{ id: "s0-k1", type: "solid" }],
          duration: 5,
        },
      ],
      audio: {
        voice: { provider: "silence", voiceId: "x", speed: 1 },
        sfx: [{ id: "cue-1", assetId: "x:1", sceneId: "s0", atSec: 0 }],
      },
      renderState: {
        narrationAudio: {},
        clipAssets: {},
        graphicAssets: {},
        sfxAssets: {
          "cue-1": {
            file: "assets/sfx/a.mp3",
            kind: "audio",
            source: "pustaka-x",
            license: "PERIKSA HAK PAKAI",
          },
        },
      },
    });
    const note = critiquePlan(plan).find((n) => n.code === "aset-hak-pakai");
    expect(note?.sceneId).toBe("s0");
    expect(note?.message).toContain("pustaka-x");
  });
});
