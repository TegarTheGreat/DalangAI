import {
  activeGuideLines,
  elementGuides,
  type FramePoint,
  type GraphicPlacement,
  placeGraphic,
  placeLayer,
  placeText,
  type SafeInsets,
  type Scene,
  type ScenePlan,
  type SnapGuide,
  safeGuides,
  snapToGuides,
  type TextPlacement,
} from "@dalang/core";
import {
  activeSceneIndex,
  aspectMetrics,
  computeFrameLayout,
} from "@dalang/templates/layout";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  movedAnnotationTarget,
  type PxRect,
  resizedAnnotationTarget,
  sameTarget,
} from "../model/annotation-drag";
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
  kind: "text" | "graphic" | "layer" | "annotation";
  id: string;
  /** Kotak dalam koordinat kotak pemutar (piksel CSS). */
  rect: { x: number; y: number; w: number; h: number };
}

/** Kunci seleksi: jenis + id, karena id anotasi (indeks) bisa sama dengan id teks. */
const keyOf = (handle: Handle): string => `${handle.kind}:${handle.id}`;

/** Satu anggota seretan kelompok (ADR-0024 §7): peganganannya + pusat awalnya. */
interface DragMember {
  handle: Handle;
  origin: FramePoint;
}

interface DragState {
  handle: Handle;
  /**
   * Semua yang ikut bergerak: seleksi saat seretan dimulai (mode move), atau
   * pegangan ini saja (ubah ukuran, anotasi). Selisih yang sama diterapkan
   * ke tiap anggota, dan keluarannya SATU patch.
   */
  members: DragMember[];
  mode: "move" | "resize";
  /** Titik pusat awal, fraksi bingkai. */
  origin: FramePoint;
  pointer: { x: number; y: number };
  startSizeFrac: number;
  /**
   * Garis bantu untuk seretan INI: margin aman + tepi/pusat elemen lain di
   * scene (batas ADR-0024 "belum ada penempelan ke elemen lain" dicabut).
   * Dihitung sekali saat mulai — elemen lain tidak bergerak selama seretan.
   */
  guides: { x: SnapGuide[]; y: SnapGuide[] };
}

/** Ukuran kotak pemutar + bingkai screenshot (anotasi), piksel CSS. */
interface DragContext {
  box: { w: number; h: number };
  /** Bingkai rujukan anotasi tutorial; null = preset tanpa bingkai. */
  annotationFrame: PxRect | null;
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

const escapeAttr = (value: string): string =>
  typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value;

/**
 * Akar scene yang sedang tampil di dalam kotak pemutar. Di tengah transisi
 * DUA scene terpasang sekaligus; preset menandai akar tiap scene, dan
 * pengukuran hanya boleh terjadi di dalam akar milik `sceneId`. Preset tanpa
 * penanda akar jatuh ke seluruh kotak.
 */
const sceneRootOf = (box: HTMLElement, sceneId: string): HTMLElement =>
  (sceneId
    ? box.querySelector<HTMLElement>(`[data-dalang-scene="${escapeAttr(sceneId)}"]`)
    : null) ?? box;

const relativeRect = (element: Element, boxRect: DOMRect): Handle["rect"] => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - boxRect.left,
    y: rect.top - boxRect.top,
    w: rect.width,
    h: rect.height,
  };
};

const isMember = (drag: DragState | null, handle: Handle): boolean =>
  drag?.members.some((member) => keyOf(member.handle) === keyOf(handle)) ?? false;

const NO_SELECTION: ReadonlySet<string> = new Set();

const centerOf = (rect: Handle["rect"], box: DOMRect): FramePoint => ({
  x: (rect.x + rect.w / 2) / box.width,
  y: (rect.y + rect.h / 2) / box.height,
});

export const CanvasEditor: React.FC<{ plan: ScenePlan }> = ({ plan }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [handles, setHandles] = useState<Handle[]>([]);
  const [annotationFrame, setAnnotationFrame] = useState<PxRect | null>(null);
  // Seleksi jamak (ADR-0024 §7): kunci `jenis:id`, bisa lebih dari satu.
  // Diikat ke id scene-nya: begitu scene berganti, seleksi lama otomatis
  // kosong — tanpa effect yang mengejar perubahan.
  const [selectionState, setSelectionState] = useState<{
    scene: string | undefined;
    keys: ReadonlySet<string>;
  }>({ scene: undefined, keys: NO_SELECTION });
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
      // Di tengah transisi DUA scene terpasang sekaligus, dan penanda scene
      // yang sedang pergi bukan milik `scene`: pegangannya akan menunjuk
      // elemen yang tidak ada — atau, lebih buruk, elemen scene lain yang
      // kebetulan ber-id sama. Preset menandai akar tiap scene; diukur hanya
      // di dalamnya. Preset tanpa penanda akar jatuh ke seluruh kotak.
      const root = sceneRootOf(box, scene?.id ?? "");
      // Bingkai rujukan anotasi (tutorial-01): diukur bersama pegangannya,
      // karena target anotasi adalah fraksi kotak ini, bukan frame video.
      const frameElement = root.querySelector<HTMLElement>(
        "[data-dalang-annotation-frame]",
      );
      if (frameElement) {
        const rect = frameElement.getBoundingClientRect();
        const next = {
          x: rect.left - boxRect.left,
          y: rect.top - boxRect.top,
          w: rect.width,
          h: rect.height,
        };
        setAnnotationFrame((previous) =>
          previous &&
          Math.round(previous.x) === Math.round(next.x) &&
          Math.round(previous.y) === Math.round(next.y) &&
          Math.round(previous.w) === Math.round(next.w) &&
          Math.round(previous.h) === Math.round(next.h)
            ? previous
            : next,
        );
      } else {
        setAnnotationFrame((previous) => (previous === null ? previous : null));
      }
      for (const [attribute, kind] of [
        ["data-dalang-text", "text"],
        ["data-dalang-graphic", "graphic"],
        // ADR-0025: lapisan video ikut bisa diseret & diubah ukurannya.
        ["data-dalang-layer", "layer"],
        // Anotasi tutorial: batas ADR-0024 dicabut.
        ["data-dalang-annotation", "annotation"],
      ] as const) {
        for (const element of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
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

  /**
   * Kotak SEGAR dari DOM saat ini, relatif kotak pemutar — dipakai saat
   * menekan dan melepas. State `handles` diukur pada mutasi DOM terakhir,
   * dan pemutar bisa menskalakan ulang isinya tanpa mutasi yang tertangkap;
   * angka yang menentukan patch harus dibaca pada detik yang sama dengan
   * jarinya, bukan dari ingatan.
   */
  const freshRect = (handle: Handle): Handle["rect"] => {
    const box = hostRef.current?.parentElement;
    if (!box) return handle.rect;
    const element = sceneRootOf(box, scene?.id ?? "").querySelector<HTMLElement>(
      `[data-dalang-${handle.kind}="${escapeAttr(handle.id)}"]`,
    );
    return element ? relativeRect(element, box.getBoundingClientRect()) : handle.rect;
  };
  const freshAnnotationFrame = (): PxRect | null => {
    const box = hostRef.current?.parentElement;
    if (!box) return annotationFrame;
    const element = sceneRootOf(box, scene?.id ?? "").querySelector<HTMLElement>(
      "[data-dalang-annotation-frame]",
    );
    return element ? relativeRect(element, box.getBoundingClientRect()) : annotationFrame;
  };
  // Dibaca lewat ref supaya effect seret tidak dipasang ulang tiap render
  // (objek baru tiap render akan memasang ulang pendengar pointer di TENGAH
  // seretan) — yang dibutuhkan hanya nilai terbaru saat melepas.
  const freshAnnotationFrameRef = useRef(freshAnnotationFrame);
  freshAnnotationFrameRef.current = freshAnnotationFrame;

  useEffect(() => {
    if (!drag) return;
    const host = hostRef.current?.parentElement;
    if (!host) return;

    /**
     * Titik sasaran untuk posisi pointer tertentu — dipakai saat bergerak
     * (bayangan) DAN saat melepas. Melepas tidak boleh memakai `ghost` dari
     * state: pointerup yang tiba sebelum React sempat menerapkan pointermove
     * terakhir akan menjatuhkan elemen di posisi gerakan SEBELUMNYA (gerbang
     * interaksi menangkapnya: 54 px dari 60 px yang diseret).
     */
    const targetFor = (clientX: number, clientY: number): FramePoint => {
      const box = host.getBoundingClientRect();
      const dx = (clientX - drag.pointer.x) / box.width;
      const dy = (clientY - drag.pointer.y) / box.height;
      if (drag.handle.kind === "annotation") {
        // Anotasi hidup di bingkai screenshot: garis bantu frame video tidak
        // berarti apa-apa baginya, jadi tanpa penempelan.
        return { x: drag.origin.x + dx, y: drag.origin.y + dy };
      }
      if (drag.mode === "move") {
        const raw = { x: drag.origin.x + dx, y: drag.origin.y + dy };
        return {
          x: snapToGuides(raw.x, drag.guides.x, SNAP),
          y: snapToGuides(raw.y, drag.guides.y, SNAP),
        };
      }
      // Ubah ukuran memakai diagonal: satu angka, tidak pernah menghasilkan
      // grafis yang gepeng — `size` memang satu nilai (tinggi fraksional).
      return { x: drag.origin.x, y: drag.origin.y + dy };
    };
    const movedFar = (clientX: number, clientY: number): boolean =>
      Math.hypot(clientX - drag.pointer.x, clientY - drag.pointer.y) >= 3;

    const move = (event: PointerEvent) => {
      // Klik yang goyah dua-tiga piksel bukan seretan: tanpa ambang ini,
      // sekadar memilih elemen sudah menjatuhkannya lagi di jangkar baru.
      if (!ghost && !movedFar(event.clientX, event.clientY)) return;
      setGhost(targetFor(event.clientX, event.clientY));
    };

    const up = (event: PointerEvent) => {
      // Tidak pernah bergerak = klik untuk memilih, bukan seretan: tidak ada
      // patch. Menjatuhkan elemen di titik yang sama pun akan mengubah
      // offset-nya (jangkar dipilih ulang), dan itu bukan yang orang minta.
      if (!ghost && !movedFar(event.clientX, event.clientY)) {
        setDrag(null);
        return;
      }
      const target = targetFor(event.clientX, event.clientY);
      const box = host.getBoundingClientRect();
      const ops = buildOps(scene, drag, target, safe, {
        box: { w: box.width, h: box.height },
        annotationFrame: freshAnnotationFrameRef.current(),
      });
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

  const selection =
    scene && selectionState.scene === scene.id ? selectionState.keys : NO_SELECTION;

  // Escape mengosongkan seleksi. Panah TIDAK menggeser seleksi: panah
  // kiri/kanan milik transport (App.tsx), dan dua arti untuk satu tombol
  // lebih buruk daripada tidak ada.
  useEffect(() => {
    if (selection.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectionState({ scene: undefined, keys: NO_SELECTION });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);

  // Pegangan disembunyikan saat memutar: teks bergerak sepanjang animasinya,
  // jadi kotaknya akan bergetar mengikuti — dan tidak ada editor yang
  // menampilkan pegangan transform di atas video yang sedang jalan.
  if (!scene || playing) return null;
  const locked = scene.locked;
  const lines =
    ghost && drag && drag.handle.kind !== "annotation" && drag.mode === "move"
      ? activeGuideLines(ghost, drag.guides, SNAP)
      : { x: [], y: [] };

  const start = (handle: Handle, mode: DragState["mode"], event: React.PointerEvent) => {
    if (locked) return;
    event.preventDefault();
    const box = hostRef.current?.parentElement?.getBoundingClientRect();
    if (!box) return;
    // Seleksi (ADR-0024 §7): Shift+klik menambah/mengurangi; klik biasa pada
    // anggota mempertahankan seleksinya (itulah cara menyeret kelompok); klik
    // biasa pada yang lain menggantinya. Anotasi selalu sendiri — koordinatnya
    // milik bingkai screenshot, bukan frame video — begitu pula ubah ukuran.
    const key = keyOf(handle);
    let next: Set<string>;
    if (mode === "resize" || handle.kind === "annotation") {
      next = new Set([key]);
    } else if (event.shiftKey) {
      next = new Set([...selection].filter((other) => !other.startsWith("annotation:")));
      if (next.has(key)) {
        next.delete(key);
        setSelectionState({ scene: scene.id, keys: next });
        return;
      }
      next.add(key);
    } else {
      next = selection.has(key) ? new Set(selection) : new Set([key]);
    }
    setSelectionState({ scene: scene.id, keys: next });
    // Kotak dibaca SEGAR saat menekan (lihat freshRect), untuk pegangan ini
    // dan semua anggota seleksi.
    const fresh: Handle = { ...handle, rect: freshRect(handle) };
    const members: DragMember[] =
      mode === "move"
        ? handles
            .filter((candidate) => next.has(keyOf(candidate)))
            .map((candidate) => {
              const current = { ...candidate, rect: freshRect(candidate) };
              return { handle: current, origin: centerOf(current.rect, box) };
            })
        : [{ handle: fresh, origin: centerOf(fresh.rect, box) }];
    if (!members.some((member) => keyOf(member.handle) === key)) {
      members.push({ handle: fresh, origin: centerOf(fresh.rect, box) });
    }
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
    const handleRect = fresh.rect;
    // Panduan: margin aman, lalu pusat/tepi elemen di LUAR seleksi (anggota
    // lain ikut bergerak, jadi tidak bisa jadi rujukan; anotasi tidak
    // menempel — koordinatnya milik bingkai screenshot, bukan frame video).
    const toFraction = (rect: Handle["rect"]) => ({
      x: rect.x / box.width,
      y: rect.y / box.height,
      w: rect.w / box.width,
      h: rect.h / box.height,
    });
    const others = handles
      .filter((other) => !next.has(keyOf(other)))
      .map((other) => toFraction(other.rect));
    const fromSafe = safeGuides(safe);
    const fromElements =
      handle.kind === "annotation"
        ? { x: [], y: [] }
        : elementGuides(toFraction(handleRect), others);
    setDrag({
      handle: fresh,
      members,
      mode,
      origin: centerOf(handleRect, box),
      pointer: { x: event.clientX, y: event.clientY },
      startSizeFrac: startSize ?? handleRect.h / box.height,
      guides: {
        x: [...fromSafe.x, ...fromElements.x],
        y: [...fromSafe.y, ...fromElements.y],
      },
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
          className={`canvas-box ${handle.kind}${selection.has(keyOf(handle)) ? " active" : ""}${
            isMember(drag, handle) ? " dragging" : ""
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
            ...(drag && ghost && isMember(drag, handle)
              ? {
                  translate: `${((ghost.x - drag.origin.x) * (hostRef.current?.clientWidth ?? 0)).toFixed(1)}px ${(
                    (ghost.y - drag.origin.y) * (hostRef.current?.clientHeight ?? 0)
                  ).toFixed(1)}px`,
                }
              : {}),
          }}
          onPointerDown={(event) => start(handle, "move", event)}
        >
          <span className="canvas-tag">
            {handle.kind === "annotation"
              ? `anotasi ${Number(handle.id) + 1}${
                  scene.annotations[Number(handle.id)]
                    ? ` · ${scene.annotations[Number(handle.id)]?.type}`
                    : ""
                }`
              : handle.id}
          </span>
          {handle.kind === "graphic" ||
          handle.kind === "layer" ||
          handle.kind === "annotation" ? (
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
  context: DragContext,
): { ops: Parameters<typeof studioClient.applyPatch>[0]; label: string } | null => {
  if (!scene || scene.locked) return null;

  if (drag.handle.kind === "annotation") {
    const index = Number(drag.handle.id);
    const annotation = scene.annotations[index];
    const frame = context.annotationFrame;
    if (!annotation || !frame || frame.w <= 0 || frame.h <= 0) return null;
    const dx = (target.x - drag.origin.x) * context.box.w;
    const dy = (target.y - drag.origin.y) * context.box.h;
    const next =
      drag.mode === "resize"
        ? resizedAnnotationTarget(frame, drag.handle.rect, dx, dy)
        : movedAnnotationTarget(frame, drag.handle.rect, dx, dy);
    if (sameTarget(next, annotation.target)) return null;
    return {
      ops: [
        {
          op: "updateScene",
          id: scene.id,
          patch: {
            annotations: scene.annotations.map((item, i) =>
              i === index ? { ...item, target: next } : item,
            ),
          },
        },
      ],
      label: `${drag.mode === "resize" ? "Ukuran" : "Geser"} anotasi ${index + 1} (${annotation.type})`,
    };
  }

  if (drag.mode === "move") {
    // Seretan kelompok (ADR-0024 §7): selisih yang SAMA untuk tiap anggota,
    // dan SATU patch untuk semuanya — satu baris di log, satu undo.
    const delta = { x: target.x - drag.origin.x, y: target.y - drag.origin.y };
    const changes = drag.members
      .map((member) => movedItem(scene, member.handle, member.origin, delta, safe))
      .filter((change): change is MovedItem => change !== null);
    if (changes.length === 0) return null;
    const textChanges = changes.filter((change) => change.kind === "text");
    const graphicChanges = changes.filter((change) => change.kind === "graphic");
    const layerChanges = changes.filter((change) => change.kind === "layer");
    const only = changes.length === 1 ? changes[0] : undefined;
    return {
      ops: [
        {
          op: "updateScene",
          id: scene.id,
          patch: {
            ...(textChanges.length > 0
              ? {
                  texts: scene.texts.map((item) => {
                    const hit = textChanges.find((change) => change.id === item.id);
                    return hit && hit.kind === "text"
                      ? { ...item, ...hit.placement }
                      : item;
                  }),
                }
              : {}),
            ...(graphicChanges.length > 0
              ? {
                  graphics: scene.graphics.map((item) => {
                    const hit = graphicChanges.find((change) => change.id === item.id);
                    return hit && hit.kind === "graphic"
                      ? { ...item, ...hit.placement }
                      : item;
                  }),
                }
              : {}),
            ...(layerChanges.length > 0
              ? {
                  layers: scene.layers.map((item) => {
                    const hit = layerChanges.find((change) => change.id === item.id);
                    return hit && hit.kind === "layer"
                      ? { ...item, ...hit.placement }
                      : item;
                  }),
                }
              : {}),
          },
        },
      ],
      label: only
        ? `Geser ${KIND_LABEL[only.kind]} ${only.id}`
        : `Geser ${changes.length} elemen sekaligus`,
    };
  }

  if (drag.handle.kind === "layer") {
    const layer = scene.layers.find((item) => item.id === drag.handle.id);
    if (!layer) return null;
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

  if (drag.handle.kind === "graphic") {
    const graphic = scene.graphics.find((item) => item.id === drag.handle.id);
    if (!graphic) return null;
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
              item.id === graphic.id ? { ...item, size: Number(next.toFixed(4)) } : item,
            ),
          },
        },
      ],
      label: `Ukuran grafis ${graphic.id}`,
    };
  }

  return null;
};

const KIND_LABEL = { text: "teks", graphic: "grafis", layer: "lapisan" } as const;

type MovedItem =
  | { kind: "text"; id: string; placement: TextPlacement }
  | { kind: "graphic"; id: string; placement: GraphicPlacement }
  | { kind: "layer"; id: string; placement: ReturnType<typeof placeLayer> };

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.001;

/** Geseran skema ±0,5, empat desimal. */
const shifted = (value: number, delta: number): number =>
  Number(Math.min(0.5, Math.max(-0.5, value + delta)).toFixed(4));

/**
 * Letak baru SATU elemen yang pusatnya (di layar, `origin`) digeser sejauh
 * `delta`, atau null bila tidak berubah. Dipakai untuk seretan tunggal maupun
 * kelompok.
 *
 * Selama jangkar/posisinya TIDAK berubah, geserannya RELATIF: offset lama +
 * selisih seretan. Menghitung ulang dari jangkar (`placeText` dkk.) di sini
 * salah, karena preset tidak menaruh elemen tepat di jangkar + offset —
 * teks bertumpuk dalam satu kelompok, blok diangkat sedikit — dan hasilnya
 * teks yang diseret mendatar melompat 30 px ke bawah pada seretan pertama.
 * Jangkar dihitung ulang hanya saat pusatnya menyeberang ke wilayah lain;
 * di situlah offset relatif akan menabrak batas ±0,5 (ADR-0024 §3).
 */
const movedItem = (
  scene: Scene,
  handle: Handle,
  origin: FramePoint,
  delta: FramePoint,
  safe: SafeInsets,
): MovedItem | null => {
  const target = { x: origin.x + delta.x, y: origin.y + delta.y };
  if (handle.kind === "text") {
    const text = scene.texts.find((item) => item.id === handle.id);
    if (!text) return null;
    const absolute = placeText(target, safe);
    const placement: TextPlacement =
      absolute.position === text.position
        ? {
            position: text.position,
            offsetX: shifted(text.offsetX, delta.x),
            offsetY: shifted(text.offsetY, delta.y),
          }
        : absolute;
    if (
      placement.position === text.position &&
      near(placement.offsetX, text.offsetX) &&
      near(placement.offsetY, text.offsetY)
    ) {
      return null;
    }
    return { kind: "text", id: text.id, placement };
  }
  if (handle.kind === "graphic") {
    const graphic = scene.graphics.find((item) => item.id === handle.id);
    if (!graphic) return null;
    const absolute = placeGraphic(target, safe);
    const placement: GraphicPlacement =
      absolute.anchor === graphic.anchor
        ? {
            anchor: graphic.anchor,
            offsetX: shifted(graphic.offsetX, delta.x),
            offsetY: shifted(graphic.offsetY, delta.y),
          }
        : absolute;
    if (
      placement.anchor === graphic.anchor &&
      near(placement.offsetX, graphic.offsetX) &&
      near(placement.offsetY, graphic.offsetY)
    ) {
      return null;
    }
    return { kind: "graphic", id: graphic.id, placement };
  }
  if (handle.kind === "layer") {
    const layer = scene.layers.find((item) => item.id === handle.id);
    if (!layer) return null;
    // Titik jatuh adalah PUSAT kotak; `placeLayer` bekerja pada kotaknya,
    // karena jangkar kiri menempelkan TEPI kiri ke margin aman, bukan pusatnya.
    const absolute = placeLayer(
      {
        x: target.x - layer.width / 2,
        y: target.y - layer.height / 2,
        width: layer.width,
        height: layer.height,
      },
      safe,
    );
    const placement =
      absolute.anchor === layer.anchor
        ? {
            anchor: layer.anchor,
            offsetX: shifted(layer.offsetX, delta.x),
            offsetY: shifted(layer.offsetY, delta.y),
          }
        : absolute;
    if (
      placement.anchor === layer.anchor &&
      near(placement.offsetX, layer.offsetX) &&
      near(placement.offsetY, layer.offsetY)
    ) {
      return null;
    }
    return { kind: "layer", id: layer.id, placement };
  }
  return null;
};
