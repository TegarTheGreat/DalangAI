import { MAX_EDITOR_NAME } from "@dalang/core";

/**
 * Identitas penyunting di peramban (ADR-0038, roadmap §10.4).
 *
 * Id dibuat DI PERAMBAN dan disimpan di localStorage, bukan diberikan server.
 * Alasannya: satu server melayani beberapa orang, jadi server tidak punya cara
 * membedakan mereka kecuali masing-masing menyebut dirinya; dan id yang
 * bertahan antar muat ulang membuat "orang yang me-refresh" tidak terbaca
 * sebagai orang baru yang datang.
 *
 * Namanya bisa diubah dan bawaannya JELAS-JELAS sementara ("Penyunting 4f2a"),
 * bukan tebakan seperti "Pengguna" — nama yang terlihat sementara mengundang
 * orang menggantinya, dan bilah kehadiran berisi tiga "Pengguna" tidak
 * menolong siapa pun.
 */

const ID_KEY = "dalang.editor.id";
const NAME_KEY = "dalang.editor.name";

/** localStorage bisa tidak ada (mode privat ketat); jangan sampai itu fatal. */
const readLocal = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writeLocal = (key: string, value: string): void => {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Tanpa localStorage identitasnya jadi per-tab. Itu tetap bekerja: yang
    // hilang cuma "orang yang sama setelah refresh", bukan kemampuannya.
  }
};

const randomId = (): string => {
  const bytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

let cachedId: string | null = null;

export const editorId = (): string => {
  if (cachedId) return cachedId;
  const stored = readLocal(ID_KEY);
  const id = stored && stored.length >= 4 ? stored : randomId();
  if (id !== stored) writeLocal(ID_KEY, id);
  cachedId = id;
  return id;
};

export const editorName = (): string => {
  const stored = readLocal(NAME_KEY)?.trim();
  if (stored && stored !== "") return stored.slice(0, MAX_EDITOR_NAME);
  return `Penyunting ${editorId().slice(0, 4)}`;
};

export const setEditorName = (name: string): string => {
  const clean = name.trim().slice(0, MAX_EDITOR_NAME);
  if (clean !== "") writeLocal(NAME_KEY, clean);
  return editorName();
};

/** Header identitas untuk permintaan yang MENGUBAH. */
export const editorHeaders = (): Record<string, string> => ({
  "x-dalang-editor-id": editorId(),
  "x-dalang-editor-name": editorName(),
});

/**
 * Kunci tautan (ADR-0038), kalau Studio dibuka ke jaringan lokal.
 *
 * Datang sekali lewat query URL, lalu disimpan di sessionStorage dan DIHAPUS
 * dari bilah alamat: kunci yang menetap di URL ikut ke setiap tangkapan
 * layar, setiap riwayat peramban, dan setiap tautan yang tidak sengaja
 * dibagikan. sessionStorage, bukan localStorage — kunci bertahan selama tab
 * ini hidup, tidak selamanya di komputer bersama.
 */
const KEY_STORAGE = "dalang.link.key";

export const linkKey = (): string | null => {
  try {
    const url = new URL(globalThis.location?.href ?? "http://localhost");
    const fromUrl = url.searchParams.get("kunci");
    if (fromUrl) {
      globalThis.sessionStorage?.setItem(KEY_STORAGE, fromUrl);
      url.searchParams.delete("kunci");
      globalThis.history?.replaceState?.(null, "", url.toString());
      return fromUrl;
    }
    return globalThis.sessionStorage?.getItem(KEY_STORAGE) ?? null;
  } catch {
    return null;
  }
};

/** Header identitas + kunci untuk permintaan yang MENGUBAH. */
export const requestHeaders = (): Record<string, string> => {
  const key = linkKey();
  return { ...editorHeaders(), ...(key ? { "x-dalang-key": key } : {}) };
};
