/*
 * Pengukur geometri yang dijalankan DI DALAM halaman oleh gerbang tata letak.
 *
 * Berkas .js tersendiri, dibaca apa adanya lalu dikirim ke browser sebagai
 * teks. DUA hal yang menuntut bentuk ini:
 *
 *  1. Sebagai fungsi TypeScript, transpiler (esbuild lewat tsx) menyisipkan
 *     pembungkus `__name` ke fungsi bernama; pembungkus itu ikut
 *     terserialisasi dan meledak di browser ("__name is not defined").
 *  2. Sebagai template literal di dalam .mts, setiap escape regex hilang
 *     backslash-nya: `\s` ditelan menjadi `s`, dan sanitizer label diam-diam
 *     membuang huruf "s" alih-alih spasi — "Ekspor" tercetak "Ek por". Itu
 *     benar-benar terjadi, dan hanya terlihat saat gerbangnya GAGAL, yaitu
 *     saat pesannya paling dibutuhkan.
 *
 * Berkas biasa tidak bisa ditulis ulang siapa pun. Ia sengaja polos: tanpa
 * impor, tanpa sintaks modern yang butuh transpile — satu ekspresi yang
 * mengembalikan laporan.
 */
(() => {
  const rect = (el) => el.getBoundingClientRect();
  const name = (el) =>
    `${(el.className || el.tagName).toString().split(" ").slice(0, 2).join(".")}«${(
      el.innerText || ""
    )
      .trim()
      .slice(0, 14)
      .replace(/\s+/g, " ")}»`;

  const controls = [
    ...document.querySelectorAll(".topbar-left > *"),
    ...document.querySelectorAll(".topbar-actions > *"),
  ].filter((el) => rect(el).width > 0 && getComputedStyle(el).position !== "sticky");

  const overlaps = [];
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = rect(controls[i]);
      const b = rect(controls[j]);
      const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (dx > 1 && dy > 1) {
        overlaps.push(
          `${name(controls[i])} menindih ${name(controls[j])} (${Math.round(dx)}px)`,
        );
      }
    }
  }

  // Tergunting oleh WADAHNYA SENDIRI, bukan hanya oleh topbar. Zona kiri
  // memakai overflow:hidden, jadi sebuah kontrol bisa hilang separuh di
  // dalamnya sementara kotaknya masih jauh di dalam topbar — persis yang
  // terjadi pada segmen rasio "1:1" di 1450-1600px, dan lolos dari
  // pemeriksaan yang cuma membandingkan dengan topbar.
  const bar = document.querySelector(".topbar");
  const barRect = bar ? rect(bar) : { left: 0, right: 0 };
  const clipRect = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (style.overflowX === "hidden" || style.overflowX === "clip") return rect(node);
      if (style.overflowX === "auto" || style.overflowX === "scroll") return null;
      node = node.parentElement;
    }
    return barRect;
  };
  // Termasuk isi kontrol majemuk (segmen sakelar rasio), bukan cuma wadahnya.
  const clipCandidates = [...controls, ...document.querySelectorAll(".topbar .seg")];
  const clippedTools = clipCandidates
    .filter((el) => {
      const box = clipRect(el);
      if (!box) return false;
      const r = rect(el);
      if (r.width === 0) return false;
      return r.right > box.right + 1 || r.left < box.left - 1;
    })
    .map(name);

  const clippedTabs = [...document.querySelectorAll(".tab-bar > *")]
    .filter((el) => {
      const parent = el.parentElement;
      if (!parent) return false;
      return (
        getComputedStyle(parent).overflowX !== "auto" &&
        rect(el).right > rect(parent).right + 1
      );
    })
    .map(name);

  window.scrollTo(9999, 0);
  const sideScroll = Math.round(window.scrollX);
  window.scrollTo(0, 0);

  return { overlaps, clippedTools, clippedTabs, sideScroll };
})();
