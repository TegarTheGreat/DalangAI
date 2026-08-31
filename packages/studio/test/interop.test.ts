import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { callJson, makeStudio, makeTempProject, postJson } from "./helpers";

/**
 * Rute /api/timeline-export (ADR-0023).
 *
 * Yang dikunci: berkasnya benar-benar ditulis DI SAMPING plan.json (bukan
 * diunduh browser, karena asetnya dirujuk dengan path mesin ini), dan daftar
 * "tidakIkut" selalu ikut ke UI.
 */

interface ExportBody {
  ok: true;
  berkas: string;
  nama: string;
  trek: number;
  klip: number;
  detik: number;
  tidakIkut: string[];
}

describe("/api/timeline-export (ADR-0023)", () => {
  it("menulis .otio di samping plan.json dan melaporkan yang tidak ikut", async () => {
    const project = makeTempProject();
    const studio = makeStudio(project.planPath);
    const { status, body } = await callJson<ExportBody>(
      studio,
      "/api/timeline-export",
      postJson({}),
    );
    expect(status).toBe(200);
    expect(body.nama).toBe("timeline.otio");
    expect(body.berkas).toBe(join(dirname(project.planPath), "timeline.otio"));
    expect(existsSync(body.berkas)).toBe(true);
    expect(JSON.parse(readFileSync(body.berkas, "utf8")).OTIO_SCHEMA).toBe("Timeline.1");
    // Daftar ini adalah fiturnya, bukan tambahan: plan uji punya caption dan
    // scene tanpa aset, jadi ia tidak boleh kosong.
    expect(body.tidakIkut.length).toBeGreaterThan(0);
  });

  it("format fcpxml menulis XML yang berkerangka FCPXML", async () => {
    const project = makeTempProject();
    const studio = makeStudio(project.planPath);
    const { body } = await callJson<ExportBody>(
      studio,
      "/api/timeline-export",
      postJson({ format: "fcpxml" }),
    );
    expect(body.nama).toBe("timeline.fcpxml");
    const xml = readFileSync(body.berkas, "utf8");
    expect(xml).toContain("<!DOCTYPE fcpxml>");
    expect(xml).toContain("<spine>");
  });

  it("menolak format yang tidak dikenal", async () => {
    const project = makeTempProject();
    const studio = makeStudio(project.planPath);
    const { status } = await callJson(
      studio,
      "/api/timeline-export",
      postJson({ format: "edl" }),
    );
    expect(status).toBe(400);
  });
});
