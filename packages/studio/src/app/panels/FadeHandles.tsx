import { useState } from "react";
import { fadeFromLeft, fadeFromRight, MAX_FADE_SEC, nudgeFade } from "../model/fade-drag";

/**
 * Pegangan fade di ujung bar audio timeline (mencabut batas ADR-0026).
 *
 * Dua ramp (gradien gelap) menggambar amplop yang sekarang berlaku; dua titik
 * di ujung ramp adalah pegangannya: diseret dengan pointer capture (posisi
 * sementara di state, satu patch saat dilepas), atau difokus sebagai slider
 * dan digeser dengan panah (0,1 dtk; Shift 1 dtk). Pegangan keluar bergerak
 * ke KIRI untuk memanjang, sama seperti ramp-nya — arah panahnya mengikuti
 * arah visual, bukan arah angkanya.
 *
 * Dipasang sebagai anak bar yang `position: relative`; bar-nya sendiri boleh
 * `pointer-events: none` (bar musik), pegangannya tetap menerima pointer.
 */
export const FadeHandles: React.FC<{
  fadeInSec: number;
  fadeOutSec: number;
  /** Panjang bar dalam detik — batas atas fade adalah setengahnya. */
  spanSec: number;
  pxPerSec: number;
  disabled: boolean;
  /** Nama untuk label patch dan aria: "musik", "trek ambience-1". */
  name: string;
  onCommit: (patch: { fadeInSec?: number; fadeOutSec?: number }, label: string) => void;
}> = ({ fadeInSec, fadeOutSec, spanSec, pxPerSec, disabled, name, onCommit }) => {
  const [draft, setDraft] = useState<{ side: "in" | "out"; sec: number } | null>(null);
  const shown = (side: "in" | "out") =>
    draft?.side === side ? draft.sec : side === "in" ? fadeInSec : fadeOutSec;

  const secAt = (side: "in" | "out", clientX: number, element: HTMLElement): number => {
    const bar = element.parentElement?.getBoundingClientRect();
    if (!bar) return side === "in" ? fadeInSec : fadeOutSec;
    return side === "in"
      ? fadeFromLeft(clientX - bar.left, pxPerSec, spanSec)
      : fadeFromRight(bar.right - clientX, pxPerSec, spanSec);
  };
  const commit = (side: "in" | "out", sec: number) => {
    const current = side === "in" ? fadeInSec : fadeOutSec;
    if (Math.abs(sec - current) < 0.05) return;
    onCommit(
      side === "in" ? { fadeInSec: sec } : { fadeOutSec: sec },
      `Fade ${side === "in" ? "masuk" : "keluar"} ${name} ${sec.toFixed(1)} dtk`,
    );
  };

  const handle = (side: "in" | "out") => {
    const sec = shown(side);
    const kata = side === "in" ? "masuk" : "keluar";
    return (
      <span
        role="slider"
        tabIndex={disabled ? -1 : 0}
        className={`fade-handle ${side}${draft?.side === side ? " dragging" : ""}`}
        style={side === "in" ? { left: sec * pxPerSec } : { right: sec * pxPerSec }}
        aria-label={`Fade ${kata} ${name}`}
        aria-valuemin={0}
        aria-valuemax={MAX_FADE_SEC}
        aria-valuenow={sec}
        aria-valuetext={`${sec.toFixed(1)} detik`}
        title={`Fade ${kata} ${sec.toFixed(1)} dtk — seret, atau panah (Shift: 1 dtk)`}
        onPointerDown={(event) => {
          if (disabled) return;
          event.stopPropagation();
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDraft({ side, sec });
        }}
        onPointerMove={(event) => {
          if (draft?.side !== side) return;
          setDraft({ side, sec: secAt(side, event.clientX, event.currentTarget) });
        }}
        onPointerUp={(event) => {
          if (draft?.side !== side) return;
          const next = secAt(side, event.clientX, event.currentTarget);
          setDraft(null);
          commit(side, next);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const step = event.shiftKey ? 1 : 0.1;
          const current = side === "in" ? fadeInSec : fadeOutSec;
          // Panah mengikuti arah VISUAL pegangan: kanan memanjangkan fade
          // masuk tapi memendekkan fade keluar.
          const direction =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (direction === 0) return;
          event.preventDefault();
          event.stopPropagation();
          commit(
            side,
            nudgeFade(current + direction * (side === "in" ? step : -step), spanSec),
          );
        }}
      />
    );
  };

  return (
    <>
      <span
        className="fade-ramp in"
        style={{ width: shown("in") * pxPerSec }}
        aria-hidden
      />
      <span
        className="fade-ramp out"
        style={{ width: shown("out") * pxPerSec }}
        aria-hidden
      />
      {handle("in")}
      {handle("out")}
    </>
  );
};
