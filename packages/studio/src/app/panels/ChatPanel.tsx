import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../store";
import { studioClient, useStudio } from "../use-studio";

/**
 * Panel kiri: chat dengan agent. Setiap giliran yang mengubah plan
 * menampilkan kartu diff ringkas + tombol Undo (PRD §8.2); aktivitas tool
 * mengalir live; biaya giliran ditampilkan jujur (null = "tak diketahui",
 * tidak pernah dipalsukan nol).
 */

const costLine = (message: ChatMessage): string | null => {
  const result = message.result;
  if (!result) return null;
  const llm =
    result.llmCostUsd === null
      ? "LLM: harga tak diketahui"
      : `LLM ~$${result.llmCostUsd.toFixed(4)}`;
  const tool = result.toolCostUsd > 0 ? ` · tool ~$${result.toolCostUsd.toFixed(4)}` : "";
  const stop = result.stop !== "selesai" ? ` · berhenti: ${result.stop}` : "";
  return `${result.steps} langkah · ${llm}${tool}${result.costIsPartial ? " (parsial)" : ""}${stop}`;
};

const Bubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const cost = costLine(message);
  const patches = message.result?.patches ?? [];
  return (
    <div className={`bubble ${message.role}`}>
      {message.activities.length > 0 ? (
        <div className="activities">
          {message.activities.map((activity) => (
            <div key={activity.id}>{activity.line}</div>
          ))}
        </div>
      ) : null}
      {message.pending && message.text === "" ? (
        <div className="thinking">berpikir…</div>
      ) : (
        <div className="bubble-text">{message.text}</div>
      )}
      {patches.length > 0 ? (
        <div className="diff-card">
          <div className="diff-head">
            <span>Perubahan giliran ini</span>
            <button
              type="button"
              className="mini"
              onClick={() => void studioClient.undo()}
              title="Batalkan perubahan terakhir"
            >
              Undo
            </button>
          </div>
          {patches.map((patch) => (
            <div key={patch.seq} className="diff-row">
              <span className={`origin ${patch.origin}`}>{patch.origin}</span>
              <span>{patch.summary.replace(/^(user|agent): /, "")}</span>
            </div>
          ))}
        </div>
      ) : null}
      {cost ? <div className="cost-line">{cost}</div> : null}
    </div>
  );
};

export const ChatPanel: React.FC = () => {
  const { chat, chatBusy, project } = useStudio();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatDisabled = project?.models.chatDisabled ?? null;

  // Tanpa daftar dependensi: gulir ke bawah setiap render (panel kecil, murah).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const send = () => {
    const text = draft.trim();
    if (text === "" || chatBusy) return;
    setDraft("");
    void studioClient.sendChat(text);
  };

  return (
    <section className="panel chat-panel">
      <div className="panel-head">
        <h2>Chat</h2>
        {project ? (
          <span
            className="meta-line"
            title={`registry: ${project.models.registrySource}`}
          >
            {project.models.orchestrator ?? "chat nonaktif"}
          </span>
        ) : null}
      </div>
      {chatDisabled ? (
        <div className="chat-disabled">
          Chat nonaktif: {chatDisabled}. Isi API key di `.env` lalu jalankan ulang — panel
          preview dan timeline tetap berfungsi penuh.
        </div>
      ) : null}
      <div className="chat-scroll" ref={scrollRef}>
        {chat.length === 0 ? (
          <div className="chat-empty">
            {project?.plan
              ? "Minta revisi apa pun — “persingkat scene 2”, “ganti aset scene 4”, “render draft”. Scene terkunci tidak akan disentuh agent."
              : "Proyek kosong. Ceritakan brief videomu (topik, durasi, gaya) dan agent menyusun scene-plan pertama."}
          </div>
        ) : (
          chat.map((message) => <Bubble key={message.id} message={message} />)
        )}
      </div>
      <div className="chat-compose">
        <textarea
          value={draft}
          placeholder={
            chatDisabled
              ? "Chat nonaktif (butuh API key)"
              : chatBusy
                ? "Agent sedang bekerja…"
                : "Tulis pesan untuk agent…"
          }
          disabled={chatBusy || chatDisabled !== null}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={3}
        />
        <button
          type="button"
          className="primary"
          disabled={chatBusy || chatDisabled !== null}
          onClick={send}
        >
          Kirim
        </button>
      </div>
    </section>
  );
};
