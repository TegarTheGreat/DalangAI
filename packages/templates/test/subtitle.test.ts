import { parseScenePlan, type ScenePlanInput } from "@dalang/core";
import { describe, expect, it } from "vitest";
import {
  buildSubtitleCues,
  SUBTITLE_MAX_CHARS_PER_LINE,
  SUBTITLE_MIN_MS,
  timestamp,
  toSrt,
  toVtt,
  wrapSubtitleText,
} from "../src/subtitle";

/**
 * Berkas subtitle (ADR-0039).
 *
 * Yang dijaga di sini adalah hal-hal yang salahnya baru ketahuan SETELAH
 * diunggah: cap waktu berformat salah (berkas ditolak mentah-mentah), kartu
 * berdurasi nol atau bertindihan (tampil kacau), dan waktu yang melenceng
 * karena transisi membuat scene bertumpuk.
 */

const plan = (mutate?: (input: ScenePlanInput) => void) => {
  const input: ScenePlanInput = {
    version: 2,
    projectId: "uji-subtitle",
    meta: {
      title: "Uji Subtitle",
      aspectRatio: "16:9",
      language: "id",
      stylePreset: "documentary-01",
    },
    audio: {},
    scenes: [
      {
        id: "sc-1",
        narration: "Kalimat pertama yang cukup panjang untuk jadi satu kartu.",
        clips: [{ id: "sc-1-k1", type: "solid" }],
        duration: 6,
        transition: { type: "cross-fade", durationFrames: 20 },
      },
      {
        id: "sc-2",
        narration: "Kalimat kedua menyusul sesudahnya.",
        clips: [{ id: "sc-2-k1", type: "solid" }],
        duration: 5,
      },
    ],
  };
  mutate?.(input);
  return parseScenePlan(input);
};

describe("timestamp", () => {
  it("SRT memakai koma, WebVTT memakai titik — dan itu bukan selera", () => {
    // Pembaca SRT menolak berkas yang memakai titik; pembaca VTT menolak yang
    // memakai koma. Satu karakter memutuskan berkasnya terbaca atau tidak.
    expect(timestamp(3_661_500, ",")).toBe("01:01:01,500");
    expect(timestamp(3_661_500, ".")).toBe("01:01:01.500");
  });

  it("nol, pembulatan, dan angka negatif tidak menghasilkan bentuk aneh", () => {
    expect(timestamp(0, ",")).toBe("00:00:00,000");
    expect(timestamp(999.6, ",")).toBe("00:00:01,000");
    expect(timestamp(-50, ",")).toBe("00:00:00,000");
  });
});

describe("wrapSubtitleText", () => {
  it("teks pendek tetap satu baris", () => {
    expect(wrapSubtitleText("Halo dunia")).toEqual(["Halo dunia"]);
  });

  it("teks panjang dipatah SEIMBANG, bukan baris pertama penuh", () => {
    // Baris pertama penuh dan baris kedua berisi satu kata adalah bentuk yang
    // paling sering membuat mata melompat balik.
    const lines = wrapSubtitleText(
      "Kalimat yang cukup panjang sehingga tidak muat dalam satu baris subtitle",
    );
    expect(lines).toHaveLength(2);
    const selisih = Math.abs((lines[0]?.length ?? 0) - (lines[1]?.length ?? 0));
    expect(selisih).toBeLessThan(SUBTITLE_MAX_CHARS_PER_LINE / 2);
    expect(lines.join(" ")).toContain("subtitle");
  });

  it("satu kata sangat panjang dibiarkan utuh, bukan dipotong di tengah", () => {
    const panjang = "x".repeat(80);
    expect(wrapSubtitleText(panjang)).toEqual([panjang]);
  });
});

describe("buildSubtitleCues", () => {
  it("menghasilkan kartu yang urut dan tidak bertindihan", () => {
    const cues = buildSubtitleCues(plan());
    expect(cues.length).toBeGreaterThan(0);
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (!cue) continue;
      // Durasi nol dibaca sebagian pemutar sebagai berkas rusak.
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
      const next = cues[i + 1];
      if (next) {
        expect(next.startMs).toBeGreaterThanOrEqual(cue.startMs);
        expect(cue.endMs).toBeLessThan(next.startMs);
      }
    }
  });

  it("kartu pendek DIPANJANGKAN ujungnya, bukan dimajukan awalnya", () => {
    // Memajukan awal kartu akan menampilkan teks sebelum kalimatnya
    // diucapkan — cacat yang terlihat oleh setiap penonton.
    const cues = buildSubtitleCues(plan());
    const pertama = cues[0];
    const kedua = cues[1];
    if (!pertama) throw new Error("tidak ada kartu");
    // Yang tidak dibatasi kartu berikutnya harus mencapai durasi minimum.
    if (!kedua || kedua.startMs - pertama.startMs > SUBTITLE_MIN_MS + 1) {
      expect(pertama.endMs - pertama.startMs).toBeGreaterThanOrEqual(SUBTITLE_MIN_MS);
    }
    expect(pertama.startMs).toBeGreaterThanOrEqual(0);
  });

  it("waktunya memakai tata letak RENDER, bukan jumlah durasi scene", () => {
    // Transisi membuat scene bertumpuk: jumlah durasi (11 dtk) lebih panjang
    // daripada videonya. Subtitle yang dihitung dari jumlah durasi melenceng
    // makin jauh tiap transisi.
    const cues = buildSubtitleCues(plan());
    const terakhir = cues[cues.length - 1];
    if (!terakhir) throw new Error("tidak ada kartu");
    const jumlahDurasi = 11_000;
    expect(terakhir.endMs).toBeLessThan(jumlahDurasi);
  });

  it("scene yang caption layarnya MATI tetap dapat subtitle", () => {
    // Mematikan caption bakar adalah keputusan tampilan; alasan paling sering
    // melakukannya justru karena berkas subtitle akan diunggah terpisah.
    const mati = buildSubtitleCues(
      plan((input) => {
        for (const scene of input.scenes) {
          scene.caption = {
            enabled: false,
            style: "klasik",
            size: "m",
            position: "bottom",
          };
        }
      }),
    );
    expect(mati.length).toBeGreaterThan(0);
  });

  it("potongan karena kelebaran mendarat di batas anak kalimat, bukan di tengah frasa", () => {
    // Tanpa aturan ini potongannya jatuh di tempat karakter ke-84 kebetulan
    // mendarat: "...candi Buddha" / "terbesar yang pernah dibangun manusia."
    // Mata membaca kartu pertama sebagai kalimat selesai, lalu harus
    // mengoreksi diri di kartu berikutnya.
    const cues = buildSubtitleCues(
      plan((input) => {
        input.scenes[0]!.narration =
          "Di jantung Pulau Jawa berdiri mahakarya abad kesembilan, Borobudur, " +
          "candi Buddha terbesar yang pernah dibangun manusia.";
        input.scenes[0]!.duration = 12;
      }),
    );
    expect(cues.length).toBeGreaterThan(1);
    // Kartu pertama dipotong karena kelebaran, dan harus mendarat di koma —
    // bukan di tempat karakter ke-84 kebetulan jatuh.
    const pertama = cues[0]?.lines.join(" ").trimEnd() ?? "";
    expect(pertama.endsWith(",")).toBe(true);
    // Dan kartu berikutnya karena itu berdiri sendiri sebagai frasa utuh.
    expect(cues[1]?.lines.join(" ")).toContain("Borobudur, candi Buddha");
  });

  it("teks tanpa satu pun tanda baca tetap dipotong, bukan jadi satu kartu raksasa", () => {
    // Batas fiturnya: kalau tidak ada batas anak kalimat di jendela
    // pencarian, potongannya memang jatuh di kelebaran. Yang tidak boleh
    // terjadi adalah kartu yang tumbuh tanpa batas.
    const cues = buildSubtitleCues(
      plan((input) => {
        input.scenes[0]!.narration = `${"kata ".repeat(40)}akhir.`;
        input.scenes[0]!.duration = 20;
      }),
    );
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.lines.join(" ").length).toBeLessThanOrEqual(
        SUBTITLE_MAX_CHARS_PER_LINE * 2 + 8,
      );
    }
  });

  it("plan tanpa narasi menghasilkan berkas kosong, bukan kartu kosong", () => {
    const kosong = buildSubtitleCues(
      plan((input) => {
        for (const scene of input.scenes) scene.narration = "";
      }),
    );
    expect(kosong).toEqual([]);
  });
});

describe("format berkas", () => {
  it("SRT bernomor urut mulai 1 dan dipisah baris kosong", () => {
    const srt = toSrt(buildSubtitleCues(plan()));
    expect(srt.startsWith("1\n")).toBe(true);
    expect(srt).toContain(" --> ");
    expect(srt).toContain(",");
    // Nomor kedua harus ada dan berurutan.
    expect(srt).toMatch(/\n\n2\n/);
  });

  it("VTT diawali WEBVTT — tanpa itu berkasnya bukan VTT", () => {
    const vtt = toVtt(buildSubtitleCues(plan()));
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain(" --> ");
    // Cap waktu VTT tidak boleh memakai koma sama sekali.
    const stamps = vtt.match(/\d\d:\d\d:\d\d[.,]\d\d\d/g) ?? [];
    expect(stamps.length).toBeGreaterThan(0);
    expect(stamps.every((stamp) => stamp.includes("."))).toBe(true);
  });

  it("berkas kosong tetap berkas yang sah", () => {
    expect(toSrt([])).toBe("");
    expect(toVtt([])).toBe("WEBVTT\n\n");
  });
});
