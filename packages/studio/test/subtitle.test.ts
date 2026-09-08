import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PublishRequest, PublishTarget } from "@dalang/pipeline";
import { afterEach, describe, expect, it } from "vitest";
import { call, callJson, collectSse, makeStudio, makeTempProject } from "./helpers";

/**
 * Berkas subtitle lewat Studio (ADR-0039).
 *
 * Yang dijaga di sini bukan isi kartunya — itu diuji di @dalang/templates —
 * melainkan hal-hal yang cuma bisa salah di permukaan: berkasnya benar-benar
 * ada di disk dengan nama yang bisa ditemukan orang, peringatan "waktu masih
 * ditaksir" muncul saat memang begitu, dan publikasi mengirim subtitle yang
 * DITULIS ULANG saat itu juga, bukan berkas lama yang tertinggal di folder.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

type SubtitleBody = {
  file: string;
  cues: number;
  durationMs: number;
  language: string;
  estimated: number;
  narrated: number;
};

const boot = (target?: PublishTarget) => {
  const { dir, planPath } = makeTempProject();
  const studio = makeStudio(planPath, target ? { publishTargets: () => [target] } : {});
  cleanups.push(() => {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { studio, dir, planPath };
};

const post = <T>(
  studio: ReturnType<typeof boot>["studio"],
  path: string,
  body: unknown,
) => callJson<T>(studio, path, { method: "POST", body: JSON.stringify(body) });

describe("/api/subtitle (ADR-0039)", () => {
  it("menulis berkas SRT di samping plan.json dengan nama proyek + bahasa", async () => {
    const { studio, dir } = boot();
    const response = await post<SubtitleBody>(studio, "/api/subtitle", { format: "srt" });
    expect(response.status).toBe(200);
    expect(response.body.file).toBe("proyek-uji.id.srt");
    expect(response.body.language).toBe("id");
    expect(response.body.cues).toBeGreaterThan(0);

    const berkas = join(dir, "proyek-uji.id.srt");
    expect(existsSync(berkas)).toBe(true);
    const isi = readFileSync(berkas, "utf8");
    expect(isi.startsWith("1\n")).toBe(true);
    expect(isi).toContain(" --> ");
  });

  it("format vtt menghasilkan berkas VTT, bukan SRT bernama .vtt", async () => {
    const { studio, dir } = boot();
    const response = await post<SubtitleBody>(studio, "/api/subtitle", { format: "vtt" });
    expect(response.body.file).toBe("proyek-uji.id.vtt");
    const isi = readFileSync(join(dir, "proyek-uji.id.vtt"), "utf8");
    expect(isi.startsWith("WEBVTT\n\n")).toBe(true);
    // Cap waktu VTT tidak boleh memakai koma sama sekali.
    expect(isi).not.toMatch(/\d\d:\d\d:\d\d,\d\d\d/);
  });

  it("melaporkan berapa scene yang waktunya masih DITAKSIR", async () => {
    // Plan uji belum pernah lewat TTS, jadi kedua scene bernarasi masih
    // ditaksir. Angka inilah yang dipakai UI untuk memperingatkan.
    const { studio } = boot();
    const response = await post<SubtitleBody>(studio, "/api/subtitle", {});
    expect(response.body.narrated).toBe(2);
    expect(response.body.estimated).toBe(2);
  });

  it("body kosong sah: bawaannya SRT", async () => {
    const { studio } = boot();
    const response = await callJson<SubtitleBody>(studio, "/api/subtitle", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(response.body.file.endsWith(".srt")).toBe(true);
  });
});

describe("subtitle ikut publikasi (ADR-0039)", () => {
  const fakeTarget = () => {
    const calls: PublishRequest[] = [];
    const target: PublishTarget & { calls: PublishRequest[] } = {
      id: "youtube-palsu",
      label: "YouTube (uji)",
      calls,
      publish: async (request) => {
        calls.push(request);
        request.onProgress?.(1);
        return {
          providerId: "youtube-palsu",
          videoId: "vid-1",
          url: "https://youtu.be/vid-1",
          ...(request.subtitle ? { subtitleUploaded: true } : {}),
        };
      },
    };
    return target;
  };

  it("mengirim berkas subtitle yang ditulis SEGAR, bukan sisa berkas lama", async () => {
    const target = fakeTarget();
    const { studio, dir } = boot(target);

    // Berkas basi dengan nama yang sama persis: kalau publikasi cuma memungut
    // berkas yang kebetulan ada, isinya akan lolos ke kanal orang.
    const basi = join(dir, ".dalang", "subtitle.id.srt");
    mkdirSync(join(dir, ".dalang"), { recursive: true });
    writeFileSync(basi, "1\n00:00:00,000 --> 00:00:01,000\nTEKS BASI\n\n");

    const renderDone = call(studio, "/api/events").then((response) =>
      collectSse(response, (list) =>
        list.some(
          (event) => event.event === "render" && JSON.parse(event.data).status === "done",
        ),
      ),
    );
    expect((await post(studio, "/api/render", { profile: "draft" })).status).toBe(202);
    await renderDone;

    const publishDone = call(studio, "/api/events").then((response) =>
      collectSse(response, (list) =>
        list.some(
          (event) =>
            event.event === "publish" &&
            ["done", "error"].includes(JSON.parse(event.data).status),
        ),
      ),
    );
    const started = await post(studio, "/api/publish", {
      file: "preview.mp4",
      confirm: true,
    });
    expect(started.status).toBe(202);
    await publishDone;

    const request = target.calls[0];
    if (!request) throw new Error("tujuan tidak pernah dipanggil");
    expect(request.subtitle?.language).toBe("id");
    const subPath = request.subtitle?.path ?? "";
    expect(subPath.startsWith(join(dir, ".dalang"))).toBe(true);
    expect(subPath).toBe(basi);
    expect(existsSync(subPath)).toBe(true);
    const isi = readFileSync(subPath, "utf8");
    expect(isi).toContain(" --> ");
    expect(isi).not.toContain("TEKS BASI");
  });
});
