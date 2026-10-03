import { describe, expect, it } from "vitest";
import {
  applyPatch,
  critiquePlan,
  parseScenePlan,
  TEXT_SOUNDS,
  TYPEWRITER_FRAMES_PER_CHAR,
  textOverlaySchema,
} from "../src/index";
import { basePlanInput, makePlan } from "./fixtures";

/**
 * Bunyi ketik (ADR-0043): skema dan kritiknya.
 *
 * Penempatan bunyinya diuji di @dalang/templates dan pengukurannya pada video
 * jadi di gerbang `gate:ketik`; yang dijaga di sini adalah dua hal yang lolos
 * skema namun menghasilkan video yang salah tanpa pesan apa pun.
 */

const dengan = (teks: Record<string, unknown>, durasi = 6) =>
  makePlan((input) => {
    const scene = input.scenes[0]!;
    scene.duration = durasi;
    scene.texts = [
      {
        id: "t-1",
        content: "Halo dunia",
        anim: "typewriter",
        sound: "ketik",
        startFrac: 0,
        endFrac: 1,
        ...teks,
      } as never,
    ];
  });

const kode = (plan: ReturnType<typeof dengan>) => critiquePlan(plan).map((n) => n.code);

describe("skema", () => {
  it("plan lama tanpa field baru tetap sah dan bawaannya senyap", () => {
    const teks = textOverlaySchema.parse({ id: "t", content: "x" });
    expect(teks.sound).toBe("none");
    expect(teks.soundVolume).toBeCloseTo(0.6, 5);
    // Bawaan tidak mengubah satu plan lama pun: tidak ada bunyi yang muncul.
    for (const scene of makePlan().scenes) {
      for (const text of scene.texts) expect(text.sound).toBe("none");
    }
  });

  it("daftar bunyi memuat none dan ketik; bunyi lain ditolak", () => {
    expect(TEXT_SOUNDS).toEqual(["none", "ketik"]);
    expect(
      textOverlaySchema.safeParse({ id: "t", content: "x", sound: "pop" }).success,
    ).toBe(false);
    expect(
      textOverlaySchema.safeParse({ id: "t", content: "x", soundVolume: 1.5 }).success,
    ).toBe(false);
  });

  it("lewat patch updateScene: dinyalakan, di-undo, dan op inversnya mengembalikan keadaan lama", () => {
    const plan = dengan({ sound: "none" });
    const teks = plan.scenes[0]!.texts.map((t) => ({ ...t, sound: "ketik" as const }));
    const hasil = applyPatch(
      plan,
      [{ op: "updateScene", id: "sc-001", patch: { texts: teks } }],
      {
        origin: "user",
      },
    );
    expect(hasil.plan.scenes[0]?.texts[0]?.sound).toBe("ketik");
    const balik = applyPatch(hasil.plan, hasil.applied.inverse, { origin: "user" });
    expect(balik.plan.scenes[0]?.texts[0]?.sound).toBe("none");
  });
});

describe("kritik: ketik-tanpa-typewriter", () => {
  it("bunyi ketik pada animasi lain dilaporkan SENYAP, dengan jalan keluarnya", () => {
    const plan = dengan({ anim: "pop" });
    expect(kode(plan)).toContain("ketik-tanpa-typewriter");
    const pesan = critiquePlan(plan).find((n) => n.code === "ketik-tanpa-typewriter")!;
    expect(pesan.message).toContain("SENYAP");
    expect(pesan.message).toContain("typewriter");
    expect(pesan.sceneId).toBe("sc-001");
  });

  it("typewriter + ketik, atau tanpa bunyi sama sekali, tidak dilaporkan", () => {
    expect(kode(dengan({}))).not.toContain("ketik-tanpa-typewriter");
    expect(kode(dengan({ anim: "pop", sound: "none" }))).not.toContain(
      "ketik-tanpa-typewriter",
    );
  });
});

describe("kritik: ketik-terpotong", () => {
  it("teks yang tak sempat selesai diketik dilaporkan beserta berapa huruf yang tampil", () => {
    // 60 huruf butuh 59 x 3 bingkai = 5,9 dtk; jendelanya 2 dtk (scene 4 dtk x 0,5).
    const plan = dengan(
      { content: "x".repeat(60), startFrac: 0, endFrac: 0.5, sound: "none" },
      4,
    );
    const catatan = critiquePlan(plan).find((n) => n.code === "ketik-terpotong");
    expect(catatan).toBeDefined();
    expect(catatan?.message).toContain("dari 60 huruf");
    // 2 dtk x 30 fps / 3 bingkai = 20 -> 21 huruf sempat tampil (indeks 0..20).
    expect(catatan?.message).toContain("baru 21 dari 60");
  });

  it("teks yang muat, atau yang kurang satu-dua huruf, tidak dilaporkan", () => {
    expect(kode(dengan({ content: "Halo dunia" }))).not.toContain("ketik-terpotong");
    const batas = Math.floor((6 * 30) / TYPEWRITER_FRAMES_PER_CHAR) + 1;
    expect(kode(dengan({ content: "x".repeat(batas) }, 6))).not.toContain(
      "ketik-terpotong",
    );
  });

  it("hanya berlaku untuk animasi typewriter", () => {
    expect(
      kode(dengan({ anim: "pop", content: "x".repeat(300), sound: "none" })),
    ).not.toContain("ketik-terpotong");
  });

  it("tidak mengganggu plan yang tidak punya teks ketik", () => {
    const plan = parseScenePlan(basePlanInput());
    expect(critiquePlan(plan).map((n) => n.code)).not.toContain("ketik-terpotong");
    expect(critiquePlan(plan).map((n) => n.code)).not.toContain("ketik-tanpa-typewriter");
  });
});
