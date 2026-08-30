import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_SETTINGS,
  ENCODE_QUALITIES,
  encoderArgs,
  extensionFor,
  resolveExportSettings,
  VIDEO_FORMATS,
  VIDEO_RESOLUTIONS,
} from "../src";

describe("pengaturan ekspor (ADR-0014)", () => {
  it("profil = makro default; override menimpa per field", () => {
    expect(resolveExportSettings("draft")).toEqual({
      format: "mp4",
      resolution: 540,
      quality: "cepat",
    });
    expect(resolveExportSettings("final", { format: "webm" })).toEqual({
      format: "webm",
      resolution: 1080,
      quality: "seimbang",
    });
  });

  it("skala mengikuti resolusi (dasar 1080)", () => {
    expect(
      encoderArgs({ format: "mp4", resolution: 540, quality: "cepat" }).scale,
    ).toBeCloseTo(0.5);
    expect(
      encoderArgs({ format: "mp4", resolution: 720, quality: "cepat" }).scale,
    ).toBeCloseTo(2 / 3);
    expect(encoderArgs({ format: "mp4", resolution: 1080, quality: "cepat" }).scale).toBe(
      1,
    );
  });

  it("mp4 -> h264+aac, mutu memetakan crf/preset/bitrate", () => {
    const cepat = encoderArgs({ format: "mp4", resolution: 1080, quality: "cepat" });
    const terbaik = encoderArgs({
      format: "mp4",
      resolution: 1080,
      quality: "terbaik",
    });
    expect(cepat).toMatchObject({
      codec: "h264",
      audioCodec: "aac",
      crf: 23,
      x264Preset: "veryfast",
      audioBitrate: "128k",
    });
    expect(terbaik).toMatchObject({
      codec: "h264",
      crf: 15,
      x264Preset: "slow",
      audioBitrate: "192k",
    });
    expect(terbaik.crf).toBeLessThan(cepat.crf ?? Number.NaN);
  });

  it("webm -> vp9+opus dengan skala CRF-nya sendiri; tanpa x264Preset", () => {
    const args = encoderArgs({ format: "webm", resolution: 720, quality: "seimbang" });
    expect(args).toMatchObject({ codec: "vp9", audioCodec: "opus", crf: 32 });
    expect(args.x264Preset).toBeUndefined();
    expect(args.proResProfile).toBeUndefined();
  });

  it("mov -> prores+pcm-16 lewat profil, tanpa CRF", () => {
    const args = encoderArgs({ format: "mov", resolution: 1080, quality: "terbaik" });
    expect(args).toMatchObject({
      codec: "prores",
      audioCodec: "pcm-16",
      proResProfile: "hq",
    });
    expect(args.crf).toBeUndefined();
    expect(
      encoderArgs({ format: "mov", resolution: 1080, quality: "cepat" }).proResProfile,
    ).toBe("proxy");
  });

  it("semua kombinasi menghasilkan argumen konsisten dengan codec-nya", () => {
    for (const format of VIDEO_FORMATS) {
      for (const resolution of VIDEO_RESOLUTIONS) {
        for (const quality of ENCODE_QUALITIES) {
          const args = encoderArgs({ format, resolution, quality });
          expect(args.scale).toBeGreaterThan(0);
          expect(args.scale).toBeLessThanOrEqual(1);
          if (args.codec === "prores") {
            expect(args.crf).toBeUndefined();
            expect(args.proResProfile).toBeDefined();
          } else {
            expect(args.crf).toBeDefined();
          }
          if (args.codec !== "h264") expect(args.x264Preset).toBeUndefined();
        }
      }
    }
  });

  it("hevc -> h265+aac dengan skala CRF bergeser, ekstensi tetap mp4", () => {
    const args = encoderArgs({ format: "hevc", resolution: 1080, quality: "seimbang" });
    expect(args).toMatchObject({ codec: "h265", audioCodec: "aac", crf: 23 });
    expect(args.x264Preset).toBeUndefined();
    expect(extensionFor("hevc")).toBe("mp4");
  });

  it("ekstensi file per format", () => {
    expect(extensionFor("mp4")).toBe("mp4");
    expect(extensionFor("webm")).toBe("webm");
    expect(extensionFor("mov")).toBe("mov");
    expect(Object.keys(DEFAULT_EXPORT_SETTINGS)).toEqual(["draft", "final"]);
  });
});
