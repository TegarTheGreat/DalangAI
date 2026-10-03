import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseScenePlan,
  type ScenePlanInput,
  TYPEWRITER_FRAMES_PER_CHAR,
} from "@dalang/core";
import { describe, expect, it } from "vitest";
import { computeFrameLayout, FPS } from "../src/layout";
import { templatesPublicDir } from "../src/paths";
import {
  bersuaraKetik,
  keyGain,
  keyVariant,
  placeSfxCues,
  placeTypingSounds,
  TYPING_KEYS,
} from "../src/sfx";
import { isSpacer, splitForAnim, typewriterRevealFrame } from "../src/typewriter";

/**
 * Bunyi ketik (ADR-0043).
 *
 * Yang dijaga bukan "ada bunyinya", melainkan JATUHNYA: ketukan ke-i harus
 * berada di bingkai yang sama dengan huruf ke-i, sebab simpangan tiga bingkai
 * antara huruf dan bunyinya terdengar sebagai keyboard yang tertinggal.
 * Pengukuran pada video jadi ada di gerbang `gate:ketik`; di sini angkanya.
 */

const plan = (
  mutate?: (input: ScenePlanInput) => void,
  teks: Partial<{
    content: string;
    anim: string;
    sound: string;
    startFrac: number;
    endFrac: number;
    soundVolume: number;
  }> = {},
) => {
  const input: ScenePlanInput = {
    version: 2,
    projectId: "uji-ketik",
    meta: {
      title: "Uji",
      aspectRatio: "16:9",
      language: "id",
      stylePreset: "documentary-01",
    },
    audio: {},
    scenes: [
      {
        id: "sc-0",
        narration: "",
        duration: 2,
        clips: [{ id: "sc-0-k1", type: "solid" }],
      },
      {
        id: "sc-1",
        narration: "",
        duration: 5,
        clips: [{ id: "sc-1-k1", type: "solid" }],
        texts: [
          {
            id: "t-1",
            content: "Halo dunia",
            anim: "typewriter",
            sound: "ketik",
            startFrac: 0.1,
            endFrac: 1,
            ...teks,
          } as never,
        ],
      },
    ],
    renderState: { narrationAudio: {}, clipAssets: {} },
  };
  mutate?.(input);
  const parsed = parseScenePlan(input);
  return { plan: parsed, layout: computeFrameLayout(parsed) };
};

describe("penempatan ketukan", () => {
  it("ketukan ke-i jatuh tepat di bingkai huruf ke-i tampil", () => {
    const { plan: p, layout } = plan();
    const keys = placeTypingSounds(p, layout, FPS);
    const sceneStart = layout.sceneStarts[1] ?? 0;
    const mulai = Math.round(0.1 * (layout.sceneFrames[1] ?? 0));
    expect(keys).toHaveLength(Array.from("Halo dunia").length);
    keys.forEach((key, i) => {
      expect(key.fromFrame).toBe(sceneStart + mulai + typewriterRevealFrame(i));
    });
    // Jeda antar ketukan SAMA dengan jeda animasinya: tidak ada angka kedua.
    expect(keys[1]!.fromFrame - keys[0]!.fromFrame).toBe(TYPEWRITER_FRAMES_PER_CHAR);
  });

  it("spasi berbunyi spasi, huruf berbunyi huruf, dan semuanya aset situs", () => {
    const { plan: p, layout } = plan();
    const keys = placeTypingSounds(p, layout, FPS);
    const pieces = splitForAnim("Halo dunia", "typewriter");
    keys.forEach((key, i) => {
      expect(key.bundled).toBe(true);
      if (isSpacer(pieces[i]!)) {
        expect(key.file).toBe(TYPING_KEYS.spasi.file);
      } else {
        expect(TYPING_KEYS.huruf.map((h) => h.file)).toContain(key.file);
      }
    });
  });

  it("varian huruf bergantian: tidak pernah sama dengan ketukan huruf sebelumnya", () => {
    const { plan: p, layout } = plan(undefined, {
      content: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const huruf = placeTypingSounds(p, layout, FPS).map((key) => key.file);
    for (let i = 1; i < huruf.length; i++) expect(huruf[i]).not.toBe(huruf[i - 1]);
  });

  it("deterministik: dua kali hitung menghasilkan daftar yang sama persis", () => {
    const { plan: p, layout } = plan();
    expect(placeTypingSounds(p, layout, FPS)).toEqual(placeTypingSounds(p, layout, FPS));
    expect(keyVariant(3, "a", -1)).toBe(keyVariant(3, "a", -1));
    expect(keyGain(5)).toBe(keyGain(5));
  });

  it("volume mengikuti soundVolume dengan variasi kecil di bawahnya, tak pernah melebihi 1", () => {
    const { plan: p, layout } = plan(undefined, { soundVolume: 1 });
    for (const key of placeTypingSounds(p, layout, FPS)) {
      expect(key.volume).toBeLessThanOrEqual(1);
      expect(key.volume).toBeGreaterThan(0.8);
    }
    const pelan = plan(undefined, { soundVolume: 0.3 });
    for (const key of placeTypingSounds(pelan.plan, pelan.layout, FPS)) {
      expect(key.volume).toBeLessThanOrEqual(0.3);
    }
  });

  it("tiap ketukan dibatasi umurnya: bukan 40 elemen audio hidup sampai video habis", () => {
    const { plan: p, layout } = plan();
    for (const key of placeTypingSounds(p, layout, FPS)) {
      expect(key.durationInFrames).toBeGreaterThan(0);
      expect(key.durationInFrames).toBeLessThan(10);
    }
  });
});

describe("kapan TIDAK berbunyi", () => {
  it("sound none, atau animasi bukan typewriter, tidak menghasilkan ketukan", () => {
    for (const teks of [{ sound: "none" }, { anim: "pop" }, { anim: "fade" }]) {
      const { plan: p, layout } = plan(undefined, teks);
      expect(placeTypingSounds(p, layout, FPS)).toEqual([]);
    }
    expect(bersuaraKetik({ sound: "ketik", anim: "pop" })).toBe(false);
    expect(bersuaraKetik({ sound: "ketik", anim: "typewriter" })).toBe(true);
  });

  it("huruf yang baru akan tampil SETELAH teksnya hilang tidak berbunyi", () => {
    // Jendela 0,1-0,3 dari scene 5 dtk = 0,5 dtk (15 bingkai): hanya huruf yang
    // sempat tampil (bingkai 0,3,6,9,12,15 relatif mulai) yang boleh berbunyi.
    const { plan: p, layout } = plan(undefined, {
      content: "Kalimat ini jauh lebih panjang daripada jendelanya",
      startFrac: 0.1,
      endFrac: 0.3,
    });
    const keys = placeTypingSounds(p, layout, FPS);
    const sceneStart = layout.sceneStarts[1] ?? 0;
    const frames = layout.sceneFrames[1] ?? 0;
    const akhir = sceneStart + Math.round(0.3 * frames);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThan(
      Array.from("Kalimat ini jauh lebih panjang daripada jendelanya").length,
    );
    for (const key of keys) expect(key.fromFrame).toBeLessThanOrEqual(akhir);
  });

  it("tanpa teks bersuara, placeSfxCues persis seperti sebelumnya (tidak ada ketukan nyasar)", () => {
    const { plan: p, layout } = plan(undefined, { sound: "none" });
    expect(placeSfxCues(p, layout, FPS)).toEqual([]);
  });
});

describe("terpasang di jalur efek suara yang sama", () => {
  it("placeSfxCues membawa ketukan, supaya SEMUA preset yang memutar efek suara ikut berbunyi", () => {
    const { plan: p, layout } = plan();
    const cues = placeSfxCues(p, layout, FPS);
    expect(cues.length).toBe(placeTypingSounds(p, layout, FPS).length);
    expect(cues.every((cue) => cue.cueId.startsWith("ketik:sc-1:t-1:"))).toBe(true);
  });

  it("cue efek suara biasa dan ketukan hidup berdampingan", () => {
    const { plan: p, layout } = plan((input) => {
      input.audio = {
        ...input.audio,
        sfx: [
          {
            id: "fx-1",
            assetId: "pustaka:ding",
            sceneId: "sc-0",
            atSec: 0.5,
            volume: 0.5,
          },
        ],
      };
    });
    const ids = placeSfxCues(p, layout, FPS).map((cue) => cue.cueId);
    expect(ids).toContain("fx-1");
    expect(ids.some((id) => id.startsWith("ketik:"))).toBe(true);
  });
});

describe("berkas ketukan", () => {
  const wav = (file: string) => {
    const bytes = readFileSync(join(templatesPublicDir, file));
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    const rate = bytes.readUInt32LE(24);
    const channels = bytes.readUInt16LE(22);
    const dataBytes = bytes.readUInt32LE(40);
    return { rate, channels, durationSec: dataBytes / 2 / channels / rate, bytes };
  };

  it("kelima berkas ada, mono, dan sepanjang yang diumumkan TYPING_KEYS", () => {
    for (const key of [...TYPING_KEYS.huruf, TYPING_KEYS.spasi]) {
      const info = wav(key.file);
      expect(info.channels).toBe(1);
      expect(info.durationSec).toBeCloseTo(key.durationSec, 2);
    }
  });

  it("puncaknya dinormalisasi seperti bunyi pustaka lain (-1 dBFS), dan tiap varian BERBEDA", () => {
    const isi = new Set<string>();
    for (const key of [...TYPING_KEYS.huruf, TYPING_KEYS.spasi]) {
      const { bytes } = wav(key.file);
      let puncak = 0;
      for (let i = 44; i + 1 < bytes.length; i += 2) {
        puncak = Math.max(puncak, Math.abs(bytes.readInt16LE(i)));
      }
      expect(20 * Math.log10(puncak / 32768)).toBeCloseTo(-1, 0);
      isi.add(bytes.subarray(44).toString("base64"));
    }
    // Empat varian yang identik akan terdengar sebagai satu sampel diulang.
    expect(isi.size).toBe(5);
  });
});
