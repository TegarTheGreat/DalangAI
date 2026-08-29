import { MIN_SCENE_SEC, type Scene, type ScenePlan } from "@dalang/core";
import { DalangVideo } from "@dalang/templates/video";
import { Thumbnail } from "@remotion/player";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { IconLock, IconPlay, IconPlus } from "../icons";
import { type PlanMeta, planMeta } from "../model/plan-meta";
import { deriveSceneStatus } from "../model/scene-status";
import {
  type ClipBox,
  clipBoxes,
  filmstripFrames,
  frameToX,
  rulerTicks,
  timelineWidth,
  xToFrame,
} from "../model/timeline-scale";
import { playback } from "../playback";
import { studioClient, useStudio } from "../use-studio";

/**
 * Timeline editor di dasar layar: ruler waktu yang bisa di-scrub, track
 * video (klip filmstrip selebar durasi, drag untuk menyusun ulang), track
 * suara (blok narasi per scene), playhead tersinkron dua arah dengan
 * Player, dan transport play/pause + zoom.
 */

const MIN_ZOOM = 8;
const MAX_ZOOM = 64;

const formatTime = (frame: number, fps: number): string => {
  const totalSec = frame / fps;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

const IconPause: React.FC = () => (
  <svg
    aria-hidden="true"
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

const Clip: React.FC<{
  plan: ScenePlan;
  meta: PlanMeta;
  scene: Scene;
  index: number;
  box: ClipBox;
  clipHeight: number;
  pxPerSec: number;
  selected: boolean;
  active: boolean;
  dropSide: "before" | "after" | null;
  onDragState: (sceneId: string | null) => void;
  onDropHint: (sceneId: string, side: "before" | "after") => void;
  onDrop: (targetId: string, side: "before" | "after") => void;
}> = ({
  plan,
  meta,
  scene,
  index,
  box,
  clipHeight,
  pxPerSec,
  selected,
  active,
  dropSide,
  onDragState,
  onDropHint,
  onDrop,
}) => {
  const { project } = useStudio();
  // Trim (mekanika CapCut): seret tepi kanan = ubah durasi scene. Selama
  // seretan hanya state lokal + label; patch updateScene dikirim saat lepas.
  const [trimSec, setTrimSec] = useState<number | null>(null);
  const trimFrom = useRef<{ x: number; sec: number } | null>(null);
  const status = deriveSceneStatus(
    plan,
    scene,
    project?.stageRuns ?? [],
    project?.busy ?? { mutation: null, render: null },
  );
  const width = trimSec === null ? box.w : Math.max(56, Math.round(trimSec * pxPerSec));
  const thumbW = Math.max(24, Math.round(clipHeight * (meta.width / meta.height)));
  const count = Math.min(6, Math.max(1, Math.ceil(width / thumbW)));
  const frames = filmstripFrames(meta, index, count);
  const busy = project?.busy.mutation !== null;
  const durSec = (meta.sceneFrames[index] ?? 1) / meta.fps;

  const endTrim = () => {
    const from = trimFrom.current;
    const sec = trimSec;
    trimFrom.current = null;
    setTrimSec(null);
    if (!from || sec === null || Math.abs(sec - from.sec) < 0.05) return;
    void studioClient.applyPatch(
      [{ op: "updateScene", id: scene.id, patch: { duration: sec } }],
      `Durasi ${scene.id} jadi ${sec.toFixed(1)}s`,
    );
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-n-drop klip timeline
    <div
      className={[
        "clip",
        selected ? "selected" : "",
        active ? "active" : "",
        trimSec !== null ? "trimming" : "",
        dropSide ? `drop-${dropSide}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ left: box.x, width }}
      draggable={!busy}
      onDragStart={(event) => {
        if (trimFrom.current) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", scene.id);
        onDragState(scene.id);
      }}
      onDragEnd={() => onDragState(null)}
      onDragOver={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onDropHint(
          scene.id,
          event.clientX < rect.left + rect.width / 2 ? "before" : "after",
        );
      }}
      onDrop={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onDrop(scene.id, event.clientX < rect.left + rect.width / 2 ? "before" : "after");
      }}
    >
      <button
        type="button"
        className="clip-hit"
        onClick={() => {
          studioClient.selectScene(scene.id);
          playback.requestSeek((meta.sceneStarts[index] ?? 0) + 1);
        }}
        title={scene.narration || scene.id}
      >
        <span className="clip-film" style={{ height: clipHeight }}>
          {frames.map((frame) => (
            <span key={frame} className="clip-frame" style={{ width: thumbW }}>
              <Thumbnail
                component={DalangVideo}
                inputProps={{ plan, debug: false }}
                frameToDisplay={frame}
                durationInFrames={meta.durationInFrames}
                compositionWidth={meta.width}
                compositionHeight={meta.height}
                fps={meta.fps}
                style={{ width: "100%", height: "100%" }}
              />
            </span>
          ))}
        </span>
        <span className="clip-label">
          <span className="clip-index">{index + 1}</span>
          <span className="clip-id">{scene.id}</span>
          {scene.locked ? (
            <span className="clip-lock">
              <IconLock />
            </span>
          ) : null}
        </span>
        <span className="clip-badges">
          <span className={`tl-dot ${status.asset}`} title={`aset: ${status.asset}`} />
        </span>
        <span className="clip-active-bar" />
      </button>
      {trimSec !== null ? (
        <span className="trim-label">{trimSec.toFixed(1)}s</span>
      ) : null}
      <div
        className="clip-trim"
        data-testid={`trim-${scene.id}`}
        onPointerDown={(event) => {
          if (busy) return;
          event.preventDefault();
          event.stopPropagation();
          trimFrom.current = { x: event.clientX, sec: durSec };
          setTrimSec(Math.max(MIN_SCENE_SEC, Math.round(durSec * 10) / 10));
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = trimFrom.current;
          if (!from) return;
          const raw = from.sec + (event.clientX - from.x) / pxPerSec;
          setTrimSec(Math.max(MIN_SCENE_SEC, Math.round(raw * 10) / 10));
        }}
        onPointerUp={endTrim}
        onPointerCancel={() => {
          trimFrom.current = null;
          setTrimSec(null);
        }}
      />
    </div>
  );
};

export const TimelineStrip: React.FC = () => {
  const { project, selectedSceneId } = useStudio();
  const plan = project?.plan ?? null;
  const frame = useSyncExternalStore(playback.subscribe, playback.getFrame);
  const playing = useSyncExternalStore(playback.subscribe, playback.getPlaying);
  const [pxPerSec, setPxPerSec] = useState(24);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{
    id: string;
    side: "before" | "after";
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const meta = useMemo(() => (plan ? planMeta(plan) : null), [plan]);
  const boxes = useMemo(() => (meta ? clipBoxes(meta, pxPerSec) : []), [meta, pxPerSec]);

  if (!plan || !meta) {
    return (
      <footer className="timeline-strip empty">
        <div className="transport">
          <span className="tl-hint">
            Timeline muncul setelah scene-plan pertama dibuat lewat chat.
          </span>
        </div>
      </footer>
    );
  }

  const width = timelineWidth(boxes);
  const playheadX = frameToX(frame, meta, boxes);
  const ticks = rulerTicks(meta, boxes);
  const busy = project?.busy.mutation !== null;

  const scrubTo = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    playback.requestSeek(xToFrame(clientX - rect.left, meta, boxes));
  };

  const reorder = (targetId: string, side: "before" | "after") => {
    setDropHint(null);
    const sourceId = drag;
    setDrag(null);
    if (!sourceId || sourceId === targetId) return;
    const order = plan.scenes.map((scene) => scene.id).filter((id) => id !== sourceId);
    const at = order.indexOf(targetId) + (side === "after" ? 1 : 0);
    order.splice(at, 0, sourceId);
    void studioClient.applyPatch([{ op: "reorderScenes", order }], "Urutan scene diubah");
  };

  const addAtEnd = () => {
    const id = `sc-${Date.now().toString(36)}`;
    void studioClient.applyPatch(
      [
        {
          op: "addScene",
          afterId: plan.scenes.at(-1)?.id ?? null,
          scene: { id, visual: { type: "stock", query: "" } } as never,
        },
      ],
      `Scene ${id} ditambahkan`,
    );
  };

  return (
    <footer className="timeline-strip">
      <div className="transport">
        <button
          type="button"
          className="transport-play"
          onClick={() => playback.requestToggle()}
          data-tip={playing ? "Jeda (Spasi)" : "Putar (Spasi)"}
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <span className="transport-time">
          {formatTime(frame, meta.fps)}
          <span className="transport-total">
            {" "}
            / {formatTime(meta.durationInFrames, meta.fps)}
          </span>
        </span>
        <span className="transport-spacer" />
        <div className="zoom-group">
          <button
            type="button"
            className="mini"
            onClick={() => setPxPerSec((z) => Math.max(MIN_ZOOM, z - 8))}
            disabled={pxPerSec <= MIN_ZOOM}
            data-tip="Perkecil timeline"
          >
            -
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            value={pxPerSec}
            onChange={(event) => setPxPerSec(Number(event.target.value))}
            title="Zoom timeline"
          />
          <button
            type="button"
            className="mini"
            onClick={() => setPxPerSec((z) => Math.min(MAX_ZOOM, z + 8))}
            disabled={pxPerSec >= MAX_ZOOM}
            data-tip="Perbesar timeline"
          >
            +
          </button>
        </div>
      </div>

      <div className="tl-body">
        <div className="tl-gutter">
          <span className="tl-gutter-ruler" />
          <span className="tl-gutter-label">Video</span>
          <span className="tl-gutter-label">Suara</span>
        </div>
        <div className="tl-scroll">
          <div className="tl-canvas" ref={canvasRef} style={{ width: width + 80 }}>
            <div
              className="tl-ruler"
              onPointerDown={(event) => {
                scrubbing.current = true;
                playback.requestPause();
                event.currentTarget.setPointerCapture(event.pointerId);
                scrubTo(event.clientX);
              }}
              onPointerMove={(event) => {
                if (scrubbing.current) scrubTo(event.clientX);
              }}
              onPointerUp={() => {
                scrubbing.current = false;
              }}
            >
              {ticks.map((tick) => (
                <span
                  key={tick.sec}
                  className={tick.label ? "tick label" : "tick"}
                  style={{ left: tick.x }}
                >
                  {tick.label ? <em>{tick.sec}s</em> : null}
                </span>
              ))}
            </div>

            {/* biome-ignore lint/a11y/noStaticElementInteractions: kontainer drop DnD klip */}
            <div className="tl-track video" onDragLeave={() => setDropHint(null)}>
              {plan.scenes.map((scene, index) => (
                <Clip
                  key={scene.id}
                  plan={plan}
                  meta={meta}
                  scene={scene}
                  index={index}
                  box={boxes[index] as ClipBox}
                  clipHeight={54}
                  pxPerSec={pxPerSec}
                  selected={scene.id === selectedSceneId}
                  active={
                    frame >= (meta.sceneStarts[index] ?? 0) &&
                    playheadX >= (boxes[index]?.x ?? 0) &&
                    playheadX <= (boxes[index]?.x ?? 0) + (boxes[index]?.w ?? 0)
                  }
                  dropSide={dropHint?.id === scene.id ? dropHint.side : null}
                  onDragState={setDrag}
                  onDropHint={(id, side) => setDropHint({ id, side })}
                  onDrop={reorder}
                />
              ))}
              <button
                type="button"
                className="clip-add"
                style={{ left: width + 8 }}
                onClick={addAtEnd}
                disabled={busy}
                data-tip="Tambah scene di akhir"
              >
                <IconPlus />
              </button>
            </div>

            <div className="tl-track audio">
              {plan.scenes.map((scene, index) => {
                const audio = plan.renderState.narrationAudio[scene.id];
                const status = deriveSceneStatus(
                  plan,
                  scene,
                  project?.stageRuns ?? [],
                  project?.busy ?? { mutation: null, render: null },
                );
                if (scene.narration.trim() === "") return null;
                const box = boxes[index] as ClipBox;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    className={`audio-block ${audio ? (audio.fallbackQuality ? "fallback" : "ok") : status.voice}`}
                    style={{ left: box.x, width: box.w }}
                    onClick={() => studioClient.selectScene(scene.id)}
                    title={
                      audio
                        ? `Narasi ${audio.durationSec.toFixed(1)}s${audio.fallbackQuality ? " (fallback)" : ""}`
                        : "Belum ada suara — jalankan Suara"
                    }
                  >
                    <span className="audio-wave" aria-hidden />
                  </button>
                );
              })}
            </div>

            <div className="tl-playhead" style={{ left: playheadX }}>
              <span className="tl-playhead-cap" />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
