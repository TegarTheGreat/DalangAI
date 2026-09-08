import { type Editor, editorSchema, MAX_EDITOR_NAME } from "@dalang/core";
import type { EditorPresence } from "../shared/api-types";
import type { EventBus } from "./bus";

/**
 * Kehadiran penyunting (ADR-0038, roadmap §10.4).
 *
 * Bukan basa-basi sosial. Satu-satunya cara menyunting satu proyek berdua
 * tanpa saling menimpa adalah dengan tahu bahwa yang lain ADA, dan sedang di
 * mana — dan mekanisme penolakan bentrok baru terasa masuk akal kalau orang
 * bisa melihat siapa yang menyebabkannya. Bilah kehadiran adalah setengah
 * penjelasan dari setiap penolakan yang akan mereka terima.
 *
 * Disimpan DI MEMORI, bukan di plan: siapa yang sedang membuka editor bukan
 * bagian dari video, dan menuliskannya ke plan.json akan membuat setiap orang
 * yang membuka proyek menghasilkan perubahan berkas.
 */

/** Warna kehadiran; dipilih deterministik dari id supaya stabil antar muat. */
const COLORS = [
  "#E5484D",
  "#F76B15",
  "#F5D90A",
  "#46A758",
  "#12A594",
  "#0091FF",
  "#8E4EC6",
  "#E93D82",
] as const;

const colorFor = (id: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return COLORS[hash % COLORS.length] ?? COLORS[0];
};

/**
 * Berapa lama kehadiran bertahan tanpa kabar.
 *
 * Lebih panjang daripada denyut SSE (25 dtk) dengan margin: kehadiran yang
 * hilang-timbul karena satu denyut telat terbaca sebagai orang yang keluar-
 * masuk ruangan, dan bilah yang berkedip begitu akan diabaikan orang.
 */
export const PRESENCE_TTL_MS = 70_000;

interface Entry extends Editor {
  sceneId: string | null;
  lastSeen: number;
  /** Berapa sambungan SSE yang terbuka untuk id ini (dua tab = dua). */
  connections: number;
}

export class PresenceRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly bus: EventBus;
  private readonly now: () => number;

  constructor(bus: EventBus, now: () => number = Date.now) {
    this.bus = bus;
    this.now = now;
  }

  /**
   * Daftar yang MASIH hidup, sekaligus membersihkan yang basi.
   *
   * Pembersihan terjadi saat dibaca, bukan lewat timer: timer yang berjalan
   * di server yang tidak sedang dipakai siapa pun hanya menahan proses tetap
   * hidup, dan daftar kehadiran tidak berarti apa-apa kalau tidak ada yang
   * membacanya.
   */
  list(): EditorPresence[] {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.connections <= 0 && now - entry.lastSeen > PRESENCE_TTL_MS) {
        this.entries.delete(id);
      }
    }
    return [...this.entries.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "id"))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        color: colorFor(entry.id),
        sceneId: entry.sceneId,
      }));
  }

  private upsert(editor: Editor, patch: Partial<Entry>): void {
    const existing = this.entries.get(editor.id);
    this.entries.set(editor.id, {
      id: editor.id,
      name: editor.name.slice(0, MAX_EDITOR_NAME),
      sceneId: existing?.sceneId ?? null,
      connections: existing?.connections ?? 0,
      ...patch,
      lastSeen: this.now(),
    });
  }

  /** Sambungan SSE dibuka. Kembalikan fungsi penutupnya. */
  join(editor: Editor): () => void {
    const before = this.entries.get(editor.id)?.connections ?? 0;
    this.upsert(editor, { connections: before + 1 });
    this.announce();
    return () => {
      const entry = this.entries.get(editor.id);
      if (!entry) return;
      entry.connections = Math.max(0, entry.connections - 1);
      entry.lastSeen = this.now();
      // TIDAK langsung dihapus: memuat ulang halaman menutup lalu membuka
      // sambungan, dan kehadiran yang lenyap di antaranya membuat rekan
      // kerjanya melihat orang itu keluar-masuk tiap kali me-refresh.
      this.announce();
    };
  }

  /** Kabar berkala dari klien: masih di sini, dan sedang di scene ini. */
  touch(editor: Editor, sceneId: string | null): void {
    const existing = this.entries.get(editor.id);
    this.upsert(editor, {
      sceneId,
      connections: existing?.connections ?? 1,
    });
    this.announce();
  }

  private announce(): void {
    this.bus.emit({ type: "presence", editors: this.list() });
  }
}

/**
 * Identitas penyunting dari sebuah permintaan.
 *
 * Dikirim lewat HEADER, bukan badan: tiap rute yang mengubah punya bentuk
 * badannya sendiri, dan menyelipkan identitas ke masing-masing berarti
 * menuliskannya belasan kali. Header juga memberi satu keuntungan yang tidak
 * disengaja tapi nyata — header kustom memaksa preflight CORS, sehingga
 * permintaan `<form>` lintas asal tidak bisa lagi membawanya (ADR-0031).
 *
 * `null` berarti "tidak menyebut diri", dan itu SAH: CLI, server MCP, dan
 * klien lama tidak menyebut, dan semuanya tetap harus bekerja.
 */
export const editorOf = (headers: Headers): Editor | null => {
  const id = headers.get("x-dalang-editor-id");
  const name = headers.get("x-dalang-editor-name");
  if (!id || !name) return null;
  const parsed = editorSchema.safeParse({
    id: id.slice(0, 64),
    name: name.slice(0, MAX_EDITOR_NAME).trim(),
  });
  return parsed.success ? parsed.data : null;
};
