import { describe, expect, it } from "vitest";
import { toFcpxml } from "../src/fcpxml";
import { fromFcpxml, parseFcpTime } from "../src/from-fcpxml";
import { buildEditTimeline } from "../src/timeline";
import { makePlan, tempProject } from "./helpers";

/**
 * Pembaca FCPXML (ADR-0023, amandemen).
 *
 * Yang diuji di sini bukan "bisa membaca berkas kami sendiri" — itu terlalu
 * mudah dan sudah dijaga gerbang interop dengan pustaka rujukan. Yang diuji
 * adalah bentuk-bentuk FCPXML yang SAH tapi berbeda: `<clip><video ref>` versus
 * `<asset-clip ref>`, `src` versi 1.8 versus `<media-rep>` versi 1.9+, dan
 * connected clip di lane yang tidak boleh diam-diam jadi scene.
 */

const doc = (resources: string, spine: string, version = "1.8"): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="${version}">
  <resources>
    <format id="r1" name="F" frameDuration="100/3000s" width="1920" height="1080"/>
    ${resources}
  </resources>
  <library>
    <event name="E">
      <project name="Proyek Uji">
        <sequence format="r1" duration="20s" tcStart="0s" tcFormat="NDF">
          <spine>
${spine}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;

describe("waktu rasional FCPXML", () => {
  it("membaca ketiga bentuk yang dipakai Final Cut", () => {
    expect(parseFcpTime("0s")).toBe(0);
    expect(parseFcpTime("10s")).toBe(10);
    expect(parseFcpTime("100/3000s")).toBeCloseTo(1 / 30, 9);
  });

  it("menolak yang bukan waktu, bukan mengembalikan nol", () => {
    // Nol adalah waktu yang SAH; memakainya sebagai tanda gagal membuat klip
    // rusak mendarat di detik nol alih-alih dilewati.
    expect(parseFcpTime("abc")).toBeNull();
    expect(parseFcpTime("10")).toBeNull();
    expect(parseFcpTime(undefined)).toBeNull();
    expect(parseFcpTime("1/0s")).toBeNull();
  });
});

describe("impor FCPXML", () => {
  it("membaca asset-clip dengan src gaya 1.8", () => {
    const xml = doc(
      '<asset id="r2" name="A" src="file:///proyek/a.mp4" start="0s" duration="30s" hasVideo="1" format="r1"/>',
      '<asset-clip name="A" ref="r2" offset="0s" duration="5s" start="4s"/>',
    );
    const { plan } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0]?.duration).toBe(5);
    expect(plan.scenes[0]?.visual?.trimStartSec).toBe(4);
    expect(plan.renderState?.resolvedAssets?.["sc-a"]).toMatchObject({
      file: "a.mp4",
      kind: "video",
      durationSec: 30,
    });
  });

  it("membaca media-rep gaya 1.9+, bukan cuma atribut src", () => {
    const xml = doc(
      '<asset id="r2" name="B" start="0s" duration="12s" hasVideo="1" format="r1"><media-rep kind="original-media" src="file:///proyek/b.mov"/></asset>',
      '<asset-clip name="B" ref="r2" offset="0s" duration="6s"/>',
      "1.10",
    );
    const { plan, notes } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.renderState?.resolvedAssets?.["sc-b"]).toMatchObject({ file: "b.mov" });
    // Versi di luar yang diuji disebutkan, bukan didiamkan.
    expect(notes.map((note) => note.code)).toContain("impor-versi-fcpxml");
  });

  it("membaca <clip> yang membungkus <video ref>", () => {
    const xml = doc(
      '<asset id="r2" name="C" src="file:///proyek/c.mp4" start="0s" duration="20s" hasVideo="1" format="r1"/>',
      '<clip name="C" offset="0s" duration="7s"><video offset="0s" ref="r2" duration="20s"/></clip>',
    );
    const { plan } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.scenes).toHaveLength(1);
    expect(plan.renderState?.resolvedAssets?.["sc-c"]).toMatchObject({ file: "c.mp4" });
  });

  it("urutan dipulihkan dari offset, bukan dari urutan tag di hasil parse", () => {
    // Parser XML mengelompokkan anak per nama tag, jadi <clip> dan
    // <asset-clip> tiba terpisah walau di berkasnya berselang-seling.
    const xml = doc(
      '<asset id="r2" name="X" src="file:///proyek/x.mp4" start="0s" duration="99s" hasVideo="1" format="r1"/>',
      [
        '<asset-clip name="ketiga" ref="r2" offset="20s" duration="5s"/>',
        '<clip name="pertama" offset="0s" duration="5s"><video offset="0s" ref="r2" duration="99s"/></clip>',
        '<asset-clip name="kedua" ref="r2" offset="10s" duration="5s"/>',
      ].join("\n"),
    );
    const { plan } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.scenes.map((scene) => scene.id)).toEqual([
      "sc-pertama",
      "sc-kedua",
      "sc-ketiga",
    ]);
  });

  it("connected clip di lane DILEWATI dan dihitung, bukan diam-diam jadi scene", () => {
    const xml = doc(
      '<asset id="r2" name="D" src="file:///proyek/d.mp4" start="0s" duration="20s" hasVideo="1" format="r1"/>',
      [
        '<asset-clip name="utama" ref="r2" offset="0s" duration="5s"/>',
        '<asset-clip name="overlay" ref="r2" offset="1s" duration="2s" lane="1"/>',
        '<gap name="Gap" offset="5s" duration="5s" start="3600s"><asset-clip name="pip" ref="r2" offset="5s" duration="2s" lane="2"/></gap>',
      ].join("\n"),
    );
    const { plan, notes } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.scenes.map((scene) => scene.id)).toEqual(["sc-utama"]);
    const lane = notes.find((note) => note.code === "impor-lane-dilewati");
    expect(lane?.detail).toContain("2 klip di lane");
  });

  it("id scene dibuat unik walau namanya sama", () => {
    // Satu rekaman dipakai berkali-kali adalah pola normal; skema menolak
    // scene berid kembar, jadi impor tidak boleh menghasilkannya.
    const xml = doc(
      '<asset id="r2" name="sama" src="file:///proyek/s.mp4" start="0s" duration="60s" hasVideo="1" format="r1"/>',
      [
        '<asset-clip name="sama" ref="r2" offset="0s" duration="5s"/>',
        '<asset-clip name="sama" ref="r2" offset="5s" duration="5s"/>',
      ].join("\n"),
    );
    const { plan } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.scenes.map((scene) => scene.id)).toEqual(["sc-sama", "sc-sama-2"]);
  });

  it("menolak berkas yang bukan FCPXML dengan pesan yang menyebut sebabnya", () => {
    expect(() => fromFcpxml("<xmeml><sequence/></xmeml>", { projectDir: "/x" })).toThrow(
      /Bukan berkas FCPXML/,
    );
    expect(() => fromFcpxml("bukan xml sama sekali", { projectDir: "/x" })).toThrow();
  });

  it("bolak-balik lewat penulis kami sendiri mempertahankan durasi klip", () => {
    const plan = makePlan();
    const project = tempProject(plan);
    const xml = toFcpxml(buildEditTimeline(plan, { planPath: project.planPath }));
    const back = fromFcpxml(xml, { projectDir: project.dir });
    // Plan uji punya 2 scene beraset di trek video; narasi dan efek suara
    // ikut sebagai klip audio di lane, jadi harus terlewat.
    expect(back.plan.scenes).toHaveLength(2);
    expect(back.plan.scenes[0]?.visual?.trimStartSec).toBe(4);
  });
});
