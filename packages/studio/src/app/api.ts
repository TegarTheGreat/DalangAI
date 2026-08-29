import type { PatchOpInput } from "@dalang/core";
import type {
  ChatStreamEvent,
  ProjectStatePayload,
  StockSearchResponse,
  StudioEvent,
} from "../shared/api-types";
import { readSseBody } from "./sse";

/**
 * Klien API tipis. Konvensi error server: JSON { error } dengan status ≠ 2xx;
 * 428 = butuh konfirmasi (payload NeedsConfirmation) — dilempar sebagai
 * ConfirmationRequired agar UI menampilkan dialog estimasi biaya (§8.2).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ConfirmationRequired extends Error {
  constructor(
    readonly detail: string,
    readonly estimatedUsd: number | null,
  ) {
    super(detail);
    this.name = "ConfirmationRequired";
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    headers: init?.body ? { "content-type": "application/json" } : {},
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 428) {
    throw new ConfirmationRequired(
      typeof payload.detail === "string" ? payload.detail : "Aksi butuh konfirmasi",
      typeof payload.estimatedUsd === "number" ? payload.estimatedUsd : null,
    );
  }
  if (!response.ok) {
    const message =
      typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return payload as T;
};

export const api = {
  getProject: () => request<ProjectStatePayload>("/api/project"),

  patch: (ops: PatchOpInput[]) =>
    request<{ ok: true; summary: string }>("/api/patch", {
      method: "POST",
      body: JSON.stringify({ ops }),
    }),

  undo: () =>
    request<{ ok: true; summary: string | null }>("/api/undo", { method: "POST" }),
  redo: () =>
    request<{ ok: true; summary: string | null }>("/api/redo", { method: "POST" }),

  runTts: (sceneIds: string[] | undefined, confirm: boolean) =>
    request<{ ok: true }>("/api/pipeline/tts", {
      method: "POST",
      body: JSON.stringify({ sceneIds, confirm }),
    }),

  runAssets: (sceneIds: string[] | undefined, confirm: boolean) =>
    request<{ ok: true }>("/api/pipeline/assets", {
      method: "POST",
      body: JSON.stringify({ sceneIds, confirm }),
    }),

  render: (profile: "draft" | "final", confirm: boolean) =>
    request<{ ok: true; started: true }>("/api/render", {
      method: "POST",
      body: JSON.stringify({ profile, confirm }),
    }),

  stockSearch: (query: string, kind: "video" | "image") =>
    request<StockSearchResponse>(
      `/api/stock/search?query=${encodeURIComponent(query)}&kind=${kind}`,
    ),

  stockPick: (sceneId: string, query: string, index: number) =>
    request<{ ok: true; file: string; summary: string }>("/api/stock/pick", {
      method: "POST",
      body: JSON.stringify({ sceneId, query, index }),
    }),

  answerApproval: (id: string, approved: boolean) =>
    request<{ ok: true }>(`/api/approvals/${id}`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),

  /** Satu giliran chat; event stream diteruskan ke onEvent. */
  chat: async (
    text: string,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void> => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(response.status, payload.error ?? `HTTP ${response.status}`);
    }
    await readSseBody(response.body, (raw) => {
      if (raw.event === "ping") return;
      try {
        onEvent(JSON.parse(raw.data) as ChatStreamEvent);
      } catch {
        // data bukan JSON → abaikan
      }
    });
  },

  /** Langganan broadcast antar-panel; kembalikan fungsi stop. */
  subscribeEvents: (onEvent: (event: StudioEvent) => void): (() => void) => {
    const source = new EventSource("/api/events");
    const names: StudioEvent["type"][] = [
      "hello",
      "plan-updated",
      "busy",
      "stage-results",
      "render",
    ];
    for (const name of names) {
      source.addEventListener(name, (message) => {
        try {
          onEvent(JSON.parse((message as MessageEvent).data) as StudioEvent);
        } catch {
          // abaikan frame rusak
        }
      });
    }
    return () => source.close();
  },
};
