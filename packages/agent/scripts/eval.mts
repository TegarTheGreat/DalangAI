/**
 * Runner suite eval agent (ADR-0022 §7.4).
 *
 * Menjawab satu pertanyaan yang sebelumnya hanya bisa dijawab dengan kesan:
 * apakah perubahan prompt atau pergantian model membuat keluaran agent lebih
 * baik atau lebih buruk?
 *
 * Butuh model ORKESTRATOR SUNGGUHAN — dan itu memang inti gunanya. Menjalankan
 * eval terhadap model mock akan mengukur skrip mock-nya, bukan agent-nya, dan
 * angka yang keluar akan terlihat meyakinkan sambil tidak berarti apa-apa.
 * Tanpa kunci API, runner ini berhenti dan menyebutkan apa yang kurang.
 *
 *   pnpm --filter @dalang/agent eval                    # semua kasus
 *   pnpm --filter @dalang/agent eval -- --case brief-minim
 *   pnpm --filter @dalang/agent eval -- --self-check    # tanpa model: uji rangkanya
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseScenePlan } from "@dalang/core";
import {
  buildAsrChain,
  buildGifChain,
  buildIconProvider,
  buildSfxChain,
  buildStockChain,
  buildTtsChain,
} from "@dalang/providers";
import { EVAL_CASES } from "../src/eval/cases";
import { formatScoreLine, scorePlan } from "../src/eval/score";
import { pickDefaultModels } from "../src/models/defaults";
import { loadModelRegistry } from "../src/models/registry";
import { type ResolvedModel, resolveModel } from "../src/models/resolve";
import { runAgentTurn } from "../src/runtime/agent";
import { Guardrails } from "../src/runtime/guardrails";
import { ProjectSession } from "../src/runtime/session";
import type { AgentDeps } from "../src/tools";

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const selfCheck = args.includes("--self-check");
const cases = only ? EVAL_CASES.filter((item) => item.id === only) : EVAL_CASES;

if (cases.length === 0) {
  console.error(
    `Kasus "${only}" tidak ada. Tersedia: ${EVAL_CASES.map((item) => item.id).join(", ")}`,
  );
  process.exit(1);
}

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

/**
 * Mode rangka: menilai plan contoh repo tanpa memanggil model sama sekali.
 * Membuktikan penilai + papan skornya jalan; TIDAK membuktikan apa pun soal
 * mutu agent — dan pesannya mengatakan itu, supaya angkanya tidak salah baca.
 */
if (selfCheck) {
  const demo = parseScenePlan(
    JSON.parse(
      readFileSync(join(repoRoot, "examples", "borobudur-60s", "plan.json"), "utf8"),
    ),
  );
  const score = scorePlan(demo, { language: "id", mustMention: ["Borobudur"] });
  console.log("Uji rangka eval (TANPA model — bukan ukuran mutu agent):");
  console.log(formatScoreLine("examples/borobudur-60s", score));
  for (const check of score.checks) {
    console.log(
      `      ${check.passed ? "ok   " : "GAGAL"} ${check.name} — ${check.detail}`,
    );
  }
  // Keluar 1 kalau ada yang gagal — kalau tidak, mode ini tak berguna sebagai
  // gerbang CI: ia akan mencetak "GAGAL" lalu tetap melaporkan sukses. Dua
  // regresi yang ditangkapnya nyata: penilai yang rusak, dan plan contoh repo
  // yang diedit sampai melanggar kaidahnya sendiri.
  const failed = score.checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    console.error(
      `\nGAGAL: ${failed.length} pemeriksaan tidak lolos pada plan contoh repo.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

// Netral vendor, sama seperti CLI: environment yang menentukan modelnya.
const registry = await loadModelRegistry();
const defaults = pickDefaultModels(process.env, registry);
if (!defaults.orchestrator) {
  console.error("Eval butuh model orkestrator sungguhan, dan tidak ada yang tersedia.");
  console.error(`  ${defaults.reason}`);
  console.error(
    "  Untuk sekadar memastikan rangkanya jalan: pnpm --filter @dalang/agent eval -- --self-check",
  );
  process.exit(1);
}
const orchestrator = resolveModel(defaults.orchestrator, { registry });
let volumeModel: ResolvedModel | undefined;
if (defaults.volume) {
  try {
    volumeModel = resolveModel(defaults.volume, { registry });
  } catch {
    // Model volume opsional: eval tetap berjalan tanpanya.
  }
}

console.log(`Eval ${cases.length} kasus lewat ${orchestrator.key}\n`);

const results: { id: string; score: number }[] = [];
for (const item of cases) {
  const dir = mkdtempSync(join(tmpdir(), `dalang-eval-${item.id}-`));
  const planPath = join(dir, "plan.json");
  // Proyek KOSONG: eval mengukur kemampuan menyusun dari brief, bukan
  // kemampuan menyunting plan yang sudah bagus.
  writeFileSync(
    planPath,
    JSON.stringify(
      {
        version: 1,
        projectId: `eval-${item.id}`,
        meta: { title: "Proyek eval" },
        scenes: [{ id: "sc-001", narration: "", visual: { type: "solid" } }],
      },
      null,
      2,
    ),
  );

  try {
    const session = ProjectSession.open(planPath);
    // Semua approval DITOLAK: eval berjalan tanpa manusia, dan menyetujui
    // diam-diam akan membelanjakan uang tanpa ada yang memutuskan.
    const guards = new Guardrails({}, async () => false);
    const deps: AgentDeps = {
      guards,
      ttsChainFor: (provider) => buildTtsChain({ provider }),
      stockChain: () => buildStockChain(),
      stickerChain: () => buildGifChain({ stickers: true }),
      iconProvider: () => buildIconProvider(),
      sfxChain: () => buildSfxChain(),
      asrChain: () => buildAsrChain(),
      // Eval menilai PLAN, bukan render: semua yang memakan menit CPU ditolak,
      // dan penolakannya tegas supaya tidak diam-diam terlewat.
      renderVideo: async () => {
        throw new Error("render dimatikan saat eval");
      },
      renderStills: async () => {
        throw new Error("tinjauan render dimatikan saat eval");
      },
      videoMetadata: async () => null,
      detectSilence: async () => null,
      saveMedia: async () => {
        throw new Error("unduh media dimatikan saat eval");
      },
      ...(volumeModel ? { volumeModel } : {}),
    };

    const started = Date.now();
    const turn = await runAgentTurn({
      session,
      deps,
      model: orchestrator,
      userText: item.brief,
    });
    const plan = session.plan;
    if (!plan) {
      console.log(`  ${item.id.padEnd(28)}  TIDAK MENGHASILKAN PLAN`);
      console.log(`      sumbu: ${item.sumbu}`);
      results.push({ id: item.id, score: 0 });
      continue;
    }
    const score = scorePlan(plan, item.expectation);
    results.push({ id: item.id, score: score.score });
    console.log(formatScoreLine(item.id, score));
    console.log(
      `      sumbu: ${item.sumbu} · ${((Date.now() - started) / 1000).toFixed(1)}s · ` +
        `~$${guards.turnCostUsd.toFixed(4)} · berhenti: ${turn.stop} (${turn.steps} langkah)`,
    );
  } catch (error) {
    console.log(
      `  ${item.id.padEnd(28)}  GALAT: ${error instanceof Error ? error.message : String(error)}`,
    );
    results.push({ id: item.id, score: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rata = results.reduce((sum, item) => sum + item.score, 0) / (results.length || 1);
console.log(
  `\nRerata ${rata.toFixed(1)} atas ${results.length} kasus (${orchestrator.key}).`,
);
console.log(
  "Ingat batasnya: skor ini mengukur KEPATUHAN dan KERAJINAN, bukan apakah naskahnya menarik.",
);
