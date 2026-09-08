import { describe, expect, it } from "vitest";
import { applyPatch, PatchError, type PatchOpInput, type ScenePlan } from "../src/index";
import { makePlan } from "./fixtures";

const apply = (
  plan: ScenePlan,
  ops: PatchOpInput[],
  origin: "user" | "agent" = "agent",
) => applyPatch(plan, ops, { origin, now: () => new Date("2026-08-29T00:00:00Z") });

const expectPatchError = (fn: () => unknown, code: string): void => {
  try {
    fn();
    expect.unreachable("expected PatchError");
  } catch (error) {
    expect(error).toBeInstanceOf(PatchError);
    expect((error as PatchError).code).toBe(code);
  }
};

describe("applyPatch — basic ops", () => {
  it("adds a scene after an existing one", () => {
    const plan = makePlan();
    const { plan: next, applied } = apply(plan, [
      {
        op: "addScene",
        afterId: "sc-001",
        scene: {
          id: "sc-new",
          narration: "Baru.",
          clips: [{ id: "sc-new-k1", type: "solid" }],
        },
      },
    ]);
    expect(next.scenes.map((scene) => scene.id)).toEqual([
      "sc-001",
      "sc-new",
      "sc-002",
      "sc-003",
    ]);
    expect(applied.summary).toContain("menambah scene sc-new setelah sc-001");
    // Original untouched (immutability).
    expect(plan.scenes).toHaveLength(3);
  });

  it("adds a scene at the start with afterId null", () => {
    const plan = makePlan();
    const { plan: next } = apply(plan, [
      {
        op: "addScene",
        afterId: null,
        scene: {
          id: "sc-intro",
          clips: [{ id: "sc-intro-k1", type: "template-anim", variant: "title" }],
        },
      },
    ]);
    expect(next.scenes[0]?.id).toBe("sc-intro");
  });

  it("rejects adding a duplicate scene id", () => {
    const plan = makePlan();
    expectPatchError(
      () =>
        apply(plan, [
          {
            op: "addScene",
            afterId: null,
            scene: { id: "sc-001", clips: [{ id: "sc-001-k1", type: "solid" }] },
          },
        ]),
      "SCENE_EXISTS",
    );
  });

  it("updates narration and duration", () => {
    const plan = makePlan();
    const { plan: next } = apply(plan, [
      { op: "updateScene", id: "sc-002", patch: { narration: "Diubah.", duration: 5 } },
    ]);
    expect(next.scenes[1]?.narration).toBe("Diubah.");
    expect(next.scenes[1]?.duration).toBe(5);
  });

  it("merges visual updates shallowly and clears with null", () => {
    const plan = makePlan();
    const { plan: next } = apply(plan, [
      {
        op: "updateScene",
        id: "sc-001",
        patch: { clip: { motion: "kenburns-in", query: null } },
      },
    ]);
    expect(next.scenes[0]?.clips[0]?.motion).toBe("kenburns-in");
    expect(next.scenes[0]?.clips[0]?.query).toBeUndefined();
    expect(next.scenes[0]?.clips[0]?.type).toBe("stock"); // untouched
  });

  it("rejects updateScene touching assetId (replaceAsset is the only path)", () => {
    const plan = makePlan();
    expectPatchError(
      () =>
        apply(plan, [
          {
            op: "updateScene",
            id: "sc-001",
            patch: { clip: { assetId: "px-123" } } as never,
          },
        ]),
      "INVALID_OP",
    );
  });

  it("removes a scene", () => {
    const plan = makePlan();
    const { plan: next } = apply(plan, [{ op: "removeScene", id: "sc-002" }]);
    expect(next.scenes.map((scene) => scene.id)).toEqual(["sc-001", "sc-003"]);
  });

  it("refuses to remove the last remaining scene", () => {
    const plan = makePlan((input) => {
      input.scenes = [input.scenes[0]!];
    });
    expectPatchError(
      () => apply(plan, [{ op: "removeScene", id: "sc-001" }]),
      "LAST_SCENE",
    );
  });

  it("reorders scenes with a full permutation", () => {
    const plan = makePlan();
    const { plan: next } = apply(plan, [
      { op: "reorderScenes", order: ["sc-003", "sc-001", "sc-002"] },
    ]);
    expect(next.scenes.map((scene) => scene.id)).toEqual(["sc-003", "sc-001", "sc-002"]);
  });

  it("rejects partial or duplicated reorder lists", () => {
    const plan = makePlan();
    expectPatchError(
      () => apply(plan, [{ op: "reorderScenes", order: ["sc-001", "sc-002"] }]),
      "BAD_REORDER",
    );
    expectPatchError(
      () => apply(plan, [{ op: "reorderScenes", order: ["sc-001", "sc-001", "sc-002"] }]),
      "BAD_REORDER",
    );
  });

  it("sets meta and audio partially", () => {
    const plan = makePlan();
    const { plan: next } = apply(plan, [
      { op: "setMeta", patch: { targetDuration: 90 } },
      {
        op: "setAudio",
        patch: {
          voice: { provider: "elevenlabs", voiceId: "v-id", speed: 1.1 },
        },
      },
    ]);
    expect(next.meta.targetDuration).toBe(90);
    expect(next.meta.title).toBe("Sejarah Borobudur dalam 60 Detik");
    expect(next.audio.voice?.provider).toBe("elevenlabs");
  });

  it("replaceAsset sets and pins the asset by default", () => {
    const plan = makePlan();
    const { plan: next } = apply(
      plan,
      [{ op: "replaceAsset", sceneId: "sc-001", assetId: "pexels-42" }],
      "user",
    );
    expect(next.scenes[0]?.clips[0]?.assetId).toBe("pexels-42");
    expect(next.scenes[0]?.clips[0]?.pinned).toBe(true);
  });

  it("replaceAsset with null clears asset and pin", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.clips[0]!.assetId = "pexels-42";
      input.scenes[0]!.clips[0]!.pinned = true;
    });
    const { plan: next } = apply(
      plan,
      [{ op: "replaceAsset", sceneId: "sc-001", assetId: null }],
      "user",
    );
    expect(next.scenes[0]?.clips[0]?.assetId).toBeNull();
    expect(next.scenes[0]?.clips[0]?.pinned).toBe(false);
  });

  it("is atomic: a failing op in a batch leaves the plan untouched", () => {
    const plan = makePlan();
    expectPatchError(
      () =>
        apply(plan, [
          { op: "updateScene", id: "sc-001", patch: { narration: "X" } },
          { op: "removeScene", id: "sc-tidak-ada" },
        ]),
      "SCENE_NOT_FOUND",
    );
    expect(plan.scenes[0]?.narration).toBe("Borobudur dibangun pada abad ke-9.");
  });

  it("rejects an empty batch", () => {
    const plan = makePlan();
    expectPatchError(() => apply(plan, []), "INVALID_OP");
  });
});

describe("applyPatch — lock enforcement (hard contract, PRD §6.3)", () => {
  const lockedPlan = () =>
    makePlan((input) => {
      input.scenes[0]!.locked = true;
    });

  it("agent cannot update a locked scene", () => {
    expectPatchError(
      () =>
        apply(lockedPlan(), [
          { op: "updateScene", id: "sc-001", patch: { narration: "Hack" } },
        ]),
      "SCENE_LOCKED",
    );
  });

  it("agent cannot remove a locked scene", () => {
    expectPatchError(
      () => apply(lockedPlan(), [{ op: "removeScene", id: "sc-001" }]),
      "SCENE_LOCKED",
    );
  });

  it("agent cannot replace the asset of a locked scene", () => {
    expectPatchError(
      () =>
        apply(lockedPlan(), [{ op: "replaceAsset", sceneId: "sc-001", assetId: "px-1" }]),
      "SCENE_LOCKED",
    );
  });

  it("agent cannot move a locked scene via reorder", () => {
    expectPatchError(
      () =>
        apply(lockedPlan(), [
          { op: "reorderScenes", order: ["sc-002", "sc-001", "sc-003"] },
        ]),
      "SCENE_LOCKED",
    );
  });

  it("agent may reorder unlocked scenes around a locked one", () => {
    const { plan: next } = apply(lockedPlan(), [
      { op: "reorderScenes", order: ["sc-001", "sc-003", "sc-002"] },
    ]);
    expect(next.scenes.map((scene) => scene.id)).toEqual(["sc-001", "sc-003", "sc-002"]);
  });

  it("agent cannot lock or unlock scenes", () => {
    expectPatchError(
      () => apply(makePlan(), [{ op: "lockScene", id: "sc-001", locked: true }]),
      "LOCK_FORBIDDEN",
    );
  });

  it("user can edit and unlock a locked scene (lock only binds the agent)", () => {
    const { plan: step1 } = apply(
      lockedPlan(),
      [{ op: "updateScene", id: "sc-001", patch: { narration: "Edit user" } }],
      "user",
    );
    expect(step1.scenes[0]?.narration).toBe("Edit user");
    const { plan: step2 } = apply(
      step1,
      [{ op: "lockScene", id: "sc-001", locked: false }],
      "user",
    );
    expect(step2.scenes[0]?.locked).toBe(false);
  });
});

describe("applyPatch — inverses", () => {
  const roundtrip = (ops: PatchOpInput[], origin: "user" | "agent" = "user") => {
    const plan = makePlan();
    const { plan: next, applied } = apply(plan, ops, origin);
    const { plan: reverted } = applyPatch(next, applied.inverse, {
      origin,
      enforce: false,
    });
    expect(reverted).toEqual(plan);
  };

  it("inverse of addScene removes it", () => {
    roundtrip([
      {
        op: "addScene",
        afterId: "sc-002",
        scene: { id: "sc-x", narration: "X", clips: [{ id: "sc-x-k1", type: "solid" }] },
      },
    ]);
  });

  it("inverse of removeScene restores content and position (incl. first scene)", () => {
    roundtrip([{ op: "removeScene", id: "sc-001" }]);
    roundtrip([{ op: "removeScene", id: "sc-002" }]);
    roundtrip([{ op: "removeScene", id: "sc-003" }]);
  });

  it("inverse of updateScene restores prior values incl. cleared optionals", () => {
    roundtrip([
      {
        op: "updateScene",
        id: "sc-001",
        patch: {
          narration: "Beda.",
          duration: 9,
          clip: { motion: "pan-left", query: "new query", variant: "quote" },
          caption: { enabled: false },
        },
      },
    ]);
  });

  it("inverse of reorder restores order", () => {
    roundtrip([{ op: "reorderScenes", order: ["sc-003", "sc-002", "sc-001"] }]);
  });

  it("inverse of setMeta/setAudio restores prior values (incl. absent keys)", () => {
    roundtrip([
      { op: "setMeta", patch: { title: "Judul Baru", tokens: { accent: "#fff" } } },
      {
        op: "setAudio",
        patch: { music: { assetId: "music-lib/calm", volume: 0.2 } },
      },
    ]);
  });

  it("inverse of replaceAsset restores prior asset and pin state", () => {
    roundtrip([{ op: "replaceAsset", sceneId: "sc-003", assetId: "px-9" }]);
  });

  it("inverse of a multi-op batch reverts everything", () => {
    roundtrip([
      { op: "updateScene", id: "sc-001", patch: { narration: "A" } },
      {
        op: "addScene",
        afterId: "sc-001",
        scene: { id: "sc-b", clips: [{ id: "sc-b-k1", type: "solid" }] },
      },
      { op: "removeScene", id: "sc-003" },
      { op: "setMeta", patch: { language: "en" } },
    ]);
  });
});
