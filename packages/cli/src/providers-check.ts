import { buildGifChain, buildStockChain } from "@dalang/providers";
import type { Command } from "commander";

/**
 * `dalang providers:check` — verifikasi HIDUP ke layanan yang sebenarnya
 * (ADR-0018).
 *
 * KENAPA PERINTAH INI ADA. Provider ditulis mengikuti kontrak resmi masing-
 * masing layanan, dan diuji unit terhadap fixture. Tapi fixture hanya
 * membuktikan kode kita konsisten dengan ANGGAPAN kita soal bentuk respons —
 * ia tidak bisa membuktikan anggapan itu benar. Satu nama field yang meleset
 * akan lolos semua test dan baru gagal di mesin user.
 *
 * Perintah ini menutup celah itu: ia memanggil layanan sungguhan dengan kunci
 * milik user, lalu melaporkan bidang mana yang benar-benar terbaca. Sekali
 * jalan, dan hasilnya bukti — bukan keyakinan.
 */

/** Ringkas pesan panjang/multi-baris jadi satu baris yang masih informatif. */
const oneLine = (text: string, max = 120): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

interface ProbeResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

const probe = async (
  provider: { id: string; label: string; search: (r: never) => Promise<unknown[]> },
  query: string,
): Promise<ProbeResult> => {
  const request = {
    query,
    kind: "video" as const,
    orientation: "landscape" as const,
    perPage: 3,
  };
  try {
    const found = (await provider.search(request as never)) as Array<{
      assetId?: string;
      downloadUrl?: string;
      width?: number;
      height?: number;
      fileExt?: string;
      license?: string;
    }>;
    if (found.length === 0) {
      return {
        id: provider.id,
        label: provider.label,
        ok: false,
        detail:
          "terhubung, tapi 0 hasil — kunci sah namun bentuk respons mungkin berubah",
      };
    }
    const first = found[0];
    // Yang diperiksa BUKAN "ada jawaban", melainkan bidang yang benar-benar
    // dipakai renderer: tanpa ini aset akan gagal di tahap unduh/render.
    const missing = [
      first?.assetId ? null : "assetId",
      first?.downloadUrl ? null : "downloadUrl",
      first?.fileExt ? null : "fileExt",
      first?.width && first.width > 0 ? null : "width",
      first?.height && first.height > 0 ? null : "height",
      first?.license ? null : "license",
    ].filter((field): field is string => field !== null);

    if (missing.length > 0) {
      return {
        id: provider.id,
        label: provider.label,
        ok: false,
        detail: `${found.length} hasil, tapi bidang wajib kosong: ${missing.join(", ")}`,
      };
    }
    return {
      id: provider.id,
      label: provider.label,
      ok: true,
      detail: `${found.length} hasil · contoh ${first?.width}x${first?.height} .${first?.fileExt}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Badan error layanan bisa berupa JSON banyak baris; tabel status harus
    // tetap satu baris per provider agar terbaca sekali lihat.
    return {
      id: provider.id,
      label: provider.label,
      ok: false,
      detail: oneLine(message),
    };
  }
};

export const registerProvidersCheckCommand = (program: Command): void => {
  program
    .command("providers:check")
    .description(
      "Uji koneksi NYATA ke provider aset yang kuncinya terpasang, dan laporkan bidang respons yang terbaca",
    )
    .option("-q, --query <teks>", "kata kunci uji", "sunset")
    .action(async (options: { query: string }) => {
      const stock = buildStockChain();
      const stickers = buildGifChain({ stickers: true });
      const all = [...stock, ...stickers];

      if (all.length === 0) {
        console.log(
          "Tidak ada provider aset yang aktif. Set salah satu kunci di .env:\n" +
            "  PEXELS_API_KEY   foto & video, lisensi jelas untuk komersial\n" +
            "  PIXABAY_API_KEY  foto & video, lisensi jelas untuk komersial\n" +
            "  GIPHY_API_KEY    GIF & stiker — hak pakai per konten harus diperiksa\n" +
            "  TENOR_API_KEY    GIF & stiker — hak pakai per konten harus diperiksa",
        );
        return;
      }

      console.log(
        `Menguji ${all.length} provider dengan kata kunci "${options.query}"…\n`,
      );
      const results: ProbeResult[] = [];
      for (const provider of all) {
        const result = await probe(provider as never, options.query);
        results.push(result);
        const mark = result.ok ? "OK   " : "GAGAL";
        console.log(`  ${mark} ${result.label.padEnd(16)} ${result.detail}`);
      }

      const failed = results.filter((result) => !result.ok);
      console.log("");
      if (failed.length === 0) {
        console.log(
          `Semua ${results.length} provider menjawab dengan bentuk yang dipahami renderer.`,
        );
        return;
      }
      console.log(
        `${failed.length} dari ${results.length} provider bermasalah. Penyebab lazim: kunci salah/kedaluwarsa, ` +
          "kuota habis, jaringan diblokir, atau layanan mengubah bentuk responsnya.",
      );
      process.exitCode = 1;
    });
};
