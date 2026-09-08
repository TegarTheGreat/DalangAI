import { describe, expect, it } from "vitest";
import {
  conflictMessage,
  editorSchema,
  patchTouchKeys,
  sceneTouchKey,
  TOUCH_AUDIO,
  TOUCH_META,
  TOUCH_STRUCTURE,
  touchConflicts,
} from "../src/index";

/**
 * Bentrok antar penyunting (ADR-0038, roadmap §10.4).
 *
 * Aturan di sini yang menentukan kapan pekerjaan orang ditolak dan kapan
 * diterima, dan KEDUA arah salahnya mahal: terlalu longgar berarti dua orang
 * saling menimpa tanpa tahu, terlalu ketat berarti dua orang yang menyunting
 * scene berbeda saling menghalangi sampai fiturnya dimatikan.
 */

describe("patchTouchKeys", () => {
  it("op scene menyentuh PETAK SCENE-nya, bukan seluruh plan", () => {
    expect(
      patchTouchKeys([{ op: "updateScene", id: "sc-2", patch: { narration: "x" } }]),
    ).toEqual([sceneTouchKey("sc-2")]);
  });

  it("meta dan audio berdiri sendiri", () => {
    // Mengganti judul tidak boleh menghalangi siapa pun yang sedang menulis
    // narasi.
    expect(patchTouchKeys([{ op: "setMeta", patch: { title: "Baru" } }])).toEqual([
      TOUCH_META,
    ]);
    expect(patchTouchKeys([{ op: "setAudio", patch: { music: null } }])).toEqual([
      TOUCH_AUDIO,
    ]);
  });

  it("tambah/buang/urut scene menyentuh SUSUNAN", () => {
    expect(patchTouchKeys([{ op: "removeScene", id: "sc-2" }])).toEqual([
      TOUCH_STRUCTURE,
    ]);
    expect(patchTouchKeys([{ op: "reorderScenes", order: ["b", "a"] }])).toEqual([
      TOUCH_STRUCTURE,
    ]);
  });

  it("op klip menyentuh scene tempat klipnya hidup", () => {
    expect(
      patchTouchKeys([
        { op: "splitClip", sceneId: "sc-3", clipId: "k1", atSec: 1, newClipId: "k2" },
      ]),
    ).toEqual([sceneTouchKey("sc-3")]);
  });

  it("op yang tidak dikenal jatuh ke sisi AMAN, bukan ke 'tidak menyentuh apa pun'", () => {
    // Op baru yang lupa didaftarkan lalu bentrok dengan segalanya — jauh
    // lebih baik daripada op baru yang diam-diam tidak pernah dianggap
    // bentrok dengan apa pun.
    expect(patchTouchKeys([{ op: "opBaruYangBelumAda" } as never])).toEqual([
      TOUCH_STRUCTURE,
    ]);
  });
});

describe("touchConflicts", () => {
  it("dua scene berbeda TIDAK bentrok", () => {
    expect(touchConflicts([sceneTouchKey("a")], [sceneTouchKey("b")])).toEqual([]);
  });

  it("scene yang sama bentrok", () => {
    expect(touchConflicts([sceneTouchKey("a")], [sceneTouchKey("a")])).toEqual([
      sceneTouchKey("a"),
    ]);
  });

  it("perubahan SUSUNAN bentrok dengan suntingan scene mana pun", () => {
    // Membuang scene ketiga sementara orang lain menyuntingnya akan membuat
    // suntingan itu mendarat di scene yang sudah tidak ada — atau di scene
    // lain yang kebetulan naik ke posisinya.
    expect(touchConflicts([sceneTouchKey("a")], [TOUCH_STRUCTURE])).toEqual([
      sceneTouchKey("a"),
    ]);
    expect(touchConflicts([TOUCH_STRUCTURE], [sceneTouchKey("b")])).toEqual([
      sceneTouchKey("b"),
    ]);
    expect(touchConflicts([TOUCH_STRUCTURE], [TOUCH_STRUCTURE])).toEqual([
      TOUCH_STRUCTURE,
    ]);
  });

  it("meta tidak bentrok dengan scene, dan sebaliknya", () => {
    expect(touchConflicts([TOUCH_META], [sceneTouchKey("a")])).toEqual([]);
    expect(touchConflicts([sceneTouchKey("a")], [TOUCH_META])).toEqual([]);
    expect(touchConflicts([TOUCH_META], [TOUCH_META])).toEqual([TOUCH_META]);
  });

  it("tanpa perubahan dari pihak lain, tidak pernah ada bentrok", () => {
    expect(touchConflicts([TOUCH_STRUCTURE, sceneTouchKey("a")], [])).toEqual([]);
  });
});

describe("conflictMessage", () => {
  it("menyebut APA yang bentrok dan SIAPA, bukan cuma 'gagal'", () => {
    const pesan = conflictMessage([sceneTouchKey("sc-2"), TOUCH_META], "Rina");
    expect(pesan).toContain("Rina");
    expect(pesan).toContain("scene sc-2");
    expect(pesan).toContain("pengaturan proyek");
    // Penolakan yang tidak mengatakan bahwa pekerjaan ORANG LAIN sedang
    // dilindungi terbaca sebagai aplikasi yang rusak.
    expect(pesan).toContain("TIDAK dipakai");
  });
});

describe("editorSchema", () => {
  it("nama panjang ditolak, id pendek ditolak", () => {
    expect(editorSchema.safeParse({ id: "abc", name: "Rina" }).success).toBe(false);
    expect(
      editorSchema.safeParse({ id: "abcd1234", name: "x".repeat(200) }).success,
    ).toBe(false);
    expect(editorSchema.safeParse({ id: "abcd1234", name: "Rina" }).success).toBe(true);
  });
});
