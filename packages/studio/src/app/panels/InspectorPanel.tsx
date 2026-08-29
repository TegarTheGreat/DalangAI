import type { PatchOpInput, Scene, ScenePlan } from "@dalang/core";
import { MOTIONS, VISUAL_TYPES } from "@dalang/core";
import { useEffect, useState } from "react";
import { IconImage, IconMic, IconPin, IconPlus, IconSearch, IconTrash } from "../icons";
import { uiStore } from "../ui-state";
import { studioClient, useStudio } from "../use-studio";

/**
 * Panel properti (kanan): semua yang bisa diubah dari scene terpilih,
 * dikelompokkan jelas — Naskah, Visual, Aset, Susunan. Setiap perubahan =
 * patch user yang tercatat dan bisa di-undo.
 */

const AssetGrid: React.FC = () => {
  const { assetSearch } = useStudio();
  if (!assetSearch) return null;
  return (
    <div className="asset-grid-block">
      <div className="asset-grid-head">
        <span>
          Kandidat "{assetSearch.query}"
          {assetSearch.provider ? ` | ${assetSearch.provider}` : ""}
        </span>
        <button
          type="button"
          className="mini"
          onClick={() => studioClient.closeAssetSearch()}
        >
          Tutup
        </button>
      </div>
      {assetSearch.loading ? (
        <div className="asset-grid-note">Mencari kandidat…</div>
      ) : null}
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
            title={`${candidate.assetId} | ${candidate.license}`}
          >
            {candidate.thumbnailUrl ? (
              <img src={candidate.thumbnailUrl} alt={candidate.assetId} loading="lazy" />
            ) : (
              <span className="asset-card-fallback">{candidate.kind}</span>
            )}
            <span className="asset-card-meta">
              {candidate.width}x{candidate.height}
              {candidate.durationSec ? ` | ${Math.round(candidate.durationSec)}s` : ""}
            </span>
          </button>
        ))}
      </div>
      <p className="asset-grid-hint">
        Memilih kandidat memasangnya ke scene dan menguncinya sebagai pilihanmu (pinned) —
        tidak akan ditimpa auto-resolve.
      </p>
    </div>
  );
};

const SceneForm: React.FC<{ plan: ScenePlan; scene: Scene; index: number }> = ({
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

  return (
    <div className="inspector-scroll">
      <div className="inspector-title">
        <div>
          <span className="inspector-scene-no">Scene {index + 1}</span>
          <span className="inspector-scene-id">{scene.id}</span>
        </div>
        <label
          className={`lock-switch ${scene.locked ? "on" : ""}`}
          title="Scene terkunci tidak akan disentuh agent"
        >
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
          <span className="lock-switch-track" aria-hidden />
          Kunci dari agent
        </label>
      </div>

      <section className="prop-group">
        <h4>Naskah</h4>
        <textarea
          rows={4}
          value={narration}
          placeholder="Narasi scene ini…"
          onChange={(event) => setNarration(event.target.value)}
        />
        <button
          type="button"
          className="ghost with-icon"
          disabled={busy || scene.narration.trim() === ""}
          onClick={() => void studioClient.runTts([scene.id])}
          title="Sintesis ulang suara scene ini"
        >
          <IconMic />
          Buat suara scene ini
        </button>
      </section>

      <section className="prop-group">
        <h4>Visual</h4>
        <div className="field-row">
          <label className="field">
            <span>Tipe</span>
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
            <span>Gerak kamera</span>
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
        </div>
        <label className="field">
          <span>Kata kunci pencarian aset (bahasa Inggris)</span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="mis. borobudur temple aerial sunrise"
          />
        </label>
        <div className="btn-row">
          <button
            type="button"
            className="ghost with-icon"
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
          >
            <IconSearch />
            Cari aset
          </button>
          {scene.visual.pinned ? (
            <button
              type="button"
              className="ghost with-icon"
              disabled={busy}
              onClick={() =>
                patch(
                  [{ op: "replaceAsset", sceneId: scene.id, assetId: null }],
                  "Pin aset dilepas",
                )
              }
            >
              <IconPin />
              Lepas pin
            </button>
          ) : null}
        </div>
        <AssetGrid />
      </section>

      <section className="prop-group">
        <h4>Waktu</h4>
        <label className="field">
          <span>Durasi (detik — kosongkan untuk otomatis dari narasi)</span>
          <input
            type="text"
            inputMode="decimal"
            value={duration}
            placeholder="auto"
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
      </section>

      {dirty ? (
        <div className="inspector-save">
          <button type="button" className="primary" onClick={save} disabled={busy}>
            Simpan perubahan
          </button>
        </div>
      ) : null}

      <section className="prop-group">
        <h4>Susunan</h4>
        <div className="btn-row">
          <button
            type="button"
            className="ghost"
            disabled={busy || index === 0}
            onClick={() => move(-1)}
          >
            Geser kiri
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy || index === plan.scenes.length - 1}
            onClick={() => move(1)}
          >
            Geser kanan
          </button>
          <button
            type="button"
            className="ghost with-icon"
            disabled={busy}
            onClick={() => {
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
            }}
          >
            <IconPlus />
            Sisip scene
          </button>
          <button
            type="button"
            className="ghost danger with-icon"
            disabled={busy || plan.scenes.length === 1}
            onClick={() =>
              patch([{ op: "removeScene", id: scene.id }], `Scene ${scene.id} dihapus`)
            }
          >
            <IconTrash />
            Hapus
          </button>
        </div>
      </section>
    </div>
  );
};

export const InspectorPanel: React.FC = () => {
  const { project, selectedSceneId } = useStudio();
  const plan = project?.plan ?? null;
  const index = plan?.scenes.findIndex((scene) => scene.id === selectedSceneId) ?? -1;
  const scene = index >= 0 ? plan?.scenes[index] : undefined;

  return (
    <aside className="panel inspector-panel">
      <div className="panel-head">
        <h2>Properti</h2>
        {scene ? <span className="meta-line">{scene.visual.type}</span> : null}
        <button
          type="button"
          className="mini drawer-close"
          onClick={() => uiStore.closeInspector()}
        >
          Tutup
        </button>
      </div>
      {plan && scene ? (
        <SceneForm plan={plan} scene={scene} index={index} />
      ) : (
        <div className="panel-empty">
          <IconImage />
          <p>Pilih scene di timeline untuk mengubah naskah, visual, dan durasinya.</p>
        </div>
      )}
    </aside>
  );
};
