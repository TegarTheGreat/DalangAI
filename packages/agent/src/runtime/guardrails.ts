import { type StopCondition, stepCountIs, type ToolSet } from "ai";
import { estimateLlmCostUsd, type ModelInfo } from "../models/registry";

/**
 * Guardrails §6.3 — ditegakkan di level kode, bukan prompt:
 *  - Step cap: maksimum tool call per giliran chat (default 15).
 *  - Budget per giliran: loop berhenti saat estimasi biaya LLM melewati cap.
 *  - Approval gate: aksi mahal (renderFinal, TTS massal) butuh konfirmasi
 *    eksplisit lewat callback yang di-inject (CLI: prompt y/t; non-interaktif:
 *    default MENOLAK — tidak pernah menyetujui diam-diam).
 *  - Budget proyek: total biaya tercatat (ledger + sesi) dibandingkan cap.
 */

export interface GuardrailConfig {
  /** Maksimum tool call per giliran (PRD default 15). */
  stepCap: number;
  /** Estimasi biaya LLM maksimum per giliran (USD). */
  turnBudgetUsd: number;
  /** Ambang biaya aksi tool yang memicu approval gate (USD). */
  approvalGateUsd: number;
  /** TTS untuk lebih dari N scene sekaligus = "massal" → approval. */
  ttsSceneGate: number;
  /** Budget keras per proyek (USD) — PRD §13. */
  projectBudgetUsd: number;
  /**
   * Batas tinjauan render per giliran (ADR-0022).
   *
   * Loop "render -> lihat -> perbaiki -> render lagi" adalah pola yang paling
   * mudah berputar tanpa ujung: tiap putaran memberi model gambar baru untuk
   * dikomentari, dan selalu ada yang bisa dikomentari. Step cap saja tidak
   * cukup karena satu putaran memakai beberapa step. Batas ini yang membuat
   * putarannya berhingga.
   */
  reviewRenderCap: number;
}

export const DEFAULT_GUARDRAILS: GuardrailConfig = {
  stepCap: 15,
  turnBudgetUsd: 0.5,
  approvalGateUsd: 0.1,
  ttsSceneGate: 5,
  projectBudgetUsd: 5,
  reviewRenderCap: 3,
};

/**
 * Konfirmasi user untuk aksi mahal. Implementasi CLI bertanya interaktif;
 * mode non-interaktif WAJIB mengembalikan false (deny-by-default).
 */
export type ApprovalFn = (request: {
  action:
    | "renderFinal"
    | "tts-massal"
    | "transkripsi"
    | "tinjauan-render"
    | "budget-proyek"
    | "publishVideo";
  detail: string;
  estimatedUsd?: number;
}) => Promise<boolean>;

export const denyAllApprovals: ApprovalFn = () => Promise.resolve(false);

export type TurnStopReason = "selesai" | "step-cap" | "budget-giliran";

export class Guardrails {
  readonly config: GuardrailConfig;
  readonly approve: ApprovalFn;
  private llmCostTurnUsd = 0;
  private llmCostUnknown = false;
  private toolCostTurnUsd = 0;
  private sessionCostUsd = 0;
  private reviewRendersThisTurn = 0;

  constructor(
    config: Partial<GuardrailConfig> = {},
    approve: ApprovalFn = denyAllApprovals,
  ) {
    this.config = { ...DEFAULT_GUARDRAILS, ...config };
    this.approve = approve;
  }

  beginTurn(): void {
    this.llmCostTurnUsd = 0;
    this.toolCostTurnUsd = 0;
    this.llmCostUnknown = false;
    this.reviewRendersThisTurn = 0;
  }

  /**
   * Klaim satu jatah tinjauan render (ADR-0022). `false` = jatah giliran ini
   * habis; pemanggilnya harus BERHENTI meninjau, bukan mencoba lagi.
   */
  claimReviewRender(): boolean {
    if (this.reviewRendersThisTurn >= this.config.reviewRenderCap) return false;
    this.reviewRendersThisTurn += 1;
    return true;
  }

  get reviewRendersLeft(): number {
    return Math.max(0, this.config.reviewRenderCap - this.reviewRendersThisTurn);
  }

  addLlmUsage(
    info: ModelInfo | undefined,
    usage: { inputTokens?: number; outputTokens?: number },
  ): void {
    const cost = estimateLlmCostUsd(info, usage);
    if (cost === null) {
      this.llmCostUnknown = true;
      return;
    }
    this.llmCostTurnUsd += cost;
    this.sessionCostUsd += cost;
  }

  addToolCost(costUsd: number): void {
    this.toolCostTurnUsd += costUsd;
    this.sessionCostUsd += costUsd;
  }

  get turnCostUsd(): number {
    return this.llmCostTurnUsd + this.toolCostTurnUsd;
  }

  get llmCostTurn(): number {
    return this.llmCostTurnUsd;
  }

  get toolCostTurn(): number {
    return this.toolCostTurnUsd;
  }

  get turnCostIsPartial(): boolean {
    return this.llmCostUnknown;
  }

  get sessionTotalUsd(): number {
    return this.sessionCostUsd;
  }

  turnBudgetExceeded(): boolean {
    return this.turnCostUsd >= this.config.turnBudgetUsd;
  }

  /**
   * Kondisi berhenti untuk generateText: step cap + budget giliran.
   * Biaya LLM diakumulasi via addLlmUsage (dipanggil onStepFinish) sehingga
   * kondisi budget membaca angka yang sudah termutakhirkan.
   */
  stopConditions<TOOLS extends ToolSet>(): Array<StopCondition<TOOLS, never>> {
    return [stepCountIs(this.config.stepCap), () => this.turnBudgetExceeded()];
  }

  classifyStop(stepsUsed: number): TurnStopReason {
    if (this.turnBudgetExceeded()) return "budget-giliran";
    if (stepsUsed >= this.config.stepCap) return "step-cap";
    return "selesai";
  }

  /** Gate budget proyek: total tercatat + sesi vs cap; di atas → approval. */
  async ensureProjectBudget(
    ledgerTotalUsd: number,
    nextActionUsd: number,
    detail: string,
  ): Promise<boolean> {
    const projected = ledgerTotalUsd + this.sessionCostUsd + nextActionUsd;
    if (projected <= this.config.projectBudgetUsd) return true;
    return this.approve({
      action: "budget-proyek",
      detail: `${detail} — proyeksi total proyek ~$${projected.toFixed(2)} melebihi budget $${this.config.projectBudgetUsd.toFixed(2)}`,
      estimatedUsd: nextActionUsd,
    });
  }
}
