import { parseScenePlan, proxiedFiles, substituteProxies } from "@dalang/core";
import { DalangVideo } from "@dalang/templates/video";
import { type CallbackListener, Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import { IconDownload } from "../icons";
import { planMeta } from "../model/plan-meta";
import { playback } from "../playback";
import { uiStore } from "../ui-state";
import { useStudio } from "../use-studio";
import { CanvasEditor } from "./CanvasEditor";

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
          {renderProgress?.status === "done" &&
          typeof renderProgress.mixLufs === "number" ? (
            <span
              className="render-note"
              title="Kenyaringan terintegrasi berkas hasil, diukur dari berkasnya sendiri (EBU R128)"
            >
              campuran akhir {renderProgress.mixLufs.toFixed(1)} LUFS
              {plan.meta.loudnessTarget ? ` · sasaran ${plan.meta.loudnessTarget}` : ""}
              {renderProgress.proxied ? ` · ${renderProgress.proxied} dari proxy` : ""}
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
              {render.url.split("/").pop()} ({(render.sizeBytes / 1024 / 1024).toFixed(1)}{" "}
              MB)
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
};
