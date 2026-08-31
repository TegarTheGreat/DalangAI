import type { Scene, ScenePlan, Transcript, TranscriptSpan } from "@dalang/core";
import { computeFrameLayout, FPS } from "@dalang/templates/layout";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { IconMic } from "../icons";
import { playback } from "../playback";
import { studioClient, useStudio } from "../use-studio";

/**
 * Tab Transkrip (ADR-0021) — teks berwaktu dari rekaman scene.
 *
 * Dua hal yang bisa dilakukan di sini, dan keduanya sengaja terpisah:
 *
 *  - KLIK kalimat memindahkan playhead ke tempat kalimat itu terdengar di
 *    dalam scene. Tidak mengubah apa pun; menjelajah tidak boleh merusak.
 *  - Tombol "Potong ke sini" memotong scene ke rentang kalimat itu, lewat
 *    patch op biasa — jadi Urungkan bekerja seperti pada semua editan lain.
 *
 * Isinya diambil sendiri lewat /api/transcript, bukan ikut muatan state:
 * rekaman satu jam menambah ratusan kilobyte pada SETIAP siaran perubahan.
 */

const clock = (sec: number): string => {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Frame awal scene di dalam komposisi — supaya klik kalimat melompat ke
 * tempat yang benar, bukan ke detik yang sama dihitung dari awal video.
 */
const sceneStartFrame = (plan: ScenePlan, sceneId: string): number => {
  const index = plan.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return 0;
  return computeFrameLayout(plan).sceneStarts[index] ?? 0;
};

export const TranscriptTab: React.FC<{ plan: ScenePlan; scene: Scene }> = ({
  plan,
  scene,
}) => {
  const { project } = useStudio();
  const file = plan.renderState.resolvedAssets[scene.id]?.file;
  const kind = plan.renderState.resolvedAssets[scene.id]?.kind;
  const summary = project?.transcripts.find((item) => item.file === file);

  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [spans, setSpans] = useState<TranscriptSpan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diarize, setDiarize] = useState(false);

  // Diambil ulang saat berkas ATAU jumlah katanya berubah: transkripsi ulang
  // dengan diarisasi menghasilkan isi berbeda untuk berkas yang sama.
  const words = summary?.words ?? 0;
  useEffect(() => {
    if (!file || words === 0) {
      setTranscript(null);
      setSpans([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .getTranscript(file)
      .then((payload) => {
        if (!alive) return;
        setTranscript(payload.transcript);
        setSpans(payload.spans);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [file, words]);

  if (!file || (kind !== "video" && kind !== "audio")) {
    return (
      <div className="panel-empty compact">
        <IconMic />
        <p>
          Scene ini belum memakai rekaman video/audio. Transkrip hanya untuk scene yang
          menampilkan orang bicara.
        </p>
      </div>
    );
  }

  const trimStart = scene.visual.trimStartSec;
  const speed = scene.visual.speed > 0 ? scene.visual.speed : 1;
  const sceneSec =
    computeFrameLayout(plan).sceneFrames[
      plan.scenes.findIndex((item) => item.id === scene.id)
    ];
  const windowEnd = trimStart + ((sceneSec ?? 0) / FPS) * speed;

  const runTranscribe = async () => {
    setError(null);
    try {
      await studioClient.transcribe([scene.id], diarize);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 501
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    }
  };

  const seekTo = (recSec: number) => {
    // Waktu REKAMAN -> waktu SCENE -> frame komposisi. Melewatkan pembagian
    // kecepatan akan meleset makin jauh pada scene yang dipercepat.
    const inScene = Math.max(0, (recSec - trimStart) / speed);
    playback.requestSeek(sceneStartFrame(plan, scene.id) + Math.round(inScene * FPS));
  };

  const cutTo = (span: TranscriptSpan) =>
    studioClient.applyPatch(
      [
        {
          op: "updateScene",
          id: scene.id,
          patch: {
            visual: { trimStartSec: Number(span.startSec.toFixed(3)) },
            duration: Number(((span.endSec - span.startSec) / speed).toFixed(3)),
          },
        },
      ],
      `${scene.id} dipotong ke "${span.text.slice(0, 40)}"`,
    );

  return (
    <div className="prop-group transcript-tab">
      <div className="transcript-head">
        <div>
          <span className="field-label">Rekaman</span>
          <p className="transcript-file">{file}</p>
        </div>
        {summary ? (
          <span className="transcript-badge">
            {summary.words} kata · {summary.language}
            {summary.speakers.length > 1 ? ` · ${summary.speakers.length} pembicara` : ""}
            {summary.fromNarration ? " · dari narasi" : ""}
          </span>
        ) : null}
      </div>

      {!summary ? (
        <div className="transcript-empty">
          <p>
            Rekaman ini belum ditranskrip. Setelah ditranskrip, kamu bisa memotong
            berdasarkan kalimat — dan caption untuk footage orang dibuat otomatis.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={diarize}
              onChange={(event) => setDiarize(event.target.checked)}
            />
            <span>Pisahkan pembicara (wawancara / podcast)</span>
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={project?.busy.mutation !== null}
            onClick={() => void runTranscribe()}
          >
            Transkripsi rekaman
          </button>
        </div>
      ) : null}

      {error ? <p className="lib-warn">{error}</p> : null}
      {loading ? <p className="tab-hint">Memuat transkrip…</p> : null}

      {transcript ? (
        <>
          <p className="tab-hint">
            Klik kalimat untuk melompat ke sana di preview. Tombol potong menyetel titik
            masuk dan durasi scene — bisa diurungkan seperti editan lain.
          </p>
          <ol className="transcript-list">
            {spans.map((span) => {
              // Di dalam potongan yang sedang dipakai scene ini?
              const inWindow = span.endSec > trimStart && span.startSec < windowEnd;
              return (
                <li
                  key={`${span.startSec}-${span.endSec}`}
                  className={inWindow ? "transcript-line in-window" : "transcript-line"}
                >
                  <button
                    type="button"
                    className="transcript-seek"
                    onClick={() => seekTo(span.startSec)}
                    title={`Lompat ke ${clock(span.startSec)}`}
                  >
                    <span className="transcript-time">{clock(span.startSec)}</span>
                    <span className="transcript-text">{span.text}</span>
                  </button>
                  <button
                    type="button"
                    className="mini transcript-cut"
                    onClick={() => void cutTo(span)}
                    title="Potong scene ke kalimat ini"
                  >
                    Potong
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </div>
  );
};
