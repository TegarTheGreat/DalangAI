import { ASPECT_RATIOS } from "@dalang/core";
import { FONT_CHOICES } from "@dalang/templates/fonts";
import { BUNDLED_MUSIC, MUSIC_LIBRARY_PREFIX } from "@dalang/templates/music";
import { useEffect, useState } from "react";
import type { ExportSettingsLite } from "../shared/api-types";
import { RadioCard, Segmented, useEscape } from "./components/controls";
import {
  IconChat,
  IconCheck,
  IconExport,
  IconImage,
  IconMic,
  IconPalette,
  IconRedo,
  IconSliders,
  IconSpinner,
  IconUndo,
} from "./icons";
import { ChatPanel } from "./panels/ChatPanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { PreviewPanel } from "./panels/PreviewPanel";
import { TimelineStrip } from "./panels/TimelineStrip";
import { playback } from "./playback";
import { uiStore, useUi } from "./ui-state";
import { studioClient, useStudio } from "./use-studio";

/**
 * Tata letak kelas editor video (pola CapCut/Premiere): header aksi global,
 * chat kiri (bisa dilipat), panggung preview di tengah, panel properti kanan,
 * timeline horizontal di dasar. Semua panel membaca-menulis satu project
 * state (PRD §8.1).
 */

const formatUsd = (value: number): string =>
  value === 0 ? "$0.00" : `$${value.toFixed(value < 0.1 ? 4 : 2)}`;

const BUSY_LABEL: Record<string, string> = {
  chat: "Agent sedang bekerja",
  tts: "Membuat suara",
  assets: "Mengambil aset",
  pick: "Memasang aset",
};

const RATIO_GLYPH: Record<(typeof ASPECT_RATIOS)[number], string> = {
  "16:9": "r169",
  "9:16": "r916",
  "1:1": "r11",
};

/**
 * Dialog Ekspor (ADR-0014): format kontainer + resolusi + mutu enkode, dengan
 * penjelasan jujur soal waktu/kualitas — pilihan di sini SEKALIGUS
 * konfirmasinya, tanpa dialog kedua.
 */
const EXPORT_FORMATS: ReadonlyArray<{
  id: ExportSettingsLite["format"];
  title: string;
  desc: string;
}> = [
  {
    id: "mp4",
    title: "MP4 · H.264",
    desc: "Kompatibilitas paling luas: media sosial, perpesanan, semua pemutar.",
  },
  {
    id: "webm",
    title: "WebM · VP9",
    desc: "Lebih kecil untuk web modern; pemutar lama mungkin tidak mendukung.",
  },
  {
    id: "mov",
    title: "MOV · ProRes",
    desc: "Master untuk edit lanjut di NLE — nyaris tanpa kompresi, file besar.",
  },
];

const RESOLUTIONS = [540, 720, 1080] as const;
const QUALITIES = ["cepat", "seimbang", "terbaik"] as const;
const QUALITY_LABEL: Record<(typeof QUALITIES)[number], string> = {
  cepat: "Cepat",
  seimbang: "Seimbang",
  terbaik: "Terbaik",
};
const QUALITY_HINT: Record<
  ExportSettingsLite["format"],
  Record<(typeof QUALITIES)[number], string>
> = {
  mp4: {
    cepat: "CRF 23 · preset veryfast — pratinjau kilat.",
    seimbang: "CRF 18 · preset medium · audio 192k — pilihan rilis.",
    terbaik: "CRF 15 · preset slow · audio 192k — detail maksimal, paling lama.",
  },
  webm: {
    cepat: "VP9 CRF 36 — kecil dan cepat.",
    seimbang: "VP9 CRF 32 · Opus — rilis web.",
    terbaik: "VP9 CRF 28 — detail maksimal, enkode lama.",
  },
  mov: {
    cepat: "ProRes Proxy — ringan untuk offline edit.",
    seimbang: "ProRes 422 — standar pertukaran NLE.",
    terbaik: "ProRes 422 HQ · audio PCM — master arsip.",
  },
};

const ExportDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const { project } = useStudio();
  const [format, setFormat] = useState<ExportSettingsLite["format"]>("mp4");
  const [resolution, setResolution] = useState<ExportSettingsLite["resolution"]>(1080);
  const [quality, setQuality] = useState<ExportSettingsLite["quality"]>("seimbang");
  useEscape(open, onClose);

  if (!open) return null;
  const busy = project?.busy.render !== null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog export-dialog">
        <h3>Ekspor video</h3>
        <p>Render berjalan lokal di mesin ini (CPU) dan hasilnya masuk riwayat render.</p>
        <div className="radio-stack">
          {EXPORT_FORMATS.map((option) => (
            <RadioCard
              key={option.id}
              active={format === option.id}
              title={option.title}
              desc={option.desc}
              onSelect={() => setFormat(option.id)}
            />
          ))}
        </div>
        <div className="export-fields">
          <div className="field">
            <span>Resolusi</span>
            <Segmented
              grow
              options={RESOLUTIONS}
              value={resolution}
              label={(r) => `${r}p`}
              onChange={setResolution}
            />
          </div>
          <div className="field">
            <span>Mutu enkode</span>
            <Segmented
              grow
              options={QUALITIES}
              value={quality}
              label={(q) => QUALITY_LABEL[q]}
              onChange={setQuality}
            />
          </div>
        </div>
        <p className="export-hint">{QUALITY_HINT[format][quality]}</p>
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              onClose();
              void studioClient.startExportConfirmed({ format, resolution, quality });
            }}
          >
            Mulai ekspor
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Dialog Gaya proyek (ADR-0013): identitas visual global lewat setMeta —
 * preset gaya, warna aksen/dasar, dan font ter-bundle. Semua patch user
 * biasa: tercatat, bisa di-undo, terlihat agent.
 */
const STYLE_PRESETS = ["documentary-01", "tutorial-01"] as const;

const StyleDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const { project } = useStudio();
  const plan = project?.plan ?? null;
  const [stylePreset, setStylePreset] = useState<string>("documentary-01");
  const [accent, setAccent] = useState("#e4a64c");
  const [primary, setPrimary] = useState("#0b0e17");
  const [fontDisplay, setFontDisplay] = useState("");
  const [fontBody, setFontBody] = useState("");
  const [music, setMusic] = useState("");
  useEscape(open, onClose);

  useEffect(() => {
    if (!open || !plan) return;
    const tokens = plan.meta.tokens ?? {};
    setStylePreset(plan.meta.stylePreset);
    setAccent(
      tokens.accent ?? (plan.meta.stylePreset === "tutorial-01" ? "#2e5fd7" : "#e4a64c"),
    );
    setPrimary(
      tokens.primary ?? (plan.meta.stylePreset === "tutorial-01" ? "#f4f2ec" : "#0b0e17"),
    );
    setFontDisplay(tokens.fontDisplay ?? "");
    setFontBody(tokens.fontBody ?? "");
    const assetId = plan.audio.music?.assetId ?? "";
    setMusic(
      assetId.startsWith(MUSIC_LIBRARY_PREFIX)
        ? assetId.slice(MUSIC_LIBRARY_PREFIX.length)
        : "",
    );
  }, [open, plan]);

  if (!open || !plan) return null;

  const save = () => {
    onClose();
    void studioClient.applyPatch(
      [
        {
          op: "setMeta",
          patch: {
            stylePreset,
            tokens: {
              accent,
              primary,
              ...(fontDisplay ? { fontDisplay } : {}),
              ...(fontBody ? { fontBody } : {}),
            },
          },
        },
        {
          op: "setAudio",
          patch: {
            music: music
              ? {
                  assetId: `${MUSIC_LIBRARY_PREFIX}${music}`,
                  volume: 0.15,
                  ducking: true,
                }
              : null,
          },
        },
      ],
      "Gaya proyek diperbarui",
    );
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog brief-dialog">
        <h3>Gaya proyek</h3>
        <p>
          Identitas visual global — berlaku ke preview dan render, dan terlihat agent.
        </p>
        <div className="brief-form">
          <div className="field">
            <span>Preset gaya</span>
            <Segmented
              grow
              options={STYLE_PRESETS}
              value={
                (STYLE_PRESETS as readonly string[]).includes(stylePreset)
                  ? (stylePreset as (typeof STYLE_PRESETS)[number])
                  : "documentary-01"
              }
              label={(preset) =>
                preset === "tutorial-01" ? "Tutorial (terang)" : "Dokumenter (gelap)"
              }
              onChange={setStylePreset}
            />
          </div>
          <div className="field-row">
            <label className="field">
              <span>Warna aksen</span>
              <input
                type="color"
                value={accent}
                onChange={(event) => setAccent(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Warna dasar</span>
              <input
                type="color"
                value={primary}
                onChange={(event) => setPrimary(event.target.value)}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Font display</span>
              <select
                value={fontDisplay}
                onChange={(event) => setFontDisplay(event.target.value)}
              >
                <option value="">Bawaan preset</option>
                {FONT_CHOICES.map((choice) => (
                  <option key={choice.family} value={choice.family}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Font body</span>
              <select
                value={fontBody}
                onChange={(event) => setFontBody(event.target.value)}
              >
                <option value="">Bawaan preset</option>
                {FONT_CHOICES.map((choice) => (
                  <option key={choice.family} value={choice.family}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <span>Musik latar</span>
            <Segmented
              grow
              options={["", ...BUNDLED_MUSIC.map((m) => m.id)]}
              value={music}
              label={(id) =>
                id === ""
                  ? "Tanpa"
                  : (BUNDLED_MUSIC.find((m) => m.id === id)?.label.split(" (")[0] ?? id)
              }
              onChange={setMusic}
            />
            <p className="field-hint">
              Bed CC0 di-loop, volume rendah, otomatis mengecil di bawah narasi (ducking).
              Bisa di-undo seperti patch lain.
            </p>
          </div>
          <div className="brief-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                onClose();
                void studioClient.applyPatch(
                  [{ op: "setMeta", patch: { tokens: null } }],
                  "Gaya kembali ke bawaan preset",
                );
              }}
            >
              Reset token
            </button>
            <button type="button" className="primary" onClick={save}>
              Terapkan gaya
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Header: React.FC = () => {
  const { project, connected } = useStudio();
  const { chatOpen, inspectorOpen } = useUi();
  const [exportOpen, setExportOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const plan = project?.plan ?? null;
  const busyLabel = project?.busy.mutation
    ? `${BUSY_LABEL[project.busy.mutation] ?? "Memproses"}…`
    : project?.busy.render
      ? `Merender ${project.busy.render}…`
      : null;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="brand-mark">Dalang</span>
        <span className="brand-sub">Studio</span>
        {plan ? <span className="project-title">{plan.meta.title}</span> : null}
        {plan ? (
          <div
            className="segmented ratio-switch"
            data-tip="Rasio video"
            data-tip-bottom=""
          >
            {ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={plan.meta.aspectRatio === ratio ? "seg active" : "seg"}
                disabled={project?.busy.mutation !== null}
                onClick={() =>
                  void studioClient.applyPatch(
                    [{ op: "setMeta", patch: { aspectRatio: ratio } }],
                    `Rasio ${ratio}`,
                  )
                }
              >
                <span className={`ratio-glyph ${RATIO_GLYPH[ratio]}`} aria-hidden />
                {ratio}
              </button>
            ))}
          </div>
        ) : null}
        {busyLabel ? (
          <span className="busy-chip">
            <IconSpinner />
            {busyLabel}
          </span>
        ) : null}
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className={chatOpen ? "tool active" : "tool"}
          onClick={() => uiStore.toggleChat()}
          data-tip="Buka/tutup panel chat"
          data-tip-bottom=""
        >
          <IconChat />
          <span>Chat</span>
        </button>
        <button
          type="button"
          className={inspectorOpen ? "tool active" : "tool"}
          onClick={() => uiStore.toggleInspector()}
          data-tip="Buka/tutup panel properti"
          data-tip-bottom=""
        >
          <IconSliders />
          <span>Properti</span>
        </button>
        <button
          type="button"
          className="tool"
          disabled={!plan}
          onClick={() => setStyleOpen(true)}
          data-tip="Gaya proyek: preset, warna, font"
          data-tip-bottom=""
        >
          <IconPalette />
          <span>Gaya</span>
        </button>
        <span className="divider" />
        <button
          type="button"
          className="tool"
          disabled={!project?.patchLog.canUndo}
          onClick={() => void studioClient.undo()}
          data-tip="Batalkan perubahan terakhir"
          data-tip-bottom=""
        >
          <IconUndo />
          <span>Undo</span>
        </button>
        <button
          type="button"
          className="tool"
          disabled={!project?.patchLog.canRedo}
          onClick={() => void studioClient.redo()}
          data-tip="Ulangi perubahan"
          data-tip-bottom=""
        >
          <IconRedo />
          <span>Redo</span>
        </button>
        <span className="divider" />
        <button
          type="button"
          className="tool"
          disabled={!plan || project?.busy.mutation !== null}
          onClick={() => void studioClient.runTts()}
          data-tip={
            project?.ttsEstimate
              ? `Buat suara ${project.ttsEstimate.scenes} scene (${project.ttsEstimate.chars} karakter)${project.ttsEstimate.usd ? ` | ~${formatUsd(project.ttsEstimate.usd)}` : ""}`
              : "Sintesis voiceover semua scene"
          }
          data-tip-bottom=""
        >
          <IconMic />
          <span>Suara</span>
        </button>
        <button
          type="button"
          className="tool"
          disabled={!plan || project?.busy.mutation !== null}
          onClick={() => void studioClient.runAssets()}
          data-tip="Isi otomatis aset stock yang masih kosong"
          data-tip-bottom=""
        >
          <IconImage />
          <span>Aset</span>
        </button>
        <span className="divider" />
        {project ? (
          connected ? (
            <span
              className="save-chip"
              data-tip="Realtime & autosave: tiap perubahan langsung tersimpan ke plan.json dan disiarkan ke semua panel/tab"
              data-tip-bottom=""
            >
              <IconCheck />
              Tersimpan
            </span>
          ) : (
            <span className="save-chip off">
              <IconSpinner />
              Menyambung…
            </span>
          )
        ) : null}
        {project ? (
          <span
            className="cost-chip"
            data-tip="Total biaya tercatat proyek (LLM + TTS)"
            data-tip-bottom=""
          >
            {formatUsd(project.totalCostUsd)}
          </span>
        ) : null}
        <button
          type="button"
          className="primary with-icon"
          disabled={!plan || project?.busy.render !== null}
          onClick={() => setExportOpen(true)}
          data-tip="Render video (pilih Draft/Final)"
          data-tip-bottom=""
        >
          <IconExport />
          Ekspor
        </button>
      </div>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <StyleDialog open={styleOpen} onClose={() => setStyleOpen(false)} />
    </header>
  );
};

const ApprovalDialog: React.FC = () => {
  const { approval } = useStudio();
  if (!approval) return null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Agent meminta izin</h3>
        <p>{approval.detail}</p>
        {approval.estimatedUsd !== null ? (
          <p className="dialog-cost">
            Estimasi biaya ~{formatUsd(approval.estimatedUsd)}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => void studioClient.answerApproval(false)}
          >
            Tolak
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void studioClient.answerApproval(true)}
          >
            Setujui
          </button>
        </div>
      </div>
    </div>
  );
};

const ConfirmDialog: React.FC = () => {
  const { confirm } = useStudio();
  if (!confirm) return null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Konfirmasi aksi</h3>
        <p>{confirm.detail}</p>
        {confirm.estimatedUsd !== null ? (
          <p className="dialog-cost">Estimasi biaya ~{formatUsd(confirm.estimatedUsd)}</p>
        ) : null}
        <div className="dialog-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => studioClient.dismissConfirm()}
          >
            Batal
          </button>
          <button type="button" className="primary" onClick={() => confirm.proceed()}>
            Lanjutkan
          </button>
        </div>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const state = useStudio();
  const { chatOpen, inspectorOpen } = useUi();

  // Pintasan editor: Spasi = putar/jeda, selama fokus tidak di kontrol input.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " ") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        (target?.isContentEditable ?? false)
      ) {
        return;
      }
      event.preventDefault();
      playback.requestToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (state.fatal) {
    return (
      <div className="boot-error">
        <h2>Studio tidak bisa memuat proyek</h2>
        <p>{state.fatal}</p>
        <p>Pastikan server berjalan: pnpm dalang studio &lt;folder-proyek&gt;</p>
      </div>
    );
  }

  const shellClass = [
    "shell",
    chatOpen ? "chat-open" : "chat-closed",
    inspectorOpen ? "inspector-open" : "inspector-closed",
  ].join(" ");

  return (
    <div className={shellClass}>
      <Header />
      <main className="workspace">
        <ChatPanel />
        <PreviewPanel />
        <InspectorPanel />
      </main>
      <TimelineStrip />
      <ApprovalDialog />
      <ConfirmDialog />
      {state.toast ? <div className="toast">{state.toast}</div> : null}
    </div>
  );
};
