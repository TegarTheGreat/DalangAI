import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ScenePlanInput } from "@dalang/core";
import type {
  AssetStore,
  LambdaRenderClient,
  LambdaRenderProgress,
  StartRenderInput,
} from "../src/ports";

export const planWithAssets = (): ScenePlanInput => ({
  version: 1,
  projectId: "proyek-lambda",
  meta: { title: "Uji Lambda", aspectRatio: "16:9", stylePreset: "documentary-01" },
  audio: { voice: { provider: "silence", voiceId: "x", speed: 1 } },
  scenes: [
    { id: "sc-001", narration: "Satu.", visual: { type: "image" }, duration: 5 },
    { id: "sc-002", narration: "Dua.", visual: { type: "image" }, duration: 5 },
  ],
  renderState: {
    narrationAudio: {},
    resolvedAssets: {
      "sc-001": { file: "assets/a.png", kind: "image", source: "local" },
      "sc-002": { file: "assets/b.png", kind: "image", source: "local" },
    },
  },
});

export const tempProject = (plan: ScenePlanInput = planWithAssets()) => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-lambda-"));
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  for (const file of ["assets/a.png", "assets/b.png"]) {
    const abs = join(dir, file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `isi-${file}`);
  }
  return { dir, planPath };
};

/** Penyimpanan objek palsu: mengingat apa yang diunggah, per proyek. */
export const fakeAssetStore = () => {
  const objects = new Map<string, string>();
  const uploads: string[] = [];
  const store: AssetStore = {
    urlFor: async (projectId, file) =>
      `https://bucket.test/${projectId}/${file}?sig=palsu`,
    has: async (projectId, file, sha256) =>
      objects.get(`${projectId}/${file}`) === sha256,
    upload: async ({ projectId, file, sha256, contentType }) => {
      objects.set(`${projectId}/${file}`, sha256);
      uploads.push(`${file}|${contentType}`);
    },
  };
  return { store, uploads, objects };
};

export interface FakeClientOptions {
  /** Barisan kemajuan yang dikembalikan berturut-turut. */
  progress?: Partial<LambdaRenderProgress>[];
  downloadBytes?: number;
}

const baseProgress: LambdaRenderProgress = {
  overallProgress: 0,
  done: false,
  fatalErrorEncountered: false,
  errors: [],
  outputFile: null,
  outputSizeInBytes: null,
  lambdasInvoked: 0,
  estimatedBillingDurationInMilliseconds: null,
  costs: { accruedSoFar: 0 },
};

export const fakeLambdaClient = (options: FakeClientOptions = {}) => {
  const steps = options.progress ?? [
    { overallProgress: 0.5 },
    { overallProgress: 1, done: true, outputFile: "https://s3.test/out.mp4" },
  ];
  const starts: StartRenderInput[] = [];
  let call = 0;
  const client: LambdaRenderClient = {
    startRender: async (input) => {
      starts.push(input);
      return { renderId: "render-1", bucketName: "remotionlambda-uji" };
    },
    getProgress: async () => {
      const step = steps[Math.min(call, steps.length - 1)];
      call += 1;
      return { ...baseProgress, ...step };
    },
    download: async ({ outPath }) => {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, "video-uji");
      return options.downloadBytes ?? 9;
    },
  };
  return { client, starts, polls: () => call };
};

export const instantSleep = async (): Promise<void> => {};
