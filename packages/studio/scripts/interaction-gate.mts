/**
 * Gerbang interaksi studio.
 *
 * Gerbang tata letak membuktikan kendali MUAT; gerbang ini membuktikan
 * kendali BEKERJA ketika benar-benar disentuh. Berlian keyframe di timeline
 * dan kotak anotasi di kanvas diseret dengan peristiwa pointer dan papan ketik
 * SUNGGUHAN lewat CDP (Input.dispatchMouseEvent / dispatchKeyEvent) — bukan
 * event sintetis dari dalam halaman, yang tidak pernah melewati pointer
 * capture — lalu yang diperiksa adalah plan DI SERVER, bukan state React:
 * patch-lah yang menjadi kebenaran, dan seretan yang cuma menggeser kotak di
 * layar tanpa mengirim patch adalah cacat yang persis ingin ditangkap.
 *
 * Kasusnya dipilih karena masing-masing pernah gagal diam-diam saat gerbang
 * ini pertama kali dijalankan:
 *   - seretan berlian 25% ke tengah bar mendarat di 50% di plan;
 *   - panah kiri menggeser 1%, Shift 5%, End ke 100% — dan fokus KEMBALI ke
 *     berlian yang sama setelah React memasang ulang elemennya;
 *   - mendarat tepat di atas keyframe lain ditolak TANPA patch kosong (versi
 *     pertama mengirim patch yang tidak mengubah apa pun, dan undo memakannya);
 *   - undo mengembalikan langkah terakhir yang sungguh mengubah sesuatu;
 *   - klik klip membawa playhead ke frame scene tampil utuh, sehingga kotak
 *     anotasi tutorial bergeser dan berubah ukuran sebesar fraksi bingkai
 *     yang persis sama dengan jarak seretannya (di awal transisi, renderer
 *     masih menganggap scene sebelumnya yang aktif dan seretan itu hilang).
 *
 * Jalankan: pnpm --filter @dalang/studio gate:interaksi [folder-tangkapan-layar]
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowserExecutable } from "@dalang/renderer";
import { openBrowser } from "@remotion/renderer";
import { startStudioServer } from "../src/server/index";
import { stubDeps } from "./stub-deps";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEMO = join(repoRoot, "examples", "tutorial-studio");
/** Folder tangkapan layar (opsional) — untuk mata manusia, bukan untuk gerbang. */
const SHOTS = process.argv[2] ? resolve(process.argv[2]) : null;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** Jeda setelah aksi: patch ke server, SSE kembali, React menggambar ulang. */
const SETTLE_MS = 900;

type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Target {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface PlanLite {
  audio: { music: { fadeInSec: number; fadeOutSec: number } | null };
  scenes: {
    id: string;
    annotations: { target: Target }[];
    layers: { tracks: { points: { at: number }[] }[] }[];
  }[];
}

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "ok   " : "GAGAL"} ${name} — ${detail}`);
  if (!ok) failures.push(`${name}: ${detail}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const fmt = (value: number) => value.toFixed(4);

const main = async (): Promise<void> => {
  // Salin ke folder sementara: sesi ini MENULIS, dan contoh di repo harus bersih.
  const root = mkdtempSync(join(tmpdir(), "dalang-gate-interaksi-"));
  cpSync(DEMO, join(root, "demo"), { recursive: true });
  const planPath = join(root, "demo", "plan.json");
  const seed = JSON.parse(readFileSync(planPath, "utf8")) as PlanLite;
  const step3 = seed.scenes.find((scene) => scene.id === "sc-step-3");
  if (!step3?.layers[0])
    throw new Error("contoh tutorial-studio tidak punya lapisan di sc-step-3");
  // Track keyframe disuntikkan di sini, bukan di contoh: contoh adalah
  // dokumentasi, dan dua titik di 25%/75% adalah geometri yang gerbang ini butuhkan.
  step3.layers[0].tracks = [
    {
      points: [
        { at: 0.25, value: 0.3, easing: "settle" },
        { at: 0.75, value: 1, easing: "settle" },
      ],
      property: "opacity",
    } as unknown as { points: { at: number }[] },
  ];
  // Dua teks di kelompok posisi yang sama pada sc-step-1: yang pendek akan
  // diseret sampai tepi kirinya sejajar tepi kiri yang panjang (penempelan
  // ke elemen lain, ADR-0024).
  const step1 = seed.scenes.find((scene) => scene.id === "sc-step-1") as unknown as {
    texts?: unknown[];
  };
  step1.texts = [
    {
      id: "tx-judul",
      content: "Judul uji yang cukup panjang",
      role: "headline",
      position: "top",
    },
    { id: "tx-sub", content: "Sub", role: "kicker", position: "top" },
  ];
  // Musik latar disuntikkan supaya bar musik (dan pegangan fade-nya) ada.
  (seed.audio as Record<string, unknown>).music = {
    assetId: "pustaka:tenang",
    volume: 0.14,
    ducking: true,
    fadeInSec: 1,
    fadeOutSec: 2,
    normalize: true,
  };
  writeFileSync(planPath, JSON.stringify(seed, null, 2));
  // Satu berkas render palsu supaya riwayat render (dan tombol Unggah
  // ADR-0030) ada di layar; server gerbang ini tidak punya token, jadi yang
  // diuji adalah kejujurannya: tombol nonaktif yang menyebut apa yang kurang.
  const rendersDir = join(root, "demo", ".dalang", "renders");
  mkdirSync(rendersDir, { recursive: true });
  writeFileSync(join(rendersDir, "preview.mp4"), "mp4-gerbang");

  const studio = await startStudioServer({
    workspaceRoot: root,
    planPath,
    deps: stubDeps(),
    port: 0,
    appDistDir: join(repoRoot, "packages", "studio", "dist"),
  });
  const browser = await openBrowser("chrome", {
    logLevel: "error",
    browserExecutable: findBrowserExecutable() ?? null,
  });
  const page = await browser.newPage({
    context: () => null,
    logLevel: "error",
    indent: false,
    pageIndex: 0,
    onBrowserLog: null,
    onLog: () => undefined,
  });
  const cdp = page._client() as unknown as Cdp;

  // --- masukan sungguhan lewat CDP -------------------------------------------
  const mouse = (type: string, x: number, y: number, pressed: boolean, modifiers = 0) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: pressed || type !== "mouseMoved" ? "left" : "none",
      buttons: pressed ? 1 : 0,
      clickCount: type === "mouseMoved" ? 0 : 1,
      modifiers,
    });
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await mouse("mouseMoved", from.x, from.y, false);
    await mouse("mousePressed", from.x, from.y, true);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await mouse(
        "mouseMoved",
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
        true,
      );
      await sleep(16);
    }
    await mouse("mouseReleased", to.x, to.y, true);
  };
  const key = async (name: string, keyCode: number, modifiers = 0) => {
    const base = {
      key: name,
      code: name,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers,
    };
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  const SHIFT = 8;

  // --- pembacaan DOM & plan --------------------------------------------------
  const rect = async (selector: string, index = 0): Promise<Rect | null> =>
    (await page.evaluate(
      `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`,
    )) as Rect | null;
  const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const attr = async (selector: string, index: number, name: string) =>
    (await page.evaluate(
      `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; return el ? el.getAttribute(${JSON.stringify(name)}) : null; })()`,
    )) as string | null;
  const plan = async (): Promise<PlanLite> => {
    const res = await fetch(`${studio.url}/api/project`);
    return ((await res.json()) as { plan: PlanLite }).plan;
  };
  const sceneOf = (current: PlanLite, id: string) => {
    const scene = current.scenes.find((item) => item.id === id);
    if (!scene) throw new Error(`scene ${id} hilang dari plan`);
    return scene;
  };
  const points = async (): Promise<number[]> =>
    (sceneOf(await plan(), "sc-step-3").layers[0]?.tracks[0]?.points ?? []).map(
      (point) => point.at,
    );
  const at = (pts: number[], index: number): number => pts[index] ?? Number.NaN;
  const annotation = async (): Promise<Target> => {
    const target = sceneOf(await plan(), "sc-step-1").annotations[0]?.target;
    if (!target) throw new Error("anotasi pertama sc-step-1 hilang");
    return target;
  };
  const shot = async (name: string) => {
    if (!SHOTS) return;
    // CDPSession milik Remotion membungkus balasan dalam { value }.
    const reply = (await cdp.send("Page.captureScreenshot", { format: "png" })) as {
      value?: { data?: string };
      data?: string;
    };
    const data = reply.value?.data ?? reply.data;
    if (data) writeFileSync(join(SHOTS, name), Buffer.from(data, "base64"));
  };
  const clickClip = (sceneId: string) =>
    page.evaluate(
      `(() => { const hits = Array.from(document.querySelectorAll(".clip-hit")); const hit = hits.find((h) => (h.querySelector(".clip-id") || {}).textContent === ${JSON.stringify(sceneId)}); if (hit) hit.click(); return Boolean(hit); })()`,
    );

  try {
    await page.setViewport({ width: 1440, height: 860, deviceScaleFactor: 1 });
    await page.goto({ url: studio.url, timeout: 30_000 });
    for (let tries = 0; tries < 60; tries++) {
      const ready = (await page.evaluate(
        'document.querySelectorAll(".kf-diamond").length > 0',
      )) as boolean;
      if (ready) break;
      await sleep(250);
    }

    console.log("\nBerlian keyframe di timeline");
    const bar = await rect(".layer-bar");
    const first = await rect(".kf-diamond", 0);
    if (!bar || !first)
      throw new Error("bar lapisan / berlian tidak ditemukan di timeline");
    console.log(
      `  bar ${Math.round(bar.w)}px; berlian pertama di x=${Math.round(first.x)}`,
    );

    // 1. Seret berlian 25% ke tengah bar (50%).
    await drag(center(first), { x: bar.x + bar.w * 0.5, y: center(first).y });
    await sleep(SETTLE_MS);
    let pts = await points();
    check("seret berlian ke 50%", near(at(pts, 0), 0.5, 0.02), `at = ${pts.join(", ")}`);
    const valueNow = await attr(".kf-diamond", 0, "aria-valuenow");
    check(
      "aria-valuenow ikut",
      near(Number(valueNow), 50, 2),
      `aria-valuenow = ${valueNow}`,
    );
    await shot("gate-timeline.png");

    // 2. Papan ketik pada berlian kedua (75%): kiri 1%, Shift+kiri 5%, End.
    await page.evaluate('document.querySelectorAll(".kf-diamond")[1].focus()');
    await key("ArrowLeft", 37);
    await sleep(SETTLE_MS);
    pts = await points();
    check("panah kiri = -1%", near(at(pts, 1), 0.74, 0.0005), `at = ${at(pts, 1)}`);
    const focused = (await page.evaluate(
      '(() => { const el = document.activeElement; return el && el.classList.contains("kf-diamond") ? el.getAttribute("aria-valuenow") : null; })()',
    )) as string | null;
    check(
      "fokus kembali ke berlian yang sama",
      focused === "74",
      `activeElement aria-valuenow = ${focused}`,
    );
    await key("ArrowLeft", 37, SHIFT);
    await sleep(SETTLE_MS);
    pts = await points();
    check("Shift+panah kiri = -5%", near(at(pts, 1), 0.69, 0.0005), `at = ${at(pts, 1)}`);
    await key("End", 35);
    await sleep(SETTLE_MS);
    pts = await points();
    check("End = 100%", near(at(pts, 1), 1, 0.0005), `at = ${at(pts, 1)}`);

    // 3. Tabrakan: seret berlian pertama (50%) melewati ujung kanan → 100%,
    //    tepat di atas berlian kedua → ditolak, dan TANPA patch kosong.
    const again = await rect(".kf-diamond", 0);
    if (!again) throw new Error("berlian pertama hilang setelah digeser");
    await drag(center(again), { x: bar.x + bar.w + 30, y: center(again).y });
    await sleep(SETTLE_MS);
    pts = await points();
    check(
      "mendarat di atas keyframe lain ditolak",
      pts.length === 2 && near(at(pts, 0), 0.5, 0.02),
      `at = ${pts.join(", ")}`,
    );

    // 4. Undo mengembalikan langkah terakhir yang SUNGGUH mengubah (End).
    const undo = (await (
      await fetch(`${studio.url}/api/undo`, { method: "POST" })
    ).json()) as {
      summary?: string | null;
    };
    await sleep(SETTLE_MS);
    pts = await points();
    check(
      "undo mengembalikan End, bukan patch kosong",
      near(at(pts, 1), 0.69, 0.0005),
      `at = ${at(pts, 1)} (undo: ${undo.summary ?? "-"})`,
    );

    console.log("\nAnotasi di kanvas");
    await clickClip("sc-step-1");
    let box: Rect | null = null;
    for (let tries = 0; tries < 40 && !box; tries++) {
      await sleep(250);
      box = await rect(".canvas-box.annotation", 0);
    }
    // Bingkai screenshot punya animasi masuk: ukur sampai dua pengukuran
    // berturut-turut sama, supaya fraksi yang diharapkan memakai bingkai
    // yang sudah diam — bingkai yang sama yang dipakai editor saat melepas.
    let frame = await rect("[data-dalang-annotation-frame]");
    for (let tries = 0; tries < 20; tries++) {
      await sleep(250);
      const again = await rect("[data-dalang-annotation-frame]");
      if (
        frame &&
        again &&
        Math.abs(again.w - frame.w) < 0.5 &&
        Math.abs(again.h - frame.h) < 0.5
      ) {
        frame = again;
        break;
      }
      frame = again;
    }
    box = await rect(".canvas-box.annotation", 0);
    if (!box || !frame) throw new Error("kotak anotasi / bingkai tidak muncul di kanvas");
    console.log(
      `  bingkai ${Math.round(frame.w)}×${Math.round(frame.h)}px; kotak anotasi ${Math.round(box.w)}×${Math.round(box.h)}px`,
    );
    const tol = 1.5 / frame.w;

    // 5. Geser +60px,+40px → target bergeser sebesar fraksi bingkai yang sama.
    const before = await annotation();
    await drag(center(box), { x: center(box).x + 60, y: center(box).y + 40 });
    await sleep(SETTLE_MS);
    const moved = await annotation();
    check(
      "geser anotasi +60px,+40px",
      near(moved.x - before.x, 60 / frame.w, tol) &&
        near(moved.y - before.y, 40 / frame.h, tol) &&
        near(moved.w, before.w, 1e-6),
      `dx = ${fmt(moved.x - before.x)} (harap ${fmt(60 / frame.w)}), dy = ${fmt(moved.y - before.y)} (harap ${fmt(40 / frame.h)})`,
    );
    await shot("gate-canvas.png");

    // 6. Ubah ukuran lewat pegangan sudut +30px,+20px.
    const grip = await rect(".canvas-box.annotation .canvas-grip", 0);
    if (!grip) throw new Error("pegangan ubah ukuran anotasi tidak ada");
    await drag(center(grip), { x: center(grip).x + 30, y: center(grip).y + 20 });
    await sleep(SETTLE_MS);
    const resized = await annotation();
    check(
      "ubah ukuran anotasi +30px,+20px",
      near(resized.w - moved.w, 30 / frame.w, tol) &&
        near(resized.h - moved.h, 20 / frame.h, tol) &&
        near(resized.x, moved.x, 1e-6),
      `dw = ${fmt(resized.w - moved.w)} (harap ${fmt(30 / frame.w)}), dh = ${fmt(resized.h - moved.h)} (harap ${fmt(20 / frame.h)})`,
    );

    console.log("\nPenempelan ke elemen lain di kanvas");
    // Masih di sc-step-1: dua kotak teks. Yang sempit diseret sampai tepi
    // kirinya sejajar tepi kiri yang lebar, DITAHAN, dan garis bantunya
    // harus muncul di tepi itu — bukan di pusat.
    let texts: Rect[] = [];
    for (let tries = 0; tries < 40 && texts.length < 2; tries++) {
      await sleep(150);
      texts =
        ((await page.evaluate(
          '(() => Array.from(document.querySelectorAll(".canvas-box.text")).map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }))()',
        )) as Rect[]) ?? [];
    }
    if (texts.length < 2)
      throw new Error(`kotak teks di kanvas: ${texts.length}, butuh 2`);
    const [wide, narrow] = [...texts].sort((a, b) => b.w - a.w) as [Rect, Rect];
    const host = await rect(".canvas-layer");
    if (!host) throw new Error("lapisan kanvas tidak ada");
    // Pusat sasaran: tepi kiri sejajar, meleset 3 px supaya penempelannya
    // yang bekerja, bukan kebetulan.
    const target = { x: wide.x + narrow.w / 2 + 3, y: center(narrow).y };
    await mouse("mouseMoved", center(narrow).x, center(narrow).y, false);
    await mouse("mousePressed", center(narrow).x, center(narrow).y, true);
    for (let i = 1; i <= 8; i++) {
      await mouse(
        "mouseMoved",
        center(narrow).x + ((target.x - center(narrow).x) * i) / 8,
        center(narrow).y,
        true,
      );
      await sleep(16);
    }
    await sleep(120);
    const guides = (await page.evaluate(
      '(() => Array.from(document.querySelectorAll(".canvas-guide.v")).map((el) => el.getBoundingClientRect().left))()',
    )) as number[];
    check(
      "garis bantu vertikal muncul di TEPI kiri elemen lain saat sejajar",
      guides.some((left) => Math.abs(left - wide.x) <= 2.5),
      `garis di x = ${guides.map((g) => g.toFixed(1)).join(", ") || "-"}; tepi kiri elemen lebar x = ${wide.x.toFixed(1)}`,
    );
    await shot("gate-snap.png");
    await mouse("mouseReleased", target.x, target.y, true);
    await sleep(SETTLE_MS);
    const subText = (
      sceneOf(await plan(), "sc-step-1") as unknown as {
        texts?: { id: string; offsetX: number }[];
      }
    ).texts?.find((text) => text.id === "tx-sub");
    check(
      "seretan yang menempel tetap menghasilkan patch teks",
      typeof subText?.offsetX === "number" && subText.offsetX !== 0,
      `offsetX tx-sub = ${subText?.offsetX}`,
    );

    console.log("\nPemilihan jamak di kanvas");
    // Setelah seretan tadi tx-sub terpilih. Shift+klik pada teks lebar
    // menambahkannya; menyeret yang lebar lalu memindahkan KEDUANYA sejauh
    // yang sama dalam SATU patch — dan satu undo mengembalikan keduanya.
    type TextPos = { id: string; offsetX: number; offsetY: number };
    const textsOf = async (): Promise<Record<string, TextPos>> => {
      const list =
        (sceneOf(await plan(), "sc-step-1") as unknown as { texts?: TextPos[] }).texts ??
        [];
      return Object.fromEntries(list.map((text) => [text.id, text]));
    };
    const canvasTexts = async (): Promise<Rect[]> =>
      ((await page.evaluate(
        '(() => Array.from(document.querySelectorAll(".canvas-box.text")).map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }))()',
      )) as Rect[]) ?? [];
    const beforeMulti = await textsOf();
    let boxes: Rect[] = [];
    for (let tries = 0; tries < 40 && boxes.length < 2; tries++) {
      await sleep(150);
      boxes = await canvasTexts();
    }
    const wideBox = [...boxes].sort((a, b) => b.w - a.w)[0];
    if (!wideBox) throw new Error("kotak teks lebar tidak ada");
    await mouse("mousePressed", center(wideBox).x, center(wideBox).y, true, SHIFT);
    await mouse("mouseReleased", center(wideBox).x, center(wideBox).y, true, SHIFT);
    await sleep(150);
    const activeCount = (await page.evaluate(
      'document.querySelectorAll(".canvas-box.text.active").length',
    )) as number;
    check(
      "Shift+klik menambah teks kedua ke seleksi",
      activeCount === 2,
      `kotak teks aktif = ${activeCount}`,
    );
    const boxesBefore = [...boxes].sort((a, b) => b.w - a.w);
    await drag(center(wideBox), { x: center(wideBox).x + 60, y: center(wideBox).y });
    await sleep(SETTLE_MS);
    // Yang dinilai adalah yang TERLIHAT: kedua kotak di layar bergeser 60 px
    // ke kanan dan tidak ke arah lain. Offset di plan boleh berbeda per teks
    // (jangkar dipilih ulang per elemen); yang harus sama adalah gerakannya.
    const boxesAfter = [...(await canvasTexts())].sort((a, b) => b.w - a.w);
    const shifts = boxesBefore.map((before, index) => ({
      dx: (boxesAfter[index]?.x ?? Number.NaN) - before.x,
      dy: (boxesAfter[index]?.y ?? Number.NaN) - before.y,
    }));
    check(
      "menyeret satu anggota menggeser KEDUA teks 60 px ke kanan, tidak ke arah lain",
      shifts.length === 2 &&
        shifts.every((shift) => near(shift.dx, 60, 3) && near(shift.dy, 0, 3)),
      shifts
        .map((shift) => `(${shift.dx.toFixed(1)}, ${shift.dy.toFixed(1)}) px`)
        .join(", "),
    );
    const afterMulti = await textsOf();
    check(
      "kedua teks berubah di plan dalam satu patch",
      afterMulti["tx-judul"]?.offsetX !== beforeMulti["tx-judul"]?.offsetX &&
        afterMulti["tx-sub"]?.offsetX !== beforeMulti["tx-sub"]?.offsetX,
      `offsetX judul ${beforeMulti["tx-judul"]?.offsetX} → ${afterMulti["tx-judul"]?.offsetX}, sub ${beforeMulti["tx-sub"]?.offsetX} → ${afterMulti["tx-sub"]?.offsetX}`,
    );
    await shot("gate-multi.png");
    await fetch(`${studio.url}/api/undo`, { method: "POST" });
    await sleep(SETTLE_MS);
    const undone = await textsOf();
    check(
      "satu undo mengembalikan kedua teks — seretan kelompok adalah satu patch",
      near(
        undone["tx-judul"]?.offsetX ?? Number.NaN,
        beforeMulti["tx-judul"]?.offsetX ?? 0,
        1e-6,
      ) &&
        near(
          undone["tx-sub"]?.offsetX ?? Number.NaN,
          beforeMulti["tx-sub"]?.offsetX ?? 0,
          1e-6,
        ),
      `judul ${undone["tx-judul"]?.offsetX} (awal ${beforeMulti["tx-judul"]?.offsetX}), sub ${undone["tx-sub"]?.offsetX} (awal ${beforeMulti["tx-sub"]?.offsetX})`,
    );

    console.log("\nPegangan fade musik di timeline");
    const musicBar = await rect(".music-bar");
    const outHandle = await rect(".music-bar .fade-handle.out");
    if (!musicBar || !outHandle) throw new Error("bar musik / pegangan fade tidak ada");
    const musicBefore = (await plan()).audio.music;
    if (!musicBefore) throw new Error("musik hilang dari plan");
    // 48 px pada 24 px/dtk = 2 detik: fade keluar 2,0 → 4,0.
    await drag(center(outHandle), {
      x: center(outHandle).x - 48,
      y: center(outHandle).y,
    });
    await sleep(SETTLE_MS);
    const musicDragged = (await plan()).audio.music;
    check(
      "seret pegangan fade keluar 48px ke kiri = +2,0 dtk",
      near(musicDragged?.fadeOutSec ?? Number.NaN, musicBefore.fadeOutSec + 2, 0.15),
      `fadeOutSec ${musicBefore.fadeOutSec} → ${musicDragged?.fadeOutSec}`,
    );
    await page.evaluate('document.querySelector(".music-bar .fade-handle.in").focus()');
    await key("ArrowRight", 39);
    await sleep(SETTLE_MS);
    const musicNudged = (await plan()).audio.music;
    check(
      "panah kanan pada fade masuk = +0,1 dtk",
      near(musicNudged?.fadeInSec ?? Number.NaN, musicBefore.fadeInSec + 0.1, 0.01),
      `fadeInSec ${musicBefore.fadeInSec} → ${musicNudged?.fadeInSec}`,
    );
    await key("ArrowRight", 39, SHIFT);
    await sleep(SETTLE_MS);
    const musicShifted = (await plan()).audio.music;
    check(
      "Shift+panah kanan = +1,0 dtk",
      near(musicShifted?.fadeInSec ?? Number.NaN, musicBefore.fadeInSec + 1.1, 0.01),
      `fadeInSec → ${musicShifted?.fadeInSec}`,
    );
    await shot("gate-fade.png");

    console.log("\nTombol unggah di riwayat render (ADR-0030, tanpa token)");
    const publishButton = await rect(".render-publish");
    check(
      "tombol Unggah ada di samping berkas render",
      publishButton !== null && publishButton.w > 0,
      publishButton ? `lebar ${publishButton.w.toFixed(0)}px` : "tidak ada",
    );
    const publishDisabled = (await page.evaluate(
      '(() => { const el = document.querySelector(".render-publish"); return el ? el.disabled : null; })()',
    )) as boolean | null;
    const publishTitle = await attr(".render-publish", 0, "title");
    check(
      "tanpa token tombolnya nonaktif dan judulnya menyebut token yang kurang",
      publishDisabled === true && (publishTitle ?? "").includes("YOUTUBE_ACCESS_TOKEN"),
      `disabled = ${publishDisabled}; title = ${publishTitle ?? "-"}`,
    );
    const publishText = (await page.evaluate(
      '(() => { const el = document.querySelector(".render-publish"); return el ? el.textContent : null; })()',
    )) as string | null;
    check(
      "labelnya mengatakan butuh token, bukan menjanjikan unggahan",
      (publishText ?? "").includes("butuh token"),
      `teks = ${publishText ?? "-"}`,
    );
    await shot("gate-publish.png");
  } finally {
    await page.close().catch(() => undefined);
    await browser.close({ silent: true }).catch(() => undefined);
    studio.close();
    rmSync(root, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\nGERBANG INTERAKSI GAGAL — ${failures.length} masalah:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nGerbang interaksi lulus.");
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
