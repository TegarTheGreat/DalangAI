import { ASPECT_RATIOS } from "@dalang/core";
import {
  IconChat,
  IconExport,
  IconImage,
  IconMic,
  IconPlay,
  IconRedo,
  IconSliders,
  IconSpinner,
  IconUndo,
} from "./icons";
import { ChatPanel } from "./panels/ChatPanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { PreviewPanel } from "./panels/PreviewPanel";
import { TimelineStrip } from "./panels/TimelineStrip";
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

const Header: React.FC = () => {
  const { project } = useStudio();
  const { chatOpen, inspectorOpen } = useUi();
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
          <div className="segmented ratio-switch" title="Rasio video">
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
          title="Buka/tutup panel chat"
        >
          <IconChat />
          <span>Chat</span>
        </button>
        <button
          type="button"
          className={inspectorOpen ? "tool active" : "tool"}
          onClick={() => uiStore.toggleInspector()}
          title="Buka/tutup panel properti"
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
          title="Batalkan perubahan terakhir"
        >
          <IconUndo />
          <span>Undo</span>
        </button>
        <button
          type="button"
          className="tool"
          disabled={!project?.patchLog.canRedo}
          onClick={() => void studioClient.redo()}
          title="Ulangi perubahan"
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
          title={
            project?.ttsEstimate
              ? `Buat suara ${project.ttsEstimate.scenes} scene (${project.ttsEstimate.chars} karakter)${project.ttsEstimate.usd ? ` | ~${formatUsd(project.ttsEstimate.usd)}` : ""}`
              : "Sintesis voiceover semua scene"
          }
        >
          <IconMic />
          <span>Suara</span>
        </button>
        <button
          type="button"
          className="tool"
          disabled={!plan || project?.busy.mutation !== null}
          onClick={() => void studioClient.runAssets()}
          title="Isi otomatis aset stock yang masih kosong"
        >
          <IconImage />
          <span>Aset</span>
        </button>
        <span className="divider" />
        {project ? (
          <span className="cost-chip" title="Total biaya tercatat proyek (LLM + TTS)">
            {formatUsd(project.totalCostUsd)}
          </span>
        ) : null}
        <button
          type="button"
          className="secondary with-icon"
          disabled={!plan || project?.busy.render !== null}
          onClick={() => void studioClient.startRender("draft")}
          title="Render cepat 540p untuk dicek"
        >
          <IconPlay />
          Draft
        </button>
        <button
          type="button"
          className="primary with-icon"
          disabled={!plan || project?.busy.render !== null}
          onClick={() => void studioClient.startRender("final")}
          title="Render final 1080p (butuh konfirmasi)"
        >
          <IconExport />
          Ekspor
        </button>
      </div>
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
