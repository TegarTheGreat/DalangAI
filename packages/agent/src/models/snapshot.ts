/**
 * Bundled models.dev snapshot — the offline floor of the registry loader
 * (fetch → cache 24 jam → SNAPSHOT ini). Bentuknya identik dengan
 * https://models.dev/api.json sehingga parser menempuh jalur yang sama.
 *
 * Isi: model Anthropic saja, disalin dari data harga/kapabilitas resmi
 * (cache 2026-06-24). Provider lain sengaja tidak ditebak — mereka terisi
 * saat api.json bisa diambil; model tanpa data registry tetap bisa dipakai,
 * hanya estimasi biayanya yang kosong (ditandai, bukan diam-diam nol).
 */

export const MODELS_SNAPSHOT_DATE = "2026-06-24";

const anthropicModel = (
  id: string,
  name: string,
  costInput: number,
  costOutput: number,
  context: number,
) => ({
  id,
  name,
  tool_call: true,
  reasoning: true,
  modalities: { input: ["text", "image"], output: ["text"] },
  limit: { context, output: 128_000 },
  cost: { input: costInput, output: costOutput },
});

export const MODELS_SNAPSHOT: Record<string, unknown> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    models: {
      "claude-opus-5": anthropicModel("claude-opus-5", "Claude Opus 5", 5, 25, 1_000_000),
      "claude-sonnet-5": anthropicModel(
        "claude-sonnet-5",
        "Claude Sonnet 5",
        2,
        10,
        1_000_000,
      ),
      "claude-haiku-4-5": anthropicModel(
        "claude-haiku-4-5",
        "Claude Haiku 4.5",
        1,
        5,
        200_000,
      ),
      "claude-opus-4-8": anthropicModel(
        "claude-opus-4-8",
        "Claude Opus 4.8",
        5,
        25,
        1_000_000,
      ),
      "claude-opus-4-7": anthropicModel(
        "claude-opus-4-7",
        "Claude Opus 4.7",
        5,
        25,
        1_000_000,
      ),
      "claude-opus-4-6": anthropicModel(
        "claude-opus-4-6",
        "Claude Opus 4.6",
        5,
        25,
        1_000_000,
      ),
      "claude-sonnet-4-6": anthropicModel(
        "claude-sonnet-4-6",
        "Claude Sonnet 4.6",
        3,
        15,
        1_000_000,
      ),
      "claude-fable-5": anthropicModel(
        "claude-fable-5",
        "Claude Fable 5",
        10,
        50,
        1_000_000,
      ),
    },
  },
};
