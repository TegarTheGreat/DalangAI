import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { guardDecision, hostnameOf, isLoopbackHostname } from "../src/server/index";
import { makeHost, makePlan } from "./helpers";

/**
 * Penjaga asal permintaan (ADR-0031). Tes integrasi di bawah menjalankan
 * ULANG serangan yang benar-benar berhasil sebelum penjaga ini ada: satu
 * halaman web asing mengubah scene-plan, memulai render, dan memicu unggahan
 * YouTube publik lewat `content-type: text/plain` yang tidak butuh preflight.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const boot = () => {
  const root = mkdtempSync(join(tmpdir(), "dalang-guard-"));
  const dir = join(root, "proyek");
  const planPath = join(dir, "plan.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(planPath, JSON.stringify(makePlan(), null, 2));
  const host = makeHost(root, planPath);
  cleanups.push(() => {
    host.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { host, root, planPath };
};

/** Permintaan persis seperti yang bisa dikirim halaman web mana pun. */
const fromPage = (
  host: ReturnType<typeof makeHost>,
  path: string,
  body: unknown,
  origin: string,
  hostHeader = "studio.local",
) =>
  host.app.fetch(
    new Request(`http://${hostHeader}${path}`, {
      method: "POST",
      // text/plain adalah tipe yang boleh dikirim <form> lintas asal TANPA
      // preflight CORS. Rute kami tetap membacanya sebagai JSON.
      headers: { "content-type": "text/plain;charset=UTF-8", origin },
      body: JSON.stringify(body),
    }),
  );

describe("aturan penjaga (murni)", () => {
  it("membaca nama host dari asal, header Host, IPv6, dan menolak yang tak terbaca", () => {
    expect(hostnameOf("http://127.0.0.1:4646")).toBe("127.0.0.1");
    expect(hostnameOf("localhost:4646")).toBe("localhost");
    // WHATWG URL menyimpan kurung siku pada IPv6; keduanya dianggap loopback.
    expect(hostnameOf("[::1]:4646")).toBe("[::1]");
    expect(hostnameOf("https://JAHAT.example")).toBe("jahat.example");
    expect(hostnameOf("null")).toBeNull();
    expect(hostnameOf("   ")).toBeNull();
  });

  it("loopback mencakup seluruh 127.0.0.0/8, ::1, dan .localhost; bukan yang lain", () => {
    for (const name of ["localhost", "127.0.0.1", "127.9.9.9", "::1", "app.localhost"]) {
      expect(isLoopbackHostname(name), name).toBe(true);
    }
    for (const name of ["jahat.example", "192.168.1.5", "127.0.0.1.jahat.example"]) {
      expect(isLoopbackHostname(name), name).toBe(false);
    }
  });

  it("GET selalu lewat; POST dari asal asing ditolak; tanpa Origin lewat", () => {
    const local = { host: "127.0.0.1:4646" };
    expect(
      guardDecision({ method: "GET", origin: "https://jahat.example", ...local }).ok,
    ).toBe(true);
    expect(guardDecision({ method: "POST", ...local }).ok).toBe(true);
    expect(
      guardDecision({ method: "POST", origin: "http://localhost:4646", ...local }).ok,
    ).toBe(true);
    const ditolak = guardDecision({
      method: "POST",
      origin: "https://jahat.example",
      ...local,
    });
    expect(ditolak.ok).toBe(false);
    expect(ditolak.reason).toContain("jahat.example");
  });

  it("DNS rebinding ditolak lewat Host, walau Origin dan Host sama", () => {
    // Penyerang mengarahkan jahat.example ke 127.0.0.1: aturan "sama asal"
    // saja akan meloloskannya, jadi Host harus ikut diperiksa.
    const rebinding = guardDecision({
      method: "POST",
      origin: "http://jahat.example:4646",
      host: "jahat.example:4646",
    });
    expect(rebinding.ok).toBe(false);
    expect(rebinding.reason).toContain("host");
  });

  it("host tambahan yang sengaja disahkan boleh lewat, dan hanya itu", () => {
    const allowedHosts = ["studio.lokal"];
    expect(
      guardDecision({
        method: "POST",
        origin: "http://studio.lokal:4646",
        host: "studio.lokal:4646",
        allowedHosts,
      }).ok,
    ).toBe(true);
    expect(
      guardDecision({
        method: "POST",
        origin: "http://lain.lokal:4646",
        host: "studio.lokal:4646",
        allowedHosts,
      }).ok,
    ).toBe(false);
  });
});

describe("serangan sungguhan yang dulu berhasil, kini ditolak", () => {
  it("halaman asing tidak bisa mengubah scene-plan, merender, atau mengunggah", async () => {
    const { host } = boot();
    const jahat = "https://situs-jahat.example";

    const patch = await fromPage(
      host,
      "/api/patch",
      {
        ops: [{ op: "setMeta", patch: { title: "DIRETAS" } }],
      },
      jahat,
    );
    expect(patch.status).toBe(403);
    expect(((await patch.json()) as { error: string }).error).toContain(
      "situs-jahat.example",
    );

    expect(
      (await fromPage(host, "/api/render", { profile: "draft" }, jahat)).status,
    ).toBe(403);
    // Yang paling berat: unggahan tidak bisa diurungkan, dan gerbang 428 tidak
    // menolong karena penyerang mengirim confirm sendiri.
    expect(
      (
        await fromPage(
          host,
          "/api/publish",
          { file: "final.mp4", confirm: true, privacy: "public" },
          jahat,
        )
      ).status,
    ).toBe(403);
    // Rute lobi ikut terjaga: app luar yang memasang penjaganya.
    expect(
      (
        await fromPage(
          host,
          "/api/workspace/memory",
          { jenis: "gaya", teks: "diretas" },
          jahat,
        )
      ).status,
    ).toBe(403);

    // Dan plan-nya memang tidak berubah.
    const project = (await (
      await host.app.fetch(new Request("http://studio.local/api/project"))
    ).json()) as { plan: { meta: { title: string } } };
    expect(project.plan.meta.title).toBe("Uji Studio");
  });

  it("Studio sendiri dan pemanggil tanpa Origin tetap bisa bekerja", async () => {
    const { host } = boot();
    // Dari halaman Studio sendiri.
    const sendiri = await fromPage(
      host,
      "/api/patch",
      { ops: [{ op: "setMeta", patch: { title: "Dari Studio" } }] },
      "http://studio.local",
    );
    expect(sendiri.status).toBe(200);
    // Dari CLI/skrip: tanpa Origin sama sekali.
    const cli = await host.app.fetch(
      new Request("http://studio.local/api/patch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops: [{ op: "setMeta", patch: { title: "Dari CLI" } }] }),
      }),
    );
    expect(cli.status).toBe(200);
    const project = (await (
      await host.app.fetch(new Request("http://studio.local/api/project"))
    ).json()) as { plan: { meta: { title: string } } };
    expect(project.plan.meta.title).toBe("Dari CLI");
  });
});
