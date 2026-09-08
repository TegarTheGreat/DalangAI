import { useEffect, useRef, useState } from "react";

/**
 * Kontrol dasar buatan sendiri — tanpa dependensi UI eksternal, dengan
 * standar yang kami pegang sendiri: state fokus/hover/aktif lengkap,
 * animasi halus, aksesibel (label nyata, Esc untuk menutup dialog).
 */

/** Tutup dialog/overlay dengan Escape selama terbuka. */
export const useEscape = (open: boolean, onClose: () => void): void => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
};

export const Switch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}> = ({ checked, onChange, label, disabled, title }) => (
  <label className={checked ? "switch on" : "switch"} {...(title ? { title } : {})}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled ?? false}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="switch-track" aria-hidden />
    {label}
  </label>
);

/**
 * Pilihan eksklusif ringkas (tab kecil) — dipakai Inspector, Chat, dsb.
 * `grow` menyamakan lebar semua segmen (layout presisi untuk form).
 */
export const Segmented = <T extends string | number>({
  options,
  value,
  label,
  onChange,
  disabled,
  grow,
}: {
  options: readonly T[];
  value: T;
  label: (option: T) => string;
  onChange: (option: T) => void;
  disabled?: boolean;
  grow?: boolean;
}) => (
  <div className={grow ? "segmented grow" : "segmented"}>
    {options.map((option) => (
      <button
        key={option}
        type="button"
        className={option === value ? "seg active" : "seg"}
        disabled={disabled}
        onClick={() => onChange(option)}
      >
        {label(option)}
      </button>
    ))}
  </div>
);

export const RadioCard: React.FC<{
  active: boolean;
  title: string;
  desc: string;
  onSelect: () => void;
  disabled?: boolean;
}> = ({ active, title, desc, onSelect, disabled }) => (
  <button
    type="button"
    className={active ? "radio-card active" : "radio-card"}
    onClick={onSelect}
    disabled={disabled ?? false}
  >
    <span className="radio-dot" aria-hidden />
    <span className="radio-card-body">
      <span className="radio-card-title">{title}</span>
      <span className="radio-card-desc">{desc}</span>
    </span>
  </button>
);

/**
 * Versi tegak dari useScrollFade: memudarkan tepi ATAS/BAWAH wadah yang bisa
 * digulir. Kalimat yang teriris rata di tepi panel terbaca seperti tampilan
 * rusak; tepi yang memudar mengatakan "masih ada lanjutannya". Sama seperti
 * versi mendatar, keadaannya diukur — tepi yang tidak menyembunyikan apa pun
 * tidak dipudarkan.
 */
export const useScrollFadeY = <T extends HTMLElement>(): [
  React.RefObject<T | null>,
  string,
] => {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const max = node.scrollHeight - node.clientHeight;
      setEdges({ start: node.scrollTop > 1, end: max > 1 && node.scrollTop < max - 1 });
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => {
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  });

  return [
    ref,
    [edges.start ? "fade-y-start" : "", edges.end ? "fade-y-end" : ""]
      .filter(Boolean)
      .join(" "),
  ];
};

/**
 * Kelas tepi-memudar untuk wadah yang bisa digulir mendatar.
 *
 * Isi yang terpotong rata di tepi wadah terbaca seperti bug, bukan seperti
 * "masih ada lagi" — tapi memudarkan tepi yang tidak menyembunyikan apa pun
 * sama-sama menyesatkan. Karena itu keadaannya diukur, bukan diasumsikan:
 * satu ResizeObserver + satu listener gulir, dan hanya sisi yang benar-benar
 * menyimpan isi yang dipudarkan.
 */
export const useScrollFade = <T extends HTMLElement>(): [
  React.RefObject<T | null>,
  string,
] => {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const max = node.scrollWidth - node.clientWidth;
      setEdges({ start: node.scrollLeft > 1, end: max > 1 && node.scrollLeft < max - 1 });
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => {
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  });

  const className = [
    edges.start ? "scroll-fade-start" : "",
    edges.end ? "scroll-fade-end" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [ref, className];
};

/**
 * Jebakan fokus + pengembalian fokus untuk SEMUA dialog aplikasi.
 *
 * Diukur, bukan diasumsikan: menekan Tab di dalam dialog "Proyek baru"
 * berjalan keluar ke lobi di belakangnya 14 kali dalam 26 tekan, dan setelah
 * dialog ditutup fokus tertinggal di kontrol acak — bukan kembali ke tombol
 * yang membukanya. Dialog yang bisa ditinggalkan Tab tidak bisa dipakai tanpa
 * tetikus, dan itu bukan detail kecil bagi orang yang memang tidak memakainya.
 *
 * Dipasang SEKALI di akar aplikasi dan mengikuti dialog teratas yang ada di
 * DOM, jadi dialog baru mana pun ikut terlindungi tanpa harus ingat.
 */
export const useDialogFocus = (): void => {
  useEffect(() => {
    let restoreTo: HTMLElement | null = null;

    const topDialog = (): HTMLElement | null => {
      const backdrops = document.querySelectorAll<HTMLElement>(".dialog-backdrop");
      const top = backdrops[backdrops.length - 1];
      return top?.querySelector<HTMLElement>(".dialog") ?? null;
    };

    const focusables = (root: HTMLElement): HTMLElement[] =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0);

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = topDialog();
      if (!dialog) return;
      const list = focusables(dialog);
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const sync = () => {
      const dialog = topDialog();
      if (dialog && !restoreTo) {
        restoreTo = document.activeElement as HTMLElement | null;
        // Beri kesempatan dialog memilih fokus awalnya sendiri (mis. kolom
        // judul); baru kalau tidak ada, jatuh ke kontrol pertama.
        requestAnimationFrame(() => {
          const current = topDialog();
          if (current && !current.contains(document.activeElement)) {
            focusables(current)[0]?.focus();
          }
        });
      } else if (!dialog && restoreTo) {
        restoreTo.focus?.();
        restoreTo = null;
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKey, true);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);
};
