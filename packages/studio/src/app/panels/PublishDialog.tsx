import {
  defaultPublishMetadata,
  PUBLISH_DESCRIPTION_MAX,
  PUBLISH_PRIVACIES,
  PUBLISH_PRIVACY_LABEL,
  PUBLISH_TITLE_MAX,
  type PublishPrivacy,
} from "@dalang/core";
import { useEffect, useState } from "react";
import type { RenderOutput } from "../../shared/api-types";
import { Segmented, useEscape } from "../components/controls";
import { studioClient, useStudio } from "../use-studio";

/**
 * Dialog unggah (ADR-0030). Ini SEKALIGUS gerbang konfirmasinya — server
 * menolak tanpa `confirm`, dan yang mengklik "Unggah" di sini sudah membaca
 * judul, privasi, dan peringatan bahwa unggahan tidak bisa diurungkan.
 * Bawaannya privat; ke publik harus dipilih dengan sengaja.
 */

const PRIVACY_SHORT: Record<PublishPrivacy, string> = {
  private: "Privat",
  unlisted: "Tak terdaftar",
  public: "Publik",
};

const PRIVACY_HINT: Record<PublishPrivacy, string> = {
  private:
    "Hanya kamu yang bisa menonton. Bisa diubah kapan saja di YouTube Studio setelah kamu memeriksanya.",
  unlisted:
    "Siapa pun yang punya tautannya bisa menonton; tidak muncul di pencarian dan halaman kanal.",
  public:
    "Tayang untuk semua orang begitu selesai diunggah. Pastikan judul dan deskripsinya sudah benar.",
};

const splitTags = (raw: string): string[] => [
  ...new Set(
    raw
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ""),
  ),
];

export const PublishDialog: React.FC<{
  render: RenderOutput | null;
  onClose: () => void;
}> = ({ render, onClose }) => {
  const { project } = useStudio();
  const open = render !== null;
  const targets = project?.publish.targets ?? [];
  const [targetChoice, setTargetChoice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState<PublishPrivacy>("private");
  const [force, setForce] = useState(false);
  useEscape(open, onClose);

  // Isi awal diturunkan dari plan SETIAP kali dialog dibuka: judul proyek,
  // narasi yang benar-benar dibacakan, tag format — dan privasi kembali ke
  // privat walau sebelumnya orang memilih publik untuk berkas lain.
  const plan = project?.plan ?? null;
  useEffect(() => {
    if (!render || !plan) return;
    const meta = defaultPublishMetadata(plan);
    setTitle(meta.title);
    setDescription(meta.description);
    setTags(meta.tags.join(", "));
    setPrivacy("private");
    setForce(false);
  }, [render, plan]);

  if (!render || !project) return null;
  const name = render.url.split("/").pop() ?? render.url;
  const target = targets.find((candidate) => candidate.id === targetChoice) ?? targets[0];
  const titleOk = title.trim().length > 0 && title.length <= PUBLISH_TITLE_MAX;
  const canSubmit =
    target !== undefined && titleOk && description.length <= PUBLISH_DESCRIPTION_MAX;

  const submit = () => {
    if (!target || !canSubmit) return;
    onClose();
    void studioClient.startPublish({
      file: name,
      targetId: target.id,
      title: title.trim(),
      description,
      tags: splitTags(tags),
      privacy,
      ...(force ? { force: true } : {}),
    });
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog publish-dialog">
        <h3>Unggah ke {target?.label ?? "tujuan publikasi"}</h3>
        <p>
          {name} · {(render.sizeBytes / 1024 / 1024).toFixed(1)} MB. Unggahan tidak bisa
          diurungkan dari sini: video yang sudah naik tetap ada di kanal sampai kamu
          menghapusnya di YouTube.
        </p>
        {targets.length > 1 ? (
          <div className="field">
            <span>Tujuan</span>
            <Segmented
              grow
              options={targets.map((candidate) => candidate.id)}
              value={target?.id ?? ""}
              label={(id) =>
                targets.find((candidate) => candidate.id === id)?.label ?? id
              }
              onChange={setTargetChoice}
            />
          </div>
        ) : null}
        <div className="publish-fields">
          <label className="field">
            <span>
              Judul
              <em className="field-count">
                {title.length}/{PUBLISH_TITLE_MAX}
              </em>
            </span>
            <input
              value={title}
              maxLength={PUBLISH_TITLE_MAX}
              placeholder="Judul video"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>
              Deskripsi
              <em className="field-count">
                {description.length}/{PUBLISH_DESCRIPTION_MAX}
              </em>
            </span>
            <textarea
              rows={5}
              value={description}
              maxLength={PUBLISH_DESCRIPTION_MAX}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Tag (pisahkan dengan koma)</span>
            <input
              value={tags}
              placeholder="edukasi, dalang"
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
          <div className="field">
            <span>Privasi</span>
            <Segmented
              grow
              options={PUBLISH_PRIVACIES}
              value={privacy}
              label={(option) => PRIVACY_SHORT[option]}
              onChange={setPrivacy}
            />
            <p className="field-hint">{PRIVACY_HINT[privacy]}</p>
          </div>
          {render.published ? (
            <label className="check-row">
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
              />
              <span>
                Berkas ini sudah terunggah (
                {PUBLISH_PRIVACY_LABEL[render.published.privacy]}
                ). Centang untuk mengunggahnya lagi sebagai video BARU; tanpa ini, tautan
                yang sudah ada yang dipakai.
              </span>
            </label>
          ) : null}
        </div>
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            {privacy === "public" ? "Unggah dan tayangkan" : "Unggah"}
          </button>
        </div>
      </div>
    </div>
  );
};
