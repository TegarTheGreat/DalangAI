import {
  ANIMATABLE_RANGE,
  type AnimatableProperty,
  clearTrack,
  KEYFRAME_EASINGS,
  type KeyframeEasing,
  type KeyframeTrack,
  MAX_KEYFRAMES_PER_TRACK,
  removeKeyframe,
  setKeyframe,
  trackOf,
} from "@dalang/core";
import { Segmented } from "../components/controls";
import { IconKeyframe, IconTrash } from "../icons";
import { SliderRow } from "./InspectorPanel";

/**
 * Penyunting track keyframe (ADR-0027, roadmap §9.3).
 *
 * SATU komponen untuk grafis, teks, dan lapisan — sama seperti
 * `keyframeTrackSchema` adalah satu bentuk untuk ketiganya. Daftar properti
 * yang boleh berbeda per elemen, dan itu satu-satunya yang dilewatkan.
 *
 * Titik ditambahkan DI POSISI PLAYHEAD, bukan lewat isian waktu: menganimasikan
 * sesuatu berarti melihatnya, dan mengetik "0,42" ke dalam kotak tidak pernah
 * memberi tahu apakah itu saat yang tepat. Kalau playhead sedang di luar
 * jendela tampil elemennya, tombolnya mati dan mengatakan alasannya — bukan
 * diam-diam menaruh titik di tempat yang tidak dilihat siapa pun.
 */

const LABEL: Record<AnimatableProperty, string> = {
  offsetX: "Geser X",
  offsetY: "Geser Y",
  size: "Ukuran",
  width: "Lebar",
  height: "Tinggi",
  rotate: "Putar",
  opacity: "Opasitas",
};

const EASING_LABEL: Record<KeyframeEasing, string> = {
  settle: "Mendarat",
  glide: "Meluncur",
  dolly: "Dolly",
  linear: "Rata",
};

const fmtValue = (property: AnimatableProperty, value: number): string =>
  property === "rotate"
    ? `${Math.round(value)}°`
    : property === "opacity"
      ? `${Math.round(value * 100)}%`
      : value.toFixed(3);

export const KeyframeControls: React.FC<{
  tracks: KeyframeTrack[];
  /** Properti yang boleh dianimasikan pada elemen INI. */
  allowed: readonly AnimatableProperty[];
  /** Nilai statis sekarang — dipakai sebagai titik pasangan track baru. */
  values: Partial<Record<AnimatableProperty, number>>;
  /**
   * Posisi playhead sebagai fraksi jendela elemen, atau null kalau playhead
   * sedang di luar jendela itu.
   */
  progress: number | null;
  onChange: (tracks: KeyframeTrack[], label: string) => void;
}> = ({ tracks, allowed, values, progress, onChange }) => (
  <div className="keyframe-editor">
    <span className="meta-line wrap">
      Properti yang punya keyframe ditentukan PENUH olehnya — nilai tetap dan preset gerak
      tidak lagi berlaku untuk properti itu.
    </span>
    {allowed.map((property) => {
      const track = trackOf(tracks, property);
      const range = ANIMATABLE_RANGE[property];
      const penuh = (track?.points.length ?? 0) >= MAX_KEYFRAMES_PER_TRACK;
      return (
        <div className="keyframe-prop" key={property}>
          <div className="keyframe-prop-head">
            <button
              type="button"
              className={track ? "mini with-icon active" : "mini with-icon"}
              disabled={progress === null || penuh}
              title={
                progress === null
                  ? "Playhead di luar jendela tampil elemen ini"
                  : penuh
                    ? `Maksimal ${MAX_KEYFRAMES_PER_TRACK} keyframe per properti`
                    : `Pasang keyframe ${LABEL[property]} di posisi playhead`
              }
              onClick={() => {
                if (progress === null) return;
                const current = values[property] ?? 0;
                onChange(
                  setKeyframe(tracks, property, progress, current, { current }),
                  `Keyframe ${LABEL[property]} di ${Math.round(progress * 100)}%`,
                );
              }}
            >
              <IconKeyframe />
              {LABEL[property]}
            </button>
            {track ? (
              <button
                type="button"
                className="mini danger"
                title={`Hapus seluruh keyframe ${LABEL[property]}`}
                onClick={() =>
                  onChange(
                    clearTrack(tracks, property),
                    `Keyframe ${LABEL[property]} dihapus`,
                  )
                }
              >
                <IconTrash />
              </button>
            ) : null}
          </div>

          {track
            ? track.points.map((point, index) => (
                <div className="keyframe-point" key={`${property}-${point.at}`}>
                  <span className="meta-line">
                    {Math.round(point.at * 100)}% · {fmtValue(property, point.value)}
                  </span>
                  <SliderRow
                    label="Nilai"
                    min={range?.[0] ?? 0}
                    max={range?.[1] ?? 1}
                    step={property === "rotate" ? 1 : 0.01}
                    value={point.value}
                    neutral={values[property] ?? 0}
                    format={(value) => fmtValue(property, value)}
                    onCommit={(value) =>
                      onChange(
                        setKeyframe(tracks, property, point.at, value, {
                          easing: point.easing,
                        }),
                        `Nilai keyframe ${LABEL[property]}`,
                      )
                    }
                  />
                  {/* Easing menggambarkan segmen MENUJU titik berikutnya, jadi
                      titik terakhir tidak punya satu pun untuk diatur. */}
                  {index < track.points.length - 1 ? (
                    <Segmented
                      options={KEYFRAME_EASINGS}
                      value={point.easing}
                      label={(easing) => EASING_LABEL[easing]}
                      onChange={(easing) =>
                        onChange(
                          setKeyframe(tracks, property, point.at, point.value, {
                            easing,
                          }),
                          `Easing keyframe ${LABEL[property]}`,
                        )
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    className="mini danger"
                    title="Hapus keyframe ini"
                    onClick={() =>
                      onChange(
                        removeKeyframe(tracks, property, point.at),
                        `Keyframe ${LABEL[property]} dihapus`,
                      )
                    }
                  >
                    <IconTrash />
                  </button>
                </div>
              ))
            : null}
        </div>
      );
    })}
  </div>
);
