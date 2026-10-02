import {
  DUB_DRIFT_LIMIT,
  dubCoverage,
  dubDrift,
  isLanguageCode,
  MAX_DUB_LANGUAGES,
  type PatchOpInput,
  planLanguages,
  type Scene,
  type ScenePlan,
} from "@dalang/core";
import { useState } from "react";
import { api } from "../api";
import { IconSpinner, IconTrash } from "../icons";
import { studioClient } from "../use-studio";

/**
 * Sulih suara (ADR-0040).
 *
 * Tab ini menyunting SCENE yang sedang dipilih — narasi sulihannya dan teks
 * layarnya — tapi kepalanya bersifat PROYEK: bahasa mana yang ada, sejauh mana
 * masing-masing sudah jadi, dan tombol yang menjalankan TTS untuk satu bahasa.
 *
 * Digabung begitu karena menerjemahkan adalah pekerjaan per scene sementara
 * memutuskan "bahasa apa saja" adalah pekerjaan sekali per proyek. Memisahnya
 * jadi dua permukaan berarti orang harus berpindah bolak-balik untuk satu
 * pekerjaan yang di kepalanya satu.
 */

const setDub = (
  sceneId: string,
  language: string,
  text: string | null,
  textId?: string,
): PatchOpInput[] => [
  {
    op: "setDub",
    sceneId,
    language,
    ...(textId ? { textId } : {}),
    text,
  },
];

/** Kotak teks yang menyimpan saat blur, bukan tiap ketikan. */
const DubField = ({
  label,
  hint,
  value,
  original,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  original: string;
  disabled: boolean;
  onCommit: (text: string) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <label className="field dub-field">
      <span className="field-label">
        {label}
        {hint ? <em className="field-hint">{hint}</em> : null}
      </span>
      {/* Aslinya SELALU terlihat di atas kotaknya: menerjemahkan tanpa melihat
          kalimat sumbernya adalah cara termudah kehilangan maknanya. */}
      <p className="dub-source">{original || <em>(scene ini tanpa narasi)</em>}</p>
      <textarea
        rows={3}
        value={shown}
        disabled={disabled || original.trim() === ""}
        placeholder="Belum disulih"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === null || draft === value) {
            setDraft(null);
            return;
          }
          onCommit(draft);
          setDraft(null);
        }}
      />
    </label>
  );
};

export const SulihTab = ({ plan, scene }: { plan: ScenePlan; scene: Scene }) => {
  const bahasa = planLanguages(plan);
  const sulihan = bahasa.slice(1);
  const [aktif, setAktif] = useState<string | null>(sulihan[0] ?? null);
  const [baru, setBaru] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  const lang = aktif && sulihan.includes(aktif) ? aktif : (sulihan[0] ?? null);
  const cakupan = lang ? dubCoverage(plan, lang) : null;
  const melar = lang ? dubDrift(plan, lang).filter((d) => d.rasio > DUB_DRIFT_LIMIT) : [];
  const melarScene = melar.find((d) => d.sceneId === scene.id);

  const tambahBahasa = () => {
    const kode = baru.trim().toLowerCase();
    if (!isLanguageCode(kode)) {
      setPesan(`"${kode}" bukan kode bahasa (contoh: en, jv, en-US)`);
      return;
    }
    if (bahasa.includes(kode)) {
      setPesan(`Bahasa ${kode} sudah ada`);
      return;
    }
    if (sulihan.length >= MAX_DUB_LANGUAGES) {
      setPesan(`Paling banyak ${MAX_DUB_LANGUAGES} bahasa sulih per proyek`);
      return;
    }
    // Bahasa "ada" begitu ada teksnya, jadi menambahkannya berarti menulis
    // sulihan pertama — di scene bernarasi pertama, dengan narasi aslinya
    // sebagai titik awal yang bisa langsung ditimpa.
    const target = plan.scenes.find((item) => item.narration.trim() !== "");
    if (!target) {
      setPesan("Belum ada scene bernarasi untuk disulih");
      return;
    }
    setPesan(null);
    setBaru("");
    setAktif(kode);
    void studioClient.applyPatch(
      setDub(target.id, kode, target.narration),
      `Bahasa sulih ${kode} ditambahkan`,
    );
  };

  const jalankanSuara = () => {
    if (!lang) return;
    setSibuk(true);
    setPesan(null);
    void api
      .runDub(lang)
      .then((hasil) => {
        const belum = hasil.belumDiterjemahkan.length;
        setPesan(
          `Suara ${lang}: ${hasil.results.length} scene` +
            (belum > 0 ? ` · ${belum} scene belum diterjemahkan (akan BISU)` : "") +
            (hasil.suaraSendiri
              ? ""
              : " · memakai suara bahasa utama, setel audio.dubVoices untuk suara yang benar"),
        );
      })
      .catch((cause: unknown) => {
        setPesan(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setSibuk(false));
  };

  return (
    <div className="prop-group sulih-tab">
      <div className="group-head">
        <h4>Sulih suara</h4>
        <span className="muted">{sulihan.length} bahasa</span>
      </div>

      {sulihan.length === 0 ? (
        <p className="hint">
          Belum ada bahasa sulih. Tambahkan kode bahasa di bawah, lalu terjemahkan
          narasinya per scene — atau minta agent menerjemahkan seluruhnya sekaligus.
        </p>
      ) : (
        <div className="chip-row">
          {sulihan.map((kode) => (
            <button
              key={kode}
              type="button"
              className={kode === lang ? "chip active" : "chip"}
              onClick={() => setAktif(kode)}
            >
              {kode}
            </button>
          ))}
        </div>
      )}

      <div className="row gap">
        <input
          type="text"
          className="mini-input"
          value={baru}
          placeholder="kode bahasa (en, jv)"
          maxLength={12}
          onChange={(event) => setBaru(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") tambahBahasa();
          }}
        />
        <button type="button" className="mini" onClick={tambahBahasa}>
          Tambah bahasa
        </button>
      </div>

      {lang && cakupan ? (
        <>
          <div className="sulih-stat">
            <span>
              teks {cakupan.diterjemahkan}/{cakupan.perlu}
            </span>
            <span>
              suara {cakupan.bersuara}/{cakupan.perlu}
            </span>
            {melar.length > 0 ? <span className="warn">{melar.length} melar</span> : null}
          </div>

          <div className="row gap">
            <button
              type="button"
              className="mini"
              disabled={sibuk || cakupan.diterjemahkan === 0}
              onClick={jalankanSuara}
            >
              {sibuk ? <IconSpinner /> : null}
              Buat suara {lang}
            </button>
            <button
              type="button"
              className="mini danger"
              disabled={sibuk}
              onClick={() =>
                void studioClient.applyPatch(
                  plan.scenes.flatMap((item) =>
                    item.dubs[lang] === undefined ? [] : setDub(item.id, lang, null),
                  ),
                  `Sulihan ${lang} dihapus`,
                )
              }
            >
              <IconTrash />
              Hapus {lang}
            </button>
          </div>

          <DubField
            label={`Narasi ${lang}`}
            {...(melarScene
              ? {
                  hint: `${Math.round((melarScene.rasio - 1) * 100)}% lebih panjang dari aslinya`,
                }
              : {})}
            value={scene.dubs[lang] ?? ""}
            original={scene.narration}
            disabled={sibuk}
            onCommit={(text) =>
              void studioClient.applyPatch(
                setDub(scene.id, lang, text),
                `Sulihan ${lang} ${scene.id}`,
              )
            }
          />

          {scene.texts.map((text) => (
            <DubField
              key={text.id}
              label={`Teks layar: ${text.id}`}
              value={text.dubs[lang] ?? ""}
              original={text.content}
              disabled={sibuk}
              onCommit={(isi) =>
                void studioClient.applyPatch(
                  setDub(scene.id, lang, isi, text.id),
                  `Sulihan ${lang} teks ${text.id}`,
                )
              }
            />
          ))}

          <label className="field">
            <span className="field-label">
              Judul proyek {lang}
              <em className="field-hint">tampil di bilah atas setiap bingkai</em>
            </span>
            <input
              type="text"
              value={plan.meta.dubTitles[lang] ?? ""}
              placeholder={plan.meta.title}
              onChange={(event) =>
                void studioClient.applyPatch(
                  [
                    {
                      op: "setMeta",
                      patch: {
                        dubTitles: {
                          ...plan.meta.dubTitles,
                          [lang]: event.target.value,
                        },
                      },
                    },
                  ],
                  `Judul ${lang}`,
                )
              }
            />
          </label>
        </>
      ) : null}

      {pesan ? <p className="hint">{pesan}</p> : null}
    </div>
  );
};
