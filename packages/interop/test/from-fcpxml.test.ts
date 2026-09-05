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
    expect(plan.scenes[0]?.clips[0]?.trimStartSec).toBe(4);
    expect(plan.renderState?.clipAssets?.["sc-a-k1"]).toMatchObject({
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
    expect(plan.renderState?.clipAssets?.["sc-b-k1"]).toMatchObject({ file: "b.mov" });
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
    expect(plan.renderState?.clipAssets?.["sc-c-k1"]).toMatchObject({ file: "c.mp4" });
  });

  it("urutan dipulihkan dari offset, bukan dari urutan tag di hasil parse", () => {
    // Parser XML mengelompokkan anak per nama tag, jadi <clip> dan
    // <asset-clip> tiba terpisah walau di berkasnya berselang-seling.
    const xml = doc(
      '<asset id="r2" name="X" src="file:///proyek/x.mp4" start="0s" duration="99s" hasVideo="1" format="r1"/>',
      [
        // `start` = titik masuk di REKAMAN; masing-masing beda supaya urutan
        // hasilnya bisa dibaca dari isinya, bukan cuma dari namanya.
        '<asset-clip name="ketiga" ref="r2" offset="20s" start="45s" duration="5s"/>',
        '<clip name="pertama" offset="0s" duration="5s"><video offset="0s" ref="r2" duration="99s"/></clip>',
        '<asset-clip name="kedua" ref="r2" offset="10s" start="30s" duration="5s"/>',
      ].join("\n"),
    );
    const { plan } = fromFcpxml(xml, { projectDir: "/proyek" });
    // Ketiganya dari BERKAS yang sama dan berurutan, jadi sejak ADR-0033
    // mereka satu scene berklip tiga — dan urutan yang diuji di sini adalah
    // urutan POTONGANNYA, yang tetap datang dari offset, bukan dari tag.
    expect(plan.scenes.map((scene) => scene.id)).toEqual(["sc-pertama"]);
    expect(plan.scenes[0]?.clips.map((clip) => clip.durationSec)).toEqual([5, 5, 5]);
    expect(plan.scenes[0]?.clips.map((clip) => clip.trimStartSec)).toEqual([
      undefined,
      30,
      45,
    ]);
  });

  /**
   * Sampai ADR-0025 connected clip hanya DIHITUNG, karena garis waktu Dalang
   * belum punya tempat untuk menaruhnya. Sekarang lane positif jadi lapisan.
   */
  it("connected clip di lane positif jadi LAPISAN pada scene yang ditindihnya", () => {
    const xml = doc(
      '<asset id="r2" name="D" src="file:///proyek/d.mp4" start="0s" duration="20s" hasVideo="1" format="r1"/>',
      [
        '<asset-clip name="utama" ref="r2" offset="0s" duration="10s"/>',
        '<asset-clip name="overlay" ref="r2" offset="2s" duration="4s" lane="1"/>',
      ].join("\n"),
    );
    const { plan, notes } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.scenes.map((scene) => scene.id)).toEqual(["sc-utama"]);
    const layers = plan.scenes[0]?.layers ?? [];
    expect(layers).toHaveLength(1);
    expect(layers[0]?.id).toBe("lap-overlay");
    // 2s..6s di dalam scene 0..10s.
    expect(layers[0]?.startFrac).toBeCloseTo(0.2, 4);
    expect(layers[0]?.endFrac).toBeCloseTo(0.6, 4);
    expect(plan.renderState?.layerAssets?.["lap-overlay"]).toMatchObject({
      file: "d.mp4",
      kind: "video",
    });
    expect(notes.find((note) => note.code === "impor-lapisan")?.detail).toContain(
      "1 klip lane",
    );
  });

  /**
   * Waktu klip bersarang diukur di basis waktu INDUKNYA. Final Cut menulis
   * `start="3600s"` untuk gap; menjumlahkan offset begitu saja akan menaruh
   * sisipannya satu jam dari tempatnya — dan karena tidak ada scene di sana,
   * sisipannya hilang tanpa jejak.
   */
  it("klip di dalam gap memakai basis waktu gap-nya (offset - start)", () => {
    const xml = doc(
      '<asset id="r2" name="D" src="file:///proyek/d.mp4" start="0s" duration="20s" hasVideo="1" format="r1"/>',
      [
        '<asset-clip name="utama" ref="r2" offset="0s" duration="4s"/>',
        '<asset-clip name="kedua" ref="r2" offset="4s" duration="6s"/>',
        '<gap name="Gap" offset="4s" duration="6s" start="3600s"><asset-clip name="pip" ref="r2" offset="3601s" duration="2s" lane="2"/></gap>',
      ].join("\n"),
    );
    const { plan } = fromFcpxml(xml, { projectDir: "/proyek" });
    // 4 + (3601 - 3600) = 5s. Kedua potongan dari berkas yang sama kini SATU
    // scene 0..10s (ADR-0033), jadi sisipannya menempel di sana — dan
    // fraksinya diukur terhadap jendela scene itu, bukan terhadap potongannya.
    expect(plan.scenes).toHaveLength(1);
    const layers = plan.scenes[0]?.layers ?? [];
    expect(layers).toHaveLength(1);
    expect(layers[0]?.startFrac).toBeCloseTo(5 / 10, 3);
  });

  it("lane negatif (audio tempelan) tetap dilewati dan dihitung", () => {
    const xml = doc(
      '<asset id="r2" name="D" src="file:///proyek/d.mp4" start="0s" duration="20s" hasVideo="1" format="r1"/>',
      [
        '<asset-clip name="utama" ref="r2" offset="0s" duration="10s"/>',
        '<asset-clip name="musik" ref="r2" offset="0s" duration="10s" lane="-1"/>',
      ].join("\n"),
    );
    const { plan, notes } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.scenes[0]?.layers ?? []).toHaveLength(0);
    expect(
      notes.find((note) => note.code === "impor-lane-audio-dilewati")?.detail,
    ).toContain("1 klip");
  });

  it("id scene dibuat unik walau namanya sama", () => {
    // Satu rekaman dipakai berkali-kali adalah pola normal; skema menolak
    // scene berid kembar, jadi impor tidak boleh menghasilkannya.
    // Dua BERKAS berbeda yang kebetulan bernama sama: potongan dari berkas
    // berbeda tidak dikelompokkan (ADR-0033), jadi keduanya jadi scene sendiri
    // dan idnya harus dibedakan.
    const xml = doc(
      [
        '<asset id="r2" name="sama" src="file:///proyek/s.mp4" start="0s" duration="60s" hasVideo="1" format="r1"/>',
        '<asset id="r3" name="sama" src="file:///proyek/t.mp4" start="0s" duration="60s" hasVideo="1" format="r1"/>',
      ].join("\n"),
      [
        '<asset-clip name="sama" ref="r2" offset="0s" duration="5s"/>',
        '<asset-clip name="sama" ref="r3" offset="5s" duration="5s"/>',
      ].join("\n"),
    );
    const { plan } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.scenes.map((scene) => scene.id)).toEqual(["sc-sama", "sc-sama-2"]);
  });

  /**
   * ADR-0033: potongan berurutan dari SATU rekaman adalah satu gagasan yang
   * disunting, bukan dua belas gagasan. Impor yang memecahnya jadi dua belas
   * scene memaksa yang membukanya menggabungkannya kembali dengan tangan.
   */
  it("potongan berurutan dari berkas berbeda TETAP jadi scene sendiri", () => {
    const xml = doc(
      [
        '<asset id="r2" name="A" src="file:///proyek/a.mp4" start="0s" duration="60s" hasVideo="1" format="r1"/>',
        '<asset id="r3" name="B" src="file:///proyek/b.mp4" start="0s" duration="60s" hasVideo="1" format="r1"/>',
      ].join("\n"),
      [
        '<asset-clip name="wawancara" ref="r2" offset="0s" duration="4s"/>',
        '<asset-clip name="wawancara" ref="r2" offset="4s" start="20s" duration="3s"/>',
        '<asset-clip name="broll" ref="r3" offset="7s" duration="5s"/>',
        '<asset-clip name="wawancara" ref="r2" offset="12s" start="40s" duration="6s"/>',
      ].join("\n"),
    );
    const { plan } = fromFcpxml(xml, { projectDir: "/proyek" });
    expect(plan.scenes.map((scene) => scene.clips.length)).toEqual([2, 1, 1]);
    expect(plan.scenes[0]?.duration).toBeUndefined();
    expect(plan.scenes[0]?.clips.map((clip) => clip.durationSec)).toEqual([4, 3]);
    // Potongan ketiga kembali ke berkas pertama TAPI tidak berurutan dengannya
    // lagi, jadi ia scene tersendiri — batas gambar dari sumber lain adalah
    // batas yang paling mungkin juga batas gagasan.
    expect(plan.scenes[2]?.clips[0]?.trimStartSec).toBe(40);
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
    expect(back.plan.scenes[0]?.clips[0]?.trimStartSec).toBe(4);
  });
});

/**
 * Sisipan yang menempel persis di ujung scene: aritmetikanya sah, tapi
 * `startFrac` bisa membulat ke 1 dan `endFrac` jadi 1,01 — ditolak skema, dan
 * seluruh impor gagal hanya karena satu klip di ujung.
 */
describe("lapisan di ujung scene", () => {
  it("jendela tampilnya tetap di dalam [0,1] dan tetap punya panjang", () => {
    const xml = doc(
      '<asset id="r2" name="D" src="file:///proyek/d.mp4" start="0s" duration="20s" hasVideo="1" format="r1"/>',
      [
        '<asset-clip name="utama" ref="r2" offset="0s" duration="10s"/>',
        // Mulai 1 milidetik sebelum scene berakhir.
        '<asset-clip name="ujung" ref="r2" offset="9999/1000s" duration="3s" lane="1"/>',
      ].join("\n"),
    );
    const { plan } = fromFcpxml(xml, { projectDir: "/proyek" });
    const layer = (plan.scenes[0]?.layers ?? [])[0];
    expect(layer).toBeDefined();
    expect(layer?.startFrac).toBeLessThanOrEqual(0.99);
    expect(layer?.endFrac).toBeLessThanOrEqual(1);
    expect(layer?.endFrac ?? 0).toBeGreaterThan(layer?.startFrac ?? 0);
  });
});
