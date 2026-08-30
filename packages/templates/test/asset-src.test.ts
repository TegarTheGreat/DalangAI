import { describe, expect, it } from "vitest";
import { joinAssetUrl } from "../src/asset-src";

/**
 * Pengalamatan aset plan untuk render cloud (ADR-0019).
 *
 * Diuji sebagai string murni. Yang dijaga bukan kerapian URL-nya, melainkan
 * bahwa berkas yang sama tetap menunjuk berkas yang sama — kesalahan di sini
 * tidak menggagalkan render, ia hanya membuat gambar dan suara hilang tanpa
 * satu pun pesan galat.
 */

describe("joinAssetUrl", () => {
  it("menyambung dengan atau tanpa garis miring di ujung basis", () => {
    expect(joinAssetUrl("https://cdn.test/proyek", "assets/a.png")).toBe(
      "https://cdn.test/proyek/assets/a.png",
    );
    expect(joinAssetUrl("https://cdn.test/proyek/", "assets/a.png")).toBe(
      "https://cdn.test/proyek/assets/a.png",
    );
  });

  it("path berlapis dipertahankan apa adanya", () => {
    expect(joinAssetUrl("https://cdn.test/p", ".dalang/tts/sc-001.wav")).toBe(
      "https://cdn.test/p/.dalang/tts/sc-001.wav",
    );
  });

  it("segmen di-encode, jadi spasi dan tanda pagar tidak merusak URL", () => {
    expect(joinAssetUrl("https://cdn.test/p", "assets/foto ku.png")).toBe(
      "https://cdn.test/p/assets/foto%20ku.png",
    );
    expect(joinAssetUrl("https://cdn.test/p", "assets/a#1.png")).toBe(
      "https://cdn.test/p/assets/a%231.png",
    );
  });

  it("garis miring ganda dan segmen '.' dibuang", () => {
    expect(joinAssetUrl("https://cdn.test/p", "./assets//a.png")).toBe(
      "https://cdn.test/p/assets/a.png",
    );
  });

  /**
   * Backstop. Staging sudah menolak "..", tetapi plan boleh disunting tangan,
   * dan URL yang menunjuk ke luar folder aset proyek tidak boleh bisa disusun
   * dari isi plan.
   */
  it("menolak '..' di mana pun", () => {
    expect(() => joinAssetUrl("https://cdn.test/p", "../rahasia.png")).toThrow(/\.\./);
    expect(() => joinAssetUrl("https://cdn.test/p", "assets/../../x.png")).toThrow(
      /\.\./,
    );
  });

  it("path kosong menghasilkan basis itu sendiri, bukan URL rusak", () => {
    expect(joinAssetUrl("https://cdn.test/p/", "")).toBe("https://cdn.test/p/");
  });
});
