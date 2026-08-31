import {
  activeSnapLines,
  type FramePoint,
  placeGraphic,
  placeLayer,
  placeText,
  type SafeInsets,
  type Scene,
  type ScenePlan,
  snapLinesFor,
  snapToLines,
} from "@dalang/core";
import {
  activeSceneIndex,
  aspectMetrics,
  computeFrameLayout,
} from "@dalang/templates/layout";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { playback } from "../playback";
import { studioClient } from "../use-studio";

/**
 * Manipulasi langsung di kanvas (ADR-0024, roadmap §9.1).
 *
 * Sampai fase kedelapan, memindahkan teks atau grafis harus lewat form di
 * panel Properti: ketik angka, lihat hasilnya, ketik lagi. Roadmap menyebut
 * ini celah paling kentara dibanding editor mana pun, dan memang begitu —
 * tidak ada editor video yang menyuruh orang mengetik koordinat.
 *
 * Kotak pegangan dibaca dari DOM yang SUDAH ter-render (`data-dalang-text`,
 * `data-dalang-graphic`, `data-dalang-layer`), bukan dihitung ulang dari model. Itu keputusan
 * penting: preset menata teks dengan flex, margin aman, dan pengelompokan per
 * posisi, dan menirukan semua itu di sisi Studio berarti dua rumus tata letak
 * yang harus tetap sama selamanya. Membaca kotaknya membuat pegangan selalu
 * pas — di preset mana pun, termasuk preset yang belum ditulis.
 *
 * Yang keluar dari sini tetap PATCH OP biasa: tercatat di patch log, bisa
 * di-undo, dan terlihat agent. Tidak ada jalan tembus ke plan.json.
 */

/** Ambang menempel ke garis bantu, dalam fraksi bingkai. */
const SNAP = 0.012;

interface Handle {
  kind: "text" | "graphic" | "layer";
  id: string;
  /** Kotak dalam koordinat kotak pemutar (piksel CSS). */
  rect: { x: number; y: number; w: number; h: number };
}

interface DragState {
  handle: Handle;
  mode: "move" | "resize";
  /** Titik pusat awal, fraksi bingkai. */
  origin: FramePoint;
  pointer: { x: number; y: number };
  startSizeFrac: number;
}

/**
 * Perbandingan kotak, dibulatkan ke piksel.
 *
 * Tanpa ini MutationObserver dan setState saling memanggil tanpa henti:
 * mengukur -> setState -> render -> DOM berubah -> mengukur. Membandingkan
 * pada presisi piksel juga meredam getaran sub-piksel dari animasi.
 */
const sameHandles = (a: Handle[], b: Handle[]): boolean =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      item.id === other.id &&
      item.kind === other.kind &&
      Math.round(item.rect.x) === Math.round(other.rect.x) &&
      Math.round(item.rect.y) === Math.round(other.rect.y) &&
      Math.round(item.rect.w) === Math.round(other.rect.w) &&
      Math.round(item.rect.h) === Math.round(other.rect.h)
    );
  });

const centerOf = (rect: Handle["rect"], box: DOMRect): FramePoint => ({
  x: (rect.x + rect.w / 2) / box.width,
  y: (rect.y + rect.h / 2) / box.height,
});

export const CanvasEditor: React.FC<{ plan: ScenePlan }> = ({ plan }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [handles, setHandles] = useState<Handle[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<FramePoint | null>(null);
  // Pola yang sama dengan TimelineStrip: satu sumber kebenaran playhead.
  const frame = useSyncExternalStore(playback.subscribe, playback.getFrame);
  const playing = useSyncExternalStore(playback.subscribe, playback.getPlaying);

  // Scene yang sedang tampil menurut renderer sendiri — bukan scene yang
  // kebetulan terpilih di timeline. Pegangan harus milik apa yang terlihat.
  const layout = computeFrameLayout(plan);
  const scene: Scene | undefined = plan.scenes[activeSceneIndex(layout, frame)];
  // Di-memo karena ia jadi dependensi effect seret: objek baru tiap render
  // akan memasang ulang pendengar pointer di TENGAH seretan.
  const safe: SafeInsets = useMemo(() => {
    const metrics = aspectMetrics(plan.meta.aspectRatio);
    return {
      x: metrics.marginX / metrics.width,
      y: metrics.marginTop / metrics.height,
    };
  }, [plan.meta.aspectRatio]);

  /**
   * Kotak diukur ulang saat isinya berubah — dan "berubah" di sini bukan cuma
   * saat frame bergerak.
   *
   * Versi pertama hanya bergantung pada `frame`, dan hasilnya nol pegangan:
   * saat effect pertama berjalan, Player belum sempat menggambar apa pun, dan
   * karena preview yang dijeda tidak pernah mengubah frame, tidak ada yang
   * memicu pengukuran kedua. Yang benar adalah mendengarkan DOM-nya sendiri:
   * MutationObserver menangkap Remotion mengganti scene, ResizeObserver
   * menangkap jendela berubah ukuran, dan rAF menunda pengukuran sampai
   * setelah gambar — mengukur di tengah render menghasilkan kotak basi.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: frame & scene.id memang pemicunya
  useEffect(() => {
    const box = hostRef.current?.parentElement;
    if (!box) return;
    let raf = 0;

    const measure = () => {
      raf = 0;
      const boxRect = box.getBoundingClientRect();
      const found: Handle[] = [];
      for (const [attribute, kind] of [
        ["data-dalang-text", "text"],
        ["data-dalang-graphic", "graphic"],
        // ADR-0025: lapisan video ikut bisa diseret & diubah ukurannya.
        ["data-dalang-layer", "layer"],
      ] as const) {
        for (const element of box.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
          const id = element.getAttribute(attribute);
          if (!id) continue;
          const rect = element.getBoundingClientRect();
          // Elemen di luar jendela tampilnya punya kotak nol atau di luar
          // bingkai; pegangan untuk sesuatu yang tidak terlihat hanya
          // membingungkan.
          if (rect.width < 2 || rect.height < 2) continue;
          if (rect.bottom < boxRect.top || rect.top > boxRect.bottom) continue;
          found.push({
            kind,
            id,
            rect: {
              x: rect.left - boxRect.left,
              y: rect.top - boxRect.top,
              w: rect.width,
              h: rect.height,
            },
          });
        }
      }
      setHandles((previous) => (sameHandles(previous, found) ? previous : found));
    };

    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(measure);
    };

    schedule();
    const mutation = new MutationObserver(schedule);
    mutation.observe(box, { childList: true, subtree: true, attributes: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(box);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      mutation.disconnect();
      resize.disconnect();
    };
  }, [frame, scene?.id, plan]);

  useEffect(() => {
    if (!drag) return;
    const host = hostRef.current?.parentElement;
    if (!host) return;

    const move = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      const dx = (event.clientX - drag.pointer.x) / box.width;
      const dy = (event.clientY - drag.pointer.y) / box.height;
      if (drag.mode === "move") {
        const lines = snapLinesFor(safe);
        const raw = { x: drag.origin.x + dx, y: drag.origin.y + dy };
        setGhost({
          x: snapToLines(raw.x, lines.x, SNAP),
          y: snapToLines(raw.y, lines.y, SNAP),
        });
      } else {
        // Ubah ukuran memakai diagonal: satu angka, tidak pernah menghasilkan
        // grafis yang gepeng — `size` memang satu nilai (tinggi fraksional).
        setGhost({ x: drag.origin.x, y: drag.origin.y + dy });
      }
    };

    const up = () => {
      const target = ghost ?? drag.origin;
      const ops = buildOps(scene, drag, target, safe);
      setDrag(null);
      setGhost(null);
      if (ops) void studioClient.applyPatch(ops.ops, ops.label);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, ghost, safe, scene]);

  // Pegangan disembunyikan saat memutar: teks bergerak sepanjang animasinya,
  // jadi kotaknya akan bergetar mengikuti — dan tidak ada editor yang
  // menampilkan pegangan transform di atas video yang sedang jalan.
  if (!scene || playing) return null;
  const locked = scene.locked;
  const lines = ghost
    ? activeSnapLines(ghost, snapLinesFor(safe), SNAP)
    : { x: [], y: [] };

  const start = (handle: Handle, mode: DragState["mode"], event: React.PointerEvent) => {
    if (locked) return;
    event.preventDefault();
    const box = hostRef.current?.parentElement?.getBoundingClientRect();
    if (!box) return;
    const item =
      handle.kind === "graphic"
        ? scene.graphics.find((graphic) => graphic.id === handle.id)
        : handle.kind === "layer"
          ? scene.layers.find((layer) => layer.id === handle.id)
          : undefined;
    // Grafis punya satu `size`; lapisan punya `height` (lebarnya ikut skala
    // yang sama saat diseret, lihat buildOps).
    const startSize =
      item && "size" in item ? item.size : item && "height" in item ? item.height : null;
    setSelected(handle.id);
    setDrag({
      handle,
      mode,
      origin: centerOf(handle.rect, box),
      pointer: { x: event.clientX, y: event.clientY },
      startSizeFrac: startSize ?? handle.rect.h / box.height,
    });
  };

  return (
    <div className="canvas-layer" ref={hostRef}>
      {locked ? (
        <span className="canvas-locked">
          Scene terkunci — buka kuncinya untuk menggeser
        </span>
      ) : null}
      {lines.x.map((line) => (
        <span
          key={`x${line}`}
          className="canvas-guide v"
          style={{ left: `${line * 100}%` }}
        />
      ))}
      {lines.y.map((line) => (
        <span
          key={`y${line}`}
          className="canvas-guide h"
          style={{ top: `${line * 100}%` }}
        />
      ))}
      {handles.map((handle) => (
        <div
          key={`${handle.kind}-${handle.id}`}
          className={`canvas-box ${handle.kind}${selected === handle.id ? " active" : ""}${
            drag?.handle.id === handle.id ? " dragging" : ""
          }`}
          style={{
            left: handle.rect.x,
            top: handle.rect.y,
            width: handle.rect.w,
            height: handle.rect.h,
            // Kotak MENGIKUTI kursor selagi diseret. Videonya sendiri baru
            // berpindah setelah dilepas (perpindahan lewat patch, dan patch
            // per gerakan pointer akan membanjiri log), jadi tanpa bayangan
            // ini seretan terasa seperti tidak terjadi apa-apa sampai lepas.
            ...(drag?.handle.id === handle.id && ghost
              ? {
                  translate: `${((ghost.x - drag.origin.x) * (hostRef.current?.clientWidth ?? 0)).toFixed(1)}px ${(
                    (ghost.y - drag.origin.y) * (hostRef.current?.clientHeight ?? 0)
                  ).toFixed(1)}px`,
                }
              : {}),
          }}
          onPointerDown={(event) => start(handle, "move", event)}
        >
          <span className="canvas-tag">{handle.id}</span>
          {handle.kind === "graphic" || handle.kind === "layer" ? (
            <button
              type="button"
              className="canvas-grip"
              aria-label={`Ubah ukuran ${handle.id}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                start(handle, "resize", event);
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
};

/**
 * Titik jatuh -> patch op. Dipisah dari komponennya supaya keputusan "apa yang
 * berubah" bisa dibaca tanpa membaca urusan pointer.
 */
const buildOps = (
  scene: Scene | undefined,
  drag: DragState,
  target: FramePoint,
  safe: SafeInsets,
): { ops: Parameters<typeof studioClient.applyPatch>[0]; label: string } | null => {
  if (!scene || scene.locked) return null;

  if (drag.handle.kind === "layer") {
    const layer = scene.layers.find((item) => item.id === drag.handle.id);
    if (!layer) return null;
    if (drag.mode === "resize") {
      // Ukuran lapisan berubah SERAGAM: tinggi dan lebar diskalakan dengan
      // faktor yang sama. Sudut yang memetakan dx ke lebar dan dy ke tinggi
      // memang lebih bebas, tapi hampir selalu memenceng-mencengkan sisipan
      // 16:9 tanpa disadari — dan rasio bebas tetap tersedia di panel Properti.
      const height = Math.min(
        1,
        Math.max(0.08, drag.startSizeFrac + (target.y - drag.origin.y) * 2),
      );
      const factor = drag.startSizeFrac > 0 ? height / drag.startSizeFrac : 1;
      const width = Math.min(1, Math.max(0.08, layer.width * factor));
      if (Math.abs(height - layer.height) < 0.001) return null;
      return {
        ops: [
          {
            op: "updateScene",
            id: scene.id,
            patch: {
              layers: scene.layers.map((item) =>
                item.id === layer.id
                  ? {
                      ...item,
                      width: Number(width.toFixed(4)),
                      height: Number(height.toFixed(4)),
                    }
                  : item,
              ),
            },
          },
        ],
        label: `Ukuran lapisan ${layer.id}`,
      };
    }
    // Titik jatuh adalah PUSAT kotak; `placeLayer` bekerja pada kotaknya,
    // karena jangkar kiri menempelkan TEPI kiri ke margin aman, bukan pusatnya.
    const placement = placeLayer(
      {
        x: target.x - layer.width / 2,
        y: target.y - layer.height / 2,
        width: layer.width,
        height: layer.height,
      },
      safe,
    );
    if (
      placement.anchor === layer.anchor &&
      Math.abs(placement.offsetX - layer.offsetX) < 0.001 &&
      Math.abs(placement.offsetY - layer.offsetY) < 0.001
    ) {
      return null;
    }
    return {
      ops: [
        {
          op: "updateScene",
          id: scene.id,
          patch: {
            layers: scene.layers.map((item) =>
              item.id === layer.id ? { ...item, ...placement } : item,
            ),
          },
        },
      ],
      label: `Geser lapisan ${layer.id}`,
    };
  }

  if (drag.handle.kind === "graphic") {
    const graphic = scene.graphics.find((item) => item.id === drag.handle.id);
    if (!graphic) return null;
    if (drag.mode === "resize") {
      // Turun = besar, naik = kecil; skalanya dua kali selisih supaya terasa
      // langsung tanpa harus menyeret setengah layar.
      const next = Math.min(
        0.6,
        Math.max(0.02, drag.startSizeFrac + (target.y - drag.origin.y) * 2),
      );
      if (Math.abs(next - graphic.size) < 0.001) return null;
      return {
        ops: [
          {
            op: "updateScene",
            id: scene.id,
            patch: {
              graphics: scene.graphics.map((item) =>
                item.id === graphic.id
                  ? { ...item, size: Number(next.toFixed(4)) }
                  : item,
              ),
            },
          },
        ],
        label: `Ukuran grafis ${graphic.id}`,
      };
    }
    const placement = placeGraphic(target, safe);
    if (
      placement.anchor === graphic.anchor &&
      Math.abs(placement.offsetX - graphic.offsetX) < 0.001 &&
      Math.abs(placement.offsetY - graphic.offsetY) < 0.001
    ) {
      return null;
    }
    return {
      ops: [
        {
          op: "updateScene",
          id: scene.id,
          patch: {
            graphics: scene.graphics.map((item) =>
              item.id === graphic.id ? { ...item, ...placement } : item,
            ),
          },
        },
      ],
      label: `Geser grafis ${graphic.id}`,
    };
  }

  const text = scene.texts.find((item) => item.id === drag.handle.id);
  if (!text) return null;
  const placement = placeText(target, safe);
  if (
    placement.position === text.position &&
    Math.abs(placement.offsetX - text.offsetX) < 0.001 &&
    Math.abs(placement.offsetY - text.offsetY) < 0.001
  ) {
    return null;
  }
  return {
    ops: [
      {
        op: "updateScene",
        id: scene.id,
        patch: {
          texts: scene.texts.map((item) =>
            item.id === text.id ? { ...item, ...placement } : item,
          ),
        },
      },
    ],
    label: `Geser teks ${text.id}`,
  };
};
