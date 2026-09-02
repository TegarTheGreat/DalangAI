import {
  PUBLISH_PRIVACY_LABEL,
  parseScenePlan,
  proxiedFiles,
  substituteProxies,
} from "@dalang/core";
import { DalangVideo } from "@dalang/templates/video";
import { type CallbackListener, Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import type { RenderOutput } from "../../shared/api-types";
import { IconDownload, IconUpload } from "../icons";
import { planMeta } from "../model/plan-meta";
import { playback } from "../playback";
import { uiStore } from "../ui-state";
import { studioClient, useStudio } from "../use-studio";
import { CanvasEditor } from "./CanvasEditor";
import { PublishDialog } from "./PublishDialog";

/**
 * Panggung tengah: preview instan via @remotion/player — komponen video yang
 * SAMA dengan renderer. Playhead dipublikasikan ke bus playback (timeline
 * menyorot scene aktif) dan permintaan seek dari timeline dieksekusi di sini.
 */

export const PreviewPanel: React.FC = () => {
  const { project, renderProgress, publishProgress } = useStudio();
  const rawPlan = project?.plan ?? null;
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [publishFor, setPublishFor] = useState<RenderOutput | null>(null);
  const targets = project?.publish.targets ?? [];
  const targetLabel = (id: string) =>
    targets.find((candidate) => candidate.id === id)?.label ?? id;
  // Unggahan yang berjalan (ADR-0030): dari event bila ada, atau dari
  // snapshot server bila tab disegarkan di tengah unggahan.
  const uploading =
    publishProgress &&
    (publishProgress.status === "started" || publishProgress.status === "progress")
      ? {
          file: publishProgress.file,
          target: publishProgress.target,
          fraction: publishProgress.fraction,
        }
      : (project?.publish.job ?? null);

  const parsed = useMemo(() => {
    if (!rawPlan) return null;
    try {
      const plan = parseScenePlan(rawPlan);
      // ADR-0028: Player memutar PROXY-nya (540p H.264) bila ada — geometri,
      // trim, dan kecepatan tidak berubah karena semuanya milik rekamannya.
      return {
        plan,
        previewPlan: substituteProxies(plan),
        proxied: proxiedFiles(plan).size,
        meta: planMeta(plan),
      };
    } catch {
      return null;
    }
  }, [rawPlan]);

  useEffect(() => {
    if (!player) return;
    const onFrame: CallbackListener<"frameupdate"> = (event) => {
      playback.setFrame(event.detail.frame);
    };
    const onPlay = () => playback.setPlaying(true);
    const onPause = () => playback.setPlaying(false);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    const offSeek = playback.onSeek((frame) => player.seekTo(frame));
    const offToggle = playback.onToggle(() => player.toggle());
    const offPause = playback.onPause(() => player.pause());
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      offSeek();
      offToggle();
      offPause();
    };
  }, [player]);

  if (!parsed) {
    return (
      <section className="panel preview-panel">
        <div className="preview-empty">
          <p className="empty-title">Belum ada video.</p>
          <p>
            Ceritakan brief videomu — agent menyusun draft scene-plan pertama, lalu semua
            bisa kamu ubah manual di sini.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              uiStore.openChat();
              window.setTimeout(() => {
                document
                  .querySelector<HTMLInputElement>(".starter .brief-form input")
                  ?.focus();
              }, 50);
            }}
          >
            Mulai dari brief
          </button>
        </div>
      </section>
    );
  }

  const { plan, previewPlan, proxied, meta } = parsed;
  const portrait = meta.height > meta.width;

  return (
    <section className="panel preview-panel">
      <div className="stage">
        <div
          className={portrait ? "player-box portrait" : "player-box landscape"}
          style={{ aspectRatio: `${meta.width} / ${meta.height}` }}
        >
          <Player
            ref={setPlayer}
            component={DalangVideo}
            inputProps={{ plan: previewPlan, debug: false }}
            durationInFrames={meta.durationInFrames}
            compositionWidth={meta.width}
            compositionHeight={meta.height}
            fps={meta.fps}
            controls
            loop
            // Poster awal di tengah scene pembuka — frame 0 gelap (fade-in).
            initialFrame={Math.min(Math.floor((meta.sceneFrames[0] ?? 2) / 2), 60)}
            acknowledgeRemotionLicense
            style={{ width: "100%", height: "100%" }}
          />
          {/* Lapisan manipulasi langsung (ADR-0024) duduk DI ATAS pemutar dan
              membaca kotak elemen yang sudah ter-render di dalamnya. */}
          <CanvasEditor plan={plan} />
          {proxied > 0 ? (
            <span
              className="proxy-flag"
              title="Preview memutar proxy 540p; render final memakai berkas aslinya"
            >
              proxy
            </span>
          ) : null}
        </div>
      </div>
      {renderProgress?.status === "started" ||
      renderProgress?.status === "error" ||
      (project?.renders.length ?? 0) > 0 ? (
        <div className="render-strip">
          {renderProgress?.status === "started" ? (
            <span className="render-note">Merender {renderProgress.label}…</span>
          ) : null}
          {renderProgress?.status === "error" ? (
            <span className="render-note error">
              Render gagal: {renderProgress.error}
            </span>
          ) : null}
          {uploading ? (
            <span className="render-note">
              Mengunggah {uploading.file} ke {targetLabel(uploading.target)}{" "}
              {Math.round(uploading.fraction * 100)}%
              <button
                type="button"
                className="mini"
                onClick={() => void studioClient.cancelPublish()}
              >
                Batal
              </button>
            </span>
          ) : null}
          {!uploading && publishProgress?.status === "error" ? (
            <span className="render-note error">
              {publishProgress.error === "dibatalkan"
                ? `Unggahan ${publishProgress.file} dibatalkan`
                : `Unggah ${publishProgress.file} gagal: ${publishProgress.error}`}
            </span>
          ) : null}
          {renderProgress?.status === "done" &&
          typeof renderProgress.mixLufs === "number" ? (
            <span
              className="render-note"
              title={
                renderProgress.mixNote
                  ? `EBU R128, diukur dari berkasnya sendiri · ${renderProgress.mixNote}`
                  : "Kenyaringan terintegrasi berkas hasil, diukur dari berkasnya sendiri (EBU R128)"
              }
            >
              campuran akhir {renderProgress.mixLufs.toFixed(1)} LUFS
              {plan.meta.loudnessTarget ? ` · sasaran ${plan.meta.loudnessTarget}` : ""}
              {renderProgress.mixGainDb
                ? ` · dikoreksi ${renderProgress.mixGainDb > 0 ? "+" : ""}${renderProgress.mixGainDb.toFixed(1)} dB`
                : ""}
              {renderProgress.proxied ? ` · ${renderProgress.proxied} dari proxy` : ""}
            </span>
          ) : null}
          {(project?.renders ?? []).map((render) => {
            const name = render.url.split("/").pop() ?? render.url;
            return (
              <span key={render.url} className="render-item">
                <a
                  className="render-link"
                  href={render.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconDownload />
                  {/* Nama berkas yang dipendekkan, UKURAN tidak: memotong
                      seluruh tautan membuat ukurannya — bagian yang justru
                      dibaca orang — yang lebih dulu hilang. */}
                  <span className="render-name">{name}</span>
                  <span className="render-size">
                    {(render.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                </a>
                {render.published ? (
                  <a
                    className="render-published"
                    href={render.published.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Terunggah ${new Date(render.published.at).toLocaleString("id-ID")} · ${PUBLISH_PRIVACY_LABEL[render.published.privacy]}`}
                  >
                    {render.published.url.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
                <button
                  type="button"
                  className="render-publish"
                  disabled={targets.length === 0 || uploading !== null}
                  title={
                    targets.length === 0
                      ? (project?.publish.hint ?? "Tidak ada tujuan publikasi")
                      : `Unggah ${name} ke ${targets[0]?.label}`
                  }
                  onClick={() => setPublishFor(render)}
                >
                  <IconUpload />
                  {targets.length === 0
                    ? "Unggah (butuh token)"
                    : render.published
                      ? "Unggah lagi"
                      : `Unggah ke ${targets[0]?.label}`}
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <PublishDialog render={publishFor} onClose={() => setPublishFor(null)} />
    </section>
  );
};
