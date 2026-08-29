import { parseScenePlan } from "@dalang/core";
import { DalangVideo } from "@dalang/templates/video";
import { type CallbackListener, Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import { IconDownload } from "../icons";
import { planMeta } from "../model/plan-meta";
import { playback } from "../playback";
import { useStudio } from "../use-studio";

/**
 * Panggung tengah: preview instan via @remotion/player — komponen video yang
 * SAMA dengan renderer. Playhead dipublikasikan ke bus playback (timeline
 * menyorot scene aktif) dan permintaan seek dari timeline dieksekusi di sini.
 */

export const PreviewPanel: React.FC = () => {
  const { project, renderProgress } = useStudio();
  const rawPlan = project?.plan ?? null;
  const [player, setPlayer] = useState<PlayerRef | null>(null);

  const parsed = useMemo(() => {
    if (!rawPlan) return null;
    try {
      const plan = parseScenePlan(rawPlan);
      return { plan, meta: planMeta(plan) };
    } catch {
      return null;
    }
  }, [rawPlan]);

  useEffect(() => {
    if (!player) return;
    const onFrame: CallbackListener<"frameupdate"> = (event) => {
      playback.setFrame(event.detail.frame);
    };
    player.addEventListener("frameupdate", onFrame);
    const offSeek = playback.onSeek((frame) => player.seekTo(frame));
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      offSeek();
    };
  }, [player]);

  if (!parsed) {
    return (
      <section className="panel preview-panel">
        <div className="preview-empty">
          <p className="empty-title">Belum ada video.</p>
          <p>
            Ceritakan brief videomu di panel chat — agent menyusun draft scene-plan
            pertama, lalu semua bisa kamu ubah manual di sini.
          </p>
        </div>
      </section>
    );
  }

  const { plan, meta } = parsed;
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
            inputProps={{ plan, debug: false }}
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
        </div>
      </div>
      {renderProgress?.status === "started" ||
      renderProgress?.status === "error" ||
      (project?.renders.length ?? 0) > 0 ? (
        <div className="render-strip">
          {renderProgress?.status === "started" ? (
            <span className="render-note">Merender {renderProgress.profile}…</span>
          ) : null}
          {renderProgress?.status === "error" ? (
            <span className="render-note error">
              Render gagal: {renderProgress.error}
            </span>
          ) : null}
          {(project?.renders ?? []).map((render) => (
            <a
              key={render.url}
              className="render-link"
              href={render.url}
              target="_blank"
              rel="noreferrer"
            >
              <IconDownload />
              {render.profile === "final" ? "final.mp4" : "preview.mp4"} (
              {(render.sizeBytes / 1024 / 1024).toFixed(1)} MB)
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
};
