import { describe, expect, it } from "vitest";
import {
  applyPatch,
  type Clip,
  clampTrimDelta,
  clipOutPointSec,
  computeClipTimings,
  critiquePlan,
  cutClipOps,
  MIN_CLIP_SEC,
  PatchError,
  type PatchOpInput,
  parseScenePlan,
  resolveSceneDurationSec,
  type Scene,
  type ScenePlan,
  type ScenePlanInput,
  trimBounds,
} from "../src/index";
import { makePlan } from "./fixtures";

/**
 * ADR-0033 fase 2 — op klip.
 *
 * Rencana verifikasi ADR-nya ditulis SEBELUM penerapannya; berkas ini menagih
 * butir 2 (ripple sebagai aritmetika murni), 3 (undo satu langkah
 * mengembalikan semua klip yang tersentuh), dan 4 (belah lalu gabung kembali
 * menghasilkan klip yang identik dengan aslinya).
 */

const apply = (plan: ScenePlan, ops: PatchOpInput[], origin: "user" | "agent" = "user") =>
  applyPatch(plan, ops, { origin, now: () => new Date("2026-09-05T00:00:00Z") });

const expectPatchError = (fn: () => unknown, code: string): PatchError => {
  try {
    fn();
    expect.unreachable("expected PatchError");
  } catch (error) {
    expect(error).toBeInstanceOf(PatchError);
    expect((error as PatchError).code).toBe(code);
    return error as PatchError;
  }
  throw new Error("unreachable");
};

/** Scene sc-002 jadi lima potongan dari satu rekaman yang sama. */
const lima = (durations = [3, 2, 4, 2.5, 1.5]) =>
  makePlan((input: ScenePlanInput) => {
    const scene = input.scenes[1] as Record<string, unknown>;
    scene.clips = durations.map((durationSec, index) => ({
      id: `sc-002-k${index + 1}`,
      type: "stock" as const,
      query: "wawancara",
      assetId: "aset-wawancara",
      trimStartSec: index * 10,
      durationSec,
    }));
    input.renderState = {
      clipAssets: Object.fromEntries(
        durations.map((_, index) => [
          `sc-002-k${index + 1}`,
          {
            file: "media/wawancara.mp4",
            kind: "video" as const,
            source: "local",
            durationSec: 600,
          },
        ]),
      ),
    };
  });

const scene = (plan: ScenePlan) => plan.scenes[1] as ScenePlan["scenes"][number];
const durasi = (plan: ScenePlan) =>
  scene(plan).clips.map((clip) => clip.durationSec ?? 0);

describe("durasi scene datang dari potongannya (§2)", () => {
  it("menjumlahkan durasi klip, bukan menebak dari narasi", () => {
    const plan = lima();
    expect(resolveSceneDurationSec(scene(plan), plan)).toBe(13);
  });

  it("klip tunggal tetap mengisi seluruh scene, durationSec-nya diabaikan", () => {
    const plan = makePlan((input) => {
      (input.scenes[0] as Record<string, unknown>).duration = 6;
      const clips = (input.scenes[0] as { clips: Record<string, unknown>[] }).clips;
      (clips[0] as Record<string, unknown>).durationSec = 99;
    });
    const first = plan.scenes[0] as ScenePlan["scenes"][number];
    expect(resolveSceneDurationSec(first, plan)).toBe(6);
    expect(computeClipTimings(first, 6)).toEqual([
      { id: "sc-001-k1", index: 0, startSec: 0, durationSec: 6 },
    ]);
  });

  it("menyusun klip berurutan dari awal scene", () => {
    const plan = lima();
    expect(computeClipTimings(scene(plan), 13).map((timing) => timing.startSec)).toEqual([
      0, 3, 5, 9, 11.5,
    ]);
  });

  it("titik keluar di rekaman sumber dihitung, bukan disimpan (§3)", () => {
    const plan = lima();
    const clip = scene(plan).clips[0] as { trimStartSec: number; speed: number };
    expect(clipOutPointSec(clip as never, 3)).toBe(3);
    // speed 2 berarti tiga detik linimasa memakan enam detik rekaman.
    expect(clipOutPointSec({ ...clip, speed: 2 } as never, 3)).toBe(6);
  });
});

describe("splitClip", () => {
  it("membelah tepat, mewarisi aset, dan memajukan titik masuk paruh kedua", () => {
    const plan = lima();
    const { plan: next } = apply(plan, [
      {
        op: "splitClip",
        sceneId: "sc-002",
        clipId: "sc-002-k3",
        atSec: 1.5,
        newClipId: "sc-002-k3b",
      },
    ]);
    const ids = scene(next).clips.map((clip) => clip.id);
    expect(ids).toEqual([
      "sc-002-k1",
      "sc-002-k2",
      "sc-002-k3",
      "sc-002-k3b",
      "sc-002-k4",
      "sc-002-k5",
    ]);
    expect(durasi(next)).toEqual([3, 2, 1.5, 2.5, 2.5, 1.5]);
    // Panjang scene tidak bergeser satu bingkai pun oleh belahan.
    expect(resolveSceneDurationSec(scene(next), next)).toBe(13);

    const kedua = scene(next).clips[3] as {
      trimStartSec: number;
      assetId: string | null;
    };
    expect(kedua.trimStartSec).toBe(21.5); // 20 + 1.5 * speed(1)
    expect(kedua.assetId).toBe("aset-wawancara");
    // Berkasnya ikut, jadi paruh kedua tidak kehilangan gambarnya.
    expect(next.renderState.clipAssets["sc-002-k3b"]?.file).toBe("media/wawancara.mp4");
  });

  it("memajukan titik masuk sebesar detik REKAMAN saat speed bukan 1", () => {
    const plan = lima();
    const { plan: cepat } = apply(plan, [
      {
        op: "setClips",
        sceneId: "sc-002",
        clips: scene(plan).clips.map((clip, index) =>
          index === 0 ? { ...clip, speed: 2 } : clip,
        ),
      },
    ]);
    const { plan: next } = apply(cepat, [
      {
        op: "splitClip",
        sceneId: "sc-002",
        clipId: "sc-002-k1",
        atSec: 1,
        newClipId: "sc-002-k1b",
      },
    ]);
    expect((scene(next).clips[1] as { trimStartSec: number }).trimStartSec).toBe(2);
  });

  it("memaku durasi scene yang tadinya angka tetap, tanpa menggesernya", () => {
    const plan = makePlan((input) => {
      (input.scenes[0] as Record<string, unknown>).duration = 6;
    });
    const { plan: next } = apply(plan, [
      {
        op: "splitClip",
        sceneId: "sc-001",
        clipId: "sc-001-k1",
        atSec: 2,
        newClipId: "sc-001-k2",
      },
    ]);
    const first = next.scenes[0] as ScenePlan["scenes"][number];
    expect(first.duration).toBe("auto");
    expect(first.clips.map((clip) => clip.durationSec)).toEqual([2, 4]);
    expect(resolveSceneDurationSec(first, next)).toBe(6);
  });

  it("memberikan transisi keluar klip aslinya kepada paruh KEDUA", () => {
    const plan = lima();
    const { plan: bertransisi } = apply(plan, [
      {
        op: "setClips",
        sceneId: "sc-002",
        clips: scene(plan).clips.map((clip, index) =>
          index === 0
            ? { ...clip, transition: { type: "cross-fade", durationFrames: 12 } }
            : clip,
        ),
      },
    ]);
    const { plan: next } = apply(bertransisi, [
      {
        op: "splitClip",
        sceneId: "sc-002",
        clipId: "sc-002-k1",
        atSec: 1,
        newClipId: "sc-002-k1b",
      },
    ]);
    expect(scene(next).clips[0]?.transition).toBeUndefined();
    expect(scene(next).clips[1]?.transition).toEqual({
      type: "cross-fade",
      durationFrames: 12,
    });
  });

  it("menolak titik belah yang menyisakan potongan lebih pendek dari lantainya", () => {
    const plan = lima();
    const error = expectPatchError(
      () =>
        apply(plan, [
          {
            op: "splitClip",
            sceneId: "sc-002",
            clipId: "sc-002-k2",
            atSec: 0.05,
            newClipId: "x",
          },
        ]),
      "CLIP_REFUSED",
    );
    expect(error.message).toContain("di luar batas");
  });

  it("menolak id klip yang sudah dipakai di plan yang sama", () => {
    const plan = lima();
    expectPatchError(
      () =>
        apply(plan, [
          {
            op: "splitClip",
            sceneId: "sc-002",
            clipId: "sc-002-k1",
            atSec: 1,
            newClipId: "sc-001-k1",
          },
        ]),
      "CLIP_EXISTS",
    );
  });
});

describe("trimClip — ripple (rencana verifikasi butir 2)", () => {
  it("memendekkan klip ketiga menggeser klip empat dan lima persis sebesar selisihnya", () => {
    const plan = lima();
    const sebelum = computeClipTimings(scene(plan), 13);
    const { plan: next } = apply(plan, [
      {
        op: "trimClip",
        sceneId: "sc-002",
        clipId: "sc-002-k3",
        edge: "keluar",
        deltaSec: -1.5,
      },
    ]);
    const sesudah = computeClipTimings(
      scene(next),
      resolveSceneDurationSec(scene(next), next),
    );

    expect(durasi(next)).toEqual([3, 2, 2.5, 2.5, 1.5]);
    // Klip 4 dan 5 bergeser ke kiri persis 1.5 dtk; klip 1-3 tidak bergerak.
    expect(sesudah[3]?.startSec).toBe((sebelum[3]?.startSec ?? 0) - 1.5);
    expect(sesudah[4]?.startSec).toBe((sebelum[4]?.startSec ?? 0) - 1.5);
    expect(sesudah.slice(0, 3).map((timing) => timing.startSec)).toEqual(
      sebelum.slice(0, 3).map((timing) => timing.startSec),
    );
    // Jumlah durasi scene ikut berubah persis sebesar itu juga.
    expect(resolveSceneDurationSec(scene(next), next)).toBe(11.5);
    // Ripple tidak menyentuh titik masuk siapa pun.
    expect(scene(next).clips.map((clip) => clip.trimStartSec)).toEqual([
      0, 10, 20, 30, 40,
    ]);
  });

  it("tepi masuk memajukan titik masuk klip itu sendiri", () => {
    const plan = lima();
    const { plan: next } = apply(plan, [
      {
        op: "trimClip",
        sceneId: "sc-002",
        clipId: "sc-002-k2",
        edge: "masuk",
        deltaSec: 0.5,
      },
    ]);
    expect(durasi(next)).toEqual([3, 1.5, 4, 2.5, 1.5]);
    expect(scene(next).clips[1]?.trimStartSec).toBe(10.5);
    expect(resolveSceneDurationSec(scene(next), next)).toBe(12.5);
  });
});

describe("trimClip — roll", () => {
  it("menukar durasi dengan tetangga kanan tanpa mengubah panjang scene", () => {
    const plan = lima();
    const { plan: next } = apply(plan, [
      {
        op: "trimClip",
        sceneId: "sc-002",
        clipId: "sc-002-k2",
        edge: "keluar",
        mode: "roll",
        deltaSec: 1,
      },
    ]);
    expect(durasi(next)).toEqual([3, 3, 3, 2.5, 1.5]);
    expect(resolveSceneDurationSec(scene(next), next)).toBe(13);
    // Tetangga kanan mulai satu detik lebih belakangan DI REKAMAN, bukan cuma
    // di linimasa: titik potongnya yang bergerak.
    expect(scene(next).clips[2]?.trimStartSec).toBe(21);
  });

  it("menukar durasi dengan tetangga kiri lewat tepi masuk", () => {
    const plan = lima();
    const { plan: next } = apply(plan, [
      {
        op: "trimClip",
        sceneId: "sc-002",
        clipId: "sc-002-k3",
        edge: "masuk",
        mode: "roll",
        deltaSec: -1,
      },
    ]);
    expect(durasi(next)).toEqual([3, 1, 5, 2.5, 1.5]);
    expect(scene(next).clips[2]?.trimStartSec).toBe(19);
    expect(resolveSceneDurationSec(scene(next), next)).toBe(13);
  });

  it("menolak roll di tepi yang tidak punya tetangga", () => {
    const plan = lima();
    const error = expectPatchError(
      () =>
        apply(plan, [
          {
            op: "trimClip",
            sceneId: "sc-002",
            clipId: "sc-002-k1",
            edge: "masuk",
            mode: "roll",
            deltaSec: 0.5,
          },
        ]),
      "CLIP_REFUSED",
    );
    expect(error.message).toContain("pakai ripple");
  });
});

describe("batas seretan", () => {
  it("tepi keluar tidak bisa melewati ujung rekaman sumber", () => {
    const plan = makePlan((input) => {
      const target = input.scenes[1] as Record<string, unknown>;
      target.clips = [
        { id: "a", type: "stock", trimStartSec: 4, durationSec: 3 },
        { id: "b", type: "stock", trimStartSec: 0, durationSec: 3 },
      ];
      input.renderState = {
        clipAssets: {
          a: { file: "m.mp4", kind: "video", source: "local", durationSec: 10 },
        },
      };
    });
    const bounds = trimBounds(plan, scene(plan), "a", "keluar", "ripple");
    expect(bounds).toEqual({ minDelta: MIN_CLIP_SEC - 3, maxDelta: 3 });
    // 4 + 3 + 3 = 10 dtk: tepat di ujung rekaman, tidak lebih.
    expect(clampTrimDelta(plan, scene(plan), "a", "keluar", "ripple", 99)).toBe(3);
  });

  it("gambar diam tidak punya batas kanan — ia bisa ditahan selama apa pun", () => {
    const plan = lima();
    const gambar = makePlan((input) => {
      const target = input.scenes[1] as Record<string, unknown>;
      target.clips = [
        { id: "a", type: "image", durationSec: 3 },
        { id: "b", type: "image", durationSec: 3 },
      ];
    });
    expect(trimBounds(gambar, scene(gambar), "a", "keluar", "ripple")).toEqual({
      minDelta: MIN_CLIP_SEC - 3,
      maxDelta: Number.POSITIVE_INFINITY,
    });
    expect(clampTrimDelta(plan, scene(plan), "sc-002-k1", "masuk", "ripple", -99)).toBe(
      0,
    );
  });

  it("scene berklip satu menolak trimClip dan menunjuk jalur yang benar", () => {
    const plan = makePlan();
    const error = expectPatchError(
      () =>
        apply(plan, [
          {
            op: "trimClip",
            sceneId: "sc-001",
            clipId: "sc-001-k1",
            edge: "keluar",
            deltaSec: 1,
          },
        ]),
      "CLIP_REFUSED",
    );
    expect(error.message).toContain("trimStartSec");
  });
});

describe("removeClip & reorderClips", () => {
  it("menutup celahnya dan memendekkan scene", () => {
    const plan = lima();
    const { plan: next } = apply(plan, [
      { op: "removeClip", sceneId: "sc-002", clipId: "sc-002-k2" },
    ]);
    expect(scene(next).clips.map((clip) => clip.id)).toEqual([
      "sc-002-k1",
      "sc-002-k3",
      "sc-002-k4",
      "sc-002-k5",
    ]);
    expect(resolveSceneDurationSec(scene(next), next)).toBe(11);
  });

  it("mengembalikan scene ke narasi saat klipnya tinggal satu", () => {
    const plan = lima([3, 2]);
    const { plan: next } = apply(plan, [
      { op: "removeClip", sceneId: "sc-002", clipId: "sc-002-k2" },
    ]);
    expect(scene(next).clips).toHaveLength(1);
    expect(scene(next).clips[0]?.durationSec).toBeUndefined();
    expect(scene(next).duration).toBe("auto");
    expect(resolveSceneDurationSec(scene(next), next)).toBeGreaterThan(2);
  });

  it("menolak membuang klip terakhir sebuah scene", () => {
    const plan = makePlan();
    const error = expectPatchError(
      () => apply(plan, [{ op: "removeClip", sceneId: "sc-001", clipId: "sc-001-k1" }]),
      "CLIP_REFUSED",
    );
    expect(error.message).toContain("minimal satu klip");
  });

  it("menyusun ulang klip di dalam scene", () => {
    const plan = lima([3, 2]);
    const { plan: next } = apply(plan, [
      { op: "reorderClips", sceneId: "sc-002", order: ["sc-002-k2", "sc-002-k1"] },
    ]);
    expect(scene(next).clips.map((clip) => clip.id)).toEqual(["sc-002-k2", "sc-002-k1"]);
    expect(durasi(next)).toEqual([2, 3]);
  });

  it("menolak urutan yang bukan permutasi", () => {
    const plan = lima([3, 2]);
    expectPatchError(
      () =>
        apply(plan, [{ op: "reorderClips", sceneId: "sc-002", order: ["sc-002-k1"] }]),
      "BAD_REORDER",
    );
  });
});

describe("undo (rencana verifikasi butir 3 & 4)", () => {
  it("satu langkah undo mengembalikan SEMUA klip yang tersentuh ripple", () => {
    const plan = lima();
    const { plan: dipotong, applied } = apply(plan, [
      {
        op: "trimClip",
        sceneId: "sc-002",
        clipId: "sc-002-k3",
        edge: "keluar",
        deltaSec: -1.5,
      },
    ]);
    expect(applied.inverse).toHaveLength(1);
    const { plan: kembali } = applyPatch(dipotong, applied.inverse, {
      origin: "user",
      enforce: false,
    });
    expect(kembali.scenes[1]).toEqual(plan.scenes[1]);
  });

  it("undo belahan mengembalikan durasi scene yang dipaku belahan itu", () => {
    const plan = makePlan((input) => {
      (input.scenes[0] as Record<string, unknown>).duration = 6;
    });
    const { plan: dibelah, applied } = apply(plan, [
      {
        op: "splitClip",
        sceneId: "sc-001",
        clipId: "sc-001-k1",
        atSec: 2,
        newClipId: "sc-001-k2",
      },
    ]);
    const { plan: kembali } = applyPatch(dibelah, applied.inverse, {
      origin: "user",
      enforce: false,
    });
    expect(kembali.scenes[0]?.duration).toBe(6);
    expect(kembali.scenes[0]?.clips).toEqual(plan.scenes[0]?.clips);
  });

  it("belah lalu gabung kembali menghasilkan klip yang identik dengan aslinya", () => {
    const plan = lima();
    const asli = scene(plan).clips[2];
    const { plan: dibelah } = apply(plan, [
      {
        op: "splitClip",
        sceneId: "sc-002",
        clipId: "sc-002-k3",
        atSec: 1.5,
        newClipId: "sc-002-k3b",
      },
    ]);
    const { plan: digabung } = apply(dibelah, [
      { op: "removeClip", sceneId: "sc-002", clipId: "sc-002-k3b" },
      {
        op: "trimClip",
        sceneId: "sc-002",
        clipId: "sc-002-k3",
        edge: "keluar",
        deltaSec: 2.5,
      },
    ]);
    expect(scene(digabung).clips[2]).toEqual(asli);
    expect(resolveSceneDurationSec(scene(digabung), digabung)).toBe(13);
  });
});

describe("potongan antar klip (§6)", () => {
  it("bawaannya potong keras: tidak ada transisi yang tersimpan", () => {
    const plan = lima();
    expect(scene(plan).clips.map((clip) => clip.transition)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("dipasang lewat updateScene berclipId, bukan dengan menulis ulang daftarnya", () => {
    const plan = lima();
    const after = apply(plan, [
      {
        op: "updateScene",
        id: "sc-002",
        clipId: "sc-002-k2",
        patch: { clip: { transition: { type: "cross-fade", durationFrames: 12 } } },
      },
    ]).plan;
    expect(scene(after).clips[1]?.transition).toEqual({
      type: "cross-fade",
      durationFrames: 12,
    });
    // Yang lain tidak ikut tersentuh: ini properti SATU potongan.
    expect(scene(after).clips[0]?.transition).toBeUndefined();
    expect(durasi(after)).toEqual([3, 2, 4, 2.5, 1.5]);
  });

  it("null mengembalikannya ke potong keras, dan undo memulihkan yang tadi", () => {
    const plan = lima();
    const dipasang = apply(plan, [
      {
        op: "updateScene",
        id: "sc-002",
        clipId: "sc-002-k2",
        patch: { clip: { transition: { type: "wipe-right", durationFrames: 9 } } },
      },
    ]);
    const dicabut = apply(dipasang.plan, [
      {
        op: "updateScene",
        id: "sc-002",
        clipId: "sc-002-k2",
        patch: { clip: { transition: null } },
      },
    ]);
    expect(scene(dicabut.plan).clips[1]?.transition).toBeUndefined();

    // Invers pencabutan harus MENGEMBALIKAN transisinya — kalau inversnya
    // ikut menghapus, undo terlihat berhasil dan diam-diam kehilangan sunting.
    const undo = apply(dicabut.plan, dicabut.applied.inverse);
    expect(scene(undo.plan).clips[1]?.transition).toEqual({
      type: "wipe-right",
      durationFrames: 9,
    });

    // Dan undo dari pemasangannya mengembalikan ketiadaannya.
    const undoPasang = apply(dipasang.plan, dipasang.applied.inverse);
    expect(scene(undoPasang.plan).clips[1]?.transition).toBeUndefined();
  });

  it("mendarat di klip yang disebut, bukan di klip pertama", () => {
    const plan = lima();
    const after = apply(plan, [
      {
        op: "updateScene",
        id: "sc-002",
        clipId: "sc-002-k4",
        patch: { clip: { transition: { type: "slide-left", durationFrames: 15 } } },
      },
    ]).plan;
    expect(scene(after).clips.map((clip) => clip.transition?.type ?? "keras")).toEqual([
      "keras",
      "keras",
      "keras",
      "slide-left",
      "keras",
    ]);
  });

  it("belahan memberikan transisi keluar aslinya ke potongan KEDUA", () => {
    const plan = lima();
    const bertransisi = apply(plan, [
      {
        op: "updateScene",
        id: "sc-002",
        clipId: "sc-002-k1",
        patch: { clip: { transition: { type: "cross-fade", durationFrames: 15 } } },
      },
    ]).plan;
    const dibelah = apply(bertransisi, [
      {
        op: "splitClip",
        sceneId: "sc-002",
        clipId: "sc-002-k1",
        atSec: 1.5,
        newClipId: "sc-002-k1b",
      },
    ]).plan;
    // Potongan pertama dapat potong keras (batas baru di dalam rekaman yang
    // sama), yang kedua memegang batas lama ke klip sesudahnya.
    expect(dibelah.scenes[1]?.clips[0]?.transition).toBeUndefined();
    expect(dibelah.scenes[1]?.clips[1]?.transition).toEqual({
      type: "cross-fade",
      durationFrames: 15,
    });
  });

  it("agent ditolak menyentuh transisi klip di scene terkunci", () => {
    const plan = apply(lima(), [{ op: "lockScene", id: "sc-002", locked: true }]).plan;
    expectPatchError(
      () =>
        apply(
          plan,
          [
            {
              op: "updateScene",
              id: "sc-002",
              clipId: "sc-002-k2",
              patch: { clip: { transition: { type: "cross-fade", durationFrames: 12 } } },
            },
          ],
          "agent",
        ),
      "SCENE_LOCKED",
    );
  });
});

describe("replaceAsset menyasar klip (§5)", () => {
  it("memasang aset ke potongan yang disebut, bukan ke potongan pertama", () => {
    const plan = lima();
    const after = apply(plan, [
      {
        op: "replaceAsset",
        sceneId: "sc-002",
        clipId: "sc-002-k3",
        assetId: "pilihan-tangan",
      },
    ]).plan;
    const clips = scene(after).clips;
    expect(clips[2]?.assetId).toBe("pilihan-tangan");
    expect(clips[2]?.pinned).toBe(true);
    // Potongan pertama tidak tersentuh.
    expect(clips[0]?.assetId).toBe("aset-wawancara");
    expect(clips[0]?.pinned).toBe(false);
  });

  it("undo mengembalikan aset potongan ITU, bukan potongan pertama", () => {
    const plan = lima();
    const applied = apply(plan, [
      {
        op: "replaceAsset",
        sceneId: "sc-002",
        clipId: "sc-002-k3",
        assetId: "pilihan-tangan",
      },
    ]);
    const undone = apply(applied.plan, applied.applied.inverse).plan;
    expect(scene(undone).clips[2]?.assetId).toBe("aset-wawancara");
    expect(scene(undone).clips[2]?.pinned).toBe(false);
  });

  it("klip yang tidak ada ditolak dengan kode klip, bukan kode lapisan", () => {
    const error = expectPatchError(
      () =>
        apply(lima(), [
          {
            op: "replaceAsset",
            sceneId: "sc-002",
            clipId: "klip-hantu",
            assetId: "apa-saja",
          },
        ]),
      "CLIP_NOT_FOUND",
    );
    expect(error.message).toContain("klip-hantu");
  });
});

describe("kritik: narasi lebih panjang dari gambar (§2)", () => {
  const kode = (plan: ScenePlan) =>
    critiquePlan(plan)
      .filter((note) => note.code === "narasi-lebih-panjang-dari-gambar")
      .map((note) => note.sceneId);

  it("melaporkan scene yang gambarnya habis sebelum kalimatnya", () => {
    const plan = lima([1, 0.5]);
    expect(kode(plan)).toEqual(["sc-002"]);
  });

  it("diam saat potongannya cukup", () => {
    expect(kode(lima([6, 6]))).toEqual([]);
  });

  it("diam untuk scene berklip satu — di sana durasinya memang mengikuti narasi", () => {
    expect(kode(makePlan())).toEqual([]);
  });

  it("memakai durasi audio yang sudah ada, bukan tebakan suku kata", () => {
    const plan = makePlan((input) => {
      const target = input.scenes[1] as Record<string, unknown>;
      target.clips = [
        { id: "a", type: "solid", durationSec: 3 },
        { id: "b", type: "solid", durationSec: 3 },
      ];
      input.renderState = {
        narrationAudio: {
          "sc-002": { file: "vo/sc-002.wav", durationSec: 20 },
        },
      };
    });
    const notes = critiquePlan(plan).filter(
      (note) => note.code === "narasi-lebih-panjang-dari-gambar",
    );
    expect(notes[0]?.message).toContain("20.3 dtk");
  });
});

describe("penjagaan kunci", () => {
  it("scene terkunci menolak op klip dari agent", () => {
    const plan = lima();
    const { plan: terkunci } = apply(plan, [
      { op: "lockScene", id: "sc-002", locked: true },
    ]);
    for (const op of [
      { op: "removeClip" as const, sceneId: "sc-002", clipId: "sc-002-k2" },
      { op: "reorderClips" as const, sceneId: "sc-002", order: ["sc-002-k2"] },
      {
        op: "trimClip" as const,
        sceneId: "sc-002",
        clipId: "sc-002-k2",
        edge: "keluar" as const,
        deltaSec: 1,
      },
      {
        op: "splitClip" as const,
        sceneId: "sc-002",
        clipId: "sc-002-k2",
        atSec: 1,
        newClipId: "baru",
      },
    ]) {
      expectPatchError(() => apply(terkunci, [op], "agent"), "SCENE_LOCKED");
    }
  });

  it("user tetap boleh menyunting klip di scene terkunci", () => {
    const plan = lima();
    const { plan: terkunci } = apply(plan, [
      { op: "lockScene", id: "sc-002", locked: true },
    ]);
    const { plan: next } = apply(terkunci, [
      { op: "removeClip", sceneId: "sc-002", clipId: "sc-002-k2" },
    ]);
    expect(scene(next).clips).toHaveLength(4);
  });

  it("klip yang tidak ada dilaporkan sebagai CLIP_NOT_FOUND", () => {
    const plan = lima();
    expectPatchError(
      () => apply(plan, [{ op: "removeClip", sceneId: "sc-002", clipId: "hantu" }]),
      "CLIP_NOT_FOUND",
    );
  });
});

/**
 * `cutClipOps` — aturan "panjang potongan disimpan di mana" satu tempat.
 *
 * Dua pemanggil pernah melanggarnya sendiri-sendiri (tool cutByWords milik
 * agent dan tombol "Potong ke sini" di tab Transkrip Studio), keduanya gagal
 * merah persis di scene berklip banyak. Test ini menjaga aturannya, bukan
 * salah satu pemanggilnya.
 */
describe("cutClipOps", () => {
  const satuKlip = parseScenePlan({
    version: 2,
    projectId: "p",
    meta: { title: "T" },
    scenes: [
      {
        id: "sc-1",
        narration: "",
        clips: [{ id: "k1", type: "stock", trimStartSec: 5, speed: 1 }],
      },
    ],
  });
  const banyakKlip = parseScenePlan({
    version: 2,
    projectId: "p",
    meta: { title: "T" },
    scenes: [
      {
        id: "sc-1",
        narration: "",
        duration: "auto",
        clips: [
          { id: "k1", type: "stock", trimStartSec: 5, durationSec: 4 },
          { id: "k2", type: "stock", trimStartSec: 40, durationSec: 3 },
        ],
      },
    ],
  });
  const scene = (plan: typeof satuKlip) => plan.scenes[0] as Scene;

  it("scene berklip satu menyetel durasi SCENE, tanpa clipId", () => {
    const ops = cutClipOps(scene(satuKlip), scene(satuKlip).clips[0] as Clip, {
      fromSec: 10,
      toSec: 12.5,
    });
    expect(ops).toEqual([
      {
        op: "updateScene",
        id: "sc-1",
        patch: { clip: { trimStartSec: 10 }, duration: 2.5 },
      },
    ]);
  });

  it("scene berklip banyak TIDAK pernah menulis angka ke duration scene", () => {
    const ops = cutClipOps(scene(banyakKlip), scene(banyakKlip).clips[1] as Clip, {
      fromSec: 50,
      toSec: 51.5,
    });
    expect(ops).toEqual([
      {
        op: "updateScene",
        id: "sc-1",
        clipId: "k2",
        patch: { clip: { trimStartSec: 50 } },
      },
      {
        op: "trimClip",
        sceneId: "sc-1",
        clipId: "k2",
        edge: "keluar",
        mode: "ripple",
        deltaSec: -1.5,
      },
    ]);
    // Bukan cuma bentuknya: op-nya harus benar-benar diterima applyPatch.
    const { plan } = applyPatch(banyakKlip, ops, { origin: "user" });
    const sesudah = plan.scenes[0] as Scene;
    expect(sesudah.duration).toBe("auto");
    expect(sesudah.clips[1]?.trimStartSec).toBe(50);
    expect(sesudah.clips[1]?.durationSec).toBeCloseTo(1.5, 3);
    expect(sesudah.clips[0]?.durationSec).toBe(4);
  });

  it("panjang yang sudah pas tidak melahirkan trimClip kosong", () => {
    const ops = cutClipOps(scene(banyakKlip), scene(banyakKlip).clips[1] as Clip, {
      fromSec: 40,
      toSec: 43,
    });
    expect(ops).toHaveLength(1);
  });

  it("kecepatan klip ikut dihitung: 2x memakan dua kali rentang rekaman", () => {
    const cepat = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        {
          id: "sc-1",
          narration: "",
          clips: [{ id: "k1", type: "stock", trimStartSec: 0, speed: 2 }],
        },
      ],
    });
    const ops = cutClipOps(scene(cepat), scene(cepat).clips[0] as Clip, {
      fromSec: 10,
      toSec: 14,
    });
    // 4 detik rekaman pada 2x = 2 detik di linimasa.
    expect((ops[0] as { patch: { duration: number } }).patch.duration).toBe(2);
  });
});
