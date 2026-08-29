import { parseScenePlan } from "@dalang/core";
import { DalangVideo } from "@dalang/templates/video";
import { Player } from "@remotion/player";
import { useMemo } from "react";
import { planMeta } from "../model/plan-meta";
import { useStudio } from "../use-studio";

/**
 * Panel tengah: preview instan via @remotion/player — komponen video yang
 * SAMA dengan renderer (satu sumber kebenaran visual). Perubahan plan dari
 * panel mana pun langsung terlihat (<1 dtk, NFR §10): cukup inputProps baru,
 * tanpa render.
 */

export const PreviewPanel: React.FC = () => {
  const { project, renderProgress } = useStudio();
  const rawPlan = project?.plan ?? null;

  const parsed = useMemo(() => {
    if (!rawPlan) return null;
    try {
      const plan = parseScenePlan(rawPlan);
      return { plan, meta: planMeta(plan) };
    } catch {
      return null;
    }
  }, [rawPlan]);

  if (!parsed) {
    return (
      <section className="panel preview-panel">
        <div className="panel-head">
          <h2>Preview</h2>
        </div>
        <div className="preview-empty">
          <p className="empty-title">Belum ada scene-plan.</p>
          <p>Ceritakan brief videomu di panel chat — agent akan menyusun draft.</p>
        </div>
      </section>
    );
  }

  const { plan, meta } = parsed;
  const portrait = meta.height > meta.width;

  return (
    <section className="panel preview-panel">
      <div className="panel-head">
        <h2>Preview</h2>
        <span className="meta-line">
          {plan.meta.aspectRatio} · {Math.round(meta.totalSec)}s · {plan.scenes.length}{" "}
          scene · preset {plan.meta.stylePreset}
        </span>
      </div>
      <div className="player-wrap">
        <div
          className={portrait ? "player-box portrait" : "player-box landscape"}
          style={{ aspectRatio: `${meta.width} / ${meta.height}` }}
        >
          <Player
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
      <div className="render-strip">
        {renderProgress && renderProgress.status === "started" ? (
          <span className="render-note">Merender {renderProgress.profile}…</span>
        ) : null}
        {renderProgress?.status === "error" ? (
          <span className="render-note error">Render gagal: {renderProgress.error}</span>
        ) : null}
        {(project?.renders ?? []).map((render) => (
          <a
            key={render.url}
            className="render-link"
            href={render.url}
            target="_blank"
            rel="noreferrer"
          >
            Unduh {render.profile === "final" ? "final.mp4" : "preview.mp4"} (
            {(render.sizeBytes / 1024 / 1024).toFixed(1)} MB)
          </a>
        ))}
      </div>
    </section>
  );
};
