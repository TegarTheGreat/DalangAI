import {
  ASPECT_RATIOS,
  type AspectRatio,
  allRecipes,
  MAX_MEMORY_TEXT,
  MEMORY_KIND_LABEL,
  MEMORY_KINDS,
  type MemoryKind,
  memoryConflicts,
} from "@dalang/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceProjectLite } from "../../shared/api-types";
import { RadioCard, Segmented, useEscape } from "../components/controls";
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconFilm,
  IconFolder,
  IconPlus,
  IconSearch,
  IconSpinner,
  IconTrash,
  IconX,
} from "../icons";
import { studioClient, useStudio } from "../use-studio";

/**
 * Lobi: layar pertama Dalang Studio.
 *
 * Ia bukan sekadar daftar — ia adalah tempat orang mengingat pekerjaannya.
 * Karena itu kartu proyek memperlihatkan RUPA proyeknya (aksen, rasio, dan
 * ekspor terakhir yang benar-benar berputar saat disorot), bukan baris teks
 * seragam yang memaksa orang membaca nama folder untuk mengenali karyanya
 * sendiri.
 */

const STYLE_PRESETS: ReadonlyArray<{ id: string; title: string; desc: string }> = [
  {
    id: "documentary-01",
    title: "Dokumenter",
    desc: "Sinematik, tipografi serif, latar duotone bergerak. Cocok untuk esai video dan naratif.",
  },
  {
    id: "tutorial-01",
    title: "Tutorial",
    desc: "Panggung tangkapan layar, anotasi, sorot langkah. Cocok untuk panduan dan demo produk.",
  },
];

const RATIO_HINT: Record<AspectRatio, string> = {
  "16:9": "Lanskap · YouTube, presentasi",
  "9:16": "Tegak · Reels, Shorts, TikTok",
  "1:1": "Persegi · feed Instagram",
};

const ASPECT_VALUE: Record<string, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 };

const durationLabel = (sec: number): string => {
  if (sec < 1) return "0 dtk";
  const minutes = Math.floor(sec / 60);
  const seconds = Math.round(sec % 60);
  return minutes > 0 ? `${minutes} mnt ${seconds} dtk` : `${seconds} dtk`;
};

/** "baru saja" / "3 jam lalu" / tanggal — bahasa manusia, bukan ISO. */
const relativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(then).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

/**
 * Sampul proyek yang belum pernah diekspor. Bukan kotak kosong: inisial judul
 * di atas gradasi warna aksen proyeknya sendiri, dengan garis-garis yang
 * mewakili jumlah scene — cukup untuk dikenali sekilas dari antara dua puluh
 * kartu lain.
 */
const CoverArt: React.FC<{ project: WorkspaceProjectLite }> = ({ project }) => {
  const initials = project.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  const ticks = Math.min(project.scenes, 12);
  return (
    <div
      className="cover-art"
      style={{
        background: `radial-gradient(120% 100% at 20% 0%, ${project.accent}2e 0%, transparent 60%), linear-gradient(160deg, #171a22 0%, #0d0f14 100%)`,
      }}
    >
      <span className="cover-initials" style={{ color: project.accent }}>
        {initials || "?"}
      </span>
      {/* Satu batang bergaris: tiap ruas = satu scene, terangnya menanjak ke
          kanan. Digambar dengan mask CSS, bukan puluhan node — sampul kartu
          tidak layak membebani lobi berisi puluhan proyek. */}
      <div
        className="cover-ticks"
        aria-hidden
        style={{
          backgroundImage: `linear-gradient(90deg, ${project.accent}44, ${project.accent}dd)`,
          maskImage: `repeating-linear-gradient(90deg, #000 0 calc(100% / ${ticks} - 3px), transparent calc(100% / ${ticks} - 3px) calc(100% / ${ticks}))`,
        }}
      />
    </div>
  );
};

/**
 * Pratinjau ekspor terakhir, DI ATAS sampul gambar yang selalu ada.
 *
 * Dua alasan lapisan ini tidak pernah berdiri sendiri: video baru dimuat saat
 * kartu disorot (`preload="metadata"`) — dua puluh kartu yang menarik dua
 * puluh video sekaligus membuat lobi berat justru di mesin yang paling butuh
 * cepat — dan sebagian peramban berbasis Chromium dibangun tanpa H.264, jadi
 * MP4 hasil ekspor tidak bisa didekode sama sekali di sana. Dalam kedua
 * keadaan itu kartu tetap memperlihatkan sampulnya, bukan kotak hitam.
 */
const CoverVideo: React.FC<{ src: string; hovered: boolean }> = ({ src, hovered }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [playable, setPlayable] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (hovered) {
      void video.play().catch(() => {
        // autoplay ditolak / codec tak didukung: sampul tetap yang terlihat
      });
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [hovered]);

  return (
    <video
      ref={ref}
      className={playable ? "cover-video ready" : "cover-video"}
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      tabIndex={-1}
      aria-hidden
      onLoadedData={(event) => setPlayable(event.currentTarget.videoWidth > 0)}
      onError={() => setPlayable(false)}
    />
  );
};

const ProjectCard: React.FC<{
  project: WorkspaceProjectLite;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
}> = ({ project, open, busy, onOpen }) => {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.title);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    const next = draft.trim();
    setRenaming(false);
    if (next === "" || next === project.title) {
      setDraft(project.title);
      return;
    }
    void studioClient.renameProject(project.id, next);
  };

  const ratio = ASPECT_VALUE[project.aspectRatio] ?? 9 / 16;

  return (
    <article
      className={`project-card${open ? " open" : ""}${project.valid ? "" : " invalid"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmTrash(false);
      }}
      style={{ ["--card-accent" as string]: project.accent }}
    >
      <button
        type="button"
        className="card-stage"
        onClick={onOpen}
        disabled={busy}
        aria-label={`Buka proyek ${project.title}`}
      >
        <span className="card-frame" style={{ aspectRatio: String(ratio) }}>
          <CoverArt project={project} />
          {project.posterUrl ? (
            <CoverVideo src={project.posterUrl} hovered={hovered} />
          ) : null}
        </span>
        <span className="card-ratio">{project.aspectRatio}</span>
        {open ? (
          <span className="card-open-flag">
            <IconCheck />
            Terbuka
          </span>
        ) : null}
        {busy ? (
          <span className="card-busy">
            <IconSpinner />
            Membuka…
          </span>
        ) : null}
        <span className="card-cta">Buka di editor</span>
      </button>

      <div className="card-body">
        {renaming ? (
          <input
            ref={inputRef}
            className="card-rename"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") {
                setDraft(project.title);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="card-title"
            onClick={() => {
              setDraft(project.title);
              setRenaming(true);
            }}
            title="Klik untuk ganti judul"
          >
            {project.title}
          </button>
        )}

        <div className="card-meta">
          <span>{project.scenes} scene</span>
          <span className="dot" aria-hidden />
          <span>{durationLabel(project.durationSec)}</span>
          {project.renders > 0 ? (
            <>
              <span className="dot" aria-hidden />
              <span className="card-renders">
                <IconFilm />
                {project.renders}
              </span>
            </>
          ) : null}
        </div>
        <div className="card-sub">
          <span className="card-id">{project.id}</span>
          <span>{relativeTime(project.updatedAt)}</span>
        </div>

        {project.valid ? null : (
          <p className="card-error">plan.json tidak terbaca — {project.error}</p>
        )}

        <div className="card-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => void studioClient.duplicateProject(project.id)}
            data-tip="Salin proyek (tanpa cache, riwayat, dan ledger biaya)"
          >
            <IconCopy />
            Duplikat
          </button>
          {confirmTrash ? (
            <button
              type="button"
              className="ghost danger confirm"
              onClick={() => {
                setConfirmTrash(false);
                void studioClient.trashProject(project.id);
              }}
            >
              <IconTrash />
              Yakin buang?
            </button>
          ) : (
            <button
              type="button"
              className="ghost danger"
              onClick={() => setConfirmTrash(true)}
              data-tip="Pindahkan folder proyek ke .trash — tidak dihapus"
            >
              <IconTrash />
              Buang
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

/** Dialog proyek baru: judul, rasio, gaya, format konten. */
const NewProjectDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const { switching } = useStudio();
  const [title, setTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [stylePreset, setStylePreset] = useState("documentary-01");
  const [format, setFormat] = useState("bebas");
  const inputRef = useRef<HTMLInputElement>(null);
  const recipes = useMemo(() => allRecipes(), []);
  useEscape(open, onClose);

  useEffect(() => {
    if (open) {
      setTitle("");
      // Fokus langsung di kolom judul: satu dialog, satu keputusan pertama.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    if (title.trim() === "" || switching) return;
    void studioClient
      .createProject({ title: title.trim(), aspectRatio, stylePreset, format })
      .then((ok) => {
        if (ok) onClose();
      });
  };

  const recipe = recipes.find((item) => item.format === format);

  return (
    <div className="dialog-backdrop">
      {/* Tombol sungguhan, bukan div yang bisa diklik: klik di luar dialog
          adalah aksi tutup, dan pembaca layar berhak tahu itu. */}
      <button
        type="button"
        className="dialog-scrim"
        aria-label="Tutup dialog"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-label="Proyek baru"
      >
        <h3>Proyek baru</h3>
        <p>
          Judulnya jadi nama folder di workspace ini. Semua pilihan di bawah bisa diubah
          kapan saja dari panel Gaya.
        </p>

        <label className="field">
          <span>Judul</span>
          <input
            ref={inputRef}
            value={title}
            maxLength={120}
            placeholder="Misal: Sejarah Rempah Nusantara"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </label>

        <div className="field">
          <span>Rasio</span>
          <div className="ratio-choices">
            {ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={ratio === aspectRatio ? "ratio-choice active" : "ratio-choice"}
                onClick={() => setAspectRatio(ratio)}
              >
                <span
                  className="ratio-box"
                  style={{ aspectRatio: String(ASPECT_VALUE[ratio] ?? 1) }}
                  aria-hidden
                />
                <strong>{ratio}</strong>
                <small>{RATIO_HINT[ratio]}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Gaya visual</span>
          <div className="radio-grid">
            {STYLE_PRESETS.map((preset) => (
              <RadioCard
                key={preset.id}
                active={preset.id === stylePreset}
                title={preset.title}
                desc={preset.desc}
                onSelect={() => setStylePreset(preset.id)}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <span>Format konten</span>
          <Segmented
            options={recipes.map((item) => item.format)}
            value={format}
            label={(value) =>
              recipes.find((item) => item.format === value)?.label ?? String(value)
            }
            onChange={(value) => setFormat(value)}
            grow
          />
          {recipe ? <small className="field-hint">{recipe.kerangka}</small> : null}
        </div>

        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className="primary with-icon"
            disabled={title.trim() === "" || switching !== null}
            onClick={submit}
          >
            {switching ? <IconSpinner /> : <IconPlus />}
            Buat &amp; buka
          </button>
        </div>
      </div>
    </div>
  );
};

type SortKey = "terbaru" | "judul" | "durasi";

/**
 * Impor berkas interchange jadi proyek baru (ADR-0023).
 *
 * Berkasnya dibaca DI PERAMBAN lalu dikirim sebagai teks: .otio dan .fcpxml
 * berukuran kilobyte, dan jalur JSON yang sudah ada jauh lebih sedikit
 * permukaannya daripada penanganan unggahan biner.
 *
 * Catatan impor ditampilkan di dialog dan TIDAK ditutup otomatis: daftar
 * "yang tidak ikut" adalah alasan utama dialog ini ada.
 */
const ImportDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const { switching } = useStudio();
  const [nama, setNama] = useState<string | null>(null);
  const [catatan, setCatatan] = useState<string[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open) {
      setNama(null);
      setCatatan(null);
      setGalat(null);
    }
  }, [open]);

  if (!open) return null;

  const pilih = (file: File | undefined) => {
    if (!file) return;
    setNama(file.name);
    setCatatan(null);
    setGalat(null);
    file
      .text()
      .then((isi) => studioClient.importTimeline(isi))
      .then((notes) => {
        if (notes) setCatatan(notes);
      })
      .catch((error: unknown) => {
        setGalat(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <div className="dialog-backdrop">
      <button
        type="button"
        className="dialog-scrim"
        aria-label="Tutup dialog"
        tabIndex={-1}
        onClick={onClose}
      />
      <div className="dialog brief-dialog">
        <h3>Impor garis waktu</h3>
        <p>
          Berkas .otio (OpenTimelineIO) atau .fcpxml (Final Cut) jadi proyek baru.
          Hasilnya kerangka: urutan dan durasi benar, naskah kosong.
        </p>
        <div className="interop-block">
          <span className="interop-label">Pilih berkas</span>
          <p className="interop-desc">
            Aset TIDAK ikut tersalin. Yang berada di luar folder ruang kerja tidak
            dirujuk, dan scene-nya dibiarkan kosong.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".otio,.fcpxml,application/json,text/xml"
            disabled={switching !== null}
            onChange={(event) => pilih(event.target.files?.[0])}
          />
          {nama ? <p className="interop-file">{nama}</p> : null}
          {galat ? (
            <div className="notice-warn interop-notice">
              <strong>Impor gagal</strong>
              <p>{galat}</p>
            </div>
          ) : null}
          {catatan ? (
            <div className="interop-result">
              <span className="interop-label">Catatan impor</span>
              <ul className="interop-notes">
                {catatan.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="brief-actions">
          <button type="button" className="primary" onClick={onClose}>
            {catatan ? "Selesai" : "Tutup"}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Memori preferensi lintas proyek (ADR-0029) — di LOBI, bukan di editor,
 * karena ia milik orangnya, bukan satu proyek. Semua yang agent ingat
 * terlihat di sini dan bisa dihapus; agent tidak punya ingatan tersembunyi.
 */
const MemorySection: React.FC = () => {
  const { memory } = useStudio();
  const [kind, setKind] = useState<MemoryKind>("gaya");
  const [text, setText] = useState("");
  const entries = memory?.entries ?? [];
  const conflicts = memory ? memoryConflicts(memory) : [];
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const teks = text.trim();
    if (teks.length < 3) return;
    void studioClient.addMemory(kind, teks);
    setText("");
  };
  return (
    <section className="lobby-memory" aria-labelledby="memori-judul">
      <div className="lobby-memory-head">
        <h2 id="memori-judul">Preferensi agent</h2>
        <p>
          Berlaku di semua proyek: agent membacanya tiap giliran, dan hanya menyimpan yang
          kamu nyatakan eksplisit sebagai kebiasaan tetap. Hapus kapan saja.
        </p>
      </div>
      {conflicts.length > 0 ? (
        <div className="notice-warn memory-conflicts" role="alert">
          <strong>Ada preferensi yang bertentangan</strong>
          <ul>
            {conflicts.map((conflict) => (
              <li key={`${conflict.a.id}-${conflict.b.id}`}>
                “{conflict.a.text}” dan “{conflict.b.text}” — {conflict.reason}. Hapus
                salah satunya; sampai itu, agent akan bertanya alih-alih memilih sendiri.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {entries.length === 0 ? (
        <p className="group-hint">
          Belum ada. Contoh: “Selalu pakai caption tegas untuk klip”, “Jangan pernah pakai
          musik dramatis”.
        </p>
      ) : (
        <ul className="memory-list">
          {entries.map((entry) => (
            <li key={entry.id} className="memory-item">
              <span className={`memory-kind ${entry.kind}`}>
                {MEMORY_KIND_LABEL[entry.kind]}
              </span>
              <span className="memory-text">{entry.text}</span>
              <span className="memory-meta">
                {entry.source === "agent" ? "dicatat agent" : "ditulis kamu"}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Hapus preferensi: ${entry.text}`}
                data-tip="Hapus"
                onClick={() => void studioClient.removeMemory(entry.id)}
              >
                <IconX />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="memory-form" onSubmit={submit}>
        <select
          value={kind}
          aria-label="Jenis preferensi"
          onChange={(event) => setKind(event.target.value as MemoryKind)}
        >
          {MEMORY_KINDS.map((item) => (
            <option key={item} value={item}>
              {MEMORY_KIND_LABEL[item]}
            </option>
          ))}
        </select>
        <input
          value={text}
          maxLength={MAX_MEMORY_TEXT}
          placeholder="Satu kalimat, mis. Selalu pakai rasio 9:16 untuk klip"
          aria-label="Teks preferensi"
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="primary" disabled={text.trim().length < 3}>
          Simpan
        </button>
      </form>
    </section>
  );
};

export const Lobby: React.FC = () => {
  const { workspace, switching } = useStudio();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("terbaru");
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const projects = workspace?.projects ?? [];
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? projects.filter(
          (item) =>
            item.title.toLowerCase().includes(needle) ||
            item.id.toLowerCase().includes(needle),
        )
      : projects;
    const sorted = [...filtered];
    if (sort === "judul") sorted.sort((a, b) => a.title.localeCompare(b.title, "id"));
    if (sort === "durasi") sorted.sort((a, b) => b.durationSec - a.durationSec);
    return sorted;
  }, [projects, query, sort]);

  const totalSec = projects.reduce((sum, item) => sum + item.durationSec, 0);

  return (
    <div className="lobby">
      <header className="lobby-top">
        <div className="lobby-brand">
          <span className="brand-mark">Dalang</span>
          <span className="brand-sub">Studio</span>
        </div>
      </header>

      <div className="lobby-hero">
        <div>
          <h1>Proyek kamu</h1>
          <p className="lobby-path">
            <IconFolder />
            <span title={workspace?.root ?? ""}>{workspace?.root ?? "—"}</span>
          </p>
        </div>
        <div className="lobby-actions">
          <button
            type="button"
            className="with-icon lg"
            onClick={() => setImportOpen(true)}
            data-tip="Impor .otio atau .fcpxml dari editor lain"
          >
            <IconDownload />
            Impor
          </button>
          <button
            type="button"
            className="primary with-icon lg"
            onClick={() => setNewOpen(true)}
          >
            <IconPlus />
            Proyek baru
          </button>
        </div>
      </div>

      {projects.length > 0 ? (
        <div className="lobby-bar">
          <label className="lobby-search">
            <IconSearch />
            <input
              value={query}
              placeholder="Cari judul atau folder"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" className="icon-btn" onClick={() => setQuery("")}>
                <IconX />
              </button>
            ) : null}
          </label>
          <Segmented
            options={["terbaru", "judul", "durasi"] as const}
            value={sort}
            label={(value) =>
              value === "terbaru" ? "Terbaru" : value === "judul" ? "Judul" : "Terpanjang"
            }
            onChange={setSort}
          />
          <span className="lobby-count">
            {projects.length} proyek · {durationLabel(totalSec)} total
          </span>
        </div>
      ) : null}

      {projects.length === 0 ? (
        <div className="lobby-empty">
          <div className="empty-art" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <h2>Belum ada proyek di folder ini</h2>
          <p>
            Dalang menyimpan tiap proyek sebagai satu folder biasa berisi
            <code>plan.json</code> — bisa disalin, di-zip, dan di-commit ke git seperti
            berkas lain. Buat yang pertama, atau jalankan{" "}
            <code>dalang studio folder-lain/</code> untuk membuka workspace lain.
          </p>
          <button
            type="button"
            className="primary with-icon lg"
            onClick={() => setNewOpen(true)}
          >
            <IconPlus />
            Buat proyek pertama
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="lobby-empty small">
          <h2>Tidak ada yang cocok dengan “{query}”</h2>
          <button type="button" className="ghost" onClick={() => setQuery("")}>
            Bersihkan pencarian
          </button>
        </div>
      ) : (
        <div className="project-grid">
          {query.trim() === "" ? (
            <button type="button" className="new-card" onClick={() => setNewOpen(true)}>
              <IconPlus />
              <strong>Proyek baru</strong>
              <small>Judul, rasio, gaya — lalu langsung ke editor</small>
            </button>
          ) : null}
          {visible.map((item) => (
            <ProjectCard
              key={item.id}
              project={item}
              open={workspace?.open?.id === item.id}
              busy={switching === item.id}
              onOpen={() => void studioClient.openProject(item.id)}
            />
          ))}
        </div>
      )}

      <MemorySection />

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
};
