import {
  clipAsset,
  cutClipOps,
  type Scene,
  type ScenePlan,
  type Transcript,
  type TranscriptSpan,
} from "@dalang/core";
import { clipFrameSpans, computeFrameLayout, FPS } from "@dalang/templates/layout";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { IconMic } from "../icons";
import { selectedClip } from "../model/plan-meta";
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
  const { project, selectedClipId } = useStudio();
  // Menyasar potongan TERPILIH, sama seperti tab Visual, tab Audio, dan panel
  // Sumber (ADR-0033). Scene wawancara berklip dua belas menampilkan dua belas
  // rentang rekaman yang berbeda; panel yang selalu menunjukkan rentang
  // potongan pertama menjawab dengan yakin tentang potongan yang tidak sedang
  // dilihat siapa pun.
  const clip = selectedClip(scene, selectedClipId);
  const file = clipAsset(plan, clip.id)?.file;
  const kind = clipAsset(plan, clip.id)?.kind;
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

  const trimStart = clip.trimStartSec;
  const speed = clip.speed > 0 ? clip.speed : 1;
  const sceneFrames =
    computeFrameLayout(plan).sceneFrames[
      plan.scenes.findIndex((item) => item.id === scene.id)
    ] ?? 0;
  // Petak POTONGAN INI di dalam scene — dari `clipFrameSpans`, fungsi yang
  // sama yang dipakai renderer. Jendela yang dihitung dari durasi scene utuh
  // akan menyorot kalimat yang sebenarnya sudah dibuang.
  const petak = clipFrameSpans(scene, Math.max(sceneFrames, scene.clips.length)).find(
    (item) => item.id === clip.id,
  );
  const clipFrames = petak?.frames ?? sceneFrames;
  const clipStartFrame = petak?.startFrame ?? 0;
  const windowEnd = trimStart + (clipFrames / FPS) * speed;

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
    // Waktu REKAMAN -> waktu di dalam POTONGAN -> frame komposisi. Dua
    // penyesuaian yang gampang terlewat: pembagian kecepatan (meleset makin
    // jauh pada potongan yang dipercepat) dan bingkai awal potongan di dalam
    // scene — tanpa yang kedua, mengklik kalimat potongan ketiga melompat ke
    // awal scene.
    const inClip = Math.max(0, (recSec - trimStart) / speed);
    playback.requestSeek(
      sceneStartFrame(plan, scene.id) + clipStartFrame + Math.round(inClip * FPS),
    );
  };

  /**
   * Potong ke kalimat ini.
   *
   * Op-nya disusun `cutClipOps` di core, bukan di sini: panjang potongan
   * disimpan di tempat yang BERBEDA tergantung jumlah klip scene (ADR-0033
   * §2), dan sebelum ini tombol ini selalu mengirim `duration` berupa angka —
   * yang untuk scene berklip banyak DITOLAK skema, jadi tombolnya gagal merah
   * persis di scene hasil pembelahan, satu-satunya tempat ia paling
   * dibutuhkan. Tool `cutByWords` milik agent memakai fungsi yang sama.
   */
  const cutTo = (target: TranscriptSpan) =>
    studioClient.applyPatch(
      cutClipOps(scene, clip, {
        fromSec: Number(target.startSec.toFixed(3)),
        toSec: Number(target.endSec.toFixed(3)),
      }),
      `${scene.clips.length > 1 ? clip.id : scene.id} dipotong ke "${target.text.slice(0, 40)}"`,
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
