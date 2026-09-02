import {
  MIN_SCENE_SEC,
  type Scene,
  type ScenePlan,
  substituteProxies,
} from "@dalang/core";
import { DalangVideo } from "@dalang/templates/video";
import { Thumbnail } from "@remotion/player";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useScrollFade } from "../components/controls";
import {
  IconLock,
  IconNextScene,
  IconPause,
  IconPlay,
  IconPlus,
  IconPrevScene,
  IconSplit,
} from "../icons";
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
/** Batas atas bingkai filmstrip per klip — penjaga biaya render thumbnail. */
const MAX_FILMSTRIP_FRAMES = 40;

const formatTime = (frame: number, fps: number): string => {
  const totalSec = frame / fps;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

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
  // Filmstrip menutupi SELURUH lebar klip. Batas 6 bingkai yang lama membuat
  // klip pada zoom tinggi jadi sebagian besar hitam — persis pada zoom yang
  // dipakai untuk kerja presisi. Batas atas tetap ada supaya klip yang sangat
  // panjang tidak melahirkan ratusan Thumbnail sekaligus.
  const count = Math.max(1, Math.min(MAX_FILMSTRIP_FRAMES, Math.ceil(width / thumbW)));
  const frames = filmstripFrames(meta, index, count);
  // ADR-0028: thumbnail juga dari proxy — tiap Thumbnail adalah satu dekoder
  // video, dan empat puluh dekoder 4K sekaligus membekukan timeline.
  const previewPlan = useMemo(() => substituteProxies(plan), [plan]);
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
        // ADR-0015: jatuhkan file gambar dari OS ke klip = unggah + pasang
        // ter-pin ke scene itu; tanpa file, ini reorder klip biasa.
        const file = event.dataTransfer.files?.[0];
        if (file && /^image\/(png|jpe?g)$/.test(file.type)) {
          const reader = new FileReader();
          reader.onload = () =>
            void studioClient.uploadAsset(scene.id, file.name, String(reader.result));
          reader.readAsDataURL(file);
          onDragState(null);
          return;
        }
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
                inputProps={{ plan: previewPlan, debug: false }}
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

/**
 * Gulir timeline mengikuti playhead.
 *
 * Tanpa ini, memutar timeline yang di-zoom membuat playhead keluar dari
 * pandangan dan penyunting kehilangan tempatnya — perilaku yang tidak ada di
 * satu pun NLE. Digulir hanya saat playhead mendekati tepi, bukan tiap frame,
 * supaya scroll manual pengguna tidak terus-menerus direbut kembali.
 */
const useFollowPlayhead = (
  scrollRef: React.RefObject<HTMLDivElement | null>,
  playheadX: number,
  playing: boolean,
  scrubbing: React.RefObject<boolean>,
): void => {
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || scrubbing.current) return;
    const margin = Math.min(160, box.clientWidth * 0.2);
    const left = box.scrollLeft;
    const right = left + box.clientWidth;
    if (playheadX < left + margin) {
      box.scrollTo({ left: Math.max(0, playheadX - margin), behavior: "auto" });
    } else if (playheadX > right - margin) {
      box.scrollTo({
        left: playheadX - box.clientWidth + margin,
        behavior: playing ? "auto" : "smooth",
      });
    }
  }, [scrollRef, playheadX, playing, scrubbing]);
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
  // Tepi gulir yang memudar: klip terakhir yang teriris rata di tepi terbaca
  // seperti tampilan rusak, bukan seperti "masih ada lanjutannya".
  const [scrollRef, scrollFade] = useScrollFade<HTMLDivElement>();
  const scrubbing = useRef(false);

  const meta = useMemo(() => (plan ? planMeta(plan) : null), [plan]);
  const boxes = useMemo(() => (meta ? clipBoxes(meta, pxPerSec) : []), [meta, pxPerSec]);
  // Dihitung sebelum early return karena hook di bawahnya tidak boleh
  // dipanggil bersyarat.
  const playheadX = meta ? frameToX(frame, meta, boxes) : 0;
  useFollowPlayhead(scrollRef, playheadX, playing, scrubbing);

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

  // ADR-0015: target belah = scene di bawah playhead, dengan kedua bagian
  // minimal 1 detik dan scene tidak terkunci.
  const splitTarget = (() => {
    for (let i = meta.sceneStarts.length - 1; i >= 0; i--) {
      const start = meta.sceneStarts[i] ?? 0;
      if (frame < start) continue;
      const local = (frame - start) / meta.fps;
      const total = (meta.sceneFrames[i] ?? 0) / meta.fps;
      const scene = plan.scenes[i];
      if (!scene || scene.locked || local < 1 || total - local < 1) return null;
      return { sceneId: scene.id, atSec: Math.round(local * 10) / 10 };
    }
    return null;
  })();

  /**
   * Batas scene di kiri/kanan playhead. Navigasi antar-scene adalah kontrol
   * transport baku di editor mana pun, dan datanya sudah ada — tanpa ini
   * satu-satunya cara berpindah scene adalah menyeret playhead dengan mata.
   */
  const boundaries = meta.sceneStarts;
  const prevBoundary = (() => {
    for (let i = boundaries.length - 1; i >= 0; i--) {
      const start = boundaries[i] ?? 0;
      // Ambang 2 frame: menekan "sebelumnya" tepat di awal scene harus
      // melompat ke scene sebelumnya, bukan diam di tempat.
      if (start < frame - 2) return start;
    }
    return frame > 0 ? 0 : null;
  })();
  const nextBoundary = boundaries.find((start) => start > frame + 2) ?? null;

  const activeSceneIndex = (() => {
    for (let i = boundaries.length - 1; i >= 0; i--) {
      if (frame >= (boundaries[i] ?? 0)) return i;
    }
    return 0;
  })();
  const activeScene = plan.scenes[activeSceneIndex];

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
          className="mini step-btn"
          disabled={prevBoundary === null}
          data-tip="Scene sebelumnya"
          onClick={() => {
            playback.requestPause();
            if (prevBoundary !== null) playback.requestSeek(prevBoundary);
          }}
        >
          <IconPrevScene />
        </button>
        <button
          type="button"
          className="transport-play"
          onClick={() => playback.requestToggle()}
          data-tip={playing ? "Jeda (Spasi)" : "Putar (Spasi)"}
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <button
          type="button"
          className="mini step-btn"
          disabled={nextBoundary === null}
          data-tip="Scene berikutnya"
          onClick={() => {
            playback.requestPause();
            if (nextBoundary !== null) playback.requestSeek(nextBoundary);
          }}
        >
          <IconNextScene />
        </button>
        <span className="transport-time">
          {formatTime(frame, meta.fps)}
          <span className="transport-total">
            {" "}
            / {formatTime(meta.durationInFrames, meta.fps)}
          </span>
        </span>
        <button
          type="button"
          className="mini split-btn"
          disabled={busy || !splitTarget}
          data-tip="Belah scene di playhead"
          onClick={() => {
            if (splitTarget) {
              void studioClient.splitScene(splitTarget.sceneId, splitTarget.atSec);
            }
          }}
        >
          <IconSplit />
        </button>
        <span className="transport-spacer" />
        {/* Scene di bawah playhead. Bentangan tengah transport tadinya
            ~1100px kekosongan di pita yang paling sering dilihat; yang
            mengisinya harus keterangan yang memang dicari orang saat
            menggeser playhead, bukan hiasan. */}
        {activeScene ? (
          <button
            type="button"
            className="transport-scene"
            onClick={() => studioClient.selectScene(activeScene.id)}
            data-tip="Pilih scene ini di panel Properti"
          >
            <span className="transport-scene-no">{activeSceneIndex + 1}</span>
            <span className="transport-scene-id">{activeScene.id}</span>
          </button>
        ) : null}
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
          <span className="tl-gutter-label">Narasi</span>
          <span className="tl-gutter-label" title="Musik latar & cue efek suara">
            Musik
          </span>
        </div>
        <div className={`tl-scroll ${scrollFade}`} ref={scrollRef}>
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

            {ticks
              .filter((tick) => tick.label)
              .map((tick) => (
                <span
                  key={`grid-${tick.sec}`}
                  className="grid-line"
                  style={{ left: tick.x }}
                />
              ))}

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

            {/*
              Track lapisan (ADR-0025) hanya muncul kalau ada lapisannya.
              Baris kosong permanen di timeline mengajarkan mata untuk
              melewatinya, dan baris yang dilewati sama saja dengan tidak ada.
            */}
            {plan.scenes.some((scene) => scene.layers.length > 0) ? (
              <div className="tl-track layers">
                {plan.scenes.flatMap((scene, index) => {
                  const box = boxes[index] as ClipBox;
                  return scene.layers.map((layer) => {
                    const asset = plan.renderState.layerAssets[layer.id];
                    const x = box.x + layer.startFrac * box.w;
                    const w = Math.max(6, (layer.endFrac - layer.startFrac) * box.w);
                    return (
                      <button
                        key={layer.id}
                        type="button"
                        className={asset ? "layer-bar" : "layer-bar kosong"}
                        style={{ left: x, width: w }}
                        onClick={() => studioClient.selectScene(scene.id)}
                        title={`Lapisan ${layer.id} di ${scene.id} · ${Math.round(
                          layer.startFrac * 100,
                        )}%–${Math.round(layer.endFrac * 100)}% durasi scene${
                          asset ? "" : " · berkas belum ada, tidak akan muncul"
                        }`}
                      >
                        <span className="layer-bar-label">{layer.id}</span>
                        {/* Berlian keyframe (ADR-0027): waktu adalah tempat
                            keyframe hidup, jadi ia harus terlihat di garis
                            waktu — bukan hanya sebagai daftar di panel.
                            Menyeretnya belum ada; lihat "Batas" ADR-0027. */}
                        {layer.tracks.flatMap((track) =>
                          track.points.map((point) => (
                            <span
                              key={`${track.property}-${point.at}`}
                              className="kf-diamond"
                              style={{ left: `${point.at * 100}%` }}
                              title={`${track.property} @ ${Math.round(point.at * 100)}%`}
                            />
                          )),
                        )}
                      </button>
                    );
                  });
                })}
              </div>
            ) : null}

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

            {/*
              Track ketiga: musik latar (ADR-0014) dan cue efek suara
              (ADR-0018). Keduanya sudah lama bisa dipasang, tetapi tidak
              pernah terlihat di timeline — dan lapisan audio yang tak terlihat
              tidak bisa ditakar oleh siapa pun.
            */}
            <div className="tl-track audio mix">
              {plan.audio.music ? (
                <span
                  className="music-bar"
                  style={{ left: 0, width }}
                  title={`Musik: ${plan.audio.music.assetId} · volume ${Math.round(
                    plan.audio.music.volume * 100,
                  )}%${plan.audio.music.ducking ? " · ducking aktif" : ""}`}
                >
                  <span className="music-label">
                    {plan.audio.music.assetId.replace("pustaka:", "")}
                  </span>
                </span>
              ) : null}
              {/* Trek audio tambahan (ADR-0026) di baris yang sama dengan
                  musik: keduanya bunyi yang bukan narasi, dan memisahkannya ke
                  baris keempat hanya menambah tinggi timeline tanpa menambah
                  apa yang bisa dibaca. */}
              {plan.audio.tracks.map((track) => {
                const asset = plan.renderState.trackAssets[track.id];
                const index = track.sceneId
                  ? plan.scenes.findIndex((scene) => scene.id === track.sceneId)
                  : -1;
                if (track.sceneId && index < 0) return null;
                const anchor = index >= 0 ? (boxes[index]?.x ?? 0) : 0;
                const x = anchor + track.atSec * pxPerSec;
                const w = asset?.durationSec
                  ? Math.max(6, asset.durationSec * pxPerSec)
                  : 24;
                return (
                  <button
                    key={track.id}
                    type="button"
                    className={asset ? "track-bar" : "track-bar kosong"}
                    style={{ left: x, width: w }}
                    onClick={() =>
                      track.sceneId ? studioClient.selectScene(track.sceneId) : undefined
                    }
                    title={`Trek ${track.id} · volume ${Math.round(
                      track.audio.volume * 100,
                    )}%${track.loop ? " · diulang" : ""}${
                      asset ? "" : " · berkas belum ada, tidak berbunyi"
                    }`}
                  >
                    <span className="layer-bar-label">{track.id}</span>
                  </button>
                );
              })}
              {plan.audio.sfx.map((cue) => {
                const index = plan.scenes.findIndex((scene) => scene.id === cue.sceneId);
                if (index < 0) return null;
                const box = boxes[index] as ClipBox;
                const x = box.x + cue.atSec * pxPerSec;
                return (
                  <button
                    key={cue.id}
                    type="button"
                    className="sfx-pin"
                    style={{ left: x }}
                    onClick={() => studioClient.selectScene(cue.sceneId)}
                    title={`Efek suara ${cue.id} · +${cue.atSec.toFixed(1)}s dari awal ${cue.sceneId} · volume ${Math.round(cue.volume * 100)}%`}
                  >
                    <span className="sfx-pin-dot" />
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
