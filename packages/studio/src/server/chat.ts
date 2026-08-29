import { runAgentTurn } from "@dalang/agent";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ChatStreamEvent, ChatTurnResultLite } from "../shared/api-types";
import type { StudioContext } from "./context";
import { StudioBusyError } from "./store";

/**
 * POST /api/chat — satu giliran agent per request, hasilnya di-stream SSE:
 *   activity          baris aktivitas tool live
 *   approval-request  gate §6.3 minta izin → dijawab POST /api/approvals/:id
 *   done              hasil giliran + kartu diff (patch giliran ini)
 *
 * Panel lain ikut hidup: setiap kali plan berubah di tengah giliran (tool
 * applyPatch dsb.), broadcast `plan-updated` dipancarkan seketika — bukan
 * menunggu giliran selesai (NFR: patch → preview < 1 dtk).
 *
 * Stream terputus = semua approval menggantung DITOLAK (deny-by-default);
 * giliran tetap diselesaikan server-side agar state konsisten.
 */

const chatBody = z.object({ text: z.string().min(1) });
const approvalBody = z.object({ approved: z.boolean() });

export const registerChatRoutes = (app: Hono, ctx: StudioContext): void => {
  const { store, deps, approvals } = ctx;

  app.post("/api/approvals/:id", async (c) => {
    const body = approvalBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "Body tidak valid: butuh { approved: boolean }" }, 400);
    }
    const known = approvals.answer(c.req.param("id"), body.data.approved);
    if (!known) {
      return c.json({ error: "Permintaan approval tidak dikenal (kedaluwarsa?)" }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/api/chat", async (c) => {
    const body = chatBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "Body tidak valid: butuh { text: string }" }, 400);
    }
    const orchestrator = deps.orchestrator;
    if (!orchestrator) {
      return c.json(
        {
          error:
            deps.chatDisabledReason ?? "Chat nonaktif: model orkestrator tidak tersedia",
        },
        503,
      );
    }
    if (store.busy.mutation) {
      return c.json({ error: new StudioBusyError(store.busy.mutation).message }, 409);
    }

    return streamSSE(c, async (stream) => {
      const send = (event: ChatStreamEvent) =>
        stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      stream.onAbort(() => {
        approvals.denyAll();
      });

      try {
        const result = await store.runExclusive("chat", async () => {
          const session = store.session;
          const seqBefore = session.patchLog.recent(1).map((entry) => entry.seq)[0] ?? 0;
          let lastPlanRef = session.plan;
          const planPulse = () => {
            if (session.plan !== lastPlanRef) {
              lastPlanRef = session.plan;
              store.notifyPlan("patch-agent");
            }
          };

          ctx.setChatBridge({
            onActivity: (line) => {
              planPulse();
              void send({ type: "activity", line });
            },
            onApproval: async (request) => {
              const { id, promise } = approvals.create();
              await send({
                type: "approval-request",
                id,
                action: request.action,
                detail: request.detail,
                estimatedUsd: request.estimatedUsd ?? null,
              });
              const approved = await promise;
              await send({ type: "approval-resolved", id, approved });
              return approved;
            },
          });

          try {
            const turn = await runAgentTurn({
              session,
              deps: ctx.agentDeps,
              model: orchestrator,
              userText: body.data.text,
            });
            planPulse();
            const patches = store
              .patchLogLite(20)
              .filter((entry) => entry.seq > seqBefore);
            const lite: ChatTurnResultLite = {
              text: turn.text,
              stop: turn.stop,
              steps: turn.steps,
              llmCostUsd: turn.llmCostUsd,
              toolCostUsd: turn.toolCostUsd,
              costIsPartial: turn.costIsPartial,
              patches,
            };
            return lite;
          } finally {
            ctx.setChatBridge(null);
          }
        });
        await send({ type: "done", result });
      } catch (error) {
        await send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        approvals.denyAll();
      }
    });
  });
};
