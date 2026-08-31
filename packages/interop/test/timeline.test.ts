import { computeFrameLayout } from "@dalang/templates/layout";
import { describe, expect, it } from "vitest";
import { buildEditTimeline, type EditClip } from "../src/timeline";
import { makePlan, tempProject } from "./helpers";

const clipsOf = (items: { kind: string }[]): EditClip[] =>
  items.filter((item): item is EditClip => item.kind === "clip");

describe("garis waktu interop", () => {
  it("klip video adu-tumpul menutup seluruh durasi tanpa celah maupun tumpang-tindih", () => {
    // Sifat yang paling mudah rusak diam-diam: satu frame yang salah di satu
    // batas menggeser SEMUA yang sesudahnya, dan hasilnya baru kelihatan
    // setelah dibuka di editor lain.
    const plan = makePlan();
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    const video = timeline.tracks.find((track) => track.kind === "video");

    let cursor = 0;
    for (const item of video?.items ?? []) {
      expect(item.startFrame).toBe(cursor);
      cursor += item.durationFrames;
    }
    expect(cursor).toBe(timeline.totalFrames);
    expect(timeline.totalFrames).toBe(computeFrameLayout(plan).totalFrames);
  });

  it("potongan jatuh di TENGAH tumpang-tindih transisi, bukan di awalnya", () => {
    // Titik itu yang dianggap "pindah scene" oleh activeSceneIndex; memakai
    // awal tumpang-tindih akan menggeser ekspor setengah transisi terhadap
    // video yang dirender Dalang sendiri.
    const plan = makePlan();
    const project = tempProject(plan);
    const layout = computeFrameLayout(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    const video = timeline.tracks.find((track) => track.kind === "video");

    const firstEnd = video?.items[0]?.durationFrames ?? 0;
    const expected = Math.round(
      (layout.sceneStarts[1] ?? 0) + (layout.boundaryFrames[0] ?? 0) / 2,
    );
    expect(firstEnd).toBe(expected);
  });

  it("scene tanpa aset jadi gap, bukan klip yang menunjuk berkas hantu", () => {
    const plan = makePlan();
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    const video = timeline.tracks.find((track) => track.kind === "video");

    expect(video?.items[0]?.kind).toBe("gap");
    expect(timeline.notes.map((note) => note.code)).toContain("scene-tanpa-aset");
  });

  it("titik masuk video ikut, dan hanya untuk video", () => {
    const plan = makePlan();
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    const clips = clipsOf(timeline.tracks[0]?.items ?? []);

    const batu = clips.find((clip) => clip.sceneId === "sc-batu");
    const peta = clips.find((clip) => clip.sceneId === "sc-peta");
    expect(batu?.sourceStartSec).toBe(4);
    // Gambar diam tidak punya titik masuk; membawa trimStartSec ke sana akan
    // memotong gambar yang tidak bisa dipotong.
    expect(peta?.sourceStartSec).toBe(0);
    expect(peta?.sourceDurationSec).toBeNull();
  });

  it("transisi none tidak menghasilkan peralihan, slide ditandai bukan dissolve", () => {
    const plan = makePlan();
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    const video = timeline.tracks.find((track) => track.kind === "video");

    // 3 scene => paling banyak 2 batas; scene terakhir "none" tidak dihitung
    // karena tidak ada scene sesudahnya.
    expect(video?.transitions).toHaveLength(2);
    expect(video?.transitions[0]?.dissolve).toBe(true);
    expect(video?.transitions[1]?.dalangType).toBe("slide-left");
    expect(video?.transitions[1]?.dissolve).toBe(false);
  });

  it("narasi ditaruh setelah lead-in, bukan di detik nol scene", () => {
    const plan = makePlan();
    const project = tempProject(plan);
    const layout = computeFrameLayout(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    const narasi = timeline.tracks.find((track) => track.name.startsWith("Narasi"));
    const first = clipsOf(narasi?.items ?? [])[0];

    // NARRATION_LEAD_IN_SEC = 0.25 detik pada 30fps = 7 frame (dibulatkan).
    expect(first?.startFrame).toBe((layout.sceneStarts[1] ?? 0) + 8);
  });

  it("audio yang bertindihan dipecah ke trek kedua, bukan ditumpuk", () => {
    // Scene pendek dengan narasi panjang membuat dua narasi berbunyi
    // bersamaan — sah di Dalang, mustahil di satu trek NLE.
    const plan = makePlan((input) => {
      input.scenes[1]!.duration = 1;
      input.scenes[2]!.duration = 1;
      input.renderState!.narrationAudio!["sc-batu"] = {
        file: "audio/sc-batu.wav",
        durationSec: 9,
      };
    });
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    const narasi = timeline.tracks.filter((track) => track.name.startsWith("Narasi"));
    expect(narasi.length).toBe(2);
    expect(narasi[0]?.name).toBe("Narasi 1");
  });

  it("musik pustaka dilewati dengan alasan kalau folder aset situs tidak diberi", () => {
    const plan = makePlan();
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    expect(timeline.tracks.some((track) => track.name === "Musik")).toBe(false);
    expect(timeline.notes.map((note) => note.code)).toContain(
      "musik-pustaka-tanpa-folder",
    );
  });

  it("musik pustaka ikut kalau folder aset situs diberi, dengan catatan datar", () => {
    const plan = makePlan();
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, {
      planPath: project.planPath,
      siteAssetDir: "/situs/public",
    });
    const musik = timeline.tracks.find((track) => track.name === "Musik");
    expect(musik).toBeDefined();
    expect(musik?.items[0]?.durationFrames).toBe(timeline.totalFrames);
    expect(timeline.notes.map((note) => note.code)).toContain("musik-datar");
  });

  it("efek suara tanpa panjang tercatat DILEWATI, bukan dikarang panjangnya", () => {
    const plan = makePlan((input) => {
      // Field-nya dihapus, bukan di-set undefined: yang diuji adalah aset yang
      // memang tidak pernah melaporkan panjangnya.
      (input.renderState!.sfxAssets!["sfx-1"] as Record<string, unknown>).durationSec =
        undefined;
    });
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    expect(timeline.tracks.some((track) => track.name.startsWith("Efek"))).toBe(false);
    expect(timeline.notes.map((note) => note.code)).toContain("sfx-tanpa-durasi");
  });

  it("melaporkan SEMUA yang tidak ikut menyeberang", () => {
    // Laporan ini adalah fiturnya. Ekspor yang diam soal caption, teks, dan
    // Ken Burns membuat orang mengira Dalang yang rusak saat membuka hasilnya.
    const plan = makePlan();
    const project = tempProject(plan);
    const codes = buildEditTimeline(plan, { planPath: project.planPath }).notes.map(
      (note) => note.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining(["caption", "overlay", "gerak-filter", "scene-tanpa-aset"]),
    );
  });

  it("URL aset absolut dan dihitung dari folder plan", () => {
    const plan = makePlan();
    const project = tempProject(plan);
    const timeline = buildEditTimeline(plan, { planPath: project.planPath });
    const clip = clipsOf(timeline.tracks[0]?.items ?? [])[0];
    expect(clip?.url.startsWith("file:///")).toBe(true);
    expect(clip?.url).toContain("/media/candi.mp4");
  });
});
