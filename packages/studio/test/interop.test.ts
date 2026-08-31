import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  callJson,
  hostCall,
  makeHost,
  makeStudio,
  makeTempProject,
  postJson,
} from "./helpers";

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

describe("/api/workspace/import (ADR-0023)", () => {
  const OTIO = JSON.stringify({
    OTIO_SCHEMA: "Timeline.1",
    name: "Dari Editor Lain",
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      children: [
        {
          OTIO_SCHEMA: "Track.1",
          kind: "Video",
          children: [
            {
              OTIO_SCHEMA: "Clip.1",
              name: "satu",
              source_range: {
                OTIO_SCHEMA: "TimeRange.1",
                duration: { OTIO_SCHEMA: "RationalTime.1", rate: 30, value: 90 },
                start_time: { OTIO_SCHEMA: "RationalTime.1", rate: 30, value: 0 },
              },
              media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: null },
            },
          ],
        },
      ],
    },
  });

  const FCPXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources><format id="r1" frameDuration="100/3000s" width="1920" height="1080"/></resources>
  <library><event name="E"><project name="Dari Final Cut">
    <sequence format="r1" duration="10s" tcStart="0s" tcFormat="NDF"><spine>
      <asset-clip name="klip" ref="r9" offset="0s" duration="4s"/>
    </spine></sequence>
  </project></event></library>
</fcpxml>`;

  it("membuat proyek baru dari .otio dan mengembalikan catatannya", async () => {
    const host = makeHost(mkdtempSync(join(tmpdir(), "dalang-impor-")));
    // hostCall mengembalikan Response mentah, bukan { status, body }.
    const response = await hostCall(
      host,
      "/api/workspace/import",
      postJson({ isi: OTIO }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      project: { title: string };
      catatan: string[];
    };
    expect(body.project.title).toBe("Dari Editor Lain");
    // Catatan HARUS ikut ke UI: impor yang diam soal apa yang hilang membuat
    // orang mengira kerangkanya adalah plan utuh.
    expect(body.catatan.some((note) => note.includes("kerangka"))).toBe(true);
    host.close();
  });

  it("mengenali FCPXML dari bentuknya, bukan dari nama berkasnya", async () => {
    const host = makeHost(mkdtempSync(join(tmpdir(), "dalang-impor-")));
    const response = await hostCall(
      host,
      "/api/workspace/import",
      postJson({ isi: FCPXML }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { project: { title: string } };
    expect(body.project.title).toBe("Dari Final Cut");
    host.close();
  });

  it("menolak berkas yang bukan keduanya dengan pesan, bukan proyek kosong", async () => {
    const host = makeHost(mkdtempSync(join(tmpdir(), "dalang-impor-")));
    const response = await hostCall(
      host,
      "/api/workspace/import",
      postJson({ isi: '{"bukan":"timeline"}' }),
    );
    expect(response.status).toBe(400);
    host.close();
  });
});
