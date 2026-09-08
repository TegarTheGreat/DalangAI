import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * Penjaga asal permintaan (ADR-0031).
 *
 * Studio hanya mendengar di 127.0.0.1, dan itu SUDAH membuatnya tak terjangkau
 * dari jaringan. Yang tidak dijaga oleh itu: peramban milik user sendiri.
 * Selama Studio jalan, situs web mana pun yang dibuka user bisa mengirim
 * permintaan ke localhost, karena rute kami membaca badan sebagai JSON apa pun
 * tipe kontennya, dan `<form>` HTML boleh mengirim `text/plain` tanpa preflight
 * CORS. Yang terbukti bisa dilakukan sebelum berkas ini ada: mengubah
 * scene-plan di disk, memulai render, dan MEMICU UNGGAHAN ke YouTube dengan
 * privasi publik — gerbang konfirmasi 428 tidak menolong karena penyerang
 * mengirim `confirm: true` sendiri.
 *
 * Jawabannya tidak bisa DIBACA penyerang (kami tidak pernah mengirim header
 * CORS), jadi ini bukan pencurian isi proyek. Tapi sabotase, biaya API, dan
 * unggahan yang tidak bisa diurungkan sudah cukup buruk.
 *
 * Dua pagar, keduanya perlu:
 *  1. `Origin` — peramban SELALU mengirimnya pada POST, termasuk form biasa.
 *     Asal yang bukan milik Studio sendiri ditolak. Permintaan tanpa `Origin`
 *     (curl, CLI, tes, server-ke-server) dibiarkan lewat: peramban tidak bisa
 *     menghilangkan header ini, jadi ketiadaannya bukan celah.
 *  2. `Host` — tanpa ini, DNS rebinding lolos: penyerang mengarahkan
 *     jahat.example ke 127.0.0.1, lalu Origin dan Host sama-sama
 *     jahat.example dan aturan "sama asal" akan meloloskannya.
 *
 * Hanya metode yang MENGUBAH yang dijaga. GET tetap terbuka karena jawabannya
 * tidak terbaca lintas asal, dan menjaga GET akan mematahkan hal-hal wajar
 * seperti membuka pratinjau render di tab baru.
 */

/** Metode yang tidak mengubah apa pun; aman dipanggil siapa saja. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Nama host dari sebuah asal atau header Host. Menerima "http://x:1", "x:1",
 * "[::1]:1", dan "x". Kembalikan null bila tidak terbaca — dan yang tidak
 * terbaca TIDAK dipercaya.
 */
export const hostnameOf = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null") return null;
  try {
    // URL() menuntut skema; header Host tidak punya, jadi ditambahkan.
    const url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return url.hostname === "" ? null : url.hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Nama host yang berarti "mesin ini": localhost, seluruh 127.0.0.0/8, dan
 * ::1. `.localhost` juga, karena RFC 6761 menjaminnya menunjuk loopback.
 */
export const isLoopbackHostname = (hostname: string): boolean => {
  const name = hostname.toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (name === "::1" || name === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
};

export interface GuardDecision {
  ok: boolean;
  /** Alasan penolakan dalam bahasa manusia; kosong bila diloloskan. */
  reason?: string;
}

/**
 * Keputusan penjaga untuk satu permintaan. Murni supaya seluruh aturannya
 * bisa diuji sebagai tabel, bukan lewat server.
 */
export const guardDecision = (request: {
  method: string;
  /** Header Origin apa adanya; null/undefined = tidak dikirim. */
  origin?: string | null;
  /** Header Host apa adanya. */
  host?: string | null;
  /** Nama host tambahan yang sah, mis. saat server sengaja diikat ke LAN. */
  allowedHosts?: readonly string[];
}): GuardDecision => {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return { ok: true };

  const extra = (request.allowedHosts ?? []).map((name) => name.toLowerCase());
  const allowed = (hostname: string): boolean =>
    isLoopbackHostname(hostname) || extra.includes(hostname);

  // Pagar 2 dulu: Host palsu membuat pemeriksaan "sama asal" tak berarti.
  const host = request.host ? hostnameOf(request.host) : null;
  if (host !== null && !allowed(host)) {
    return {
      ok: false,
      reason: `Permintaan ditujukan ke host "${host}", bukan ke mesin ini. Buka Studio lewat http://localhost.`,
    };
  }

  const origin = request.origin ? hostnameOf(request.origin) : null;
  // Tanpa Origin = bukan dari peramban (curl, CLI, tes). Peramban tidak bisa
  // menghilangkannya pada permintaan yang mengubah.
  if (origin === null) return { ok: true };
  if (allowed(origin)) return { ok: true };
  return {
    ok: false,
    reason: `Permintaan datang dari "${origin}", bukan dari Studio. Halaman web lain tidak boleh memerintah Studio.`,
  };
};

/** Middleware Hono dari aturan di atas; 403 dengan alasan yang bisa dibaca. */
export const localOnlyGuard = (
  options: { allowedHosts?: readonly string[] } = {},
): MiddlewareHandler => {
  return async (c, next) => {
    const decision = guardDecision({
      method: c.req.method,
      origin: c.req.header("origin") ?? null,
      host: c.req.header("host") ?? null,
      ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
    });
    if (decision.ok) return next();
    return c.json({ error: decision.reason ?? "Permintaan ditolak" }, 403);
  };
};

// ---------------------------------------------------------------------------
// Kunci tautan untuk membuka ke jaringan lokal (ADR-0038)
// ---------------------------------------------------------------------------

/**
 * Alamat soket yang berarti "mesin ini". Dipakai untuk membedakan pemakai
 * lokal dari tamu jaringan — dan yang dipercaya di sini adalah ALAMAT SOKET,
 * bukan header `Host`: header bisa ditulis siapa saja, alamat soket tidak.
 */
export const isLoopbackAddress = (address: string): boolean => {
  const clean = address.replace(/^::ffff:/i, "");
  return clean === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean);
};

/** Bandingkan dua rahasia tanpa membocorkan panjang kecocokannya lewat waktu. */
const secretEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/**
 * Penjaga kunci tautan.
 *
 * Studio dibuka ke jaringan lokal hanya dengan `--lan`, dan saat itu ia
 * mencetak URL yang memuat kunci acak. Tanpa penjaga ini, "buka ke jaringan"
 * berarti siapa pun di kafe yang sama bisa menyunting proyek, memicu render
 * berbayar, dan mengunggah ke YouTube. Dengan penjaga ini, yang bisa cuma
 * orang yang diberi tautannya.
 *
 * Pemakai LOOPBACK dilewatkan tanpa kunci: membuka ke jaringan tidak boleh
 * berarti pemiliknya sendiri harus menempelkan kunci di URL-nya.
 *
 * Ini BUKAN akun dan bukan izin per-orang. Yang punya tautan punya segalanya,
 * dan mencabutnya berarti menjalankan ulang Studio (kunci baru). Itu batas
 * yang dinyatakan, bukan yang disembunyikan.
 */
export const linkKeyGuard = (key: string): MiddlewareHandler => {
  return async (c, next) => {
    const env = c.env as
      | { incoming?: { socket?: { remoteAddress?: string } } }
      | undefined;
    const remote = env?.incoming?.socket?.remoteAddress ?? "";
    if (remote === "" || isLoopbackAddress(remote)) return next();
    const supplied = c.req.header("x-dalang-key") ?? c.req.query("kunci") ?? "";
    if (supplied !== "" && secretEquals(supplied, key)) return next();
    return c.json(
      {
        error:
          "Butuh kunci tautan. Buka Studio lewat URL lengkap yang dicetak `dalang studio --lan`.",
      },
      401,
    );
  };
};
