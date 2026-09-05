import { useEffect, useMemo, useState } from "react";
import type {
  CapabilityLite,
  SettingLite,
  SettingsPayload,
} from "../../shared/api-types";
import { api } from "../api";
import { useEscape } from "../components/controls";
import { IconCheck, IconGear, IconKey, IconSpinner, IconX } from "../icons";

/**
 * Panel Pengaturan (ADR-0032): `dalang setup` untuk orang yang tidak pernah
 * membuka terminal.
 *
 * Yang dipinjam dari wizard, karena itu bagian yang membuatnya bisa dipakai
 * orang awam:
 *
 *  - kemampuan disebut dengan APA YANG BISA DILAKUKAN, bukan nama teknologi;
 *  - yang SUDAH menyala ditampilkan lebih dulu, supaya orang tahu programnya
 *    sudah berguna hari ini sebelum melihat daftar yang belum;
 *  - tiap kemampuan menyatakan apa yang tetap bisa dikerjakan tanpanya;
 *  - kunci diuji ke layanannya sebelum disimpan, karena kunci salah ketik
 *    terlihat persis seperti kunci benar sampai render gagal di tengah jalan.
 *
 * Yang TIDAK ada di sini: isi kunci. Server hanya mengirim samarannya, jadi
 * kolom isian selalu mulai kosong, dan nilai lama hanya terbaca empat huruf
 * terakhirnya. Mengosongkan kolom bukan berarti menghapus - menghapus punya
 * tombolnya sendiri, supaya tidak ada yang kehilangan kunci karena salah tab.
 */

type Draft = Record<string, string>;
type Hasil = { status: "ok" | "gagal" | "tak-diuji" | "menguji"; detail: string };

const KIND_HINT: Record<SettingLite["kind"], string> = {
  rahasia: "Disimpan di berkas .env di komputermu sendiri, tidak dikirim ke mana pun.",
  path: "Lokasi berkas di komputermu.",
  url: "Alamat lengkap, termasuk https://",
  angka: "Isi angka saja.",
  teks: "",
};

/** "A atau B" untuk aturan salah-satu, "A dan B" untuk semua. */
const needsSentence = (capability: CapabilityLite): string => {
  const joined = capability.missing.join(
    capability.rule === "semua" ? " dan " : " atau ",
  );
  return capability.alsoActiveWhen
    ? `${joined}; atau ${capability.alsoActiveWhen}`
    : joined;
};

const statusNote = (capability: CapabilityLite): string => {
  if (!capability.active) return `Butuh ${needsSentence(capability)}`;
  if (capability.activeByDetection) return "Terdeteksi di komputer ini";
  if (
    capability.readyWithoutConfig &&
    capability.settings.every((item) => !item.filled)
  ) {
    return "Jalan tanpa kunci apa pun";
  }
  const terisi = capability.settings.filter((item) => item.filled).length;
  return `${terisi} setelan terisi`;
};

const SettingRow: React.FC<{
  setting: SettingLite;
  draft: string | undefined;
  hasil: Hasil | undefined;
  onDraft: (value: string) => void;
  onTest: () => void;
  onClear: () => void;
}> = ({ setting, draft, hasil, onDraft, onTest, onClear }) => {
  const [openHelp, setOpenHelp] = useState(false);
  const value = draft ?? "";
  const hint = KIND_HINT[setting.kind];
  return (
    <li
      className={setting.filled ? "setting-row filled" : "setting-row"}
      data-setting={setting.key}
    >
      <div className="setting-head">
        <span className="setting-mark" aria-hidden>
          {setting.kind === "rahasia" ? <IconKey /> : <IconGear />}
        </span>
        <div className="setting-title">
          <strong>{setting.label}</strong>
          <span className="setting-key">{setting.key}</span>
        </div>
        {setting.required ? null : <span className="setting-opt">opsional</span>}
        {setting.filled ? (
          <span className="setting-now" title="Nilai yang terpasang sekarang">
            {setting.shown}
          </span>
        ) : null}
      </div>

      <p className="setting-effect">{setting.effect}</p>
      {!setting.filled && setting.fallback ? (
        <p className="setting-fallback">Bila dikosongkan: {setting.fallback}</p>
      ) : null}
      {setting.source === "lingkungan" ? (
        <p className="setting-warn">
          Nilai ini di-export di terminal, bukan dari berkas .env. Simpanan di sini
          berlaku sekarang, tetapi setelah Studio dijalankan ulang nilai terminal yang
          menang.
        </p>
      ) : null}
      {setting.needsRestart ? (
        <p className="setting-warn">
          Perubahannya baru berlaku setelah Studio dijalankan ulang.
        </p>
      ) : null}

      <div className="setting-input">
        <input
          type={setting.kind === "rahasia" ? "password" : "text"}
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            setting.filled ? "Isi untuk mengganti" : (setting.example ?? "Tempel di sini")
          }
          aria-label={setting.label}
          onChange={(event) => onDraft(event.target.value)}
        />
        {setting.testable ? (
          <button
            type="button"
            className="ghost"
            disabled={
              hasil?.status === "menguji" || (value.trim() === "" && !setting.filled)
            }
            onClick={onTest}
          >
            {hasil?.status === "menguji" ? <IconSpinner /> : null}
            Uji
          </button>
        ) : null}
        {setting.filled ? (
          <button type="button" className="ghost setting-clear" onClick={onClear}>
            Hapus
          </button>
        ) : null}
      </div>

      {hint === "" ? null : <p className="setting-hint">{hint}</p>}

      {hasil && hasil.status !== "menguji" ? (
        <p className={hasil.status === "gagal" ? "setting-warn" : "setting-ok"}>
          {hasil.detail}
        </p>
      ) : null}

      {setting.howTo.length > 0 ? (
        <div className="setting-howto">
          <button
            type="button"
            className="linkish"
            aria-expanded={openHelp}
            onClick={() => setOpenHelp((prev) => !prev)}
          >
            {openHelp ? "Sembunyikan caranya" : "Cara mendapatkannya"}
          </button>
          {openHelp ? (
            <ol>
              {setting.howTo.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

const CapabilityCard: React.FC<{
  capability: CapabilityLite;
  draft: Draft;
  hasil: Record<string, Hasil>;
  /**
   * Kartu mulai TERTUTUP, kecuali satu. Membuka semua yang belum menyala
   * sekaligus menghasilkan lima ribu piksel gulungan dan mengubur daftarnya —
   * padahal baris judulnya sudah menyebut nama kemampuan dan apa yang
   * dibutuhkannya. Satu yang terbuka cukup untuk memperlihatkan bahwa kartu
   * ini bisa dibuka.
   */
  defaultOpen: boolean;
  onDraft: (key: string, value: string) => void;
  onTest: (setting: SettingLite) => void;
  onClear: (key: string) => void;
}> = ({ capability, draft, hasil, defaultOpen, onDraft, onTest, onClear }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={capability.active ? "cap-card on" : "cap-card"}>
      <button
        type="button"
        className="cap-head"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="cap-dot" aria-hidden>
          {capability.active ? <IconCheck /> : null}
        </span>
        <span className="cap-title">
          <strong>{capability.title}</strong>
          <span className="cap-note">{statusNote(capability)}</span>
        </span>
        <span className="cap-chevron" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? (
        <div className="cap-body">
          <p className="cap-plain">{capability.plain}</p>
          <p className="cap-without">Tanpa ini: {capability.withoutIt}</p>
          {capability.rule === "salah-satu" &&
          capability.settings.filter((item) => item.required).length > 1 ? (
            <p className="cap-rule">Cukup isi SALAH SATU dari yang bertanda wajib.</p>
          ) : null}
          {capability.rule === "semua" &&
          capability.settings.filter((item) => item.required).length > 1 ? (
            <p className="cap-rule">Yang bertanda wajib harus terisi SEMUA.</p>
          ) : null}
          <ul className="setting-list">
            {capability.settings.map((setting) => (
              <SettingRow
                key={setting.key}
                setting={setting}
                draft={draft[setting.key]}
                hasil={hasil[setting.key]}
                onDraft={(value) => onDraft(setting.key, value)}
                onTest={() => onTest(setting)}
                onClear={() => onClear(setting.key)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

export const SettingsDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [hasil, setHasil] = useState<Record<string, Hasil>>({});
  const [galat, setGalat] = useState<string | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open) {
      setDraft({});
      setHasil({});
      setGalat(null);
      setKabar(null);
      return;
    }
    api
      .getSettings()
      .then((reply) => setPayload(reply.settings))
      .catch((error: unknown) =>
        setGalat(error instanceof Error ? error.message : String(error)),
      );
  }, [open]);

  const terisi = useMemo(
    () => Object.entries(draft).filter(([, value]) => value.trim() !== "").length,
    [draft],
  );

  if (!open) return null;

  const uji = (setting: SettingLite) => {
    const value = draft[setting.key]?.trim();
    setHasil((prev) => ({
      ...prev,
      [setting.key]: { status: "menguji", detail: "Menghubungi layanannya..." },
    }));
    api
      .testSetting(setting.key, value === "" ? undefined : value)
      .then((reply) => {
        setHasil((prev) => ({
          ...prev,
          [setting.key]: { status: reply.status, detail: reply.detail },
        }));
      })
      .catch((error: unknown) => {
        setHasil((prev) => ({
          ...prev,
          [setting.key]: {
            status: "gagal",
            detail: error instanceof Error ? error.message : String(error),
          },
        }));
      });
  };

  const simpan = (updates: Draft) => {
    if (Object.keys(updates).length === 0) return;
    setMenyimpan(true);
    setGalat(null);
    api
      .saveSettings(updates)
      .then((reply) => {
        setPayload(reply.settings);
        setDraft({});
        const jumlah = reply.replaced.length + reply.added.length;
        const bagian: string[] = [];
        if (jumlah > 0) bagian.push(`${jumlah} setelan tersimpan`);
        if (reply.removed.length > 0) bagian.push(`${reply.removed.length} dihapus`);
        if (reply.needsRestart.length > 0) {
          bagian.push(
            `${reply.needsRestart.join(", ")} baru berlaku setelah Studio dijalankan ulang`,
          );
        }
        setKabar(`${bagian.join(" · ")}. Ditulis ke ${reply.settings.envPath}`);
      })
      .catch((error: unknown) =>
        setGalat(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setMenyimpan(false));
  };

  const hidup = payload?.capabilities.filter((item) => item.active) ?? [];
  const belum = payload?.capabilities.filter((item) => !item.active) ?? [];

  return (
    <div className="dialog-backdrop">
      <button
        type="button"
        className="dialog-scrim"
        aria-label="Tutup dialog"
        tabIndex={-1}
        onClick={onClose}
      />
      <div className="dialog settings-dialog" role="dialog" aria-label="Pengaturan">
        <header className="settings-top">
          <div>
            <h3>Pengaturan</h3>
            <p>
              Tanpa satu kunci pun, Dalang tetap menyusun, merender, dan mengekspor video.
              Yang di bawah ini menambah kemampuan, bukan menyalakan program.
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="Tutup" onClick={onClose}>
            <IconX />
          </button>
        </header>

        {payload ? (
          <p className="settings-machine">
            Node {payload.machine.node} ·{" "}
            {payload.machine.browser
              ? "Chromium untuk render ditemukan"
              : "Chromium diunduh saat render pertama"}{" "}
            ·{" "}
            {payload.machine.whisper
              ? "whisper.cpp terpasang"
              : "whisper.cpp belum terpasang"}{" "}
            · berkas {payload.envPath}
            {payload.envExists ? "" : " (akan dibuat)"}
          </p>
        ) : null}

        {galat ? (
          <div className="notice-warn" role="alert">
            <strong>Gagal</strong>
            <p>{galat}</p>
          </div>
        ) : null}
        {kabar ? <div className="notice-ok">{kabar}</div> : null}

        <div className="settings-body">
          {payload === null && galat === null ? (
            <p className="group-hint">Memuat...</p>
          ) : null}

          {hidup.length > 0 ? (
            <>
              <h4 className="settings-group">Sudah bisa dipakai</h4>
              {hidup.map((capability) => (
                <CapabilityCard
                  key={capability.id}
                  capability={capability}
                  draft={draft}
                  hasil={hasil}
                  defaultOpen={false}
                  onDraft={(key, value) =>
                    setDraft((prev) => ({ ...prev, [key]: value }))
                  }
                  onTest={uji}
                  onClear={(key) => simpan({ [key]: "" })}
                />
              ))}
            </>
          ) : null}

          {belum.length > 0 ? (
            <>
              <h4 className="settings-group">Belum menyala</h4>
              {belum.map((capability, index) => (
                <CapabilityCard
                  key={capability.id}
                  capability={capability}
                  draft={draft}
                  hasil={hasil}
                  defaultOpen={index === 0}
                  onDraft={(key, value) =>
                    setDraft((prev) => ({ ...prev, [key]: value }))
                  }
                  onTest={uji}
                  onClear={(key) => simpan({ [key]: "" })}
                />
              ))}
            </>
          ) : null}
        </div>

        <footer className="settings-actions">
          <span className="settings-count">
            {terisi === 0 ? "Belum ada yang diisi" : `${terisi} setelan siap disimpan`}
          </span>
          <button type="button" className="ghost" onClick={onClose}>
            Tutup
          </button>
          <button
            type="button"
            className="primary"
            disabled={terisi === 0 || menyimpan}
            onClick={() =>
              simpan(
                Object.fromEntries(
                  Object.entries(draft).filter(([, value]) => value.trim() !== ""),
                ),
              )
            }
          >
            {menyimpan ? <IconSpinner /> : null}
            Simpan
          </button>
        </footer>
      </div>
    </div>
  );
};
