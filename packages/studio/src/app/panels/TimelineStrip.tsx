import type { Scene, ScenePlan } from "@dalang/core";
import { activeSceneIndex } from "@dalang/templates/layout";
import { DalangVideo } from "@dalang/templates/video";
import { Thumbnail } from "@remotion/player";
import { useMemo, useSyncExternalStore } from "react";
import { IconLock, IconPlus } from "../icons";
import { type PlanMeta, planMeta, sceneThumbFrame } from "../model/plan-meta";
import { deriveSceneStatus } from "../model/scene-status";
import { playback } from "../playback";
import { studioClient, useStudio } from "../use-studio";

/**
 * Timeline horizontal di dasar layar (pola editor video): satu klip per
 * scene, LEBAR sebanding durasi, thumbnail nyata, status suara/aset sebagai
 * titik berwarna, playhead tersinkron dengan Player (klik klip = pilih +
 * lompat ke awal scene-nya).
 */

const PX_PER_SEC = 26;
const MIN_CLIP_PX = 104;

const StatusDot: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  if (value === "n/a") return null;
  return <span className={`tl-dot ${value}`} title={`${label}: ${value}`} />;
};

const Clip: React.FC<{
  plan: ScenePlan;
  meta: PlanMeta;
  scene: Scene;
  index: number;
  selected: boolean;
  active: boolean;
}> = ({ plan, meta, scene, index, selected, active }) => {
  const { project } = useStudio();
  const durationSec = (meta.sceneFrames[index] ?? 0) / meta.fps;
  const width = Math.max(MIN_CLIP_PX, Math.round(durationSec * PX_PER_SEC));
  const status = deriveSceneStatus(
    plan,
    scene,
    project?.stageRuns ?? [],
    project?.busy ?? { mutation: null, render: null },
  );

  return (
    <button
      type="button"
      className={`clip ${selected ? "selected" : ""} ${active ? "active" : ""}`}
      style={{ width }}
      onClick={() => {
        studioClient.selectScene(scene.id);
        playback.requestSeek((meta.sceneStarts[index] ?? 0) + 1);
      }}
      title={scene.narration || scene.id}
    >
      <span className="clip-thumb">
        <Thumbnail
          component={DalangVideo}
          inputProps={{ plan, debug: false }}
          frameToDisplay={sceneThumbFrame(meta, index)}
          durationInFrames={meta.durationInFrames}
          compositionWidth={meta.width}
          compositionHeight={meta.height}
          fps={meta.fps}
          style={{ width: "100%", height: "100%" }}
        />
      </span>
      <span className="clip-body">
        <span className="clip-top">
          <span className="clip-index">{index + 1}</span>
          <span className="clip-id">{scene.id}</span>
          {scene.locked ? (
            <span className="clip-lock" title="Terkunci dari agent">
              <IconLock />
            </span>
          ) : null}
        </span>
        <span className="clip-bottom">
          <StatusDot label="suara" value={status.voice} />
          <StatusDot label="aset" value={status.asset} />
          <span className="clip-duration">{durationSec.toFixed(1)}s</span>
        </span>
      </span>
      <span className="clip-active-bar" />
    </button>
  );
};

export const TimelineStrip: React.FC = () => {
  const { project, selectedSceneId } = useStudio();
  const plan = project?.plan ?? null;
  const frame = useSyncExternalStore(playback.subscribe, playback.getFrame);

  const meta = useMemo(() => (plan ? planMeta(plan) : null), [plan]);
  const activeIndex =
    plan && meta
      ? activeSceneIndex(
          {
            sceneStarts: meta.sceneStarts,
            sceneFrames: meta.sceneFrames,
            totalFrames: meta.durationInFrames,
          },
          frame,
        )
      : -1;

  if (!plan || !meta) {
    return (
      <footer className="timeline-strip">
        <div className="tl-head">
          <span className="tl-title">Timeline</span>
          <span className="tl-meta">menunggu scene-plan pertama</span>
        </div>
      </footer>
    );
  }

  const addAtEnd = () => {
    const lastId = plan.scenes.at(-1)?.id ?? null;
    const id = `sc-${Date.now().toString(36)}`;
    void studioClient.applyPatch(
      [
        {
          op: "addScene",
          afterId: lastId,
          scene: { id, visual: { type: "stock", query: "" } } as never,
        },
      ],
      `Scene ${id} ditambahkan`,
    );
  };

  const seconds = Math.round(meta.totalSec);

  return (
    <footer className="timeline-strip">
      <div className="tl-head">
        <span className="tl-title">Timeline</span>
        <span className="tl-meta">
          {plan.scenes.length} scene | {seconds}s | {plan.meta.aspectRatio}
        </span>
        <span className="tl-frame">
          {(frame / meta.fps).toFixed(1)}s / frame {frame}
        </span>
      </div>
      <div className="tl-scroll">
        {plan.scenes.map((scene, index) => (
          <Clip
            key={scene.id}
            plan={plan}
            meta={meta}
            scene={scene}
            index={index}
            selected={scene.id === selectedSceneId}
            active={index === activeIndex}
          />
        ))}
        <button
          type="button"
          className="clip add"
          onClick={addAtEnd}
          disabled={project?.busy.mutation !== null}
          title="Tambah scene di akhir"
        >
          <IconPlus />
          <span>Scene</span>
        </button>
      </div>
    </footer>
  );
};
