import type { StudioDeps } from "../src/server/context";

/**
 * Dependensi tiruan untuk gerbang yang hanya memeriksa UI.
 *
 * Gerbang tata letak mengukur geometri, bukan pipeline: ia tidak butuh TTS
 * nyata, stock nyata, atau render nyata — dan tidak boleh membutuhkan kunci
 * API, supaya bisa jalan di CI mana pun. Semuanya menolak dengan rapi; yang
 * penting server hidup dan app-nya tersaji.
 */
const nope = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} tidak tersedia di gerbang UI`);
};

export const stubDeps = (
  options: { publishTargets?: StudioDeps["publishTargets"] } = {},
): StudioDeps => ({
  // Gerbang tata letak memberi tujuan palsu supaya tombol Unggah aktif dan
  // dialognya bisa diukur; gerbang interaksi justru menguji keadaan TANPA token.
  ...(options.publishTargets ? { publishTargets: options.publishTargets } : {}),
  ttsChainFor: () => [],
  stockChain: () => [],
  stickerChain: () => [],
  // Tanpa jalur ASR: itu keadaan mesin polos, dan cukup untuk gerbang tata letak.
  asrChain: () => [],
  // Gerbang tata letak tidak meninjau render; cukup dilarang berjalan.
  renderStills: async () => {
    throw new Error("stub: tinjauan render tidak dipakai gerbang tata letak");
  },
  iconProvider: () => ({
    id: "stub",
    label: "stub",
    search: async () => [],
    fetchSvg: nope("Ikon"),
  }),
  sfxChain: () => [],
  renderVideo: nope("Render"),
  probeVideo: async () => null,
  detectSilence: async () => null,
  saveMedia: nope("Simpan media"),
  chatDisabledReason: "gerbang UI berjalan tanpa model",
  registrySource: "gerbang",
});
