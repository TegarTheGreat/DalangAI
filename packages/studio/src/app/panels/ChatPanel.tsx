import { ASPECT_RATIOS } from "@dalang/core";
import { useEffect, useRef, useState } from "react";
import { Segmented, Switch, useEscape } from "../components/controls";
import { IconImage, IconSend, IconSparkles, IconX } from "../icons";
import type { ChatMessage } from "../store";
import { uiStore } from "../ui-state";
import { studioClient, useStudio } from "../use-studio";

/**
 * Panel kiri: chat dengan agent. Setiap giliran yang mengubah plan
 * menampilkan kartu diff ringkas + tombol Undo (PRD §8.2); aktivitas tool
 * mengalir live; biaya giliran ditampilkan jujur (null = "tak diketahui",
 * tidak pernah dipalsukan nol).
 *
 * Proyek kosong dimulai dari KARTU BRIEF inline (form terstruktur) — bukan
 * kolom teks kosong; saat plan sudah ada, form yang sama dibuka sebagai
 * dialog dari toolbar komposer.
 */

/** Aksi rutin sekali-klik — chip mengirim instruksi utuh ke agent. */
const QUICK_ACTIONS: readonly { chip: string; prompt: string }[] = [
  {
    chip: "Buat suara semua scene",
    prompt: "Buat voiceover untuk semua scene yang belum punya suara.",
  },
  {
    chip: "Isi aset kosong",
    prompt: "Isi aset stock untuk semua scene yang asetnya masih kosong.",
  },
  {
    chip: "Rapikan narasi",
    prompt:
      "Rapikan narasi semua scene yang tidak terkunci agar lebih lisan dan mengalir, tanpa mengubah substansinya.",
  },
  { chip: "Render draft", prompt: "Render draft sekarang." },
];

const BRIEF_STYLES = ["dokumenter", "berita", "edukasi", "cerita"] as const;
const BRIEF_DURATIONS = ["30", "60", "90"] as const;
const BRIEF_VOICES = [
  ["auto", "Otomatis — agent memilih"],
  ["silence", "Tanpa suara (senyap)"],
  ["elevenlabs", "ElevenLabs"],
  ["edge", "Edge TTS (gratis)"],
] as const;
const RATIO_GLYPH: Record<(typeof ASPECT_RATIOS)[number], string> = {
  "16:9": "r169",
  "9:16": "r916",
  "1:1": "r11",
};

/**
 * Form brief terstruktur: topik, gaya, suara, durasi, rasio (glyph visual),
 * saklar auto-jalankan — dikompilasi jadi satu instruksi utuh untuk agent.
 * Dipakai dua tempat: kartu pembuka (proyek kosong) dan dialog Brief baru.
 * Saat chat nonaktif form tetap bisa dijelajahi; hanya kirim yang terkunci.
 */
const BriefForm: React.FC<{
  chatDisabled: string | null;
  onDone: () => void;
  onCancel?: () => void;
}> = ({ chatDisabled, onDone, onCancel }) => {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<(typeof BRIEF_STYLES)[number]>("dokumenter");
  const [duration, setDuration] = useState<(typeof BRIEF_DURATIONS)[number]>("60");
  const [ratio, setRatio] = useState<(typeof ASPECT_RATIOS)[number]>("16:9");
  const [voice, setVoice] = useState("auto");
  const [autoRun, setAutoRun] = useState(false);

  const submit = () => {
    const voiceLine =
      voice === "auto"
        ? "Suara: pilih provider TTS yang paling masuk akal untuk proyek ini"
        : voice === "silence"
          ? "Suara: tanpa voiceover (provider silence)"
          : `Suara: pakai provider ${voice}`;
    const lines = [
      "Susun scene-plan baru dari brief ini:",
      `- Topik: ${topic.trim()}`,
      `- Gaya: ${style}`,
      `- Durasi target: sekitar ${duration} detik`,
      `- Rasio: ${ratio}`,
      `- ${voiceLine}`,
      autoRun
        ? "Setelah plan tersimpan, langsung buat voiceover semua scene dan isi aset stock yang kosong."
        : "Cukup susun plan-nya dulu; suara dan aset akan saya jalankan sendiri.",
    ];
    onDone();
    void studioClient.sendChat(lines.join("\n"));
  };

  return (
    <div className="brief-form">
      <label className="field">
        <span>Topik video</span>
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="mis. Sejarah Candi Borobudur"
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Gaya</span>
          <select
            value={style}
            onChange={(event) =>
              setStyle(event.target.value as (typeof BRIEF_STYLES)[number])
            }
          >
            {BRIEF_STYLES.map((option) => (
              <option key={option} value={option}>
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Suara</span>
          <select value={voice} onChange={(event) => setVoice(event.target.value)}>
            {BRIEF_VOICES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <span>Durasi target</span>
        <Segmented
          grow
          options={BRIEF_DURATIONS}
          value={duration}
          label={(option) => `${option} detik`}
          onChange={setDuration}
        />
      </div>
      <div className="field">
        <span>Rasio</span>
        <div className="segmented grow">
          {ASPECT_RATIOS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === ratio ? "seg active" : "seg"}
              onClick={() => setRatio(option)}
            >
              <span className={`ratio-glyph ${RATIO_GLYPH[option]}`} aria-hidden />
              {option}
            </button>
          ))}
        </div>
      </div>
      <Switch
        checked={autoRun}
        onChange={setAutoRun}
        label="Langsung buat suara & isi aset"
      />
      {chatDisabled !== null ? (
        <p className="brief-note">
          Chat nonaktif — isi API key di `.env` untuk mengirim brief. Form ini tetap bisa
          dijelajahi.
        </p>
      ) : null}
      <div className="brief-actions">
        {onCancel ? (
          <button type="button" className="ghost" onClick={onCancel}>
            Batal
          </button>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={topic.trim() === "" || chatDisabled !== null}
          onClick={submit}
        >
          <IconSparkles />
          Susun scene-plan
        </button>
      </div>
    </div>
  );
};

/** Brief ulang di proyek berjalan — dialog terpusat, bukan popover sempit. */
const BriefDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  chatDisabled: string | null;
}> = ({ open, onClose, chatDisabled }) => {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog brief-dialog">
        <h3>Brief baru</h3>
        <p>
          Scene-plan sudah ada — brief baru meminta agent menata ulang. Scene yang
          terkunci tidak akan disentuh.
        </p>
        <BriefForm chatDisabled={chatDisabled} onDone={onClose} onCancel={onClose} />
      </div>
    </div>
  );
};

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
      {message.images.length > 0 ? (
        <div className="bubble-images">
          {message.images.map((src, index) => (
            <img
              key={`${message.id}-img-${index === 0 ? "a" : index === 1 ? "b" : "c"}`}
              src={src}
              alt="lampiran"
            />
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
  const { chat, chatBusy, project, pendingImages } = useStudio();
  const [draft, setDraft] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const plan = project?.plan ?? null;
  const chatDisabled = project?.models.chatDisabled ?? null;
  // Autodeteksi multimodal dari registry: false = model dipastikan non-vision.
  const vision = project?.models.vision ?? null;

  const pickFiles = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") studioClient.attachImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  // Tanpa daftar dependensi: gulir ke bawah setiap render (panel kecil, murah).
  // Hanya saat ada pesan — kartu pembuka harus tampil dari atas.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && chat.length > 0) el.scrollTop = el.scrollHeight;
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
        <button
          type="button"
          className="mini drawer-close"
          onClick={() => uiStore.closeChat()}
        >
          Tutup
        </button>
      </div>
      {chatDisabled ? (
        <div className="chat-disabled">
          Chat nonaktif: {chatDisabled}. Isi API key di `.env` lalu jalankan ulang — panel
          preview dan timeline tetap berfungsi penuh.
        </div>
      ) : null}
      <div className="chat-scroll" ref={scrollRef}>
        {chat.length === 0 ? (
          plan ? (
            <div className="chat-empty">
              Minta revisi apa pun — “persingkat scene 2”, “ganti aset scene 4”, “render
              draft”. Scene terkunci tidak akan disentuh agent.
            </div>
          ) : (
            <div className="starter">
              <div className="starter-head">
                <span className="starter-glyph" aria-hidden>
                  <IconSparkles />
                </span>
                <div className="starter-copy">
                  <h3>Buat video pertamamu</h3>
                  <p>
                    Isi brief singkat — agent menyusun scene-plan yang sepenuhnya bisa
                    kamu edit.
                  </p>
                </div>
              </div>
              <BriefForm chatDisabled={chatDisabled} onDone={() => undefined} />
            </div>
          )
        ) : (
          chat.map((message) => <Bubble key={message.id} message={message} />)
        )}
      </div>
      {plan && chatDisabled === null ? (
        <div className="quick-row">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.chip}
              type="button"
              className="quick-chip"
              disabled={chatBusy}
              onClick={() => void studioClient.sendChat(action.prompt)}
            >
              {action.chip}
            </button>
          ))}
        </div>
      ) : null}
      <div className="composer">
        {pendingImages.length > 0 ? (
          <div className="attach-row">
            {pendingImages.map((src, index) => (
              <span key={src.slice(-24)} className="attach-chip">
                <img src={src} alt="lampiran" />
                <button
                  type="button"
                  className="attach-remove"
                  onClick={() => studioClient.removeImage(index)}
                  data-tip="Hapus lampiran"
                >
                  <IconX />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          className="composer-input"
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
          rows={2}
        />
        <div className="composer-bar">
          <div className="composer-tools">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(event) => pickFiles(event.target.files)}
            />
            {plan ? (
              <button
                type="button"
                className="icon-btn"
                disabled={chatBusy}
                onClick={() => setBriefOpen(true)}
                data-tip="Brief baru (form terstruktur)"
              >
                <IconSparkles />
              </button>
            ) : null}
            <button
              type="button"
              className="icon-btn"
              disabled={chatBusy || chatDisabled !== null || vision === false}
              onClick={() => fileRef.current?.click()}
              data-tip={
                vision === false
                  ? "Model aktif tidak menerima gambar — pilih model vision lewat DALANG_MODEL"
                  : "Lampirkan gambar (referensi visual untuk agent)"
              }
            >
              <IconImage />
            </button>
          </div>
          <button
            type="button"
            className="primary composer-send"
            disabled={chatBusy || chatDisabled !== null || draft.trim() === ""}
            onClick={send}
            data-tip="Kirim (Enter)"
          >
            <IconSend />
          </button>
        </div>
      </div>
      <BriefDialog
        open={briefOpen}
        onClose={() => setBriefOpen(false)}
        chatDisabled={chatDisabled}
      />
    </section>
  );
};
