import {
  type AudioTrack,
  type ClipAudio,
  LOUDNESS_TARGETS,
  type PatchOpInput,
  type Scene,
  type ScenePlan,
  uniqueTrackId,
} from "@dalang/core";
import { useState } from "react";
import { Segmented, Switch } from "../components/controls";
import { IconTrash, IconWave } from "../icons";
import { studioClient } from "../use-studio";
import { ClipAudioControls } from "./ClipAudioControls";
import { SliderRow } from "./InspectorPanel";

/**
 * Panel audio (ADR-0026, roadmap §9.4).
 *
 * Dua ruang lingkup dalam satu tab, dan judulnya yang membedakan: "Klip ini"
 * milik scene yang sedang dipilih, "Proyek" berlaku untuk seluruh video.
 * Menyebarnya ke dua tempat terdengar lebih rapi, tapi menata audio berarti
 * membandingkan — seberapa keras sisipan ini dibanding musiknya, dibanding
 * narasinya — dan perbandingan tidak bisa dilakukan kalau angkanya ada di dua
 * layar berbeda. Semua meja mixer bekerja begitu.
 */

const trackPatch = (tracks: AudioTrack[]): PatchOpInput[] => [
  { op: "setAudio", patch: { tracks } },
];

export const AudioTab: React.FC<{ plan: ScenePlan; scene: Scene }> = ({
  plan,
  scene,
}) => {
  const target = plan.meta.loudnessTarget;
  const asset = plan.renderState.resolvedAssets[scene.id];

  return (
    <>
      <section className="prop-group">
        <h4>Klip ini — {scene.id}</h4>
        {asset?.kind === "video" ? (
          <ClipAudioControls
            audio={scene.visual.audio}
            lufs={asset.lufs}
            channels={asset.channels}
            targetLufs={target}
            onChange={(audio) =>
              void studioClient.applyPatch(
                [{ op: "updateScene", id: scene.id, patch: { visual: { audio } } }],
                `Suara aset ${scene.id}`,
              )
            }
          />
        ) : (
          <p className="group-hint">
            Aset scene ini bukan video, jadi tidak punya suara bawaan. Suara alami hanya
            ada pada aset video — untuk bunyi lain, pakai trek audio di bawah atau efek
            suara di tab Scene.
          </p>
        )}
      </section>

      <section className="prop-group">
        <h4>Proyek</h4>
        <div className="field">
          <span>Sasaran kenyaringan</span>
          <Segmented
            options={[...LOUDNESS_TARGETS.map((entry) => entry.lufs), 0]}
            value={target ?? 0}
            label={(value) =>
              value === 0
                ? "Mati"
                : (LOUDNESS_TARGETS.find((entry) => entry.lufs === value)?.label ??
                  String(value))
            }
            onChange={(value) =>
              void studioClient.applyPatch(
                [
                  {
                    op: "setMeta",
                    patch: { loudnessTarget: value === 0 ? null : value },
                  },
                ],
                value === 0
                  ? "Normalisasi kenyaringan dimatikan"
                  : `Sasaran kenyaringan ${value} LUFS`,
              )
            }
          />
          <span className="meta-line wrap">
            {target === null
              ? "Tiap klip dipakai apa adanya — rekaman keras dan pelan perlu ditata volumenya satu per satu."
              : `Tiap klip yang sudah diukur dibawa ke ${target} LUFS sebelum volumenya diterapkan. Ini normalisasi PER KLIP; campuran akhirnya tidak diukur.`}
          </span>
        </div>
        <MusicSection plan={plan} />
      </section>

      <TracksSection plan={plan} scene={scene} />
    </>
  );
};

const MusicSection: React.FC<{ plan: ScenePlan }> = ({ plan }) => {
  const music = plan.audio.music;
  if (!music) {
    return (
      <p className="group-hint">
        Belum ada musik latar. Minta agent memasangnya — video hening hampir selalu terasa
        mati.
      </p>
    );
  }
  const set = (patch: Partial<typeof music>, label: string) =>
    void studioClient.applyPatch(
      [{ op: "setAudio", patch: { music: { ...music, ...patch } } }],
      label,
    );

  return (
    <>
      <span className="meta-line wrap">
        Musik: {music.assetId.replace("pustaka:", "")}
      </span>
      <SliderRow
        label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={music.volume}
        neutral={0.15}
        format={(value) => `${Math.round(value * 100)}%`}
        onCommit={(volume) => set({ volume }, "Volume musik")}
      />
      <SliderRow
        label="Fade masuk"
        min={0}
        max={10}
        step={0.5}
        value={music.fadeInSec}
        neutral={1}
        format={(value) => `${value.toFixed(1)}s`}
        onCommit={(fadeInSec) => set({ fadeInSec }, "Fade masuk musik")}
      />
      <SliderRow
        label="Fade keluar"
        min={0}
        max={10}
        step={0.5}
        value={music.fadeOutSec}
        neutral={2}
        format={(value) => `${value.toFixed(1)}s`}
        onCommit={(fadeOutSec) => set({ fadeOutSec }, "Fade keluar musik")}
      />
      <Switch
        checked={music.ducking}
        label="Mengecil di bawah narasi"
        onChange={(ducking) => set({ ducking }, "Ducking musik")}
      />
    </>
  );
};

const TracksSection: React.FC<{ plan: ScenePlan; scene: Scene }> = ({ plan, scene }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const tracks = plan.audio.tracks;
  const full = tracks.length >= 8;

  return (
    <section className="prop-group">
      <h4>Trek audio ({tracks.length}/8)</h4>
      {tracks.length === 0 ? (
        <p className="group-hint">
          Belum ada trek audio. Trek adalah berkas suara yang ditaruh di garis waktu —
          ambience, rekaman wawancara, lagu berlisensi yang bukan bed. Unggah berkasnya
          lewat panel Aset, lalu tambahkan di sini.
        </p>
      ) : (
        tracks.map((track) => (
          <TrackCard
            key={track.id}
            plan={plan}
            track={track}
            open={openId === track.id}
            onToggle={() => setOpenId(openId === track.id ? null : track.id)}
          />
        ))
      )}
      <button
        type="button"
        className="mini with-icon"
        disabled={full}
        onClick={() => {
          const id = uniqueTrackId(plan, `trek-${scene.id}`);
          void studioClient.applyPatch(
            trackPatch([
              ...tracks,
              {
                id,
                // Kosong sampai berkasnya dipilih: trek tanpa berkas TIDAK
                // digambar, dan kartunya mengatakan itu.
                assetId: "",
                sceneId: scene.id,
                atSec: 0,
                loop: false,
                audio: {
                  volume: 0.5,
                  fadeInSec: 0.5,
                  fadeOutSec: 1,
                  ducking: true,
                  normalize: true,
                },
              },
            ]),
            `Trek audio ${id} ditambahkan`,
          );
          setOpenId(id);
        }}
      >
        <IconWave />
        Tambah trek
      </button>
    </section>
  );
};

const TrackCard: React.FC<{
  plan: ScenePlan;
  track: AudioTrack;
  open: boolean;
  onToggle: () => void;
}> = ({ plan, track, open, onToggle }) => {
  const [file, setFile] = useState(track.assetId);
  const asset = plan.renderState.trackAssets[track.id];
  const tracks = plan.audio.tracks;
  const set = (patch: Partial<AudioTrack>, label: string) =>
    void studioClient.applyPatch(
      trackPatch(
        tracks.map((item) => (item.id === track.id ? { ...item, ...patch } : item)),
      ),
      label,
    );

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
            <IconWave />
          </span>
          <span className="graphic-card-id">
            <strong>{track.id}</strong>
            <span className="meta-line">
              {track.sceneId ? `di ${track.sceneId}` : "dari awal video"} | +
              {track.atSec.toFixed(1)}s |{" "}
              {asset ? `${asset.durationSec?.toFixed(1) ?? "?"}s` : "berkas belum ada"}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="mini danger"
          title="Hapus trek ini"
          onClick={() =>
            void studioClient.applyPatch(
              trackPatch(tracks.filter((item) => item.id !== track.id)),
              `Trek ${track.id} dihapus`,
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
              <span>Berkas (relatif folder proyek)</span>
              <input
                type="text"
                value={file}
                placeholder="mis. assets/ambience.wav"
                onChange={(event) => setFile(event.target.value)}
                onBlur={() => {
                  const next = file.trim();
                  if (next !== track.assetId) {
                    set({ assetId: next }, `Berkas trek ${track.id}`);
                  }
                }}
              />
              {!asset ? (
                <span className="meta-line wrap">
                  Berkasnya belum tercatat di renderState — jalankan tahap Aset supaya
                  panjang dan kenyaringannya terukur. Sampai itu trek ini TIDAK berbunyi.
                </span>
              ) : null}
            </div>
            <SliderRow
              label="Mulai"
              min={0}
              max={60}
              step={0.5}
              value={track.atSec}
              neutral={0}
              format={(value) => `${value.toFixed(1)}s`}
              onCommit={(atSec) => set({ atSec }, `Mulai trek ${track.id}`)}
            />
            <Switch
              checked={track.loop}
              label="Ulangi sampai video habis"
              onChange={(loop) => set({ loop }, `Ulangi trek ${track.id}`)}
            />
            <Switch
              checked={track.sceneId !== null}
              label="Tambatkan ke scene ini"
              title="Tertambat = ikut bergeser saat susunan scene berubah"
              onChange={(anchored) =>
                set(
                  { sceneId: anchored ? (plan.scenes[0]?.id ?? null) : null },
                  `Tambatan trek ${track.id}`,
                )
              }
            />
            <ClipAudioControls
              audio={track.audio}
              lufs={asset?.lufs}
              channels={asset?.channels}
              targetLufs={plan.meta.loudnessTarget}
              onChange={(audio: ClipAudio) => set({ audio }, `Suara trek ${track.id}`)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};
