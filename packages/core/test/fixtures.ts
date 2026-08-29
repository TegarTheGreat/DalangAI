import { parseScenePlan, type ScenePlan, type ScenePlanInput } from "../src/index";

export const basePlanInput = (): ScenePlanInput => ({
  version: 1,
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
      visual: { type: "stock", query: "borobudur temple aerial sunrise" },
    },
    {
      id: "sc-002",
      narration: "Candi ini sempat terkubur abu vulkanik selama berabad-abad.",
      visual: { type: "stock", query: "volcanic ash jungle" },
    },
    {
      id: "sc-003",
      narration: "Kini Borobudur menjadi warisan dunia UNESCO.",
      visual: { type: "solid" },
    },
  ],
});

export const makePlan = (mutate?: (input: ScenePlanInput) => void): ScenePlan => {
  const input = basePlanInput();
  mutate?.(input);
  return parseScenePlan(input);
};
