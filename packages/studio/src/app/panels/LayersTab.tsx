import {
  type GraphicAnchor,
  LAYER_ENTRANCES,
  LAYER_SHAPES,
  type LayerEntrance,
  type LayerShape,
  MAX_LAYERS,
  MOTIONS,
  type Motion,
  type PatchOpInput,
  type Scene,
  type ScenePlan,
  uniqueLayerId,
  type VideoLayer,
} from "@dalang/core";
import { useState } from "react";
import { Segmented } from "../components/controls";
import { IconFilm, IconTrash } from "../icons";
import { studioClient, useStudio } from "../use-studio";
import { SliderRow } from "./InspectorPanel";
import { ANCHOR_LABEL, AnchorPad } from "./MediaLibrary";

/**
 * Panel lapisan video (ADR-0025, roadmap §9.2).
 *
 * Satu kartu per lapisan, ringkas secara bawaan dan terbuka saat dipilih —
 * pola yang sama dengan kartu grafis, dan karena alasan yang sama: dua kartu
 * terbuka mendorong tombol "Tambah lapisan" ke bawah lipatan sehingga menambah
 * sisipan berikutnya terasa seperti fitur yang hilang.
 *
 * Nilai posisi dan ukuran ADA di sini walau lapisan juga bisa diseret langsung
 * di kanvas (ADR-0024). Keduanya bukan kelebihan: menyeret enak untuk menata
 * dengan mata, mengetik angka satu-satunya cara menyamakan dua sisipan di dua
 * scene berbeda supaya tidak bergeser saat berganti scene.
 */

const ENTRANCE_LABEL: Record<LayerEntrance, string> = {
  fade: "Larut",
  geser: "Geser",
  pop: "Pop",
  diam: "Diam",
};

const SHAPE_LABEL: Record<LayerShape, string> = {
  persegi: "Persegi",
  bulat: "Bulat",
};

const MOTION_LABEL: Record<Motion, string> = {
  none: "Diam",
  "kenburns-in": "Zoom masuk",
  "kenburns-out": "Zoom keluar",
  "pan-left": "Geser kiri",
  "pan-right": "Geser kanan",
  "pan-up": "Geser atas",
  "pan-down": "Geser bawah",
  drift: "Melayang",
};

const layersPatch = (sceneId: string, layers: VideoLayer[]): PatchOpInput[] => [
  { op: "updateScene", id: sceneId, patch: { layers } },
];

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export const LapisanTab: React.FC<{ plan: ScenePlan; scene: Scene }> = ({
  plan,
  scene,
}) => {
  const [openId, setOpenId] = useState<string | null>(
    scene.layers.length === 1 ? (scene.layers[0]?.id ?? null) : null,
  );
  const full = scene.layers.length >= MAX_LAYERS;

  const add = () => {
    const id = uniqueLayerId(plan, `lap-${scene.id}`);
    void studioClient.applyPatch(
      layersPatch(scene.id, [
        ...scene.layers,
        {
          id,
          visual: {
            type: "stock",
            assetId: null,
            motion: "none",
            pinned: false,
            speed: 1,
            trimStartSec: 0,
            flipH: false,
            focusX: 0.5,
            focusY: 0.5,
            volume: 0,
          },
          anchor: "kanan-bawah",
          width: 0.34,
          height: 0.3,
          offsetX: 0,
          offsetY: 0,
          shape: "persegi",
          radius: 0.05,
          border: 0,
          borderColor: null,
          opacity: 1,
          fit: "cover",
          entrance: "fade",
          // Bukan 0–1: sisipan yang menyala sepanjang scene berhenti jadi
          // sisipan (lihat kritik "lapisan-sepanjang-scene").
          startFrac: 0.15,
          endFrac: 0.8,
        },
      ]),
      `Lapisan ${id} ditambahkan ke ${scene.id}`,
    );
    setOpenId(id);
  };

  return (
    <section className="prop-group">
      <h4>
        Lapisan ({scene.layers.length}/{MAX_LAYERS})
      </h4>
      {scene.layers.length === 0 ? (
        <p className="group-hint">
          Belum ada lapisan. Lapisan adalah sisipan video di ATAS visual scene — B-roll
          yang menunjukkan apa yang sedang dikatakan, picture-in-picture, atau bukti
          visual. Letaknya bisa diseret langsung di preview.
        </p>
      ) : (
        scene.layers.map((layer) => (
          <LayerCard
            key={layer.id}
            plan={plan}
            scene={scene}
            layer={layer}
            open={openId === layer.id}
            onToggle={() => setOpenId(openId === layer.id ? null : layer.id)}
          />
        ))
      )}
      <button type="button" className="mini with-icon" disabled={full} onClick={add}>
        <IconFilm />
        Tambah lapisan
      </button>
      {full ? (
        <p className="group-hint">
          Batasnya {MAX_LAYERS} lapisan per scene — tiap lapisan adalah satu pemutar video
          lagi di setiap frame, dan render melambat jauh lebih cepat daripada gambarnya
          jadi lebih baik.
        </p>
      ) : null}
    </section>
  );
};

const LayerCard: React.FC<{
  plan: ScenePlan;
  scene: Scene;
  layer: VideoLayer;
  open: boolean;
  onToggle: () => void;
}> = ({ plan, scene, layer, open, onToggle }) => {
  const { assetSearch } = useStudio();
  const [query, setQuery] = useState(layer.visual.query ?? "");
  const asset = plan.renderState.layerAssets[layer.id];
  const searching = assetSearch?.layerId === layer.id;

  const update = (patch: Partial<VideoLayer>, label: string) => {
    void studioClient.applyPatch(
      layersPatch(
        scene.id,
        scene.layers.map((item) => (item.id === layer.id ? { ...item, ...patch } : item)),
      ),
      label,
    );
  };
  const updateVisual = (patch: Partial<VideoLayer["visual"]>, label: string) => {
    update({ visual: { ...layer.visual, ...patch } }, label);
  };

  return (
    <div className={open ? "graphic-card open" : "graphic-card"}>
      <div className="graphic-card-head">
        <button
          type="button"
          className="graphic-card-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="graphic-thumb icon">
            <IconFilm />
          </span>
          <span className="graphic-card-id">
            <strong>{layer.id}</strong>
            <span className="meta-line">
              {ANCHOR_LABEL[layer.anchor]} | {percent(layer.width)}x
              {percent(layer.height)} |{" "}
              {asset ? asset.kind : "berkas belum ada — tidak akan muncul"}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="mini danger"
          title="Hapus lapisan ini"
          onClick={() =>
            void studioClient.applyPatch(
              layersPatch(
                scene.id,
                scene.layers.filter((item) => item.id !== layer.id),
              ),
              `Lapisan ${layer.id} dihapus`,
            )
          }
        >
          <IconTrash />
        </button>
      </div>

      {open ? (
        <div className="graphic-card-body layer">
          <div className="graphic-card-controls">
            <div className="field">
              <span>Aset</span>
              {/* Kueri lapisan sengaja TIDAK diturunkan dari narasi: kalau
                diturunkan, sisipannya akan mendapat gambar yang sama dengan
                latarnya, dan sisipan yang sama dengan latarnya bukan B-roll. */}
              <div className="lib-search">
                <input
                  type="text"
                  value={query}
                  placeholder="mis. hands typing keyboard"
                  onChange={(event) => setQuery(event.target.value)}
                  onBlur={() => {
                    const next = query.trim();
                    if (next !== (layer.visual.query ?? "")) {
                      updateVisual(
                        next ? { query: next } : { query: undefined },
                        `Kueri lapisan ${layer.id}`,
                      );
                    }
                  }}
                />
                <button
                  type="button"
                  className="mini"
                  disabled={query.trim().length < 2}
                  onClick={() =>
                    void studioClient.searchAssets(
                      scene.id,
                      query.trim(),
                      "video",
                      layer.id,
                    )
                  }
                >
                  Cari
                </button>
              </div>
              <span className="meta-line wrap">
                {asset
                  ? `${asset.file}${asset.durationSec ? ` · ${asset.durationSec.toFixed(1)}s` : ""}`
                  : searching
                    ? "Pilih kandidat di grid di bawah."
                    : "Belum ada berkas — lapisan ini tidak akan muncul di video."}
              </span>
            </div>

            <div className="field">
              <span>Posisi</span>
              <AnchorPad
                value={layer.anchor}
                onChange={(anchor: GraphicAnchor) =>
                  update({ anchor }, `Jangkar lapisan ${layer.id}`)
                }
              />
            </div>
            <SliderRow
              label="Geser X"
              min={-0.5}
              max={0.5}
              step={0.005}
              value={layer.offsetX}
              neutral={0}
              onCommit={(offsetX) => update({ offsetX }, `Geser lapisan ${layer.id}`)}
            />
            <SliderRow
              label="Geser Y"
              min={-0.5}
              max={0.5}
              step={0.005}
              value={layer.offsetY}
              neutral={0}
              onCommit={(offsetY) => update({ offsetY }, `Geser lapisan ${layer.id}`)}
            />
            <SliderRow
              label="Lebar"
              min={0.08}
              max={1}
              step={0.01}
              value={layer.width}
              neutral={0.34}
              format={percent}
              onCommit={(width) => update({ width }, `Lebar lapisan ${layer.id}`)}
            />
            <SliderRow
              label="Tinggi"
              min={0.08}
              max={1}
              step={0.01}
              value={layer.height}
              neutral={0.3}
              format={percent}
              onCommit={(height) => update({ height }, `Tinggi lapisan ${layer.id}`)}
            />

            <div className="field">
              <span>Bentuk</span>
              <Segmented
                options={LAYER_SHAPES}
                value={layer.shape}
                label={(value) => SHAPE_LABEL[value]}
                onChange={(shape) => update({ shape }, `Bentuk lapisan ${layer.id}`)}
              />
            </div>
            {layer.shape === "persegi" ? (
              <SliderRow
                label="Sudut"
                min={0}
                max={0.5}
                step={0.01}
                value={layer.radius}
                neutral={0.05}
                onCommit={(radius) => update({ radius }, `Sudut lapisan ${layer.id}`)}
              />
            ) : null}
            <SliderRow
              label="Bingkai"
              min={0}
              max={0.02}
              step={0.001}
              value={layer.border}
              neutral={0}
              format={(value) => (value === 0 ? "tanpa" : value.toFixed(3))}
              onCommit={(border) => update({ border }, `Bingkai lapisan ${layer.id}`)}
            />
            <SliderRow
              label="Opasitas"
              min={0.1}
              max={1}
              step={0.05}
              value={layer.opacity}
              neutral={1}
              format={percent}
              onCommit={(opacity) => update({ opacity }, `Opasitas lapisan ${layer.id}`)}
            />

            <div className="field">
              <span>Masuk</span>
              <Segmented
                options={LAYER_ENTRANCES}
                value={layer.entrance}
                label={(value) => ENTRANCE_LABEL[value]}
                onChange={(entrance) => update({ entrance }, `Masuk lapisan ${layer.id}`)}
              />
            </div>
            <div className="field">
              <span>Gerak kamera</span>
              <select
                value={layer.visual.motion}
                onChange={(event) =>
                  updateVisual(
                    { motion: event.target.value as Motion },
                    `Gerak lapisan ${layer.id}`,
                  )
                }
              >
                {MOTIONS.map((motion) => (
                  <option key={motion} value={motion}>
                    {MOTION_LABEL[motion]}
                  </option>
                ))}
              </select>
            </div>

            <SliderRow
              label="Mulai"
              min={0}
              max={0.95}
              step={0.01}
              value={layer.startFrac}
              neutral={0.15}
              format={percent}
              onCommit={(startFrac) =>
                update(
                  {
                    startFrac,
                    endFrac: Math.max(layer.endFrac, startFrac + 0.05),
                  },
                  `Mulai lapisan ${layer.id}`,
                )
              }
            />
            <SliderRow
              label="Selesai"
              min={0.05}
              max={1}
              step={0.01}
              value={layer.endFrac}
              neutral={0.8}
              format={percent}
              onCommit={(endFrac) =>
                update(
                  {
                    endFrac,
                    startFrac: Math.min(layer.startFrac, endFrac - 0.05),
                  },
                  `Selesai lapisan ${layer.id}`,
                )
              }
            />
            {/* Suara lapisan: satu angka gain. Amplop fade dan normalisasi
              kenyaringan adalah §9.4 — dan mengaku begitu lebih baik daripada
              menaruh slider yang tidak melakukan apa yang namanya janjikan. */}
            <SliderRow
              label="Suara"
              min={0}
              max={1}
              step={0.05}
              value={layer.visual.volume}
              neutral={0}
              format={(value) => (value === 0 ? "bisu" : percent(value))}
              onCommit={(volume) => updateVisual({ volume }, `Suara lapisan ${layer.id}`)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};
