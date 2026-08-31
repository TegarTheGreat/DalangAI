import type {
  Graphic,
  GraphicAnchor,
  PatchOpInput,
  Scene,
  ScenePlan,
} from "@dalang/core";
import { GRAPHIC_ANIMS } from "@dalang/core";
import { useRef, useState } from "react";
import type {
  IconCandidateLite,
  SfxCandidateLite,
  StickerCandidateLite,
} from "../../shared/api-types";
import { api } from "../api";
import { Segmented } from "../components/controls";
import { IconSearch, IconSpinner, IconSticker, IconTrash, IconWave } from "../icons";
import { studioClient } from "../use-studio";
import { SliderRow } from "./InspectorPanel";

/**
 * Panel pustaka media (ADR-0018): ikon, stiker, dan efek suara di panel MANUAL.
 *
 * Kenapa manual dan bukan cukup lewat chat: ikon (Iconify) dan efek suara
 * (Openverse) tidak butuh kunci API sama sekali. Kalau satu-satunya jalan
 * memakainya adalah menyuruh agent, seluruh fitur ini ikut mati ketika API key
 * model tidak ada — padahal pustakanya sendiri terbuka.
 *
 * Pemasangan memakai jalur yang sama dengan panel manual lain: satu patch USER,
 * bisa di-undo, dan terlihat agent di giliran berikutnya (PRD §5.2 dua arah).
 */

export const ANCHOR_LABEL: Record<GraphicAnchor, string> = {
  "kiri-atas": "Kiri atas",
  "tengah-atas": "Tengah atas",
  "kanan-atas": "Kanan atas",
  "kiri-tengah": "Kiri tengah",
  tengah: "Tengah",
  "kanan-tengah": "Kanan tengah",
  "kiri-bawah": "Kiri bawah",
  "tengah-bawah": "Tengah bawah",
  "kanan-bawah": "Kanan bawah",
};

/** Urutan sel pad 3x3 — persis tata letak jangkar di frame. */
const ANCHOR_ORDER: readonly GraphicAnchor[] = [
  "kiri-atas",
  "tengah-atas",
  "kanan-atas",
  "kiri-tengah",
  "tengah",
  "kanan-tengah",
  "kiri-bawah",
  "tengah-bawah",
  "kanan-bawah",
];

type GraphicAnim = (typeof GRAPHIC_ANIMS)[number];

const ANIM_LABEL: Record<GraphicAnim, string> = {
  diam: "Diam",
  pop: "Pop",
  apung: "Apung",
  putar: "Putar",
  denyut: "Denyut",
};

/** Warna cepat untuk ikon; null = warna aksen preset. */
const ICON_COLORS: readonly (string | null)[] = [
  null,
  "#ffffff",
  "#0f172a",
  "#e11d48",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
];

/**
 * Lisensi bertanda ini datang dari layanan yang memberi izin MENCARI, bukan
 * izin menyiarkan ulang (ADR-0018). Ditandai di tempat aset itu dipilih, bukan
 * hanya di catatan sutradara, supaya keputusannya diambil sadar.
 */
const RIGHTS_MARK = "PERIKSA HAK PAKAI";

const isIconRef = (ref: string): boolean => ref.startsWith("iconify:");

/**
 * Warna aksen bawaan tiap preset (sumber: theme.ts masing-masing). Dipakai
 * HANYA untuk pratinjau: tanpa ini, ikon dengan `color: null` tampil apa adanya
 * di grid lalu keluar berwarna aksen di video — pratinjau yang berbohong
 * tentang hasilnya.
 */
const PRESET_ACCENT: Record<string, string> = {
  "documentary-01": "#E4A64C",
  "tutorial-01": "#2E5FD7",
};

const accentOf = (plan: ScenePlan): string =>
  plan.meta.tokens?.accent ?? PRESET_ACCENT[plan.meta.stylePreset] ?? "#E4A64C";

/** Kotak pencarian dengan status; dipakai ketiga pustaka. */
const SearchBox: React.FC<{
  placeholder: string;
  busy: boolean;
  onSearch: (query: string) => void;
  /** Keterangan perilaku yang tidak perlu dibaca ulang tiap kali. */
  title?: string;
}> = ({ placeholder, busy, onSearch, title }) => {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const query = draft.trim();
    if (query.length >= 2) onSearch(query);
  };
  return (
    <div className="lib-search">
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        {...(title ? { title } : {})}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
      />
      <button
        type="button"
        className="mini with-icon"
        disabled={busy || draft.trim().length < 2}
        onClick={submit}
      >
        {busy ? <IconSpinner /> : <IconSearch />}
        Cari
      </button>
    </div>
  );
};

/** Jangkar 3x3 — peta posisi yang sebenarnya, bukan daftar nama. */
export const AnchorPad: React.FC<{
  value: GraphicAnchor;
  onChange: (anchor: GraphicAnchor) => void;
}> = ({ value, onChange }) => (
  <fieldset className="anchor-pad" aria-label="Jangkar posisi">
    {ANCHOR_ORDER.map((anchor) => (
      <button
        key={anchor}
        type="button"
        className={anchor === value ? "anchor-cell active" : "anchor-cell"}
        title={ANCHOR_LABEL[anchor]}
        aria-label={ANCHOR_LABEL[anchor]}
        aria-pressed={anchor === value}
        onClick={() => onChange(anchor)}
      >
        <span aria-hidden />
      </button>
    ))}
  </fieldset>
);

const Swatches: React.FC<{
  value: string | null;
  onChange: (color: string | null) => void;
}> = ({ value, onChange }) => (
  <fieldset className="swatch-row" aria-label="Warna ikon">
    {ICON_COLORS.map((color) => (
      <button
        key={color ?? "aksen"}
        type="button"
        className={value === color ? "swatch active" : "swatch"}
        title={color ?? "Warna aksen preset"}
        aria-label={color ?? "Warna aksen preset"}
        aria-pressed={value === color}
        {...(color ? { style: { background: color } } : {})}
        onClick={() => onChange(color)}
      >
        {color ? null : "A"}
      </button>
    ))}
  </fieldset>
);

const graphicsPatch = (sceneId: string, graphics: Graphic[]): PatchOpInput[] => [
  { op: "updateScene", id: sceneId, patch: { graphics } },
];

/**
 * Kartu satu grafis terpasang: baris ringkas yang membuka kendali penuh.
 *
 * Ringkas secara bawaan, dan itu bukan penghematan piksel: empat kartu terbuka
 * mendorong PUSTAKA jauh ke bawah lipatan, sehingga menambah tempelan
 * berikutnya terasa seperti fitur yang hilang. Satu baris per tempelan membuat
 * daftarnya terbaca seperti daftar layer di editor, dan pustakanya tetap
 * terjangkau.
 */
const GraphicCard: React.FC<{
  plan: ScenePlan;
  scene: Scene;
  graphic: Graphic;
  open: boolean;
  onToggle: () => void;
}> = ({ plan, scene, graphic, open, onToggle }) => {
  const asset = plan.renderState.graphicAssets[graphic.id];
  const icon = isIconRef(graphic.ref);
  const preview = icon
    ? api.iconPreviewUrl(
        graphic.ref.slice("iconify:".length),
        graphic.color ?? accentOf(plan),
      )
    : asset
      ? `/${asset.file}`
      : null;

  const commit = (patch: Partial<Graphic>, label: string) =>
    void studioClient.applyPatch(
      graphicsPatch(
        scene.id,
        scene.graphics.map((entry) =>
          entry.id === graphic.id ? { ...entry, ...patch } : entry,
        ),
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
          <span className={icon ? "graphic-thumb icon" : "graphic-thumb"}>
            {preview ? <img src={preview} alt="" loading="lazy" /> : <IconSticker />}
          </span>
          <span className="graphic-card-id">
            <strong>{icon ? graphic.ref.slice("iconify:".length) : "Stiker"}</strong>
            <span className="meta-line">
              {ANCHOR_LABEL[graphic.anchor]} | {Math.round(graphic.size * 100)}% |{" "}
              {asset?.license ?? "berkas belum ada"}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="mini danger"
          title="Hapus grafis ini"
          onClick={() =>
            void studioClient.applyPatch(
              graphicsPatch(
                scene.id,
                scene.graphics.filter((entry) => entry.id !== graphic.id),
              ),
              "Grafis dihapus",
            )
          }
        >
          <IconTrash />
        </button>
      </div>

      {open ? (
        <div className="graphic-card-body">
          <AnchorPad
            value={graphic.anchor}
            onChange={(anchor) => commit({ anchor }, `Jangkar: ${ANCHOR_LABEL[anchor]}`)}
          />
          <div className="graphic-card-controls">
            <SliderRow
              label="Ukuran"
              min={0.04}
              max={0.5}
              step={0.01}
              value={graphic.size}
              neutral={0.12}
              format={(value) => `${Math.round(value * 100)}%`}
              onCommit={(size) =>
                commit({ size }, `Ukuran grafis ${Math.round(size * 100)}%`)
              }
            />
            <SliderRow
              label="Opasitas"
              min={0.1}
              max={1}
              step={0.05}
              value={graphic.opacity}
              neutral={1}
              format={(value) => `${Math.round(value * 100)}%`}
              onCommit={(opacity) => commit({ opacity }, "Opasitas grafis diubah")}
            />
            <SliderRow
              label="Putar"
              min={-45}
              max={45}
              step={1}
              value={graphic.rotate}
              neutral={0}
              format={(value) => `${value}°`}
              onCommit={(rotate) => commit({ rotate }, "Rotasi grafis diubah")}
            />
            <Segmented
              options={GRAPHIC_ANIMS}
              value={graphic.anim}
              label={(anim) => ANIM_LABEL[anim]}
              onChange={(anim) => commit({ anim }, `Gerak grafis: ${ANIM_LABEL[anim]}`)}
            />
            {icon ? (
              <Swatches
                value={graphic.color}
                onChange={(color) => commit({ color }, "Warna ikon diubah")}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** Tab Grafis: yang terpasang di atas, pustaka pencarian di bawah. */
export const GrafisTab: React.FC<{ plan: ScenePlan; scene: Scene }> = ({
  plan,
  scene,
}) => {
  const [source, setSource] = useState<"ikon" | "stiker">("ikon");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icons, setIcons] = useState<IconCandidateLite[]>([]);
  const [stickers, setStickers] = useState<StickerCandidateLite[]>([]);
  const [stickerQuery, setStickerQuery] = useState("");
  const [anchor, setAnchor] = useState<GraphicAnchor>("kanan-bawah");
  const [anim, setAnim] = useState<GraphicAnim>("pop");
  const [color, setColor] = useState<string | null>(null);
  // Satu kartu terbuka pada satu waktu; grafis tunggal langsung terbuka karena
  // di situ tidak ada yang perlu dipilih.
  const [openId, setOpenId] = useState<string | null>(
    scene.graphics.length === 1 ? (scene.graphics[0]?.id ?? null) : null,
  );
  const resultsRef = useRef<HTMLDivElement>(null);

  const full = scene.graphics.length >= 4;

  const search = async (query: string) => {
    setBusy(true);
    setError(null);
    try {
      if (source === "ikon") {
        const result = await api.iconSearch(query);
        setIcons(result.icons);
        if (result.icons.length === 0) setError(`Tidak ada ikon untuk "${query}"`);
      } else {
        const result = await api.stickerSearch(query);
        setStickers(result.stickers);
        setStickerQuery(query);
        if (result.stickers.length === 0) setError(`Tidak ada stiker untuk "${query}"`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      // Hasil pencarian berada di bawah daftar tempelan, jadi tanpa ini
      // menekan Enter tampak seperti tidak terjadi apa-apa.
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
    }
  };

  return (
    <>
      <section className="prop-group">
        <h4>Terpasang ({scene.graphics.length}/4)</h4>
        {scene.graphics.length === 0 ? (
          <p className="group-hint">
            Belum ada tempelan di scene ini. Cari ikon atau stiker di bawah, lalu klik
            untuk memasangnya.
          </p>
        ) : (
          scene.graphics.map((graphic) => (
            <GraphicCard
              key={graphic.id}
              plan={plan}
              scene={scene}
              graphic={graphic}
              open={openId === graphic.id}
              onToggle={() => setOpenId(openId === graphic.id ? null : graphic.id)}
            />
          ))
        )}
      </section>

      <section className="prop-group">
        <h4>Pustaka</h4>
        <Segmented
          options={["ikon", "stiker"] as const}
          value={source}
          grow
          label={(value) => (value === "ikon" ? "Ikon" : "Stiker")}
          onChange={(value) => {
            setSource(value);
            setError(null);
          }}
        />
        {/* Sumber di satu baris; peringatan hak pakai stiker BUKAN dipendekkan
            jadi prosa abu-abu yang mudah dilewati — ia dipisah sebagai catatan
            bertanda, karena isinya soal risiko hukum, bukan tip. */}
        <p className="group-hint">
          {source === "ikon"
            ? "Iconify · tanpa kunci API · lisensi aman untuk komersial. Kata kunci Inggris memberi hasil jauh lebih kaya."
            : "GIPHY/Tenor · butuh GIPHY_API_KEY atau TENOR_API_KEY."}
        </p>
        {source === "stiker" ? (
          <p className="lib-warn">
            API resmi berarti boleh mencari dan menampilkan — BUKAN otomatis boleh
            menyiarkan ulang di video. Periksa hak pakainya sebelum publikasi.
          </p>
        ) : null}
        <SearchBox
          placeholder={source === "ikon" ? "mis. arrow, check, map" : "mis. wow, clap"}
          busy={busy}
          onSearch={(query) => void search(query)}
        />
        {error ? <p className="lib-error">{error}</p> : null}

        {/* Tiga kontrol yang saling terkait, masing-masing berlabel dan rata
            pada tepi kiri yang SAMA. Sebelumnya pad jangkar duduk di kolom
            kiri sementara gerak, warna, dan keterangannya menjorok 72px ke
            dalam — tiga perataan berbeda dalam satu blok. */}
        <div className="lib-placement">
          <div className="field">
            <span>Posisi</span>
            <AnchorPad value={anchor} onChange={setAnchor} />
          </div>
          <div className="field">
            <span>Gerak</span>
            <Segmented
              options={GRAPHIC_ANIMS}
              value={anim}
              label={(value) => ANIM_LABEL[value]}
              onChange={setAnim}
            />
          </div>
          {source === "ikon" ? (
            <div className="field">
              <span>Warna</span>
              <Swatches value={color} onChange={setColor} />
            </div>
          ) : null}
        </div>
        <span className="meta-line wrap">
          Tempelan berikutnya: {ANCHOR_LABEL[anchor].toLowerCase()},{" "}
          {ANIM_LABEL[anim].toLowerCase()}
        </span>

        {full ? (
          <p className="lib-error">
            Scene ini sudah punya 4 grafis — hapus salah satu sebelum menambah.
          </p>
        ) : null}

        <div ref={resultsRef}>
          {source === "ikon" ? (
            <div className="icon-grid">
              {icons.map((entry) => (
                <button
                  key={entry.iconId}
                  type="button"
                  className="icon-cell"
                  disabled={full}
                  title={`${entry.iconId} | ${entry.setName} | ${entry.license}${
                    entry.needsAttribution ? " (wajib kredit)" : ""
                  }`}
                  onClick={() =>
                    void studioClient.addIcon({
                      sceneId: scene.id,
                      iconId: entry.iconId,
                      anchor,
                      size: 0.14,
                      color,
                      anim,
                    })
                  }
                >
                  <img
                    src={api.iconPreviewUrl(entry.iconId, color ?? accentOf(plan))}
                    alt={entry.iconId}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="asset-grid">
              {stickers.map((sticker) => (
                <button
                  key={sticker.assetId}
                  type="button"
                  className="asset-card sticker"
                  disabled={full}
                  title={`${sticker.assetId} | ${sticker.license}`}
                  onClick={() =>
                    void studioClient.addSticker({
                      sceneId: scene.id,
                      query: stickerQuery,
                      index: sticker.index,
                      anchor,
                      size: 0.2,
                      anim,
                    })
                  }
                >
                  {sticker.thumbnailUrl ? (
                    <img
                      src={sticker.thumbnailUrl}
                      alt={sticker.assetId}
                      loading="lazy"
                    />
                  ) : (
                    <span className="asset-card-fallback">stiker</span>
                  )}
                  {sticker.license.includes(RIGHTS_MARK) ? (
                    <span className="asset-card-warn">Periksa hak pakai</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
};

/**
 * Efek suara scene ini (ADR-0018). Cue ditambatkan ke SCENE, bukan garis waktu
 * mutlak, jadi menggeser atau memanjangkan scene tidak pernah membuat bunyinya
 * salah tempat.
 */
export const SfxSection: React.FC<{ plan: ScenePlan; scene: Scene }> = ({
  plan,
  scene,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sounds, setSounds] = useState<SfxCandidateLite[]>([]);
  const [atSec, setAtSec] = useState(0);
  const resultsRef = useRef<HTMLUListElement>(null);
  const cues = plan.audio.sfx.filter((cue) => cue.sceneId === scene.id);

  const setSfx = (sfx: ScenePlan["audio"]["sfx"], label: string) =>
    void studioClient.applyPatch([{ op: "setAudio", patch: { sfx } }], label);

  const search = async (query: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.sfxSearch(query);
      setSounds(result.sounds);
      if (result.sounds.length === 0) setError(`Tidak ada efek suara untuk "${query}"`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
    }
  };

  return (
    <section className="prop-group">
      <h4>Efek suara</h4>
      {cues.length > 0 ? (
        <ul className="cue-list">
          {cues.map((cue) => (
            <li key={cue.id}>
              <span className="cue-time">+{cue.atSec.toFixed(1)}s</span>
              <span
                className="cue-name"
                title={`${cue.assetId} | ${
                  plan.renderState.sfxAssets[cue.id]?.license ?? "belum diunduh"
                }`}
              >
                {plan.renderState.sfxAssets[cue.id]?.author ??
                  cue.assetId.split(":").pop() ??
                  cue.assetId}
              </span>
              <SliderRow
                label="Volume"
                min={0}
                max={1}
                step={0.05}
                value={cue.volume}
                neutral={0.6}
                format={(value) => `${Math.round(value * 100)}%`}
                onCommit={(volume) =>
                  setSfx(
                    plan.audio.sfx.map((entry) =>
                      entry.id === cue.id ? { ...entry, volume } : entry,
                    ),
                    "Volume efek suara diubah",
                  )
                }
              />
              <button
                type="button"
                className="mini danger"
                title="Hapus cue efek suara"
                onClick={() =>
                  setSfx(
                    plan.audio.sfx.filter((entry) => entry.id !== cue.id),
                    "Efek suara dihapus",
                  )
                }
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {/* Satu baris sumber; perilaku waktunya (ikut bergeser bila susunan
          scene berubah) dipindah ke tooltip kolom cari — ia keterangan
          perilaku, bukan sesuatu yang perlu dibaca setiap kali. */}
      <p className="group-hint">Openverse · CC0 / domain publik · tanpa kunci API.</p>
      <SearchBox
        title="Waktu cue dihitung dari AWAL scene, jadi bunyinya ikut bergeser bila susunan scene berubah"
        placeholder="mis. whoosh, click, chime"
        busy={busy}
        onSearch={(query) => void search(query)}
      />
      {error ? <p className="lib-error">{error}</p> : null}
      {sounds.length > 0 ? (
        <SliderRow
          label="Mulai di"
          min={0}
          max={8}
          step={0.1}
          value={atSec}
          neutral={0}
          format={(value) => `+${value.toFixed(1)}s`}
          onCommit={setAtSec}
        />
      ) : null}
      <ul className="sfx-list" ref={resultsRef}>
        {sounds.map((sound) => (
          <li key={sound.assetId}>
            <button
              type="button"
              className="sfx-pick"
              title={`${sound.license}${sound.author ? ` | ${sound.author}` : ""}`}
              onClick={() =>
                void studioClient.addSfx({
                  sceneId: scene.id,
                  assetId: sound.assetId,
                  atSec,
                  volume: 0.6,
                })
              }
            >
              <IconWave />
              <span className="sfx-title">{sound.title}</span>
              <span className="sfx-meta">
                {sound.durationSec ? `${sound.durationSec.toFixed(1)}s` : "-"} |{" "}
                {sound.license}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
