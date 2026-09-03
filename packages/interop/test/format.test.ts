import { describe, expect, it } from "vitest";
import { toFcpxml } from "../src/fcpxml";
import { fromOtio } from "../src/from-otio";
import { otioToJson, toOtio } from "../src/otio";
import { buildEditTimeline } from "../src/timeline";
import { makePlan, tempProject } from "./helpers";

const timelineFor = (opts?: { siteAssetDir?: string }) => {
  const plan = makePlan();
  const project = tempProject(plan);
  return {
    plan,
    project,
    timeline: buildEditTimeline(plan, { planPath: project.planPath, ...opts }),
  };
};

describe("penulis OTIO", () => {
  it("memakai nama skema persis seperti berkas contoh resmi", () => {
    // Nama field OTIO seragam sampai membosankan; satu huruf yang salah bikin
    // berkasnya ditolak pembaca mana pun tanpa menyebut bagian yang salah.
    const { timeline } = timelineFor();
    const doc = toOtio(timeline) as Record<string, unknown>;
    expect(doc.OTIO_SCHEMA).toBe("Timeline.1");
    const stack = doc.tracks as Record<string, unknown>;
    expect(stack.OTIO_SCHEMA).toBe("Stack.1");
    const track = (stack.children as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    expect(track.OTIO_SCHEMA).toBe("Track.1");
    expect(track.kind).toBe("Video");
    const clip = (track.children as Record<string, unknown>[]).find(
      (child) => child.OTIO_SCHEMA === "Clip.1",
    ) as Record<string, unknown>;
    expect(clip.source_range).toMatchObject({ OTIO_SCHEMA: "TimeRange.1" });
    expect(clip.media_reference).toMatchObject({ OTIO_SCHEMA: "ExternalReference.1" });
  });

  it("waktu OTIO dalam FRAME dengan rate, bukan detik", () => {
    const { timeline } = timelineFor();
    const doc = toOtio(timeline) as Record<string, unknown>;
    const stack = doc.tracks as Record<string, unknown>;
    const track = (stack.children as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    const clip = (track.children as Record<string, unknown>[]).find(
      (child) => child.OTIO_SCHEMA === "Clip.1",
    ) as Record<string, unknown>;
    const source = clip.source_range as Record<string, Record<string, number>>;
    expect(source.duration?.rate).toBe(30);
    // Klip pertama yang punya aset = sc-batu; titik masuk 4 detik = 120 frame.
    expect(source.start_time?.value).toBe(120);
  });

  it("available_range null saat panjang sumber tidak diketahui", () => {
    // "Tidak tahu" adalah nilai yang sah di OTIO. Mengarang panjang di sini
    // membuat pembacanya memotong klip di tempat yang salah.
    const { timeline } = timelineFor();
    const doc = toOtio(timeline) as Record<string, unknown>;
    const stack = doc.tracks as Record<string, unknown>;
    const track = (stack.children as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    const clips = (track.children as Record<string, unknown>[]).filter(
      (child) => child.OTIO_SCHEMA === "Clip.1",
    );
    const image = clips.find((clip) => String(clip.name) === "sc-peta") as Record<
      string,
      unknown
    >;
    expect((image.media_reference as Record<string, unknown>).available_range).toBeNull();
  });

  it("slide ditulis Custom, cross-fade ditulis SMPTE_Dissolve", () => {
    const { timeline } = timelineFor();
    const doc = toOtio(timeline) as Record<string, unknown>;
    const stack = doc.tracks as Record<string, unknown>;
    const track = (stack.children as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    const transitions = (track.children as Record<string, unknown>[]).filter(
      (child) => child.OTIO_SCHEMA === "Transition.1",
    );
    expect(transitions.map((t) => t.transition_type)).toEqual([
      "SMPTE_Dissolve",
      "Custom",
    ]);
  });

  it("catatan ikut masuk ke berkasnya, bukan cuma ke terminal", () => {
    const { timeline } = timelineFor();
    const json = otioToJson(timeline);
    expect(json).toContain("tidakIkut");
    expect(json).toContain("Caption karaoke");
  });
});

describe("penulis FCPXML", () => {
  it("kerangka dokumen sesuai contoh resmi adapter OTIO", () => {
    const { timeline } = timelineFor();
    const xml = toFcpxml(timeline);
    expect(
      xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>'),
    ).toBe(true);
    expect(xml).toContain('<fcpxml version="1.8">');
    expect(xml).toContain("<resources>");
    expect(xml).toContain("<library>");
    expect(xml).toContain("<spine>");
    expect(xml).toContain('frameDuration="100/3000s"');
  });

  it("penyebut waktu kelipatan basis waktu, supaya tiap nilai jatuh di batas frame", () => {
    const { timeline } = timelineFor();
    const xml = toFcpxml(timeline);
    const times = [...xml.matchAll(/(?:offset|duration)="(\d+)\/(\d+)s"/g)];
    expect(times.length).toBeGreaterThan(0);
    for (const [, , denominator] of times) {
      expect(Number(denominator)).toBe(3000);
    }
  });

  it("nama proyek yang mengandung karakter XML ter-escape", () => {
    const plan = makePlan((input) => {
      input.meta.title = 'Riset "A&B" <awal>';
    });
    const project = tempProject(plan);
    const xml = toFcpxml(buildEditTimeline(plan, { planPath: project.planPath }));
    expect(xml).toContain("Riset &quot;A&amp;B&quot; &lt;awal&gt;");
    expect(xml).not.toContain('name="Riset "A&B"');
  });

  it("naskah scene dibawa sebagai marker di klipnya", () => {
    const { timeline } = timelineFor();
    const xml = toFcpxml(timeline);
    expect(xml).toContain("<marker ");
    expect(xml).toContain("Candi batu berdiri sejak dua belas abad silam.");
  });

  it("satu sumber daya per BERKAS walau dipakai beberapa klip", () => {
    const plan = makePlan((input) => {
      // Dua scene memakai rekaman yang sama dengan titik masuk berbeda —
      // inti kemampuan mengklip; aset ganda akan membuat FCP mengimpor
      // berkasnya dua kali.
      input.renderState!.clipAssets!["sc-peta-k1"] = {
        file: "media/candi.mp4",
        kind: "video",
        source: "pexels",
        durationSec: 30,
      };
      input.scenes[2]!.clips = [
        { id: "sc-peta-k1", type: "stock", assetId: null, trimStartSec: 12 },
      ];
    });
    const project = tempProject(plan);
    const xml = toFcpxml(buildEditTimeline(plan, { planPath: project.planPath }));
    // Berkasnya yang dihitung, bukan jumlah <asset> seluruhnya: narasi dan
    // efek suara juga jadi aset, dan jumlahnya berubah tiap kali plan uji
    // disentuh — yang diuji di sini khusus dedup rekaman video.
    expect([...xml.matchAll(/src="[^"]*candi\.mp4"/g)]).toHaveLength(1);
    const refs = [...xml.matchAll(/<asset id="(r\d+)"[^>]*candi\.mp4/g)].map((m) => m[1]);
    expect(refs).toHaveLength(1);
    // Kedua scene menunjuk id sumber daya yang SAMA.
    expect([...xml.matchAll(new RegExp(`ref="${refs[0]}"`, "g"))]).toHaveLength(2);
  });

  it("tidak menulis transisi sama sekali, dan mengatakannya di laporan", () => {
    const { timeline } = timelineFor();
    expect(toFcpxml(timeline)).not.toContain("<transition");
  });
});

describe("impor OTIO", () => {
  const roundTrip = () => {
    const { timeline, project } = timelineFor();
    return fromOtio(toOtio(timeline), { projectDir: project.dir });
  };

  it("bolak-balik mempertahankan urutan, durasi, dan titik masuk klip", () => {
    const { plan, project, timeline } = timelineFor();
    const back = fromOtio(toOtio(timeline), { projectDir: project.dir });
    // Hanya scene yang punya berkas yang bisa kembali sebagai scene; yang
    // tanpa aset jadi gap di berkas dan tidak punya apa pun untuk dipulihkan.
    expect(back.plan.scenes).toHaveLength(2);
    expect(back.plan.scenes[0]?.clips[0]?.trimStartSec).toBe(4);
    const durations = back.plan.scenes.map((scene) => scene.duration);
    expect(durations.every((duration) => typeof duration === "number")).toBe(true);
    expect(plan.scenes).toHaveLength(3);
  });

  it("menolak berkas yang bukan Timeline OTIO dengan pesan yang menyebut sebabnya", () => {
    expect(() => fromOtio({ OTIO_SCHEMA: "Clip.1" }, { projectDir: "/tmp" })).toThrow(
      /Bukan berkas OTIO Timeline/,
    );
  });

  it("aset di LUAR folder proyek tidak dirujuk, dan itu dilaporkan", () => {
    const { timeline } = timelineFor();
    const back = fromOtio(toOtio(timeline), { projectDir: "/folder/lain" });
    expect(back.notes.map((note) => note.code)).toContain("impor-aset-luar");
    expect(back.plan.scenes.every((scene) => scene.clips[0]?.assetId == null)).toBe(true);
  });

  it("selalu mengatakan bahwa hasilnya kerangka, bukan plan utuh", () => {
    expect(roundTrip().notes.map((note) => note.code)).toContain("impor-kerangka");
  });

  it("memakai rate berkasnya sendiri, bukan mengasumsikan 30fps", () => {
    // Berkas dari editor lain lazimnya 24 atau 25fps; salah membaca rate
    // membuat semua durasi meleset ~25%.
    const doc = {
      OTIO_SCHEMA: "Timeline.1",
      name: "Dua puluh empat",
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        children: [
          {
            OTIO_SCHEMA: "Track.1",
            kind: "Video",
            children: [
              {
                OTIO_SCHEMA: "Clip.1",
                name: "a.mov",
                source_range: {
                  OTIO_SCHEMA: "TimeRange.1",
                  duration: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 48 },
                  start_time: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 0 },
                },
                media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: null },
              },
            ],
          },
        ],
      },
    };
    const back = fromOtio(doc, { projectDir: "/tmp" });
    expect(back.plan.scenes[0]?.duration).toBe(2);
  });
});
