import type { PatchOpInput, Scene, ScenePlan } from "@dalang/core";
import { MOTIONS, VISUAL_TYPES } from "@dalang/core";
import { DalangVideo } from "@dalang/templates/video";
import { Thumbnail } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import { type PlanMeta, planMeta, sceneThumbFrame } from "../model/plan-meta";
import { badgeLabel, deriveSceneStatus } from "../model/scene-status";
import { studioClient, useStudio } from "../use-studio";

/**
 * Panel kanan (PRD §8.2): timeline scene (status pipeline per scene, lock,
 * pilih) + inspector properti yang bisa diedit langsung. Semua edit manual
 * menjadi PATCH USER — tercatat di log, bisa di-undo, dan terlihat agent.
 */

const StatusBadge: React.FC<{ kind: "voice" | "asset"; value: string }> = ({
  kind,
  value,
}) => {
  if (value === "n/a") return null;
  return (
    <span className={`badge ${value}`}>
      <span className="dot" aria-hidden />
      {kind === "voice" ? "suara" : "aset"} {badgeLabel[value as keyof typeof badgeLabel]}
    </span>
  );
};

const SceneRow: React.FC<{
  plan: ScenePlan;
  meta: PlanMeta;
  scene: Scene;
  index: number;
  selected: boolean;
  durationSec: number;
}> = ({ plan, meta, scene, index, selected, durationSec }) => {
  const { project } = useStudio();
  const status = deriveSceneStatus(
    plan,
    scene,
    project?.stageRuns ?? [],
    project?.busy ?? { mutation: null, render: null },
  );

  return (
    <button
      type="button"
      className={`scene-row ${selected ? "selected" : ""}`}
      onClick={() => studioClient.selectScene(scene.id)}
    >
      <div className="scene-thumb">
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
      </div>
      <div className="scene-info">
        <div className="scene-title-line">
          <span className="scene-ordinal">{String(index + 1).padStart(2, "0")}</span>
          <span className="scene-id">{scene.id}</span>
          {scene.locked ? <span className="lock-chip">terkunci</span> : null}
          <span className="scene-duration">{durationSec.toFixed(1)}s</span>
        </div>
        <div className="scene-snippet">
          {scene.narration.trim() === "" ? (
            <em>(tanpa narasi)</em>
          ) : (
            scene.narration.slice(0, 64) + (scene.narration.length > 64 ? "…" : "")
          )}
        </div>
        <div className="scene-badges">
          <span className="badge type">{scene.visual.type}</span>
          <StatusBadge kind="voice" value={status.voice} />
          <StatusBadge kind="asset" value={status.asset} />
        </div>
      </div>
    </button>
  );
};

const AssetGrid: React.FC = () => {
  const { assetSearch } = useStudio();
  if (!assetSearch) return null;
  return (
    <div className="asset-grid-block">
      <div className="asset-grid-head">
        <span>
          Kandidat “{assetSearch.query}”
          {assetSearch.provider ? ` · ${assetSearch.provider}` : ""}
        </span>
        <button
          type="button"
          className="mini"
          onClick={() => studioClient.closeAssetSearch()}
        >
          Tutup
        </button>
      </div>
      {assetSearch.loading ? <div className="asset-grid-note">mencari…</div> : null}
      {assetSearch.error ? (
        <div className="asset-grid-note error">Gagal: {assetSearch.error}</div>
      ) : null}
      <div className="asset-grid">
        {assetSearch.candidates.map((candidate) => (
          <button
            key={candidate.assetId}
            type="button"
            className="asset-card"
            onClick={() => void studioClient.pickAsset(candidate.index)}
            title={`${candidate.assetId} · ${candidate.license}`}
          >
            {candidate.thumbnailUrl ? (
              <img src={candidate.thumbnailUrl} alt={candidate.assetId} loading="lazy" />
            ) : (
              <span className="asset-card-fallback">{candidate.kind}</span>
            )}
            <span className="asset-card-meta">
              {candidate.width}×{candidate.height}
              {candidate.durationSec ? ` · ${Math.round(candidate.durationSec)}s` : ""}
              {candidate.author ? ` · ${candidate.author}` : ""}
            </span>
          </button>
        ))}
      </div>
      <p className="asset-grid-hint">
        Memilih kandidat = patch user: aset dipasang dan <strong>ter-pin</strong> — tidak
        akan ditimpa auto-resolve.
      </p>
    </div>
  );
};

const Inspector: React.FC<{ plan: ScenePlan; scene: Scene; index: number }> = ({
  plan,
  scene,
  index,
}) => {
  const { project } = useStudio();
  const busy = project?.busy.mutation !== null;
  const [narration, setNarration] = useState(scene.narration);
  const [query, setQuery] = useState(scene.visual.query ?? "");
  const [duration, setDuration] = useState(
    scene.duration === "auto" ? "" : String(scene.duration),
  );

  // Sinkron ulang draft form saat pindah scene / plan berubah dari luar.
  useEffect(() => {
    setNarration(scene.narration);
    setQuery(scene.visual.query ?? "");
    setDuration(scene.duration === "auto" ? "" : String(scene.duration));
  }, [scene]);

  const patch = (ops: PatchOpInput[], label?: string) =>
    void studioClient.applyPatch(ops, label);

  const dirty =
    narration !== scene.narration ||
    query !== (scene.visual.query ?? "") ||
    duration !== (scene.duration === "auto" ? "" : String(scene.duration));

  const save = () => {
    const durationValue =
      duration.trim() === "" ? ("auto" as const) : Number(duration.trim());
    if (
      durationValue !== "auto" &&
      (!Number.isFinite(durationValue) || durationValue <= 0)
    ) {
      return;
    }
    const update: Record<string, unknown> = {};
    if (narration !== scene.narration) update.narration = narration;
    if (query !== (scene.visual.query ?? "")) {
      update.visual = { query: query.trim() === "" ? null : query };
    }
    if (durationValue !== scene.duration) update.duration = durationValue;
    patch([{ op: "updateScene", id: scene.id, patch: update }], "Scene disimpan.");
  };

  const move = (delta: number) => {
    const order = plan.scenes.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as string);
    patch([{ op: "reorderScenes", order: next }]);
  };

  const addAfter = () => {
    const id = `sc-${Date.now().toString(36)}`;
    patch(
      [
        {
          op: "addScene",
          afterId: scene.id,
          scene: { id, visual: { type: "stock", query: "" } } as never,
        },
      ],
      `Scene ${id} ditambahkan`,
    );
  };

  return (
    <div className="inspector">
      <div className="inspector-head">
        <h3>
          Scene {index + 1} · {scene.id}
        </h3>
        <label className="lock-toggle" title="Scene terkunci tidak boleh disentuh agent">
          <input
            type="checkbox"
            checked={scene.locked}
            onChange={(event) =>
              patch(
                [{ op: "lockScene", id: scene.id, locked: event.target.checked }],
                event.target.checked
                  ? `${scene.id} dikunci dari agent`
                  : `Kunci ${scene.id} dibuka`,
              )
            }
          />
          Kunci dari agent
        </label>
      </div>

      <label className="field">
        <span>Narasi</span>
        <textarea
          rows={4}
          value={narration}
          onChange={(event) => setNarration(event.target.value)}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Tipe visual</span>
          <select
            value={scene.visual.type}
            onChange={(event) =>
              patch([
                {
                  op: "updateScene",
                  id: scene.id,
                  patch: { visual: { type: event.target.value as never } },
                },
              ])
            }
          >
            {VISUAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Gerak</span>
          <select
            value={scene.visual.motion ?? "none"}
            onChange={(event) =>
              patch([
                {
                  op: "updateScene",
                  id: scene.id,
                  patch: { visual: { motion: event.target.value as never } },
                },
              ])
            }
          >
            {MOTIONS.map((motion) => (
              <option key={motion} value={motion}>
                {motion}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Durasi (dtk, kosong = auto)</span>
          <input
            type="text"
            inputMode="decimal"
            value={duration}
            placeholder="auto"
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
      </div>

      <label className="field">
        <span>Query aset (bahasa Inggris)</span>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="mis. borobudur temple aerial sunrise"
        />
      </label>

      {dirty ? (
        <div className="inspector-save">
          <button type="button" className="primary" onClick={save} disabled={busy}>
            Simpan perubahan
          </button>
        </div>
      ) : null}

      <div className="inspector-actions">
        <button
          type="button"
          className="ghost"
          disabled={busy || scene.narration.trim() === ""}
          onClick={() => void studioClient.runTts([scene.id])}
          title="Sintesis ulang suara scene ini"
        >
          TTS scene ini
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() =>
            void studioClient.searchAssets(
              scene.id,
              (
                scene.visual.query ?? scene.narration.split(/\s+/).slice(0, 8).join(" ")
              ).trim(),
              "video",
            )
          }
          title="Cari kandidat aset, lalu pilih manual (ter-pin)"
        >
          Cari aset
        </button>
        {scene.visual.pinned ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() =>
              patch(
                [{ op: "replaceAsset", sceneId: scene.id, assetId: null }],
                "Pin aset dilepas",
              )
            }
          >
            Lepas pin
          </button>
        ) : null}
      </div>

      <AssetGrid />

      <div className="inspector-actions secondary">
        <button
          type="button"
          className="ghost"
          disabled={busy || index === 0}
          onClick={() => move(-1)}
        >
          Naik
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || index === plan.scenes.length - 1}
          onClick={() => move(1)}
        >
          Turun
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={addAfter}>
          Tambah scene
        </button>
        <button
          type="button"
          className="ghost danger"
          disabled={busy || plan.scenes.length === 1}
          onClick={() =>
            patch([{ op: "removeScene", id: scene.id }], `Scene ${scene.id} dihapus`)
          }
        >
          Hapus
        </button>
      </div>
    </div>
  );
};

export const ScenesPanel: React.FC = () => {
  const { project, selectedSceneId } = useStudio();
  const plan = project?.plan ?? null;

  const derived = useMemo(() => {
    if (!plan) return null;
    const meta = planMeta(plan);
    const perScene = plan.scenes.map((scene, index) => ({
      scene,
      index,
      durationSec: (meta.sceneFrames[index] ?? 0) / meta.fps,
    }));
    return { meta, perScene };
  }, [plan]);

  if (!plan || !derived) {
    return (
      <section className="panel scenes-panel">
        <div className="panel-head">
          <h2>Timeline</h2>
        </div>
        <div className="chat-empty">
          Timeline muncul setelah scene-plan pertama dibuat.
        </div>
      </section>
    );
  }

  const selected = derived.perScene.find((entry) => entry.scene.id === selectedSceneId);

  return (
    <section className="panel scenes-panel">
      <div className="panel-head">
        <h2>Timeline</h2>
        <span className="meta-line">{plan.scenes.length} scene</span>
      </div>
      <div className="scene-list">
        {derived.perScene.map(({ scene, index, durationSec }) => (
          <SceneRow
            key={scene.id}
            plan={plan}
            meta={derived.meta}
            scene={scene}
            index={index}
            selected={scene.id === selectedSceneId}
            durationSec={durationSec}
          />
        ))}
      </div>
      {selected ? (
        <Inspector plan={plan} scene={selected.scene} index={selected.index} />
      ) : null}
    </section>
  );
};
