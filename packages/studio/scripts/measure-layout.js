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

  const bar = document.querySelector(".topbar");
  const barRect = bar ? rect(bar) : { left: 0, right: 0 };
  const clippedTools = controls
    .filter((el) => {
      const scroller = el.closest(".topbar-actions");
      if (scroller && getComputedStyle(scroller).overflowX === "auto") return false;
      const r = rect(el);
      return r.right > barRect.right + 1 || r.left < barRect.left - 1;
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
