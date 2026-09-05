import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeTimeline, parseScenePlan } from "@dalang/core";
import { computeFrameLayout, FPS } from "@dalang/templates/layout";
import { afterEach, describe, expect, it } from "vitest";
import type { StudioHost } from "../src/server/index";
import { resolveEntry, slugify } from "../src/server/index";
import type { ProjectStatePayload, WorkspacePayload } from "../src/shared/api-types";
import { collectSse, hostCall, hostJson, makeHost, makePlan, postJson } from "./helpers";

/**
 * Lobi: satu port, banyak proyek. Yang diuji di sini bukan hanya "endpoint
 * menjawab 200", melainkan hal-hal yang benar-benar bisa menghilangkan
 * pekerjaan orang: proyek rusak tetap terlihat, buang = pindah bukan hapus,
 * dan pindah proyek ditolak saat ada job berjalan.
 */

const cleanups: Array<() => void> = [];

const makeWorkspace = (projects: Array<{ id: string; title?: string }> = []) => {
  const root = mkdtempSync(join(tmpdir(), "dalang-lobi-"));
  for (const project of projects) {
    const dir = join(root, project.id);
    mkdirSync(dir, { recursive: true });
    const plan = { ...makePlan(), projectId: project.id };
    if (project.title) plan.meta = { ...plan.meta, title: project.title };
    writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2));
  }
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

const boot = (root: string, planPath?: string): StudioHost => {
  const host = makeHost(root, planPath);
  cleanups.push(() => host.close());
  return host;
};

/** Tunggu sebuah kondisi server jadi benar (job latar tidak punya callback ke tes). */
const waitUntil = async (
  check: () => Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("kondisi tidak pernah terpenuhi");
};

const workspace = async (host: StudioHost) =>
  (await hostJson<WorkspacePayload>(host, "/api/workspace")).body;

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("daftar proyek", () => {
  it("mendaftar tiap folder ber-plan.json dengan ringkasan yang bisa dibaca", async () => {
    const root = makeWorkspace([
      { id: "borobudur", title: "Borobudur" },
      { id: "kopi", title: "Kopi Gayo" },
    ]);
    const state = await workspace(boot(root));

    expect(state.projects.map((p) => p.id).sort()).toEqual(["borobudur", "kopi"]);
    const borobudur = state.projects.find((p) => p.id === "borobudur");
    expect(borobudur).toMatchObject({
      title: "Borobudur",
      aspectRatio: "9:16",
      scenes: 3,
      valid: true,
      renders: 0,
    });
    expect(borobudur?.durationSec).toBeGreaterThan(0);
    expect(state.open).toBeNull();
  });

  it("proyek dengan plan rusak TETAP didaftar, ditandai tidak sah", async () => {
    const root = makeWorkspace([{ id: "sehat" }]);
    mkdirSync(join(root, "rusak"));
    writeFileSync(join(root, "rusak", "plan.json"), "{ bukan json");

    const state = await workspace(boot(root));
    const rusak = state.projects.find((p) => p.id === "rusak");
    expect(rusak?.valid).toBe(false);
    expect(rusak?.error).toBeTruthy();
    expect(rusak?.title).toBe("rusak"); // jatuh ke nama folder
  });

  it("folder tanpa plan.json dan folder tersembunyi diabaikan", async () => {
    const root = makeWorkspace([{ id: "nyata" }]);
    mkdirSync(join(root, "bukan-proyek"));
    mkdirSync(join(root, ".trash"));
    const state = await workspace(boot(root));
    expect(state.projects.map((p) => p.id)).toEqual(["nyata"]);
  });

  it("workspace kosong menjawab daftar kosong, bukan galat", async () => {
    const state = await workspace(boot(makeWorkspace()));
    expect(state.projects).toEqual([]);
    expect(state.open).toBeNull();
  });
});

describe("buka & tutup proyek", () => {
  it("tanpa proyek terbuka, rute proyek menjawab 409 no-project (bukan 404 samar)", async () => {
    const host = boot(makeWorkspace([{ id: "a" }]));
    const response = await hostJson<{ code: string }>(host, "/api/project");
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("no-project");
  });

  it("membuka proyek membuat seluruh API proyek hidup", async () => {
    const host = boot(makeWorkspace([{ id: "borobudur", title: "Borobudur" }]));
    const opened = await hostJson<{ workspace: WorkspacePayload }>(
      host,
      "/api/workspace/open",
      postJson({ id: "borobudur" }),
    );
    expect(opened.status).toBe(200);
    expect(opened.body.workspace.open?.title).toBe("Borobudur");

    const project = await hostJson<ProjectStatePayload>(host, "/api/project");
    expect(project.status).toBe(200);
    expect(project.body.plan?.meta.title).toBe("Borobudur");
  });

  it("pindah proyek menutup sesi lama dan memuat plan yang baru", async () => {
    const host = boot(
      makeWorkspace([
        { id: "a", title: "Satu" },
        { id: "b", title: "Dua" },
      ]),
    );
    await hostCall(host, "/api/workspace/open", postJson({ id: "a" }));
    const first = await hostJson<ProjectStatePayload>(host, "/api/project");
    expect(first.body.plan?.meta.title).toBe("Satu");

    await hostCall(host, "/api/workspace/open", postJson({ id: "b" }));
    const second = await hostJson<ProjectStatePayload>(host, "/api/project");
    expect(second.body.plan?.meta.title).toBe("Dua");
    expect(second.body.planPath).toContain(join("b", "plan.json"));
  });

  it("menutup proyek mengembalikan server ke lobi", async () => {
    const host = boot(makeWorkspace([{ id: "a" }]));
    await hostCall(host, "/api/workspace/open", postJson({ id: "a" }));
    const closed = await hostJson<{ workspace: WorkspacePayload }>(
      host,
      "/api/workspace/close",
      postJson({}),
    );
    expect(closed.body.workspace.open).toBeNull();
    expect((await hostJson(host, "/api/project")).status).toBe(409);
  });

  it("id di luar workspace ditolak, tidak pernah dipakai sebagai path", async () => {
    const host = boot(makeWorkspace([{ id: "a" }]));
    for (const id of ["../rahasia", "a/b", "..", "."]) {
      const response = await hostJson<{ error: string }>(
        host,
        "/api/workspace/open",
        postJson({ id }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.error).toMatch(/tidak sah|tidak valid/);
    }
  });

  it("proyek yang diminta lewat baris perintah langsung terbuka dan ditandai pinned", async () => {
    const root = makeWorkspace([{ id: "a", title: "Satu" }, { id: "b" }]);
    const host = boot(root, join(root, "a", "plan.json"));
    const state = await workspace(host);
    expect(state.open?.id).toBe("a");
    expect(state.pinned).toBe(true);
    expect(state.projects).toHaveLength(2); // lobi tetap memperlihatkan tetangganya
  });
});

describe("proyek baru", () => {
  it("membuat folder + plan sah, lalu langsung membukanya", async () => {
    const root = makeWorkspace();
    const host = boot(root);
    const created = await hostJson<{ project: { id: string; scenes: number } }>(
      host,
      "/api/workspace/create",
      postJson({
        title: "Sejarah Rempah",
        aspectRatio: "16:9",
        stylePreset: "documentary-01",
        format: "edukasi",
      }),
    );
    expect(created.status).toBe(200);
    expect(created.body.project.id).toBe("sejarah-rempah");
    expect(existsSync(join(root, "sejarah-rempah", "plan.json"))).toBe(true);

    // Proyek baru tidak boleh membuka ke layar kosong.
    expect(created.body.project.scenes).toBe(1);
    const project = await hostJson<ProjectStatePayload>(host, "/api/project");
    expect(project.body.plan?.meta.title).toBe("Sejarah Rempah");
    expect(project.body.plan?.meta.aspectRatio).toBe("16:9");
    expect(project.body.plan?.scenes).toHaveLength(1);
  });

  it("judul yang bertabrakan mendapat folder sendiri, bukan menimpa", async () => {
    const root = makeWorkspace();
    const host = boot(root);
    const body = postJson({
      title: "Kopi",
      aspectRatio: "9:16",
      stylePreset: "documentary-01",
      format: "klip",
    });
    await hostCall(host, "/api/workspace/create", body);
    const second = await hostJson<{ project: { id: string } }>(
      host,
      "/api/workspace/create",
      body,
    );
    expect(second.body.project.id).toBe("kopi-2");
    expect(readdirSync(root).sort()).toEqual(["kopi", "kopi-2"]);
  });

  it("judul kosong dan rasio asing ditolak sebelum ada folder yang lahir", async () => {
    const root = makeWorkspace();
    const host = boot(root);
    const kosong = await hostJson<{ error: string }>(
      host,
      "/api/workspace/create",
      postJson({
        title: "   ",
        aspectRatio: "9:16",
        stylePreset: "documentary-01",
        format: "klip",
      }),
    );
    expect(kosong.status).toBe(400);
    const rasio = await hostJson<{ error: string }>(
      host,
      "/api/workspace/create",
      postJson({
        title: "X",
        aspectRatio: "4:3",
        stylePreset: "documentary-01",
        format: "klip",
      }),
    );
    expect(rasio.status).toBe(400);
    expect(readdirSync(root)).toEqual([]);
  });

  it("judul non-latin tetap menghasilkan id yang aman", () => {
    expect(slugify("Sejarah 日本 & Kopi!!")).toBe("sejarah-kopi");
    expect(slugify("///")).toBe("proyek");
    expect(slugify("a".repeat(80))).toHaveLength(48);
  });
});

describe("kelola proyek", () => {
  it("ganti judul proyek tertutup menulis plan.json apa adanya", async () => {
    const root = makeWorkspace([{ id: "a", title: "Lama" }]);
    const host = boot(root);
    await hostCall(host, "/api/workspace/rename", postJson({ id: "a", title: "Baru" }));
    const plan = JSON.parse(readFileSync(join(root, "a", "plan.json"), "utf8"));
    expect(plan.meta.title).toBe("Baru");
  });

  it("ganti judul proyek TERBUKA lewat patch sesi, sehingga bisa di-undo", async () => {
    const root = makeWorkspace([{ id: "a", title: "Lama" }]);
    const host = boot(root, join(root, "a", "plan.json"));
    await hostCall(host, "/api/workspace/rename", postJson({ id: "a", title: "Baru" }));

    const project = await hostJson<ProjectStatePayload>(host, "/api/project");
    expect(project.body.plan?.meta.title).toBe("Baru");
    expect(project.body.patchLog.canUndo).toBe(true);

    await hostCall(host, "/api/undo", { method: "POST" });
    const after = await hostJson<ProjectStatePayload>(host, "/api/project");
    expect(after.body.plan?.meta.title).toBe("Lama");
  });

  it("salinan proyek TIDAK membawa .dalang (cache, ledger biaya, riwayat)", async () => {
    const root = makeWorkspace([{ id: "a", title: "Asal" }]);
    mkdirSync(join(root, "a", ".dalang", "renders"), { recursive: true });
    writeFileSync(join(root, "a", ".dalang", "pipeline.db"), "x");
    writeFileSync(join(root, "a", ".dalang", "renders", "final.mp4"), "x");
    mkdirSync(join(root, "a", "assets"), { recursive: true });
    writeFileSync(join(root, "a", "assets", "gambar.jpg"), "x");

    const host = boot(root);
    const copy = await hostJson<{
      project: { id: string; title: string; renders: number };
    }>(host, "/api/workspace/duplicate", postJson({ id: "a" }));
    const id = copy.body.project.id;
    expect(copy.body.project.title).toBe("Asal (salinan)");
    expect(existsSync(join(root, id, "assets", "gambar.jpg"))).toBe(true);
    expect(existsSync(join(root, id, ".dalang"))).toBe(false);
    expect(copy.body.project.renders).toBe(0);
    // projectId ikut folder barunya, bukan warisan asalnya
    expect(JSON.parse(readFileSync(join(root, id, "plan.json"), "utf8")).projectId).toBe(
      id,
    );
  });

  it("buang proyek MEMINDAHKAN ke .trash, tidak menghapus", async () => {
    const root = makeWorkspace([{ id: "a" }, { id: "b" }]);
    const host = boot(root);
    const trashed = await hostJson<{ trashedTo: string; workspace: WorkspacePayload }>(
      host,
      "/api/workspace/trash",
      postJson({ id: "a" }),
    );
    expect(trashed.status).toBe(200);
    expect(existsSync(join(root, "a"))).toBe(false);
    expect(existsSync(join(trashed.body.trashedTo, "plan.json"))).toBe(true);
    expect(trashed.body.workspace.projects.map((p) => p.id)).toEqual(["b"]);
  });

  it("membuang proyek yang sedang terbuka menutup sesinya lebih dulu", async () => {
    const root = makeWorkspace([{ id: "a" }]);
    const host = boot(root, join(root, "a", "plan.json"));
    const trashed = await hostJson<{ workspace: WorkspacePayload }>(
      host,
      "/api/workspace/trash",
      postJson({ id: "a" }),
    );
    expect(trashed.body.workspace.open).toBeNull();
    expect((await hostJson(host, "/api/project")).status).toBe(409);
  });
});

describe("resolveEntry", () => {
  it("folder ber-plan.json = proyek; folder lain = lobi; file = proyek", () => {
    const root = makeWorkspace([{ id: "a" }]);
    expect(resolveEntry(join(root, "a"))).toEqual({
      mode: "project",
      planPath: join(root, "a", "plan.json"),
    });
    expect(resolveEntry(root)).toEqual({ mode: "workspace", root });
    expect(resolveEntry(join(root, "a", "plan.json"))).toEqual({
      mode: "project",
      planPath: join(root, "a", "plan.json"),
    });
  });
});

describe("pindah proyek saat sibuk", () => {
  it("ekspor yang sedang berjalan menahan pindah/tutup/buang proyek", async () => {
    const root = makeWorkspace([{ id: "a" }, { id: "b" }]);
    const host = makeHost(root, join(root, "a", "plan.json"), { renderDelayMs: 400 });
    cleanups.push(() => host.close());

    // /api/render menjawab segera; job-nya berjalan di belakang.
    const accepted = await hostCall(
      host,
      "/api/render",
      postJson({ profile: "draft", confirm: true }),
    );
    expect(accepted.status).toBe(202);

    for (const path of [
      "/api/workspace/open",
      "/api/workspace/close",
      "/api/workspace/trash",
    ]) {
      const blocked = await hostJson<{ error: string }>(
        host,
        path,
        postJson({ id: "b" }),
      );
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toMatch(/sedang berjalan/);
    }

    await waitUntil(async () => {
      const state = await hostJson<ProjectStatePayload>(host, "/api/project");
      return state.body.busy.render === null;
    });
    // Setelah ekspor selesai, pindah proyek jalan seperti biasa.
    const moved = await hostJson<{ workspace: WorkspacePayload }>(
      host,
      "/api/workspace/open",
      postJson({ id: "b" }),
    );
    expect(moved.status).toBe(200);
    expect(moved.body.workspace.open?.id).toBe("b");
  });
});

describe("delegasi host ke app proyek", () => {
  it("SSE mengalir lewat host, dan penutupan proyek disiarkan lebih dulu", async () => {
    const root = makeWorkspace([{ id: "a" }]);
    const host = boot(root, join(root, "a", "plan.json"));

    const stream = await hostCall(host, "/api/events");
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const events = collectSse(stream, (list) =>
      list.some((event) => event.event === "project-closed"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await hostCall(host, "/api/workspace/close", postJson({}));

    const seen = await events;
    expect(seen[0]?.event).toBe("hello");
    expect(seen.at(-1)?.event).toBe("project-closed");
  });

  it("permintaan Range untuk media diteruskan utuh (206, bukan 200 penuh)", async () => {
    const root = makeWorkspace([{ id: "a" }]);
    mkdirSync(join(root, "a", "assets"), { recursive: true });
    writeFileSync(join(root, "a", "assets", "nada.wav"), Buffer.alloc(2048, 7));
    const host = boot(root, join(root, "a", "plan.json"));

    const response = await hostCall(host, "/assets/nada.wav", {
      headers: { Range: "bytes=0-99" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-99/2048");
  });
});

describe("pratinjau ekspor di kartu lobi", () => {
  it("menawarkan ekspor TERBARU dan menyajikannya dengan Range", async () => {
    const root = makeWorkspace([{ id: "a" }]);
    const renders = join(root, "a", ".dalang", "renders");
    mkdirSync(renders, { recursive: true });
    writeFileSync(join(renders, "lama.mp4"), Buffer.alloc(512, 1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeFileSync(join(renders, "ekspor-mp4-1080p-terbaik.mp4"), Buffer.alloc(1024, 2));

    const host = boot(root);
    const state = await workspace(host);
    const project = state.projects[0];
    expect(project?.renders).toBe(2);
    expect(project?.posterUrl).toBe(
      "/api/workspace/render/a/.dalang/renders/ekspor-mp4-1080p-terbaik.mp4",
    );

    const poster = await hostCall(host, project?.posterUrl ?? "", {
      headers: { Range: "bytes=0-15" },
    });
    expect(poster.status).toBe(206);
    expect(poster.headers.get("content-range")).toBe("bytes 0-15/1024");
  });

  it("berkas .dalang selain render TIDAK tersaji lewat rute ini", async () => {
    const root = makeWorkspace([{ id: "a" }]);
    mkdirSync(join(root, "a", ".dalang"), { recursive: true });
    writeFileSync(join(root, "a", ".dalang", "pipeline.db"), "rahasia");
    writeFileSync(join(root, "a", ".dalang", "chat-history.json"), "rahasia");
    const host = boot(root);

    for (const path of [
      "/api/workspace/render/a/.dalang/pipeline.db",
      "/api/workspace/render/a/.dalang/chat-history.json",
      "/api/workspace/render/a/plan.json",
      "/api/workspace/render/a/.dalang/renders/../../plan.json",
      "/api/workspace/render/a/.dalang/renders/%2e%2e/%2e%2e/plan.json",
    ]) {
      const response = await hostCall(host, path);
      expect([404, 409]).toContain(response.status);
      expect(await response.text()).not.toContain("rahasia");
    }
  });

  it("proyek tanpa ekspor tidak menjanjikan pratinjau", async () => {
    const state = await workspace(boot(makeWorkspace([{ id: "a" }])));
    expect(state.projects[0]?.posterUrl).toBeNull();
    expect(state.projects[0]?.accent).toBe("#E4A64C"); // aksen bawaan documentary-01
  });
});

describe("durasi yang ditampilkan lobi", () => {
  it("sama dengan durasi hasil render (transisi menindih), bukan jumlah durasi scene", async () => {
    const root = makeWorkspace([{ id: "a" }]);
    const plan = parseScenePlan(
      JSON.parse(readFileSync(join(root, "a", "plan.json"), "utf8")),
    );

    const sequential = computeTimeline(plan).totalSec;
    const rendered = computeFrameLayout(plan).totalFrames / FPS;
    expect(rendered).toBeLessThan(sequential); // plan uji punya transisi

    const state = await workspace(boot(root));
    expect(state.projects[0]?.durationSec).toBe(Number(rendered.toFixed(1)));
  });
});
