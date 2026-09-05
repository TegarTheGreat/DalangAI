import {
  type Annotation,
  CAPTION_POSITIONS,
  CAPTION_STYLES,
  FILTER_PRESETS,
  MAX_TRANSITION_FRAMES,
  MIN_TRANSITION_FRAMES,
  MOTIONS,
  type PatchOpInput,
  primaryClip,
  type Scene,
  type ScenePlan,
  TEXT_ALIGNS,
  TEXT_ANIMS,
  TEXT_EMPHASES,
  TEXT_POSITIONS,
  TEXT_ROLES,
  TEXT_SIZES,
  TRANSITION_TYPES,
  type TransitionType,
  VISUAL_TYPES,
  type VisualFilter,
  visualFilterSchema,
} from "@dalang/core";
import { useEffect, useRef, useState } from "react";
import { Segmented, Switch, useScrollFade } from "../components/controls";
import {
  IconImage,
  IconMic,
  IconNextScene,
  IconPin,
  IconPlus,
  IconPrevScene,
  IconSearch,
  IconTrash,
} from "../icons";
import { uiStore } from "../ui-state";
import { studioClient, useStudio } from "../use-studio";
import { AudioTab } from "./AudioTab";
import { LapisanTab } from "./LayersTab";
import { GrafisTab, SfxSection } from "./MediaLibrary";
import { SourceSection } from "./SourcePanel";
import { TranscriptTab } from "./TranscriptTab";

/**
 * Panel properti bertab (pola editor: CapCut/Premiere) untuk scene terpilih:
 *   Scene  - naskah, suara, durasi, susunan
 *   Visual - tipe/gerak, FILTER (preset + slider), aset
 *   Teks   - hingga 3 overlay (headline/subline/kicker/quote)
 *   Transisi - kartu jenis transisi keluar scene
 * Semua perubahan = patch user (tercatat, bisa di-undo, terlihat agent).
 */

type Tab =
  | "scene"
  | "visual"
  | "teks"
  | "transkrip"
  | "grafis"
  | "lapisan"
  | "audio"
  | "transisi"
  | "anotasi";

const ANNOTATION_TYPES = ["zoom", "highlight", "arrow", "blur"] as const;
const ANNOTATION_LABEL: Record<(typeof ANNOTATION_TYPES)[number], string> = {
  zoom: "Zoom",
  highlight: "Sorot",
  arrow: "Panah",
  blur: "Blur",
};

const TRANSITION_LABEL: Record<TransitionType, string> = {
  "cross-fade": "Larut",
  "slide-left": "Geser kiri",
  "slide-right": "Geser kanan",
  "slide-up": "Geser naik",
  "wipe-right": "Sapu kanan",
  "wipe-down": "Sapu turun",
  none: "Potong",
};

const FILTER_LABEL: Record<string, string> = {
  none: "Asli",
  warm: "Hangat",
  cool: "Sejuk",
  mono: "Mono",
  vivid: "Vivid",
  film: "Film",
};

const ROLE_LABEL: Record<string, string> = {
  headline: "Judul",
  subline: "Subjudul",
  kicker: "Label",
  quote: "Kutipan",
};

const POSITION_LABEL: Record<string, string> = {
  top: "Atas",
  center: "Tengah",
  bottom: "Bawah",
};

const ALIGN_LABEL: Record<string, string> = {
  left: "Kiri",
  center: "Tengah",
  right: "Kanan",
};
const SIZE_LABEL: Record<string, string> = { s: "S", m: "M", l: "L" };
const EMPHASIS_LABEL: Record<string, string> = {
  none: "Polos",
  box: "Kotak",
  underline: "Garis",
  stabilo: "Stabilo",
};

/** ADR-0016: animasi masuk teks + gaya caption. */
const ANIM_LABEL: Record<string, string> = {
  fade: "Larut",
  pop: "Pop",
  rise: "Naik",
  typewriter: "Ketik",
};
const CAPTION_STYLE_LABEL: Record<string, string> = {
  klasik: "Klasik",
  tegas: "Tegas",
  chip: "Chip",
  halus: "Halus",
};
const CAPTION_POSITION_LABEL: Record<string, string> = {
  bottom: "Bawah",
  center: "Tengah",
};

const MOTION_LABEL: Record<string, string> = {
  none: "Diam",
  "kenburns-in": "Zoom masuk",
  "kenburns-out": "Zoom keluar",
  "pan-left": "Pan kiri",
  "pan-right": "Pan kanan",
  "pan-up": "Pan atas",
  "pan-down": "Pan bawah",
  drift: "Melayang",
};

/** Varian seni prosedural (ADR-0013) untuk scene solid/stock belum ter-resolve. */
const ART_VARIANTS = ["duotone", "rays", "topo", "grid"] as const;
const ART_LABEL: Record<string, string> = {
  duotone: "Duotone",
  rays: "Sinar",
  topo: "Kontur",
  grid: "Grid",
};

/** Slider dengan label nilai; commit patch saat dilepas (bukan tiap piksel). */
export const SliderRow: React.FC<{
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  neutral: number;
  format?: (value: number) => string;
  onCommit: (value: number) => void;
}> = ({ label, min, max, step, value, neutral, format, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const shown = format ? format(draft) : draft.toFixed(2);
  return (
    <div className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={() => {
          if (draft !== value) onCommit(draft);
        }}
        onKeyUp={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            if (draft !== value) onCommit(draft);
          }
        }}
      />
      <span className={draft === neutral ? "slider-value" : "slider-value changed"}>
        {shown}
      </span>
    </div>
  );
};

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
        <div className="asset-grid-note">Mencari kandidat...</div>
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

const SceneTab: React.FC<{ plan: ScenePlan; scene: Scene; index: number }> = ({
  plan,
  scene,
  index,
}) => {
  const { project } = useStudio();
  const busy = project?.busy.mutation !== null;
  const [narration, setNarration] = useState(scene.narration);
  const [duration, setDuration] = useState(
    scene.duration === "auto" ? "" : String(scene.duration),
  );
  useEffect(() => {
    setNarration(scene.narration);
    setDuration(scene.duration === "auto" ? "" : String(scene.duration));
  }, [scene]);

  const patch = (ops: PatchOpInput[], label?: string) =>
    void studioClient.applyPatch(ops, label);
  const dirty =
    narration !== scene.narration ||
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
    <>
      <section className="prop-group">
        <h4>Naskah</h4>
        <textarea
          rows={4}
          value={narration}
          placeholder="Narasi scene ini..."
          onChange={(event) => setNarration(event.target.value)}
        />
        <button
          type="button"
          className="ghost with-icon"
          disabled={busy || scene.narration.trim() === ""}
          onClick={() => void studioClient.runTts([scene.id])}
        >
          <IconMic />
          Buat suara scene ini
        </button>
      </section>

      <section className="prop-group">
        <h4>Waktu</h4>
        <label className="field">
          <span data-tip="Kosongkan untuk otomatis mengikuti durasi narasi">
            Durasi (detik)
          </span>
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

      {/* Efek suara scene ini duduk di sini, bukan di tab terpisah: ia audio
          milik scene, sebaris dengan naskah dan durasinya (ADR-0018). */}
      <SfxSection plan={plan} scene={scene} />

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
    </>
  );
};

/**
 * Tab Anotasi (Fase 4 §9): zoom/sorot/panah/blur pada scene — kontrak data
 * yang sama dengan tool locateUiElement agent, jadi manusia bisa menandai
 * atau mengoreksi target secara manual. Dirender oleh preset tutorial-01.
 */
const AnotasiTab: React.FC<{ scene: Scene; stylePreset: string }> = ({
  scene,
  stylePreset,
}) => {
  const { project } = useStudio();
  const busy = project?.busy.mutation !== null;
  const commit = (annotations: Annotation[], label: string) =>
    void studioClient.applyPatch(
      [{ op: "updateScene", id: scene.id, patch: { annotations } }],
      label,
    );
  const update = (index: number, next: Partial<Annotation>) =>
    commit(
      scene.annotations.map((annotation, i) =>
        i === index ? ({ ...annotation, ...next } as Annotation) : annotation,
      ),
      "Anotasi diubah",
    );

  return (
    <>
      {stylePreset !== "tutorial-01" ? (
        <p className="tab-hint">
          Anotasi dirender oleh preset tutorial-01 (preset aktif: {stylePreset}). Nilainya
          tetap tersimpan di plan dan terlihat agent.
        </p>
      ) : null}
      {scene.annotations.map((annotation, index) => {
        const untilEnd = annotation.timing.endSec === undefined;
        return (
          <section
            className="prop-group"
            key={`${annotation.type}-${annotation.timing.startSec}-${annotation.target.x}-${annotation.target.y}-${annotation.target.w}-${annotation.target.h}`}
          >
            <Segmented
              grow
              options={ANNOTATION_TYPES}
              value={annotation.type}
              label={(option) => ANNOTATION_LABEL[option]}
              disabled={busy}
              onChange={(type) => update(index, { type })}
            />
            {(["x", "y", "w", "h"] as const).map((axis) => (
              <SliderRow
                key={axis}
                label={axis.toUpperCase()}
                min={0}
                max={1}
                step={0.01}
                value={annotation.target[axis]}
                neutral={axis === "w" || axis === "h" ? 0.3 : 0.35}
                onCommit={(value) =>
                  update(index, {
                    target: { ...annotation.target, [axis]: value },
                  })
                }
              />
            ))}
            <SliderRow
              label="Mulai"
              min={0}
              max={20}
              step={0.1}
              value={annotation.timing.startSec}
              neutral={0}
              format={(value) => `${value.toFixed(1)}s`}
              onCommit={(startSec) =>
                update(index, {
                  timing: untilEnd
                    ? { startSec }
                    : { startSec, endSec: annotation.timing.endSec as number },
                })
              }
            />
            <Switch
              checked={untilEnd}
              disabled={busy}
              label="Bertahan sampai akhir scene"
              onChange={(on) =>
                update(index, {
                  timing: on
                    ? { startSec: annotation.timing.startSec }
                    : {
                        startSec: annotation.timing.startSec,
                        endSec: annotation.timing.startSec + 2,
                      },
                })
              }
            />
            {!untilEnd ? (
              <SliderRow
                label="Selesai"
                min={0.2}
                max={22}
                step={0.1}
                value={annotation.timing.endSec ?? 2}
                neutral={0}
                format={(value) => `${value.toFixed(1)}s`}
                onCommit={(endSec) =>
                  update(index, {
                    timing: { startSec: annotation.timing.startSec, endSec },
                  })
                }
              />
            ) : null}
            <button
              type="button"
              className="ghost danger with-icon"
              disabled={busy}
              onClick={() =>
                commit(
                  scene.annotations.filter((_, i) => i !== index),
                  "Anotasi dihapus",
                )
              }
            >
              <IconTrash />
              Hapus anotasi
            </button>
          </section>
        );
      })}
      <section className="prop-group">
        <button
          type="button"
          className="secondary with-icon"
          disabled={busy}
          onClick={() =>
            commit(
              [
                ...scene.annotations,
                {
                  type: "highlight",
                  target: { x: 0.35, y: 0.35, w: 0.3, h: 0.2 },
                  timing: { startSec: 0.5 },
                },
              ],
              "Anotasi ditambahkan",
            )
          }
        >
          <IconPlus />
          Tambah anotasi
        </button>
      </section>
    </>
  );
};

/**
 * Daftar potongan gambar sebuah scene (ADR-0033).
 *
 * Muncul HANYA saat potongannya lebih dari satu. Scene berklip satu adalah
 * mayoritas dunia, dan menambahkan baris "Klip 1" di atas setiap panel Visual
 * hanya menyuruh orang membaca kata baru yang tidak menjelaskan apa pun
 * tentang video mereka.
 *
 * Yang ada di sini adalah tindakan yang TIDAK bisa dilakukan dengan pointer di
 * timeline: memilih potongan untuk disunting, menukar urutannya, dan
 * membuangnya. Menggeser tepi tetap di timeline — di sanalah waktunya terlihat.
 */
const ClipList: React.FC<{ scene: Scene; selected: string; busy: boolean }> = ({
  scene,
  selected,
  busy,
}) => {
  if (scene.clips.length < 2) return null;
  const order = scene.clips.map((clip) => clip.id);
  const move = (id: string, arah: -1 | 1) => {
    const from = order.indexOf(id);
    const to = from + arah;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(to, 0, ...next.splice(from, 1));
    void studioClient.applyPatch(
      [{ op: "reorderClips", sceneId: scene.id, order: next }],
      `Urutan klip ${scene.id} diubah`,
    );
  };
  return (
    <section className="prop-group">
      <h4>Potongan ({scene.clips.length})</h4>
      <ul className="clip-list">
        {scene.clips.map((clip, index) => (
          <li key={clip.id} className={clip.id === selected ? "selected" : ""}>
            <button
              type="button"
              className="clip-pick"
              data-testid={`pilih-klip-${clip.id}`}
              onClick={() => studioClient.selectClip(clip.id)}
            >
              <span className="clip-no">{index + 1}</span>
              <span className="clip-name">{clip.query ?? clip.variant ?? clip.type}</span>
              <span className="clip-dur">{(clip.durationSec ?? 0).toFixed(1)}s</span>
            </button>
            <span className="clip-tools">
              <button
                type="button"
                className="mini"
                disabled={busy || index === 0}
                data-tip="Geser ke kiri"
                onClick={() => move(clip.id, -1)}
              >
                <IconPrevScene />
              </button>
              <button
                type="button"
                className="mini"
                disabled={busy || index === scene.clips.length - 1}
                data-tip="Geser ke kanan"
                onClick={() => move(clip.id, 1)}
              >
                <IconNextScene />
              </button>
              <button
                type="button"
                className="mini danger"
                disabled={busy}
                data-tip="Buang potongan ini"
                data-testid={`hapus-klip-${clip.id}`}
                onClick={() =>
                  void studioClient.applyPatch(
                    [{ op: "removeClip", sceneId: scene.id, clipId: clip.id }],
                    `Klip ${clip.id} dibuang`,
                  )
                }
              >
                <IconTrash />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <ClipCut scene={scene} clipId={selected} busy={busy} />
    </section>
  );
};

/**
 * Potongan dari klip terpilih ke klip sesudahnya (ADR-0033 §6).
 *
 * Bawaannya POTONG KERAS, dan itu bukan kelalaian: di dalam satu scene,
 * potongan keras adalah yang benar hampir selalu — larut antar potongan dari
 * gagasan yang sama terbaca sebagai keraguan. Yang disediakan di sini adalah
 * jalan keluar untuk kasus yang memang membutuhkannya (lompatan waktu, ganti
 * lokasi), bukan hiasan yang dipasang karena bisa.
 *
 * "Potong keras" MENGHAPUS field-nya (null), bukan menyetel tipe "none".
 * Keduanya terlihat sama di layar tapi tidak sama di linimasa: yang satu tidak
 * memakai tumpang-tindih sama sekali, yang satu lagi tetap memakan durasinya
 * untuk pergantian seketika. Menawarkan dua-duanya berarti menawarkan pilihan
 * yang tidak bisa dibedakan pemakainya, jadi yang ditawarkan cuma satu.
 */
const ClipCut: React.FC<{ scene: Scene; clipId: string; busy: boolean }> = ({
  scene,
  clipId,
  busy,
}) => {
  const index = scene.clips.findIndex((clip) => clip.id === clipId);
  const clip = scene.clips[index];
  // Klip terakhir tidak punya "berikutnya": batas itu milik scene, dan
  // transisinya diatur di tab Transisi.
  if (!clip || index < 0 || index === scene.clips.length - 1) return null;
  const current = clip.transition ?? null;
  const kirim = (
    transition: { type: TransitionType; durationFrames: number } | null,
    label: string,
  ) =>
    void studioClient.applyPatch(
      [{ op: "updateScene", id: scene.id, clipId, patch: { clip: { transition } } }],
      label,
    );
  return (
    <div className="clip-cut-edit">
      <h5>
        Potongan ke klip {index + 2}
        <span className="clip-cut-state">
          {current ? TRANSITION_LABEL[current.type] : "Potong keras"}
        </span>
      </h5>
      <div className="transition-grid tight">
        <button
          type="button"
          className={current ? "transition-card" : "transition-card active"}
          disabled={busy}
          data-testid={`potong-keras-${clipId}`}
          onClick={() => kirim(null, `Potongan ${clipId}: potong keras`)}
        >
          <span className="transition-glyph none" aria-hidden>
            <span className="ga" />
            <span className="gb" />
          </span>
          Potong keras
        </button>
        {TRANSITION_TYPES.filter((type) => type !== "none").map((type) => (
          <button
            key={type}
            type="button"
            className={
              current?.type === type ? "transition-card active" : "transition-card"
            }
            disabled={busy}
            data-testid={`silang-${type}-${clipId}`}
            onClick={() =>
              kirim(
                { type, durationFrames: current?.durationFrames ?? 15 },
                `Potongan ${clipId}: ${TRANSITION_LABEL[type]}`,
              )
            }
          >
            <span className={`transition-glyph ${type}`} aria-hidden>
              <span className="ga" />
              <span className="gb" />
            </span>
            {TRANSITION_LABEL[type]}
          </button>
        ))}
      </div>
      {current ? (
        <SliderRow
          label="Durasi silang"
          min={MIN_TRANSITION_FRAMES}
          max={MAX_TRANSITION_FRAMES}
          step={1}
          value={current.durationFrames}
          neutral={15}
          format={(value) => `${(value / 30).toFixed(2)}s`}
          onCommit={(durationFrames) =>
            kirim(
              { type: current.type, durationFrames },
              `Durasi silang ${(durationFrames / 30).toFixed(2)}s`,
            )
          }
        />
      ) : null}
    </div>
  );
};

const VisualTab: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { project, selectedClipId } = useStudio();
  const busy = project?.busy.mutation !== null;
  const uploadRef = useRef<HTMLInputElement>(null);
  /**
   * Potongan yang sedang disunting (ADR-0033).
   *
   * Semua kendali di tab ini menyasar SATU klip lewat `updateScene.clipId`.
   * Tanpa itu, scene wawancara berklip dua belas hanya bisa disetel gerak dan
   * filternya di potongan pertama — dan sebelas sisanya diam-diam tak
   * tersentuh oleh kendali yang tampak berlaku untuk semuanya.
   */
  const clip =
    scene.clips.find((candidate) => candidate.id === selectedClipId) ??
    primaryClip(scene);
  const [query, setQuery] = useState(clip.query ?? "");
  useEffect(() => setQuery(clip.query ?? ""), [clip]);

  const patch = (ops: PatchOpInput[], label?: string) =>
    void studioClient.applyPatch(ops, label);
  // Nilai efektif = filter tersimpan ATAU netral (untuk slider).
  const filter: VisualFilter = clip.filter ?? visualFilterSchema.parse({});

  const commitFilter = (partial: Partial<VisualFilter>, label?: string) =>
    patch(
      [
        {
          op: "updateScene",
          id: scene.id,
          clipId: clip.id,
          patch: { clip: { filter: { ...filter, ...partial } } },
        },
      ],
      label,
    );

  return (
    <>
      <ClipList scene={scene} selected={clip.id} busy={busy} />
      <section className="prop-group">
        <h4>Sumber</h4>
        <label className="field">
          <span>Tipe visual</span>
          <select
            value={clip.type}
            onChange={(event) =>
              patch([
                {
                  op: "updateScene",
                  id: scene.id,
                  clipId: clip.id,
                  patch: { clip: { type: event.target.value as never } },
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
        <div className="btn-row">
          <input
            ref={uploadRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === "string") {
                    void studioClient.uploadAsset(scene.id, file.name, reader.result);
                  }
                };
                reader.readAsDataURL(file);
              }
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="ghost with-icon"
            disabled={busy}
            onClick={() => uploadRef.current?.click()}
            data-tip="PNG/JPEG maks 8MB — terpasang & ter-pin ke scene ini"
          >
            <IconPlus />
            Unggah gambar
          </button>
        </div>
        {/* ADR-0028: rekaman (bukan gambar) — pilih/unggah, lihat, tentukan titik masuk. */}
        {project?.plan ? <SourceSection plan={project.plan} scene={scene} /> : null}
        <label className="field">
          <span>Kata kunci pencarian aset (bahasa Inggris)</span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={() => {
              if (query !== (clip.query ?? "")) {
                patch([
                  {
                    op: "updateScene",
                    id: scene.id,
                    clipId: clip.id,
                    patch: { clip: { query: query.trim() === "" ? null : query } },
                  },
                ]);
              }
            }}
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
                (clip.query ?? scene.narration.split(/\s+/).slice(0, 8).join(" ")).trim(),
                "video",
              )
            }
          >
            <IconSearch />
            Cari aset
          </button>
          {clip.pinned ? (
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
        <h4>Gerak kamera</h4>
        <div className="chip-row grid-3">
          {MOTIONS.map((motion) => (
            <button
              key={motion}
              type="button"
              className={clip.motion === motion ? "chip active" : "chip"}
              disabled={busy}
              onClick={() =>
                patch(
                  [
                    {
                      op: "updateScene",
                      id: scene.id,
                      clipId: clip.id,
                      patch: { clip: { motion } },
                    },
                  ],
                  `Gerak ${MOTION_LABEL[motion]}`,
                )
              }
            >
              {MOTION_LABEL[motion] ?? motion}
            </button>
          ))}
        </div>
      </section>

      <section className="prop-group">
        <h4>Bingkai</h4>
        <p className="group-hint">Bagian aset yang dipertahankan saat di-crop.</p>
        <SliderRow
          label="Fokus X"
          min={0}
          max={1}
          step={0.05}
          neutral={0.5}
          value={clip.focusX}
          format={(v) => `${Math.round(v * 100)}%`}
          onCommit={(focusX) =>
            patch([
              {
                op: "updateScene",
                id: scene.id,
                clipId: clip.id,
                patch: { clip: { focusX } },
              },
            ])
          }
        />
        <SliderRow
          label="Fokus Y"
          min={0}
          max={1}
          step={0.05}
          neutral={0.5}
          value={clip.focusY}
          format={(v) => `${Math.round(v * 100)}%`}
          onCommit={(focusY) =>
            patch([
              {
                op: "updateScene",
                id: scene.id,
                clipId: clip.id,
                patch: { clip: { focusY } },
              },
            ])
          }
        />
        <div className="switch-row">
          <Switch
            checked={clip.flipH}
            disabled={busy}
            label="Cermin horizontal"
            onChange={(flipH) =>
              patch(
                [
                  {
                    op: "updateScene",
                    id: scene.id,
                    clipId: clip.id,
                    patch: { clip: { flipH } },
                  },
                ],
                flipH ? "Aset dicerminkan" : "Cermin dilepas",
              )
            }
          />
        </div>
        {project?.plan?.renderState.clipAssets[scene.id]?.kind === "video" ? (
          <SliderRow
            label="Kecepatan"
            min={0.25}
            max={4}
            step={0.25}
            neutral={1}
            value={clip.speed}
            format={(v) => `${v}x`}
            onCommit={(speed) =>
              patch(
                [
                  {
                    op: "updateScene",
                    id: scene.id,
                    clipId: clip.id,
                    patch: { clip: { speed } },
                  },
                ],
                `Kecepatan ${speed}x`,
              )
            }
          />
        ) : null}
      </section>

      {clip.type === "solid" || clip.type === "stock" ? (
        <section className="prop-group">
          <h4>Seni prosedural</h4>
          <p className="group-hint">
            Bahasa grafis latar saat scene belum punya aset (atau tipe solid) —
            deterministik per scene.
          </p>
          <Segmented
            grow
            options={ART_VARIANTS}
            value={
              (ART_VARIANTS as readonly string[]).includes(clip.variant ?? "")
                ? (clip.variant as (typeof ART_VARIANTS)[number])
                : "duotone"
            }
            disabled={busy}
            label={(variant) => ART_LABEL[variant] ?? variant}
            onChange={(variant) =>
              patch(
                [
                  {
                    op: "updateScene",
                    id: scene.id,
                    clipId: clip.id,
                    patch: { clip: { variant } },
                  },
                ],
                `Seni ${ART_LABEL[variant]}`,
              )
            }
          />
        </section>
      ) : null}

      <section className="prop-group">
        <div className="group-head">
          <h4>Filter</h4>
          {clip.filter ? (
            <button
              type="button"
              className="mini"
              disabled={busy}
              onClick={() =>
                patch(
                  [
                    {
                      op: "updateScene",
                      id: scene.id,
                      clipId: clip.id,
                      patch: { clip: { filter: null } },
                    },
                  ],
                  "Filter direset",
                )
              }
            >
              Reset
            </button>
          ) : null}
        </div>
        <div className="chip-row">
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={filter.preset === preset ? "chip active" : "chip"}
              disabled={busy}
              onClick={() => commitFilter({ preset }, `Filter ${FILTER_LABEL[preset]}`)}
            >
              {FILTER_LABEL[preset]}
            </button>
          ))}
        </div>
        <SliderRow
          label="Cerah"
          min={0.25}
          max={2}
          step={0.05}
          neutral={1}
          value={filter.brightness}
          onCommit={(brightness) => commitFilter({ brightness })}
        />
        <SliderRow
          label="Kontras"
          min={0.25}
          max={2}
          step={0.05}
          neutral={1}
          value={filter.contrast}
          onCommit={(contrast) => commitFilter({ contrast })}
        />
        <SliderRow
          label="Saturasi"
          min={0}
          max={2}
          step={0.05}
          neutral={1}
          value={filter.saturation}
          onCommit={(saturation) => commitFilter({ saturation })}
        />
        <SliderRow
          label="Opacity"
          min={0}
          max={1}
          step={0.05}
          neutral={1}
          value={filter.opacity}
          format={(v) => `${Math.round(v * 100)}%`}
          onCommit={(opacity) => commitFilter({ opacity })}
        />
        <SliderRow
          label="Blur"
          min={0}
          max={20}
          step={1}
          neutral={0}
          value={filter.blur}
          format={(v) => `${v}px`}
          onCommit={(blur) => commitFilter({ blur })}
        />
      </section>
    </>
  );
};

const TeksTab: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { project } = useStudio();
  const busy = project?.busy.mutation !== null;
  const patchTexts = (texts: Scene["texts"], label?: string) =>
    void studioClient.applyPatch(
      [{ op: "updateScene", id: scene.id, patch: { texts } }],
      label,
    );

  return (
    <>
      {/* ADR-0016: caption karaoke akhirnya punya gaya nyata. */}
      <section className="prop-group">
        <div className="group-head">
          <h4>Caption karaoke</h4>
          {/* Label mengikuti KEADAAN, bukan tetap "Aktif": sakelar mati yang
              bertuliskan "Aktif" terbaca seperti pernyataan status yang salah,
              bukan seperti nama sakelarnya. */}
          <Switch
            checked={scene.caption.enabled}
            disabled={busy}
            label={scene.caption.enabled ? "Aktif" : "Nonaktif"}
            onChange={(enabled) =>
              void studioClient.applyPatch(
                [{ op: "updateScene", id: scene.id, patch: { caption: { enabled } } }],
                enabled ? "Caption dinyalakan" : "Caption dimatikan",
              )
            }
          />
        </div>
        {scene.caption.enabled ? (
          <>
            <p className="group-hint">
              Kata aktif tersinkron narasi. Tegas = kapital tebal ber-garis-luar (gaya
              klip sosial), Chip = kata aktif berkotak aksen, Halus = tanpa karaoke.
            </p>
            <Segmented
              grow
              options={CAPTION_STYLES}
              value={
                (CAPTION_STYLES as readonly string[]).includes(scene.caption.style)
                  ? (scene.caption.style as (typeof CAPTION_STYLES)[number])
                  : "klasik"
              }
              disabled={busy}
              label={(style) => CAPTION_STYLE_LABEL[style] ?? style}
              onChange={(style) =>
                void studioClient.applyPatch(
                  [{ op: "updateScene", id: scene.id, patch: { caption: { style } } }],
                  `Caption ${CAPTION_STYLE_LABEL[style]}`,
                )
              }
            />
            <div className="text-item-row">
              <Segmented
                options={TEXT_SIZES}
                value={scene.caption.size}
                disabled={busy}
                label={(size) => SIZE_LABEL[size] ?? size}
                onChange={(size) =>
                  void studioClient.applyPatch([
                    { op: "updateScene", id: scene.id, patch: { caption: { size } } },
                  ])
                }
              />
              <Segmented
                options={CAPTION_POSITIONS}
                value={scene.caption.position}
                disabled={busy}
                label={(position) => CAPTION_POSITION_LABEL[position] ?? position}
                onChange={(position) =>
                  void studioClient.applyPatch([
                    {
                      op: "updateScene",
                      id: scene.id,
                      patch: { caption: { position } },
                    },
                  ])
                }
              />
            </div>
          </>
        ) : null}
      </section>

      <section className="prop-group">
        <div className="group-head">
          <h4>Teks di atas visual</h4>
          <button
            type="button"
            className="mini"
            disabled={busy || scene.texts.length >= 3}
            onClick={() =>
              patchTexts(
                [
                  ...scene.texts,
                  {
                    id: `tx-${Date.now().toString(36)}`,
                    content: "Teks baru",
                    role: "headline",
                    position: "center",
                    align: "center",
                    size: "m",
                    emphasis: "none",
                    anim: "fade",
                    color: null,
                    stroke: 0,
                    uppercase: false,
                    tracking: 0,
                    offsetX: 0,
                    offsetY: 0,
                    // ADR-0027: elemen baru lahir TANPA keyframe — geraknya
                    // datang dari preset `anim` sampai seseorang memutuskan lain.
                    tracks: [],
                    startFrac: 0,
                    endFrac: 1,
                  },
                ],
                "Teks ditambahkan",
              )
            }
          >
            Tambah
          </button>
        </div>
        {scene.texts.length === 0 ? (
          <p className="group-hint">
            Judul besar, label kecil, atau kutipan yang tampil di atas visual — untuk
            angka kunci dan penekanan, bukan duplikat narasi.
          </p>
        ) : null}
        {scene.texts.map((text, index) => (
          <div key={text.id} className="text-item">
            <textarea
              rows={2}
              defaultValue={text.content}
              onBlur={(event) => {
                const content = event.target.value.trim();
                if (content !== "" && content !== text.content) {
                  patchTexts(
                    scene.texts.map((entry, i) =>
                      i === index ? { ...entry, content } : entry,
                    ),
                  );
                }
              }}
            />
            <div className="text-item-controls">
              <Segmented
                options={TEXT_ROLES}
                value={text.role}
                disabled={busy}
                label={(role) => ROLE_LABEL[role] ?? role}
                onChange={(role) =>
                  patchTexts(
                    scene.texts.map((entry, i) =>
                      i === index ? { ...entry, role } : entry,
                    ),
                  )
                }
              />
              <Segmented
                options={TEXT_POSITIONS}
                value={text.position}
                disabled={busy}
                label={(position) => POSITION_LABEL[position] ?? position}
                onChange={(position) =>
                  patchTexts(
                    scene.texts.map((entry, i) =>
                      i === index ? { ...entry, position } : entry,
                    ),
                  )
                }
              />
              <div className="text-item-row">
                <Segmented
                  options={TEXT_ALIGNS}
                  value={text.align}
                  disabled={busy}
                  label={(align) => ALIGN_LABEL[align] ?? align}
                  onChange={(align) =>
                    patchTexts(
                      scene.texts.map((entry, i) =>
                        i === index ? { ...entry, align } : entry,
                      ),
                    )
                  }
                />
                <Segmented
                  options={TEXT_SIZES}
                  value={text.size}
                  disabled={busy}
                  label={(size) => SIZE_LABEL[size] ?? size}
                  onChange={(size) =>
                    patchTexts(
                      scene.texts.map((entry, i) =>
                        i === index ? { ...entry, size } : entry,
                      ),
                    )
                  }
                />
              </div>
              <Segmented
                options={TEXT_EMPHASES}
                value={text.emphasis}
                disabled={busy}
                label={(emphasis) => EMPHASIS_LABEL[emphasis] ?? emphasis}
                onChange={(emphasis) =>
                  patchTexts(
                    scene.texts.map((entry, i) =>
                      i === index ? { ...entry, emphasis } : entry,
                    ),
                  )
                }
              />
              {/* ADR-0016: animasi masuk + rupa (warna, garis luar, kapital). */}
              <Segmented
                options={TEXT_ANIMS}
                value={text.anim}
                disabled={busy}
                label={(anim) => ANIM_LABEL[anim] ?? anim}
                onChange={(anim) =>
                  patchTexts(
                    scene.texts.map((entry, i) =>
                      i === index ? { ...entry, anim } : entry,
                    ),
                    `Animasi ${ANIM_LABEL[anim]}`,
                  )
                }
              />
              <div className="text-item-row">
                <input
                  type="color"
                  title="Warna teks"
                  value={text.color ?? "#f5f0e6"}
                  disabled={busy}
                  onChange={(event) =>
                    patchTexts(
                      scene.texts.map((entry, i) =>
                        i === index ? { ...entry, color: event.target.value } : entry,
                      ),
                      "Warna teks diubah",
                    )
                  }
                />
                <Switch
                  checked={text.uppercase}
                  disabled={busy}
                  label="KAPITAL"
                  onChange={(uppercase) =>
                    patchTexts(
                      scene.texts.map((entry, i) =>
                        i === index ? { ...entry, uppercase } : entry,
                      ),
                    )
                  }
                />
              </div>
              <SliderRow
                label="Garis luar"
                min={0}
                max={8}
                step={1}
                neutral={0}
                value={text.stroke}
                format={(v) => `${v}px`}
                onCommit={(stroke) =>
                  patchTexts(
                    scene.texts.map((entry, i) =>
                      i === index ? { ...entry, stroke } : entry,
                    ),
                  )
                }
              />
              <SliderRow
                label="Kerapatan"
                min={-0.05}
                max={0.5}
                step={0.01}
                neutral={0}
                value={text.tracking}
                format={(v) => `${v.toFixed(2)}em`}
                onCommit={(tracking) =>
                  patchTexts(
                    scene.texts.map((entry, i) =>
                      i === index ? { ...entry, tracking } : entry,
                    ),
                  )
                }
              />
              <div className="text-item-row">
                {text.color ? (
                  <button
                    type="button"
                    className="mini"
                    disabled={busy}
                    onClick={() =>
                      patchTexts(
                        scene.texts.map((entry, i) =>
                          i === index ? { ...entry, color: null } : entry,
                        ),
                        "Warna kembali ke tema",
                      )
                    }
                  >
                    Warna tema
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost danger with-icon"
                  disabled={busy}
                  onClick={() =>
                    patchTexts(
                      scene.texts.filter((_, i) => i !== index),
                      "Teks dihapus",
                    )
                  }
                >
                  <IconTrash />
                  Hapus
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>
    </>
  );
};

const TransisiTab: React.FC<{ scene: Scene; isLast: boolean }> = ({ scene, isLast }) => {
  const { project } = useStudio();
  const busy = project?.busy.mutation !== null;
  return (
    <section className="prop-group">
      <h4>Transisi keluar scene</h4>
      {isLast ? (
        <p className="group-hint">
          Ini scene terakhir — transisinya tidak dipakai (tidak ada scene berikutnya).
        </p>
      ) : null}
      <div className="transition-grid">
        {TRANSITION_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={
              scene.transition.type === type
                ? "transition-card active"
                : "transition-card"
            }
            disabled={busy}
            onClick={() =>
              void studioClient.applyPatch(
                [
                  {
                    op: "updateScene",
                    id: scene.id,
                    patch: {
                      transition: {
                        type,
                        durationFrames: scene.transition.durationFrames,
                      },
                    },
                  },
                ],
                `Transisi: ${TRANSITION_LABEL[type]}`,
              )
            }
          >
            <span className={`transition-glyph ${type}`} aria-hidden>
              <span className="ga" />
              <span className="gb" />
            </span>
            {TRANSITION_LABEL[type]}
          </button>
        ))}
      </div>
      <SliderRow
        label="Durasi"
        min={MIN_TRANSITION_FRAMES}
        max={MAX_TRANSITION_FRAMES}
        step={1}
        value={scene.transition.durationFrames}
        neutral={15}
        format={(value) => `${(value / 30).toFixed(2)}s`}
        onCommit={(durationFrames) =>
          void studioClient.applyPatch(
            [
              {
                op: "updateScene",
                id: scene.id,
                patch: {
                  transition: { type: scene.transition.type, durationFrames },
                },
              },
            ],
            `Durasi transisi ${(durationFrames / 30).toFixed(2)}s`,
          )
        }
      />
    </section>
  );
};

export const InspectorPanel: React.FC = () => {
  const { project, selectedSceneId } = useStudio();
  const [tab, setTab] = useState<Tab>("scene");
  const [tabBarRef, tabFade] = useScrollFade<HTMLDivElement>();
  const plan = project?.plan ?? null;
  const index = plan?.scenes.findIndex((scene) => scene.id === selectedSceneId) ?? -1;
  const scene = index >= 0 ? plan?.scenes[index] : undefined;

  return (
    <aside className="panel inspector-panel">
      <div className="panel-head">
        <h2>Properti</h2>
        {scene ? (
          <span className="meta-line">
            Scene {index + 1} | {scene.id}
          </span>
        ) : null}
        <button
          type="button"
          className="mini drawer-close"
          onClick={() => uiStore.closeInspector()}
        >
          Tutup
        </button>
      </div>
      {plan && scene ? (
        <>
          <div className="inspector-tools">
            <Switch
              checked={scene.locked}
              label="Kunci dari agent"
              title="Scene terkunci tidak akan disentuh agent"
              onChange={(locked) =>
                void studioClient.applyPatch(
                  [{ op: "lockScene", id: scene.id, locked }],
                  locked ? `${scene.id} dikunci dari agent` : `Kunci ${scene.id} dibuka`,
                )
              }
            />
          </div>
          <div className={`tab-bar ${tabFade}`} ref={tabBarRef}>
            {(
              [
                ["scene", "Scene"],
                ["visual", "Visual"],
                ["teks", "Teks"],
                ["transkrip", "Transkrip"],
                ["grafis", "Grafis"],
                ["lapisan", "Lapisan"],
                ["audio", "Audio"],
                ["transisi", "Transisi"],
                ["anotasi", "Anotasi"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={tab === key ? "tab active" : "tab"}
                onClick={() => setTab(key)}
              >
                {label}
                {key === "teks" && scene.texts.length > 0 ? (
                  <span className="tab-count">{scene.texts.length}</span>
                ) : null}
                {key === "grafis" && scene.graphics.length > 0 ? (
                  <span className="tab-count">{scene.graphics.length}</span>
                ) : null}
                {key === "lapisan" && scene.layers.length > 0 ? (
                  <span className="tab-count">{scene.layers.length}</span>
                ) : null}
                {key === "audio" && plan.audio.tracks.length > 0 ? (
                  <span className="tab-count">{plan.audio.tracks.length}</span>
                ) : null}
                {key === "anotasi" && scene.annotations.length > 0 ? (
                  <span className="tab-count">{scene.annotations.length}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="inspector-scroll">
            {tab === "scene" ? (
              <SceneTab plan={plan} scene={scene} index={index} />
            ) : null}
            {tab === "visual" ? <VisualTab scene={scene} /> : null}
            {tab === "teks" ? <TeksTab scene={scene} /> : null}
            {tab === "transkrip" ? <TranscriptTab plan={plan} scene={scene} /> : null}
            {tab === "grafis" ? <GrafisTab plan={plan} scene={scene} /> : null}
            {tab === "lapisan" ? <LapisanTab plan={plan} scene={scene} /> : null}
            {tab === "audio" ? <AudioTab plan={plan} scene={scene} /> : null}
            {tab === "transisi" ? (
              <TransisiTab scene={scene} isLast={index === plan.scenes.length - 1} />
            ) : null}
            {tab === "anotasi" ? (
              <AnotasiTab scene={scene} stylePreset={plan.meta.stylePreset} />
            ) : null}
          </div>
        </>
      ) : (
        <div className="panel-empty">
          <IconImage />
          <p>
            Pilih scene di timeline untuk mengubah naskah, visual, teks, dan transisinya.
          </p>
        </div>
      )}
    </aside>
  );
};
