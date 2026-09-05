import {
  clockLabel,
  primaryClip,
  type Scene,
  type ScenePlan,
  sceneAsset,
} from "@dalang/core";
import { computeFrameLayout, FPS } from "@dalang/templates/layout";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SourceLite } from "../../shared/api-types";
import { api } from "../api";
import { IconFilm, IconPlus } from "../icons";
import { studioClient, useStudio } from "../use-studio";

/**
 * Sumber rekaman (ADR-0028, roadmap §9.5) — bagian panel Properti yang
 * mengurus REKAMAN, bukan gambar: memilih berkas dari folder proyek,
 * mengunggah yang baru (streaming, dengan kemajuan), dan memilih TITIK MASUK
 * dengan melihat rekamannya — strip bingkai + bentuk gelombang sepanjang
 * seluruh rekaman, dengan jendela scene digambar di atasnya.
 *
 * Sebelum ini titik masuk hanya bisa diketik agent atau dipilih dari kalimat
 * transkrip. Memotong podcast satu jam tanpa pernah melihat satu bingkai pun
 * adalah pekerjaan buta, dan strip inilah yang mengembalikan penglihatannya.
 *
 * Semua perubahan keluar sebagai patch op biasa (updateScene) — tercatat,
 * bisa Ctrl+Z, terlihat agent.
 */

const THUMB_H = 40;
const PEAK_BUCKETS = 480;

const clock = (sec: number): string => {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Kalimat fakta satu rekaman: kodek, dimensi, laju, durasi. */
const factsOf = (source: SourceLite): string => {
  const p = source.probe;
  if (!p) return megabytes(source.sizeBytes);
  return [
    p.codec ?? null,
    p.width && p.height ? `${p.width}×${p.height}` : null,
    p.fps ? `${Math.round(p.fps * 100) / 100} fps` : null,
    clockLabel(p.durationSec),
    megabytes(source.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");
};

// ---------------------------------------------------------------------------
// Strip bingkai + gelombang + titik masuk
// ---------------------------------------------------------------------------

const SourceStrip: React.FC<{
  file: string;
  durationSec: number;
  trimStartSec: number;
  /** Panjang jendela DI REKAMAN (sudah dikali kecepatan), detik. */
  windowSec: number;
  disabled: boolean;
  onSetIn: (sec: number) => void;
}> = ({ file, durationSec, trimStartSec, windowSec, disabled, onSetIn }) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(6);
  const [draft, setDraft] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [silentSource, setSilentSource] = useState(false);

  // Jumlah bingkai mengikuti LEBAR strip, bukan angka tetap: panel Properti
  // bisa 280 px atau 520 px, dan strip yang terpotong menyembunyikan ujung
  // rekaman — justru tempat orang paling sering mencari penutupnya.
  useLayoutEffect(() => {
    const element = stripRef.current;
    if (!element) return;
    const measure = () => {
      const thumbW = Math.round(THUMB_H * (16 / 9));
      setCount(Math.max(3, Math.min(24, Math.floor(element.clientWidth / thumbW))));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    let alive = true;
    setPeaks(null);
    api
      .sourcePeaks(file, PEAK_BUCKETS)
      .then((payload) => {
        if (!alive) return;
        setPeaks(payload.peaks);
        setSilentSource(!payload.hasAudio);
      })
      .catch(() => {
        if (alive) setPeaks([]);
      });
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, width, height);
    const accent =
      getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#7c9cff";
    ctx.fillStyle = accent;
    const barW = width / peaks.length;
    peaks.forEach((peak, index) => {
      const h = Math.max(1, peak * height);
      ctx.globalAlpha = 0.35 + peak * 0.65;
      ctx.fillRect(index * barW, (height - h) / 2, Math.max(1, barW - 0.5), h);
    });
    ctx.globalAlpha = 1;
  }, [peaks]);

  const maxIn = Math.max(0, durationSec - windowSec);
  const secAt = (clientX: number): number => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return trimStartSec;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(maxIn, Math.round(fraction * durationSec * 10) / 10);
  };
  const shownIn = draft ?? trimStartSec;
  const pct = (sec: number) => `${durationSec > 0 ? (sec / durationSec) * 100 : 0}%`;
  const frames = Array.from(
    { length: count },
    (_, i) => ((i + 0.5) / count) * durationSec,
  );

  return (
    <div className="source-strip-block">
      <div
        ref={stripRef}
        className={disabled ? "source-strip disabled" : "source-strip"}
        role="slider"
        aria-label="Titik masuk di rekaman"
        aria-valuemin={0}
        aria-valuemax={maxIn}
        aria-valuenow={shownIn}
        tabIndex={0}
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDraft(secAt(event.clientX));
        }}
        onPointerMove={(event) => {
          if (draft === null || disabled) return;
          setDraft(secAt(event.clientX));
        }}
        onPointerUp={(event) => {
          if (draft === null) return;
          const sec = secAt(event.clientX);
          setDraft(null);
          if (Math.abs(sec - trimStartSec) >= 0.05) onSetIn(sec);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const step = event.shiftKey ? 10 : 1;
          if (event.key === "ArrowRight") onSetIn(Math.min(maxIn, trimStartSec + step));
          if (event.key === "ArrowLeft") onSetIn(Math.max(0, trimStartSec - step));
        }}
      >
        <div className="source-frames" style={{ height: THUMB_H }}>
          {frames.map((t) => (
            <img
              key={t}
              className="source-frame"
              src={api.sourceThumbUrl(file, t, THUMB_H)}
              alt=""
              draggable={false}
              loading="lazy"
            />
          ))}
        </div>
        <canvas ref={canvasRef} className="source-wave" />
        <div
          className="source-window"
          style={{ left: pct(shownIn), width: pct(Math.min(windowSec, durationSec)) }}
        />
        <div className="source-in" style={{ left: pct(shownIn) }} />
      </div>
      <div className="source-ruler">
        <span>0:00</span>
        <span className="source-in-label">
          masuk {clock(shownIn)} · jendela {windowSec.toFixed(1)} dtk
          {silentSource ? " · tanpa suara" : ""}
        </span>
        <span>{clock(durationSec)}</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Pemilih rekaman + unggah
// ---------------------------------------------------------------------------

const RecordingPicker: React.FC<{
  sceneId: string;
  layerId: string | null;
  currentFile: string | null;
  disabled: boolean;
}> = ({ sceneId, layerId, currentFile, disabled }) => {
  const { sources, sourceUpload } = useStudio();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) void studioClient.loadSources();
  }, [open]);

  const videos = (sources?.items ?? []).filter((item) => item.kind === "video");
  const target = { sceneId, ...(layerId ? { layerId } : {}) };

  return (
    <div className="source-picker">
      <div className="btn-row">
        <button
          type="button"
          className="ghost with-icon"
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <IconFilm />
          {open ? "Tutup daftar" : "Pilih rekaman"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mkv,.mts"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void studioClient.uploadSource(file, target);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          className="ghost with-icon"
          disabled={disabled || sourceUpload !== null}
          onClick={() => inputRef.current?.click()}
          data-tip="Diunggah streaming ke folder proyek, lalu dipasang & diberi proxy"
        >
          <IconPlus />
          Unggah rekaman
        </button>
      </div>
      {sourceUpload ? (
        <div className="source-progress" aria-live="polite">
          <span>
            Mengunggah {sourceUpload.name} · {Math.round(sourceUpload.progress * 100)}%
          </span>
          <progress value={sourceUpload.progress} max={1} />
        </div>
      ) : null}
      {open ? (
        <div className="source-list">
          {sources?.loading ? <p className="group-hint">Membaca folder proyek…</p> : null}
          {sources?.error ? (
            <p className="group-hint error">Gagal: {sources.error}</p>
          ) : null}
          {sources && !sources.loading && videos.length === 0 ? (
            <p className="group-hint">
              Belum ada rekaman video di folder proyek. Taruh berkasnya di{" "}
              <code>assets/</code> atau unggah dari sini.
            </p>
          ) : null}
          {sources && !sources.transcoder ? (
            <p className="group-hint">
              Mesin ini tanpa transkoder ffmpeg: rekaman tetap bisa dipasang, tapi tanpa
              proxy, thumbnail, dan bentuk gelombang.
            </p>
          ) : null}
          {videos.map((source) => {
            const inUse = source.usedBy.sceneIds.length + source.usedBy.layerIds.length;
            const current = source.file === currentFile;
            return (
              <div
                key={source.file}
                className={current ? "source-row current" : "source-row"}
              >
                <div className="source-row-main">
                  <strong className="source-name">{source.file.split("/").pop()}</strong>
                  <span className="meta-line wrap">{factsOf(source)}</span>
                  <span className="meta-line wrap">
                    {inUse > 0 ? `dipakai ${inUse} tempat` : "belum dipakai"}
                    {source.proxy
                      ? ` · proxy ${source.proxy.width}×${source.proxy.height}`
                      : source.proxyDecision
                        ? source.proxyDecision.needed
                          ? " · perlu proxy"
                          : " · ringan, tanpa proxy"
                        : ""}
                    {source.transcript ? " · ada transkrip" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="mini"
                  disabled={disabled || current}
                  onClick={() =>
                    void studioClient.registerSource({ file: source.file, ...target })
                  }
                >
                  {current ? "Dipakai" : "Pakai"}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Bagian panel: fakta aset + proxy + strip + pemilih
// ---------------------------------------------------------------------------

export const SourceSection: React.FC<{
  plan: ScenePlan;
  scene: Scene;
  /** Diisi = mengurus lapisan ini, bukan visual dasar scene. */
  layerId?: string;
}> = ({ plan, scene, layerId }) => {
  const { project } = useStudio();
  const busy = project?.busy.mutation !== null;
  const proxyJob = project?.proxyJob ?? null;
  const layer = layerId ? scene.layers.find((item) => item.id === layerId) : undefined;
  const visual = layer ? layer.visual : primaryClip(scene);
  const asset = layerId ? plan.renderState.layerAssets[layerId] : sceneAsset(plan, scene);
  const isVideo = asset?.kind === "video";

  const index = plan.scenes.findIndex((item) => item.id === scene.id);
  const sceneSec = (computeFrameLayout(plan).sceneFrames[index] ?? 0) / FPS;
  const speed = visual.speed > 0 ? visual.speed : 1;
  const windowSec = layer
    ? Math.max(0, layer.endFrac - layer.startFrac) * sceneSec * speed
    : sceneSec * speed;

  const setIn = (trimStartSec: number) => {
    const label = `Titik masuk ${layerId ?? scene.id} ${clock(trimStartSec)}`;
    if (layer) {
      void studioClient.applyPatch(
        [
          {
            op: "updateScene",
            id: scene.id,
            patch: {
              layers: scene.layers.map((item) =>
                item.id === layer.id
                  ? { ...item, visual: { ...item.visual, trimStartSec } }
                  : item,
              ),
            },
          },
        ],
        label,
      );
    } else {
      void studioClient.applyPatch(
        [{ op: "updateScene", id: scene.id, patch: { clip: { trimStartSec } } }],
        label,
      );
    }
  };

  return (
    <div className="source-section">
      {isVideo && asset ? (
        <div className="source-card">
          <div className="source-card-head">
            <span className="source-name">{asset.file.split("/").pop()}</span>
            {proxyJob?.running && proxyJob.file === asset.file ? (
              <span
                className="source-badge"
                title="Proxy sedang dibuat di latar — editor tetap bisa dipakai"
              >
                proxy {Math.round(proxyJob.fraction * 100)}%
              </span>
            ) : asset.proxy ? (
              <span className="source-badge ok" title={asset.proxy.file}>
                proxy {asset.proxy.width}×{asset.proxy.height}
              </span>
            ) : (
              <button
                type="button"
                className="mini"
                disabled={busy || Boolean(proxyJob?.running)}
                title="Buat salinan ringan 540p di latar untuk preview & render draf; render final tetap memakai aslinya"
                onClick={() => void studioClient.runProxies([asset.file])}
              >
                Buat proxy
              </button>
            )}
          </div>
          <span className="meta-line wrap">
            {[
              asset.codec ?? null,
              asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
              asset.fps ? `${Math.round(asset.fps * 100) / 100} fps` : null,
              asset.durationSec ? clockLabel(asset.durationSec) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {asset.durationSec ? (
            <SourceStrip
              file={asset.file}
              durationSec={asset.durationSec}
              trimStartSec={visual.trimStartSec}
              windowSec={windowSec}
              disabled={busy || scene.locked}
              onSetIn={setIn}
            />
          ) : null}
        </div>
      ) : null}
      <RecordingPicker
        sceneId={scene.id}
        layerId={layerId ?? null}
        currentFile={isVideo && asset ? asset.file : null}
        disabled={busy || scene.locked}
      />
    </div>
  );
};
