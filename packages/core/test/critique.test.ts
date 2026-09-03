import { describe, expect, it } from "vitest";
import { critiquePlan, formatDirectorNotes, parseScenePlan } from "../src";

/** Plan minimal yang valid; setiap test memodifikasi salinannya. */
const basePlan = () =>
  parseScenePlan({
    version: 1,
    projectId: "uji-kritik",
    meta: { title: "Uji Kritik" },
    scenes: [
      {
        id: "sc-title",
        narration: "Pembuka.",
        clips: [{ id: "sc-title-k1", type: "template-anim", variant: "title" }],
        duration: 4,
      },
      {
        id: "sc-a",
        narration: "Narasi singkat.",
        clips: [{ id: "sc-a-k1", type: "stock", query: "temple", motion: "kenburns-in" }],
        duration: 6,
        transition: { type: "slide-up", durationFrames: 12 },
      },
      {
        id: "sc-b",
        narration: "Narasi lain.",
        clips: [{ id: "sc-b-k1", type: "stock", query: "stone", motion: "kenburns-out" }],
        duration: 6,
      },
      {
        id: "sc-outro",
        narration: "",
        clips: [{ id: "sc-outro-k1", type: "template-anim", variant: "outro" }],
        duration: 4,
      },
    ],
  });

const codes = (plan: ReturnType<typeof basePlan>) =>
  critiquePlan(plan).map((n) => n.code);

const sc = (plan: ReturnType<typeof basePlan>, index: number) => {
  const scene = plan.scenes[index];
  if (!scene) throw new Error(`scene ${index} tidak ada`);
  return scene;
};

describe("critiquePlan", () => {
  it("plan sehat: hanya saran musik (belum ada audio.music)", () => {
    expect(codes(basePlan())).toEqual(["musik-hening"]);
  });

  it("musik terpasang menghilangkan saran musik", () => {
    const plan = basePlan();
    plan.audio.music = {
      assetId: "pustaka:tenang",
      volume: 0.15,
      ducking: true,
      fadeInSec: 1,
      fadeOutSec: 2,
      normalize: true,
    };
    expect(codes(plan)).not.toContain("musik-hening");
  });

  it("gerak kamera seragam di >=3 scene beraset tertangkap", () => {
    const plan = basePlan();
    for (const s of plan.scenes) {
      const clip = s.clips[0];
      if (clip?.type === "stock") clip.motion = "kenburns-in";
    }
    plan.scenes.splice(3, 0, { ...sc(plan, 1), id: "sc-c" });
    expect(codes(plan)).toContain("gerak-monoton");
  });

  it("transisi seragam (tipe+tempo) tertangkap pada >=4 scene", () => {
    const plan = basePlan();
    for (const s of plan.scenes) {
      s.transition = { type: "cross-fade", durationFrames: 15 };
    }
    expect(codes(plan)).toContain("transisi-monoton");
    sc(plan, 1).transition = { type: "slide-up", durationFrames: 10 };
    expect(codes(plan)).not.toContain("transisi-monoton");
  });

  it("hook lemah: pembuka bernarasi panjang tanpa teks overlay", () => {
    const plan = basePlan();
    sc(plan, 1).narration =
      "Ini narasi pembuka yang sangat panjang sekali melebihi empat belas kata supaya heuristik hook menyala dengan pasti ya.";
    expect(critiquePlan(plan).find((n) => n.code === "hook-lemah")?.sceneId).toBe("sc-a");
  });

  it("narasi terlalu padat per detik jadi PERHATIAN", () => {
    const plan = basePlan();
    sc(plan, 1).duration = 3;
    sc(plan, 1).narration = Array(15).fill("kata").join(" ");
    const note = critiquePlan(plan).find((n) => n.code === "narasi-padat");
    expect(note?.level).toBe("perhatian");
    expect(note?.sceneId).toBe("sc-a");
  });

  it("judul >8 kata, solid polos beruntun, teks datar, outro hilang", () => {
    const plan = basePlan();
    plan.meta.title = "Judul yang panjang sekali sampai sembilan kata penuh ini";
    for (const i of [1, 2]) {
      const clip = sc(plan, i).clips[0]!;
      sc(plan, i).clips = [{ ...clip, type: "solid", variant: undefined }];
    }
    sc(plan, 1).texts = [
      { id: "t1", content: "Satu", role: "headline" },
      { id: "t2", content: "Dua", role: "subline" },
    ].map((t) => ({
      ...t,
      position: "center",
      align: "center",
      size: "m",
      emphasis: "none",
      startFrac: 0,
      endFrac: 1,
    })) as never;
    plan.scenes.pop();
    const found = codes(plan);
    expect(found).toEqual(
      expect.arrayContaining([
        "judul-panjang",
        "solid-polos",
        "teks-datar",
        "outro-hilang",
      ]),
    );
  });

  it("formatDirectorNotes memberi prefiks level", () => {
    const lines = formatDirectorNotes(critiquePlan(basePlan()));
    expect(lines[0]).toMatch(/^\[saran\] /);
  });
});
