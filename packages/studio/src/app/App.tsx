import { ASPECT_RATIOS } from "@dalang/core";
import { useEffect, useState } from "react";
import { RadioCard } from "./components/controls";
import {
  IconChat,
  IconExport,
  IconImage,
  IconMic,
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

const formatUsd = (value: number): string => `$${value.toFixed(value < 0.1 ? 4 : 2)}`;

const BUSY_LABEL: Record<string, string> = {
  chat: "Agent sedang bekerja",
  tts: "Membuat suara",
  assets: "Mengambil aset",
  pick: "Memasang aset",
};

/**
 * Dialog Ekspor beropsi (pola editor umum): pilih profil render dengan
 * penjelasan jujur soal waktu/kualitas — pilihan di sini SEKALIGUS
 * konfirmasinya, tanpa dialog kedua.
 */
const ExportDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const { project } = useStudio();
  const [profile, setProfile] = useState<"draft" | "final">("draft");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const busy = project?.busy.render !== null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog export-dialog">
        <h3>Ekspor video</h3>
        <p>Render berjalan lokal di mesin ini (CPU) dan hasilnya masuk riwayat render.</p>
        <div className="radio-stack">
          <RadioCard
            active={profile === "draft"}
            title="Draft — 540p"
            desc="Cepat (kira-kira 1–2 menit), bitrate rendah. Untuk memeriksa alur, timing, dan aset."
            onSelect={() => setProfile("draft")}
          />
          <RadioCard
            active={profile === "final"}
            title="Final — 1080p"
            desc="Kualitas penuh, butuh beberapa menit. Pastikan suara dan aset sudah beres."
            onSelect={() => setProfile("final")}
          />
        </div>
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
              void studioClient.startRenderConfirmed(profile);
            }}
          >
            Mulai render
          </button>
        </div>
      </div>
    </div>
  );
};

const Header: React.FC = () => {
  const { project } = useStudio();
  const { chatOpen, inspectorOpen } = useUi();
  const [exportOpen, setExportOpen] = useState(false);
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
