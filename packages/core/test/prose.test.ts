import { describe, expect, it } from "vitest";
import {
  countSyllablesInWord,
  critiquePlan,
  lexicalOverlap,
  opensWithConnector,
  parseScenePlan,
  proseStats,
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
});
