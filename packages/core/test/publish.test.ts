import { describe, expect, it } from "vitest";
import { defaultPublishMetadata, PUBLISH_TITLE_MAX, parseScenePlan } from "../src";

describe("defaultPublishMetadata (ADR-0030)", () => {
  const plan = parseScenePlan({
    version: 1,
    projectId: "uji-publish",
    meta: {
      title: "Sejarah Borobudur",
      aspectRatio: "9:16",
      language: "id",
      format: "klip",
    },
    audio: {},
    scenes: [
      { id: "a", narration: "Abad kesembilan.", clips: [{ id: "a-k1", type: "image" }] },
      { id: "b", narration: "  ", clips: [{ id: "b-k1", type: "image" }] },
      {
        id: "c",
        narration: "Candi terbesar di dunia.",
        clips: [{ id: "c-k1", type: "image" }],
      },
    ],
    renderState: { narrationAudio: {}, clipAssets: {} },
  });

  it("judul dari proyek, deskripsi dari narasi yang dibacakan, tag dari format, dan PRIVAT sebagai bawaan", () => {
    const meta = defaultPublishMetadata(plan);
    expect(meta.title).toBe("Sejarah Borobudur");
    expect(meta.description).toBe(
      "Abad kesembilan. Candi terbesar di dunia.\n\nDibuat dengan Dalang.",
    );
    expect(meta.tags).toEqual(["klip", "dalang"]);
    expect(meta.privacy).toBe("private");
    expect(meta.language).toBe("id");
  });

  it("memangkas judul ke batas YouTube tanpa memotong di tengah kata secara diam-diam", () => {
    const long = parseScenePlan({
      ...plan,
      meta: { ...plan.meta, title: "Judul ".repeat(40) },
    });
    const meta = defaultPublishMetadata(long);
    expect(meta.title.length).toBeLessThanOrEqual(PUBLISH_TITLE_MAX);
    expect(meta.title.endsWith("…")).toBe(true);
  });
});
