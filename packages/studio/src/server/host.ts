import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defaultMemoryPath, fileMemoryStore, type MemoryStore } from "@dalang/agent";
import {
  addMemoryEntry,
  MAX_MEMORY_TEXT,
  MEMORY_KINDS,
  removeMemoryEntry,
} from "@dalang/core";
import { fromFcpxml, fromOtio } from "@dalang/interop";
import { templatesPublicDir } from "@dalang/templates/paths";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { z } from "zod";
import type { WorkspacePayload } from "../shared/api-types";
import { type CreateStudioOptions, createStudioApp, type Studio } from "./app";
import {
  createProject,
  createProjectFromPlan,
  duplicateProject,
  listProjects,
  projectIdOf,
  renameClosedProject,
  trashProject,
  type WorkspaceProject,
} from "./workspace";

/**
 * Host studio: SATU port, banyak proyek.
 *
 * Aplikasi proyek (`createStudioApp`) dibangun dari satu ProjectSession dan
 * memegangnya seumur hidup — itu properti yang bagus dan tidak ingin kami
 * rusak demi lobi. Jadi berpindah proyek TIDAK menukar sesi di dalam app;
 * ia membuang app-nya dan membangun yang baru. Yang tetap hidup hanyalah
 * host: port, berkas UI, dan rute /api/workspace.
 *
 * Konsekuensinya jelas dan disengaja: satu proyek terbuka pada satu waktu,
 * per server. Editor video bukan peramban — dua proyek terbuka bersamaan
 * berarti dua render, dua pipeline, dan dua anggaran yang saling menutupi.
 */

const memoryBody = z.object({
  jenis: z.enum(MEMORY_KINDS),
  teks: z.string().min(3).max(MAX_MEMORY_TEXT),
});

const newProjectBody = z.object({
  title: z.string().min(1).max(120),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  stylePreset: z.string().min(1).max(64),
  format: z.string().min(1).max(32),
});
const idBody = z.object({ id: z.string().min(1) });
const importBody = z.object({
  /** Isi berkas .otio (JSON) atau .fcpxml (XML), apa adanya. */
  isi: z.string().min(2).max(24_000_000),
  judul: z.string().min(1).max(120).optional(),
});
const WORKSPACE_RENDER =
  /^\/api\/workspace\/render\/[^/]+\/\.dalang\/renders\/[^/]+\.(mp4|webm|mov)$/;
const renameBody = z.object({ id: z.string().min(1), title: z.string().min(1).max(120) });

const errorPayload = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
});

/** id folder tidak boleh keluar dari workspace lewat "..", "/" atau NUL. */
const safeId = (root: string, id: string): string => {
  if (id === "" || /[/\\\0]/.test(id) || id === "." || id === "..") {
    throw new Error(`Id proyek "${id}" tidak sah`);
  }
  const dir = resolve(root, id);
  if (dirname(dir) !== resolve(root)) throw new Error(`Id proyek "${id}" tidak sah`);
  return id;
};

export interface StudioHostOptions
  extends Omit<CreateStudioOptions, "planPath" | "memory"> {
  /** Folder induk berisi folder-folder proyek. */
  workspaceRoot: string;
  /** Proyek yang langsung dibuka saat start; kosong = mulai di lobi. */
  planPath?: string;
  /**
   * Berkas memori preferensi (ADR-0029); bawaan `$DALANG_HOME/memori.json`.
   * Tes memberi path sementara supaya tidak menyentuh rumah pengguna.
   */
  memoryPath?: string;
}

export class StudioHost {
  readonly app = new Hono();
  readonly workspaceRoot: string;
  /** Memori preferensi lintas proyek — satu untuk seluruh lobi (ADR-0029). */
  readonly memory: MemoryStore;
  private studio: Studio | null = null;
  private readonly options: StudioHostOptions;
  private pinnedId: string | null = null;

  constructor(options: StudioHostOptions) {
    this.options = options;
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.memory = fileMemoryStore(options.memoryPath ?? defaultMemoryPath());
    if (options.planPath) {
      this.openPlan(options.planPath);
      this.pinnedId = projectIdOf(options.planPath);
    }
    this.registerWorkspaceRoutes();
    this.registerRenderPoster();
    this.registerAppShell();
    this.registerDelegate();
  }

  get current(): Studio | null {
    return this.studio;
  }

  /** Path plan proyek yang sedang terbuka (untuk pesan CLI). */
  get openPlanPath(): string | null {
    return this.studio?.store.session.paths.planPath ?? null;
  }

  // -- siklus hidup proyek ---------------------------------------------------

  private openPlan(planPath: string): void {
    this.closeProject();
    const {
      workspaceRoot: _drop,
      planPath: _drop2,
      memoryPath: _drop3,
      ...rest
    } = this.options;
    this.studio = createStudioApp({ ...rest, planPath, memory: this.memory });
  }

  /**
   * Menutup proyek berarti menutup handle SQLite dan fs.watch-nya. Panel yang
   * masih tersambung diberi tahu lebih dulu supaya mereka menutup SSE-nya
   * sendiri dan kembali ke lobi, bukan menggantung pada bus yang sudah mati.
   */
  private closeProject(): void {
    const studio = this.studio;
    if (!studio) return;
    studio.store.bus.emit({ type: "project-closed" });
    this.studio = null;
    studio.close();
  }

  /** Tolak pindah proyek saat ada pekerjaan berjalan — render/TTS tidak boleh terpotong. */
  private assertIdle(): void {
    const busy = this.studio?.store.busy;
    if (!busy) return;
    if (busy.render) {
      throw new Error(`Ekspor "${busy.render}" sedang berjalan — tunggu sampai selesai`);
    }
    if (busy.mutation) {
      throw new Error(
        `Pekerjaan "${busy.mutation}" sedang berjalan — tunggu sampai selesai`,
      );
    }
  }

  private payload(): WorkspacePayload {
    const session = this.studio?.store.session;
    return {
      root: this.workspaceRoot,
      projects: listProjects(this.workspaceRoot).map(
        ({ dir: _dir, planPath: _planPath, ...lite }) => lite,
      ),
      open: session
        ? {
            id: projectIdOf(session.paths.planPath),
            title: session.plan?.meta.title ?? basename(session.paths.planDir),
            planPath: session.paths.planPath,
          }
        : null,
      pinned: this.pinnedId !== null,
    };
  }

  private lite(project: WorkspaceProject) {
    const { dir: _dir, planPath: _planPath, ...rest } = project;
    return rest;
  }

  // -- rute ------------------------------------------------------------------

  private registerWorkspaceRoutes(): void {
    const { app } = this;

    app.get("/api/workspace", (c) => c.json(this.payload()));

    // -- memori preferensi lintas proyek (ADR-0029) --------------------------
    // Milik lobi, bukan proyek: satu berkas untuk semua proyek, terlihat dan
    // bisa dihapus di sini — agent tidak boleh punya ingatan yang tersembunyi.
    app.get("/api/workspace/memory", (c) =>
      c.json({ ok: true, memory: this.memory.read() }),
    );

    app.post("/api/workspace/memory", async (c) => {
      const body = memoryBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) {
        return c.json(
          {
            error:
              "Body tidak valid: butuh jenis (gaya|suara|format|larangan|catatan) dan teks 3-240 karakter",
          },
          400,
        );
      }
      const result = addMemoryEntry(this.memory.read(), {
        kind: body.data.jenis,
        text: body.data.teks,
        source: "user",
        projectId: this.studio?.store.session.projectId ?? null,
      });
      if (!result.ok) return c.json({ error: result.reason }, 400);
      if (!result.duplicate) this.memory.write(result.memory);
      return c.json({
        ok: true,
        entry: result.entry,
        duplicate: result.duplicate,
        memory: result.memory,
      });
    });

    app.delete("/api/workspace/memory/:id", (c) => {
      const { memory, removed } = removeMemoryEntry(
        this.memory.read(),
        c.req.param("id"),
      );
      if (!removed) return c.json({ error: "Preferensi tidak ditemukan" }, 404);
      this.memory.write(memory);
      return c.json({ ok: true, removed, memory });
    });

    app.post("/api/workspace/create", async (c) => {
      const body = newProjectBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) {
        return c.json(
          { error: "Body tidak valid: butuh judul, rasio, gaya, format" },
          400,
        );
      }
      try {
        this.assertIdle();
        const project = createProject(this.workspaceRoot, body.data);
        this.openPlan(project.planPath);
        return c.json({
          ok: true,
          project: this.lite(project),
          workspace: this.payload(),
        });
      } catch (error) {
        return c.json(errorPayload(error), 400);
      }
    });

    /**
     * Proyek baru dari berkas interchange (ADR-0023).
     *
     * Isinya dikirim sebagai teks, bukan multipart: .otio dan .fcpxml adalah
     * berkas teks berukuran kilobyte, dan jalur JSON yang sudah ada jauh lebih
     * sedikit permukaannya daripada penanganan unggahan biner.
     *
     * Aset TIDAK ikut. Berkas interchange menunjuk berkas di mesin asalnya,
     * dan menyalinnya diam-diam ke folder proyek adalah kejutan bergigabyte —
     * jadi impor menghasilkan kerangka, dan catatannya mengatakan itu.
     */
    app.post("/api/workspace/import", async (c) => {
      const body = importBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "Body tidak valid: butuh { isi }" }, 400);
      try {
        this.assertIdle();
        const raw = body.data.isi;
        // Bentuknya yang menentukan, bukan namanya: berkas dari perkakas lain
        // sering tiba dengan ekstensi yang salah.
        const looksXml = raw.trimStart().startsWith("<");
        const projectDir = this.workspaceRoot;
        const result = looksXml
          ? fromFcpxml(raw, {
              projectDir,
              ...(body.data.judul ? { title: body.data.judul } : {}),
            })
          : fromOtio(JSON.parse(raw), {
              projectDir,
              ...(body.data.judul ? { title: body.data.judul } : {}),
            });
        const project = createProjectFromPlan(
          this.workspaceRoot,
          body.data.judul ?? result.plan.meta.title,
          result.plan,
        );
        this.openPlan(project.planPath);
        return c.json({
          ok: true,
          project: this.lite(project),
          workspace: this.payload(),
          // Sama seperti ekspor: yang tidak ikut menyeberang HARUS sampai ke
          // orangnya, bukan berhenti di server.
          catatan: result.notes.map((note) => note.detail),
        });
      } catch (error) {
        return c.json(errorPayload(error), 400);
      }
    });

    app.post("/api/workspace/open", async (c) => {
      const body = idBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "Body tidak valid: butuh { id }" }, 400);
      try {
        this.assertIdle();
        const id = safeId(this.workspaceRoot, body.data.id);
        const planPath = join(this.workspaceRoot, id, "plan.json");
        if (!existsSync(planPath)) {
          return c.json({ error: `Proyek "${id}" tidak punya plan.json` }, 404);
        }
        this.openPlan(planPath);
        this.pinnedId = null; // pilihan pengguna menggantikan proyek dari baris perintah
        return c.json({ ok: true, workspace: this.payload() });
      } catch (error) {
        return c.json(errorPayload(error), 409);
      }
    });

    app.post("/api/workspace/close", (c) => {
      try {
        this.assertIdle();
        this.closeProject();
        this.pinnedId = null;
        return c.json({ ok: true, workspace: this.payload() });
      } catch (error) {
        return c.json(errorPayload(error), 409);
      }
    });

    app.post("/api/workspace/rename", async (c) => {
      const body = renameBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        return c.json({ error: "Body tidak valid: butuh { id, title }" }, 400);
      try {
        const id = safeId(this.workspaceRoot, body.data.id);
        const title = body.data.title.trim();
        if (title === "") throw new Error("Judul proyek tidak boleh kosong");
        // Proyek yang terbuka diganti judulnya lewat patch sesi: satu penulis,
        // dan hasilnya masuk riwayat sehingga bisa di-undo seperti edit lain.
        if (this.isOpen(id)) {
          this.studio?.store.applyUserPatch([{ op: "setMeta", patch: { title } }]);
        } else {
          renameClosedProject(this.workspaceRoot, id, title);
        }
        return c.json({ ok: true, workspace: this.payload() });
      } catch (error) {
        return c.json(errorPayload(error), 400);
      }
    });

    app.post("/api/workspace/duplicate", async (c) => {
      const body = idBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "Body tidak valid: butuh { id }" }, 400);
      try {
        const id = safeId(this.workspaceRoot, body.data.id);
        const project = duplicateProject(this.workspaceRoot, id);
        return c.json({
          ok: true,
          project: this.lite(project),
          workspace: this.payload(),
        });
      } catch (error) {
        return c.json(errorPayload(error), 400);
      }
    });

    app.post("/api/workspace/trash", async (c) => {
      const body = idBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "Body tidak valid: butuh { id }" }, 400);
      try {
        this.assertIdle();
        const id = safeId(this.workspaceRoot, body.data.id);
        if (this.isOpen(id)) this.closeProject(); // lepaskan handle sebelum folder pindah
        const { trashedTo } = trashProject(this.workspaceRoot, id);
        return c.json({ ok: true, trashedTo, workspace: this.payload() });
      } catch (error) {
        return c.json(errorPayload(error), 409);
      }
    });
  }

  /**
   * Ekspor terbaru tiap proyek, supaya kartu di lobi bisa memutar hasilnya.
   * Hanya berkas video di `<proyek>/.dalang/renders/` yang boleh lewat: sisi
   * `.dalang` lain (pipeline.db, riwayat chat, log patch) tetap tertutup —
   * aturan yang sama dengan mount media proyek yang sedang terbuka.
   */
  private registerRenderPoster(): void {
    this.app.use("/api/workspace/render/*", async (c, next) => {
      const path = decodeURIComponent(c.req.path);
      if (!WORKSPACE_RENDER.test(path) || path.split("/").includes("..")) {
        return c.json({ error: "Tidak tersedia" }, 404);
      }
      return serveStatic({
        root: this.workspaceRoot,
        rewriteRequestPath: (requestPath) =>
          requestPath.replace(/^\/api\/workspace\/render/, ""),
      })(c, next);
    });
  }

  private isOpen(id: string): boolean {
    const planPath = this.studio?.store.session.paths.planPath;
    return planPath !== undefined && projectIdOf(planPath) === id;
  }

  /**
   * Berkas UI disajikan HOST, bukan app proyek: lobi harus bisa dimuat justru
   * ketika belum ada proyek yang terbuka.
   */
  private registerAppShell(): void {
    const dist = this.options.appDistDir;
    if (dist && existsSync(join(dist, "index.html"))) {
      this.app.use("/app/*", serveStatic({ root: dist }));
      this.app.get("/", serveStatic({ root: dist, path: "index.html" }));
      return;
    }
    this.app.get("/", (c) =>
      c.text(
        "Dalang Studio API aktif, tapi app UI belum ter-build.\n" +
          "Jalankan: pnpm --filter @dalang/studio build\n" +
          "(atau mode dev: pnpm --filter @dalang/studio dev)\n",
        200,
      ),
    );
  }

  /**
   * Sisanya milik app proyek. Request diteruskan APA ADANYA (`c.req.raw`)
   * supaya header Range, body, dan stream SSE tidak tersentuh.
   */
  private registerDelegate(): void {
    // Aset situs (font, bed musik) tidak bergantung proyek — di lobi pun
    // preview kartu harus punya fontnya.
    for (const dir of ["fonts", "music"]) {
      this.app.use(`/${dir}/*`, serveStatic({ root: templatesPublicDir }));
    }
    this.app.all("*", (c) => {
      const studio = this.studio;
      if (!studio) {
        // 409 hanya untuk API: itu memang "state server belum siap". Berkas
        // (favicon, aset) yang tidak ada tetap 404 — kalau tidak, konsol
        // peramban di lobi penuh galat yang tidak berarti apa-apa.
        return c.req.path.startsWith("/api/")
          ? c.json({ error: "Belum ada proyek terbuka", code: "no-project" }, 409)
          : c.json({ error: "Tidak ditemukan" }, 404);
      }
      return studio.app.fetch(c.req.raw);
    });
  }

  close(): void {
    this.closeProject();
  }
}
