import { ChatPanel } from "./panels/ChatPanel";
import { PreviewPanel } from "./panels/PreviewPanel";
import { ScenesPanel } from "./panels/ScenesPanel";
import { studioClient, useStudio } from "./use-studio";

/**
 * Kerangka 3 panel (PRD §8.1): Chat — Preview — Timeline/Inspector.
 * Header membawa aksi global: undo/redo, generate, render, biaya proyek.
 */

const formatUsd = (value: number): string => `$${value.toFixed(value < 0.1 ? 4 : 2)}`;

const Header: React.FC = () => {
  const state = useStudio();
  const project = state.project;
  const plan = project?.plan ?? null;
  const busyLabel = project?.busy.mutation
    ? `sedang bekerja: ${project.busy.mutation}`
    : project?.busy.render
      ? `merender ${project.busy.render}`
      : null;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">Dalang</span>
        <span className="brand-sub">Studio</span>
        {plan ? <span className="project-title">{plan.meta.title}</span> : null}
        {busyLabel ? <span className="busy-chip">{busyLabel}</span> : null}
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="ghost"
          disabled={!project?.patchLog.canUndo}
          onClick={() => void studioClient.undo()}
          title="Undo perubahan terakhir"
        >
          Undo
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!project?.patchLog.canRedo}
          onClick={() => void studioClient.redo()}
          title="Redo"
        >
          Redo
        </button>
        <span className="divider" />
        <button
          type="button"
          className="ghost"
          disabled={!plan || project?.busy.mutation !== null}
          onClick={() => void studioClient.runTts()}
          title={
            project?.ttsEstimate
              ? `TTS ${project.ttsEstimate.scenes} scene · ${project.ttsEstimate.chars} karakter${project.ttsEstimate.usd ? ` · ~${formatUsd(project.ttsEstimate.usd)}` : ""}`
              : "Sintesis voiceover semua scene"
          }
        >
          Voiceover
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!plan || project?.busy.mutation !== null}
          onClick={() => void studioClient.runAssets()}
          title="Resolve aset stock yang belum terisi"
        >
          Aset
        </button>
        <span className="divider" />
        <button
          type="button"
          className="ghost"
          disabled={!plan || project?.busy.render !== null}
          onClick={() => void studioClient.startRender("draft")}
          title="Render draft 540p (cepat)"
        >
          Render draft
        </button>
        <button
          type="button"
          className="primary"
          disabled={!plan || project?.busy.render !== null}
          onClick={() => void studioClient.startRender("final")}
          title="Render final 1080p — butuh konfirmasi"
        >
          Render final
        </button>
        {project ? (
          <span className="cost-chip" title="Total biaya tercatat proyek (LLM + TTS)">
            {formatUsd(project.totalCostUsd)}
          </span>
        ) : null}
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
        <h3>Agent minta izin</h3>
        <p>{approval.detail}</p>
        {approval.estimatedUsd !== null ? (
          <p className="dialog-cost">
            Estimasi biaya: ~{formatUsd(approval.estimatedUsd)}
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
          <p className="dialog-cost">
            Estimasi biaya: ~{formatUsd(confirm.estimatedUsd)}
          </p>
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

  if (state.fatal) {
    return (
      <div className="boot-error">
        <h2>Studio tidak bisa memuat proyek</h2>
        <p>{state.fatal}</p>
        <p>Pastikan server berjalan: `pnpm dalang studio &lt;folder-proyek&gt;`</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <Header />
      <main className="panels">
        <ChatPanel />
        <PreviewPanel />
        <ScenesPanel />
      </main>
      <ApprovalDialog />
      <ConfirmDialog />
      {state.toast ? <div className="toast">{state.toast}</div> : null}
    </div>
  );
};
