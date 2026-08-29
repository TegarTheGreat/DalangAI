import { useEffect, useRef } from "react";

/**
 * Kontrol dasar buatan sendiri — tanpa dependensi UI eksternal, dengan
 * standar yang kami pegang sendiri: state fokus/hover/aktif lengkap,
 * animasi halus, aksesibel (label nyata, Esc/klik-luar untuk popover).
 */

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
 * Popover berjangkar: render `trigger`, tampilkan isi saat terbuka.
 * Tutup dengan klik di luar atau Esc. Posisi default di ATAS jangkar
 * (cocok untuk baris komposer); `align="top"` menaruhnya di bawah.
 */
export const Popover: React.FC<{
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  align?: "bottom" | "top";
  children: React.ReactNode;
}> = ({ open, onClose, trigger, align = "bottom", children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div className="popover-anchor" ref={ref}>
      {trigger}
      {open ? (
        <div className={align === "top" ? "popover align-top" : "popover"} role="dialog">
          {children}
        </div>
      ) : null}
    </div>
  );
};

/** Pilihan eksklusif ringkas (tab kecil) — dipakai Inspector, Chat, dsb. */
export const Segmented = <T extends string>({
  options,
  value,
  label,
  onChange,
  disabled,
}: {
  options: readonly T[];
  value: T;
  label: (option: T) => string;
  onChange: (option: T) => void;
  disabled?: boolean;
}) => (
  <div className="segmented">
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
