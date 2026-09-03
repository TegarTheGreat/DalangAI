import { parseScenePlan, type ScenePlan, type ScenePlanInput } from "../src/index";

export const basePlanInput = (): ScenePlanInput => ({
  version: 2,
  projectId: "proj-test",
  meta: {
    title: "Sejarah Borobudur dalam 60 Detik",
    aspectRatio: "9:16",
    targetDuration: 60,
    language: "id",
    stylePreset: "documentary-01",
  },
  audio: {},
  scenes: [
    {
      id: "sc-001",
      narration: "Borobudur dibangun pada abad ke-9.",
      clips: [
        { id: "sc-001-k1", type: "stock", query: "borobudur temple aerial sunrise" },
      ],
    },
    {
      id: "sc-002",
      narration: "Candi ini sempat terkubur abu vulkanik selama berabad-abad.",
      clips: [{ id: "sc-002-k1", type: "stock", query: "volcanic ash jungle" }],
    },
    {
      id: "sc-003",
      narration: "Kini Borobudur menjadi warisan dunia UNESCO.",
      clips: [{ id: "sc-003-k1", type: "solid" }],
    },
  ],
});

export const makePlan = (mutate?: (input: ScenePlanInput) => void): ScenePlan => {
  const input = basePlanInput();
  mutate?.(input);
  return parseScenePlan(input);
};
