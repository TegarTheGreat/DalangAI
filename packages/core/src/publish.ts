import type { ScenePlan } from "./scene-plan";

/**
 * Publikasi langsung (ADR-0030, roadmap §10.3) — bagian yang MURNI:
 * metadata unggahan yang diturunkan dari plan. Bawaannya PRIVAT: unggahan
 * tidak pernah bisa "di-undo" sepenuhnya, jadi langkah pertama ke publik
 * harus keputusan orang, bukan bawaan program.
 */

export const PUBLISH_PRIVACIES = ["private", "unlisted", "public"] as const;
export type PublishPrivacy = (typeof PUBLISH_PRIVACIES)[number];

export const PUBLISH_PRIVACY_LABEL: Record<PublishPrivacy, string> = {
  private: "Privat (hanya kamu)",
  unlisted: "Tidak terdaftar (siapa pun dengan tautan)",
  public: "Publik",
};

/** Batas YouTube: judul 100 karakter, deskripsi 5000, tag total 500. */
export const PUBLISH_TITLE_MAX = 100;
export const PUBLISH_DESCRIPTION_MAX = 5000;

export interface PublishMetadata {
  title: string;
  description: string;
  tags: string[];
  privacy: PublishPrivacy;
  /** Kode bahasa BCP-47 konten, mis. "id". */
  language?: string;
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * Metadata bawaan dari plan: judul proyek, deskripsi dari narasi (kalimat
 * yang benar-benar dibacakan — bukan ringkasan karangan), tag dari format
 * dan nama alat. Semuanya bisa ditimpa orang sebelum unggah.
 */
export const defaultPublishMetadata = (plan: ScenePlan): PublishMetadata => {
  const narration = plan.scenes
    .map((scene) => scene.narration.trim())
    .filter((text) => text !== "")
    .join(" ");
  const tags = [plan.meta.format, "dalang"]
    .filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
    .map((tag) => tag.trim().toLowerCase());
  return {
    title: clip(plan.meta.title.trim() || "Video Dalang", PUBLISH_TITLE_MAX),
    description: clip(
      narration ? `${narration}\n\nDibuat dengan Dalang.` : "Dibuat dengan Dalang.",
      PUBLISH_DESCRIPTION_MAX,
    ),
    tags: [...new Set(tags)],
    privacy: "private",
    language: plan.meta.language,
  };
};
