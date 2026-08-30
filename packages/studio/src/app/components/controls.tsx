import { useEffect } from "react";

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
