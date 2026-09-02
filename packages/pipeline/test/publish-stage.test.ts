import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineDb } from "../src/db";
import type { PublishTarget } from "../src/ports";
import { projectPaths } from "../src/project-paths";
import { publishedRecordFor, publishRender } from "../src/publish-stage";

/**
 * Publikasi (ADR-0030) dengan tujuan PALSU: yang diuji ledger-nya — berkas
 * yang sama tidak diunggah dua kali, --force mengunggah lagi, kegagalan
 * tercatat dan tidak dianggap selesai.
 */
let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-publish-stage-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".dalang", "renders"), { recursive: true });
  const file = join(dir, ".dalang", "renders", "final.mp4");
  writeFileSync(file, "mp4-uji");
  const paths = projectPaths(join(dir, "plan.json"));
  const db = new PipelineDb(":memory:");
  cleanup.push(() => db.close());
  return { dir, file, paths, db };
};

const fakeTarget = (
  options: { fail?: string } = {},
): PublishTarget & { uploads: string[] } => {
  const target = {
    id: "palsu",
    label: "Tujuan palsu",
    uploads: [] as string[],
    publish: async (request: { filePath: string; onProgress?: (f: number) => void }) => {
      if (options.fail) throw new Error(options.fail);
      request.onProgress?.(0.5);
      request.onProgress?.(1);
      target.uploads.push(request.filePath);
      return {
        providerId: "palsu",
        videoId: `v${target.uploads.length}`,
        url: `https://palsu.test/v${target.uploads.length}`,
      };
    },
  };
  return target;
};

const META = {
  title: "Judul",
  description: "Deskripsi",
  tags: ["dalang"],
  privacy: "private" as const,
};

describe("publishRender", () => {
  it("mengunggah sekali, jalan kedua dari ledger, --force mengunggah lagi", async () => {
    const { file, paths, db } = project();
    const target = fakeTarget();
    const seen: number[] = [];
    const first = await publishRender({
      paths,
      db,
      projectId: "p",
      target,
      filePath: file,
      metadata: META,
      onProgress: (f) => seen.push(f),
    });
    expect(first.status).toBe("done");
    if (first.status !== "done") return;
    expect(first.record).toMatchObject({
      targetId: "palsu",
      videoId: "v1",
      url: "https://palsu.test/v1",
      privacy: "private",
    });
    expect(seen).toEqual([0.5, 1]);
    expect(publishedRecordFor(db, "p", paths, file)?.url).toBe("https://palsu.test/v1");

    const again = await publishRender({
      paths,
      db,
      projectId: "p",
      target,
      filePath: file,
      metadata: META,
    });
    expect(again.status).toBe("cached");
    expect(target.uploads).toHaveLength(1);

    const forced = await publishRender({
      paths,
      db,
      projectId: "p",
      target,
      filePath: file,
      metadata: META,
      force: true,
    });
    expect(forced.status).toBe("done");
    expect(target.uploads).toHaveLength(2);
  });

  it("berkas yang isinya berubah diunggah lagi; kegagalan tercatat, tidak dianggap selesai", async () => {
    const { file, paths, db } = project();
    const target = fakeTarget();
    await publishRender({
      paths,
      db,
      projectId: "p",
      target,
      filePath: file,
      metadata: META,
    });
    writeFileSync(file, "mp4-uji versi baru yang lebih panjang");
    const changed = await publishRender({
      paths,
      db,
      projectId: "p",
      target,
      filePath: file,
      metadata: META,
    });
    expect(changed.status).toBe("done");
    expect(target.uploads).toHaveLength(2);

    const broken = fakeTarget({ fail: "token kedaluwarsa" });
    const failed = await publishRender({
      paths,
      db,
      projectId: "p",
      target: broken,
      filePath: file,
      metadata: META,
      force: true,
    });
    expect(failed).toEqual({ status: "error", reason: "token kedaluwarsa" });
    expect(db.getRun("p", ".dalang/renders/final.mp4", "publish")?.status).toBe("error");
    expect(
      await publishRender({
        paths,
        db,
        projectId: "p",
        target: fakeTarget(),
        filePath: join(paths.planDir, "tidak-ada.mp4"),
        metadata: META,
      }),
    ).toMatchObject({ status: "error" });
  });
});
