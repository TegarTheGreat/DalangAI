import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { defaultMemoryPath, fileMemoryStore } from "@dalang/agent";
import {
  addMemoryEntry,
  computeTimeline,
  countWords,
  critiquePlan,
  defaultPublishMetadata,
  formatDirectorNotes,
  MEMORY_KIND_LABEL,
  MEMORY_KINDS,
  memoryConflictLines,
  memoryContextLines,
  PUBLISH_PRIVACIES,
  PUBLISH_PRIVACY_LABEL,
  removeMemoryEntry,
  resolveSceneDurationSec,
  type ScenePlan,
} from "@dalang/core";
import {
  atomicWriteFile,
  generatePlan,
  latestRenderFile,
  PipelineDb,
  projectPaths,
  publishedRecordFor,
  publishRender,
  readPlanFile,
  recordingsInPlan,
  runAsrStage,
  runProxyStage,
  type SceneStageResult,
} from "@dalang/pipeline";
import {
  buildAsrChain,
  buildPublishTargets,
  buildStockChain,
  buildTtsChain,
  PUBLISH_SETUP_HINT,
} from "@dalang/providers";
import {
  ENCODE_QUALITIES,
  type EncodeQuality,
  extensionFor,
  loadPlan,
  localRenderTarget,
  type ProgressEvent,
  type RenderProfile,
  type RenderTargetProgress,
  remotionAudioProbe,
  remotionTranscoder,
  renderPlanStills,
  renderPlanToVideo,
  resolveExportSettings,
  VIDEO_FORMATS,
  VIDEO_RESOLUTIONS,
  type VideoFormat,
  type VideoResolution,
} from "@dalang/renderer";
import { computeFrameLayout, FPS, TRANSITION_FRAMES } from "@dalang/templates/layout";
import { Command, InvalidArgumentError, Option } from "commander";
import { registerChatCommand, registerLogCommand } from "./chat";
import { buildLambdaTarget, readCloudConfig, registerCloudCommands } from "./cloud";
import { registerInteropCommands } from "./interop";
import { registerMcpCommand } from "./mcp";
import { planPathOf } from "./project-path";
import { registerProvidersCheckCommand } from "./providers-check";
import { registerReviewCommand } from "./review";
import { registerStudioCommand } from "./studio";

/**
 * `dalang` — CLI: validate, generate (deterministic pipeline, Fase 1), and
 * render a scene-plan locally.
 */

// API keys (ELEVENLABS_API_KEY, PEXELS_API_KEY, …) may live in a local .env.
try {
  process.loadEnvFile();
} catch {
  // .env is optional
}

const program = new Command();
program
  .name("dalang")
  .description(
    "Dalang AI — render video dari scene-plan JSON (agent-piloted video editor)",
  )
  .version("0.1.0");

const profileOption = () =>
  new Option("--profile <profile>", "profil render").choices(["draft", "final"]);

const parseSeconds = (value: string): number => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new InvalidArgumentError(`"${value}" bukan detik yang valid (angka ≥ 0)`);
  }
  return seconds;
};

const parsePositiveInt = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`"${value}" bukan bilangan bulat ≥ 1`);
  }
  return parsed;
};

const parseScale = (value: string): number => {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new InvalidArgumentError(`"${value}" bukan skala valid (0 < s ≤ 1)`);
  }
  return scale;
};

const collectSeconds = (value: string, previous: number[]): number[] => [
  ...previous,
  parseSeconds(value),
];

const formatSec = (sec: number): string => `${sec.toFixed(1)}s`;

const printPlanSummary = (plan: ScenePlan): void => {
  const layout = computeFrameLayout(plan);
  const { timings, totalSec } = computeTimeline(plan);

  console.log(`\n  ${plan.meta.title}`);
  console.log(
    `  ${plan.meta.aspectRatio} · preset ${plan.meta.stylePreset} · bahasa ${plan.meta.language}\n`,
  );
  const rows = plan.scenes.map((scene, index) => {
    const audio = plan.renderState.narrationAudio[scene.id];
    return {
      "#": index + 1,
      id: scene.id,
      tipe: scene.visual.type,
      kata: countWords(scene.narration),
      durasi: formatSec(resolveSceneDurationSec(scene, plan)),
      suara: audio
        ? audio.fallbackQuality
          ? "fallback"
          : "ok"
        : scene.narration.trim()
          ? "—"
          : "",
      aset:
        plan.renderState.resolvedAssets[scene.id]?.file ??
        (scene.visual.type === "template-anim" || scene.visual.type === "solid"
          ? "(template)"
          : "(belum di-resolve)"),
      lock: scene.locked ? "terkunci" : "",
    };
  });
  console.table(rows);
  console.log(
    `  Total: ${timings.length} scene · ${formatSec(totalSec)} materi · ` +
      `${formatSec(layout.totalFrames / FPS)} durasi video ` +
      `(${layout.totalFrames} frame @ ${FPS}fps, crossfade ${TRANSITION_FRAMES} frame)\n`,
  );
};

const progressPrinter = () => {
  let lastLine = "";
  // Menerima tahap dari KEDUA target: render lokal tidak mengenal "uploading"
  // dan "downloading", render cloud tidak mengenal "bundling".
  return (event: ProgressEvent | RenderTargetProgress) => {
    const line = `  ${event.stage} ${(event.progress * 100).toFixed(0)}%`;
    if (line !== lastLine) {
      process.stdout.write(`\r${line.padEnd(40)}`);
      lastLine = line;
    }
  };
};

/** Kemajuan tahap proxy (ADR-0028 §10): satu baris per berkas, diperbarui di tempat. */
const proxyProgressPrinter = () => {
  let last = "";
  return (event: { file: string; index: number; total: number; fraction: number }) => {
    const line = `  proxy ${event.index}/${event.total} ${event.file} ${(event.fraction * 100).toFixed(0)}%`;
    if (line !== last) {
      process.stdout.write(`\r${line.padEnd(70)}`);
      last = line;
    }
    if (event.fraction >= 1) {
      process.stdout.write("\n");
      last = "";
    }
  };
};

/** Kemajuan unggahan (ADR-0030): satu baris, diperbarui di tempat. */
const publishProgressPrinter = () => {
  let last = "";
  return (fraction: number) => {
    const line = `  unggah ${(fraction * 100).toFixed(0)}%`;
    if (line !== last) {
      process.stdout.write(`\r${line.padEnd(30)}`);
      last = line;
    }
  };
};

program
  .command("validate")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .description("Validasi scene-plan terhadap skema v0 dan tampilkan ringkasan")
  .action((planPath: string) => {
    const plan = loadPlan(planPathOf(planPath));
    console.log("Scene-plan valid (skema v0).");
    printPlanSummary(plan);
    // Kritik sutradara (ADR-0014): heuristik anti-"generic", murni saran.
    const notes = critiquePlan(plan);
    if (notes.length > 0) {
      console.log("  Saran sutradara:");
      for (const line of formatDirectorNotes(notes)) {
        console.log(`  - ${line}`);
      }
      console.log("");
    }
  });

program
  .command("still")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .option(
    "-t, --time <detik...>",
    "waktu (detik) yang di-render; bisa lebih dari satu",
    collectSeconds,
    [] as number[],
  )
  .option("-o, --out-dir <dir>", "folder output", "out")
  .option("-s, --scale <scale>", "skala render (1 = 1080p)", parseScale, 1)
  .addOption(profileOption().default("final"))
  .addOption(
    new Option("--format <format>", "format gambar")
      .choices(["png", "jpeg"])
      .default("png"),
  )
  .option("--no-cache", "jangan pakai bundle cache (selalu bundling ulang)")
  .description("Render satu atau beberapa frame (PNG/JPEG) untuk cek visual")
  .action(
    async (
      planPath: string,
      options: {
        time: number[];
        outDir: string;
        scale: number;
        profile: RenderProfile;
        format: "png" | "jpeg";
        cache: boolean;
      },
    ) => {
      const absPlan = planPathOf(planPath);
      const name = basename(dirname(absPlan));
      mkdirSync(resolve(options.outDir), { recursive: true });
      const times = options.time.length > 0 ? options.time : [1];
      const frames = times.map((t) => Math.round(t * FPS));
      const extension = options.format === "jpeg" ? "jpg" : "png";
      const { outputs, bundleFromCache } = await renderPlanStills({
        planPath: absPlan,
        frames,
        scale: options.scale,
        profile: options.profile,
        imageFormat: options.format,
        disableBundleCache: !options.cache,
        outputLocationFor: (frame) =>
          join(resolve(options.outDir), `${name}-f${frame}.${extension}`),
        onProgress: progressPrinter(),
      });
      process.stdout.write("\n");
      if (bundleFromCache) console.log("  (bundle cache: hit)");
      for (const output of outputs) {
        console.log(`frame ${output.frame} → ${output.outputLocation}`);
      }
    },
  );

registerCloudCommands(program);

program
  .command("render")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .option("-o, --out <file>", "file output video")
  .addOption(profileOption().default("draft"))
  .addOption(
    new Option(
      "--video-format <format>",
      "format kontainer (ADR-0014); menimpa default profil",
    ).choices(VIDEO_FORMATS),
  )
  .addOption(
    new Option("--resolution <p>", "sisi pendek piksel").choices(
      VIDEO_RESOLUTIONS.map(String),
    ),
  )
  .addOption(new Option("--quality <mutu>", "mutu enkode").choices(ENCODE_QUALITIES))
  .option(
    "--concurrency <n>",
    "jumlah tab render paralel (default: otomatis)",
    parsePositiveInt,
  )
  .option("--no-cache", "jangan pakai bundle cache (selalu bundling ulang)")
  .option(
    "--proxy",
    "render dari proxy pratinjau 540p bila ada (ADR-0028) — untuk draf, bukan final",
  )
  .addOption(
    new Option("--target <tujuan>", "di mana render dijalankan (ADR-0019)")
      .choices(["local", "lambda"])
      .default("local"),
  )
  .description("Render scene-plan menjadi video (MP4 H.264 / WebM VP9 / MOV ProRes)")
  .action(
    async (
      planPath: string,
      options: {
        out?: string;
        profile: RenderProfile;
        videoFormat?: VideoFormat;
        resolution?: string;
        quality?: EncodeQuality;
        concurrency?: number;
        cache: boolean;
        proxy?: boolean;
        target: "local" | "lambda";
      },
    ) => {
      const absPlan = planPathOf(planPath);
      const plan = loadPlan(absPlan);
      printPlanSummary(plan);
      if (options.proxy && options.profile === "final") {
        console.warn(
          "  PERHATIAN: --proxy pada profil final — hasilnya 540p yang diperbesar. Ini draf, bukan rilis.",
        );
      }

      const overrides = {
        ...(options.videoFormat ? { format: options.videoFormat } : {}),
        ...(options.resolution
          ? { resolution: Number(options.resolution) as VideoResolution }
          : {}),
        ...(options.quality ? { quality: options.quality } : {}),
      };
      const settings = resolveExportSettings(options.profile, overrides);
      const name = basename(dirname(absPlan));
      const outPath = resolve(
        options.out ??
          join(
            "out",
            `${name}-${settings.resolution}p-${settings.quality}.${extensionFor(settings.format)}`,
          ),
      );
      mkdirSync(dirname(outPath), { recursive: true });

      const target =
        options.target === "lambda"
          ? (() => {
              const read = readCloudConfig();
              if (!read.ok) {
                console.error(
                  "Render cloud belum diatur. Jalankan `dalang cloud:check` untuk melihat apa yang kurang.",
                );
                process.exit(1);
              }
              return buildLambdaTarget(read.config);
            })()
          : localRenderTarget({
              concurrency: options.concurrency ?? null,
              disableBundleCache: !options.cache,
            });

      if (target.id !== "local") {
        const estimate = await target.estimateCost({
          planPath: absPlan,
          outputLocation: outPath,
          profile: options.profile,
        });
        console.log(`  target ${target.label} · estimasi ~$${estimate.usd.toFixed(4)}`);
      }

      const startedAt = Date.now();
      const result = await target.render({
        planPath: absPlan,
        outputLocation: outPath,
        profile: options.profile,
        settings: overrides,
        ...(options.proxy ? { useProxies: true } : {}),
        onProgress: progressPrinter(),
      });
      process.stdout.write("\n");

      const elapsed = (Date.now() - startedAt) / 1000;
      console.log(
        `selesai: ${result.outputLocation}\n` +
          `  ${result.settings.format} ${result.width}×${result.height} (${result.settings.quality}) · ` +
          `${formatSec(result.durationSec)} · ` +
          `${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB · render ${formatSec(elapsed)}` +
          `${result.bundleFromCache ? " · bundle cache: hit" : ""}` +
          `${result.proxied ? ` · ${result.proxied} berkas dari proxy` : ""}` +
          mixLine(result, plan.meta.loudnessTarget),
      );
    },
  );

/**
 * Kenyaringan campuran akhir (ADR-0028) di samping sasarannya: angka yang
 * benar-benar akan didengar penonton, bukan janji normalisasi per klip.
 */
const mixLine = (
  result: { mixLufs?: number | null; mixGainDb?: number; mixNote?: string },
  target: number | null,
): string => {
  const mixLufs = result.mixLufs;
  if (typeof mixLufs !== "number") return "";
  if (!target)
    return `\n  campuran akhir ${mixLufs.toFixed(1)} LUFS (normalisasi nonaktif)`;
  const selisih = mixLufs - target;
  const arah =
    Math.abs(selisih) < 1 ? "pas sasaran" : selisih > 0 ? "lebih keras" : "lebih pelan";
  // Catatan koreksi (ADR-0028 §9) hanya bila ada yang perlu dijelaskan:
  // berkasnya digeser, atau masih meleset dan alasannya tertulis.
  const gain = result.mixGainDb ?? 0;
  const catatan =
    result.mixNote && (gain !== 0 || Math.abs(selisih) >= 1)
      ? ` · ${result.mixNote}`
      : "";
  return `\n  campuran akhir ${mixLufs.toFixed(1)} LUFS · sasaran ${target} · ${arah} (${selisih >= 0 ? "+" : ""}${selisih.toFixed(1)} LU)${catatan}`;
};

const STATUS_ICON: Record<SceneStageResult["status"], string> = {
  done: "ok",
  cached: "cache",
  skipped: "lewat",
  error: "GAGAL",
};

const printStageResults = (title: string, results: SceneStageResult[]): void => {
  if (results.length === 0) {
    console.log(`  ${title}: tidak ada scene yang perlu diproses`);
    return;
  }
  console.log(`  ${title}:`);
  for (const result of results) {
    const cost =
      result.costUsd && result.costUsd > 0 ? ` · ~$${result.costUsd.toFixed(4)}` : "";
    console.log(
      `    ${STATUS_ICON[result.status]} ${result.sceneId.padEnd(10)} ${result.detail}${cost}`,
    );
  }
};

program
  .command("generate")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .option("--force", "abaikan cache — jalankan ulang semua stage")
  .addOption(
    new Option("--render <profile>", "langsung render setelah pipeline selesai").choices([
      "draft",
      "final",
    ]),
  )
  .description(
    "Jalankan pipeline deterministik (TTS + resolve aset) dan tulis renderState ke plan",
  )
  .action(
    async (planPath: string, options: { force?: boolean; render?: RenderProfile }) => {
      const absPlan = planPathOf(planPath);
      const peek = readPlanFile(absPlan);

      const ttsProviders = peek.audio.voice
        ? buildTtsChain({ provider: peek.audio.voice.provider })
        : [];
      const stockProviders = buildStockChain();

      const summary = await generatePlan({
        planPath: absPlan,
        ttsProviders,
        stockProviders,
        // ADR-0026: tanpa port ini hanya berkas WAV yang bisa diukur.
        audioProbe: remotionAudioProbe(),
        // ADR-0028: proxy pratinjau untuk rekaman panjang/berat.
        transcoder: remotionTranscoder(),
        onProxyProgress: proxyProgressPrinter(),
        force: options.force,
        log: {
          info: (message) => console.log(message),
          warn: (message) => console.warn(message),
        },
      });

      console.log("");
      printStageResults("TTS", summary.tts);
      printStageResults("Aset", summary.assets);
      printStageResults("Kenyaringan", summary.loudness);
      printStageResults("Proxy", summary.proxies);
      console.log(
        `\n  ${summary.planChanged ? "renderState ditulis ke" : "Tidak ada perubahan pada"} ${summary.planPath}` +
          (summary.totalCostUsd > 0
            ? ` · perkiraan biaya ~$${summary.totalCostUsd.toFixed(4)}`
            : ""),
      );
      printPlanSummary(summary.plan);

      if (summary.errorCount > 0) {
        process.exitCode = 1;
        console.error(
          `GAGAL: ${summary.errorCount} scene bermasalah — lihat detail di atas (ledger: .dalang/pipeline.db)`,
        );
        return;
      }

      if (options.render) {
        const name = basename(dirname(absPlan));
        const outPath = resolve(join("out", `${name}-${options.render}.mp4`));
        mkdirSync(dirname(outPath), { recursive: true });
        const startedAt = Date.now();
        const result = await renderPlanToVideo({
          planPath: absPlan,
          outputLocation: outPath,
          profile: options.render,
          // ADR-0028: draf dari proxy; final selalu dari berkas aslinya.
          useProxies: options.render === "draft",
          onProgress: progressPrinter(),
        });
        process.stdout.write("\n");
        console.log(
          `selesai: ${result.outputLocation}\n` +
            `  ${result.width}×${result.height} · ${formatSec(result.durationSec)} · ` +
            `${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB · render ${formatSec((Date.now() - startedAt) / 1000)}` +
            `${result.proxied ? ` · ${result.proxied} berkas dari proxy` : ""}` +
            mixLine(result, summary.plan.meta.loudnessTarget),
        );
      }
    },
  );

program
  .command("proxy")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .option("--file <path...>", "batasi ke berkas tertentu (path relatif plan)")
  .option("--force", "abaikan cache — buat ulang proxy")
  .description(
    "Buat proxy pratinjau (H.264 540p) untuk rekaman panjang/berat di plan (ADR-0028); preview dan render draf memakainya, render final tidak",
  )
  .action(async (planPath: string, options: { file?: string[]; force?: boolean }) => {
    const absPlan = planPathOf(planPath);
    const paths = projectPaths(absPlan);
    const plan = readPlanFile(absPlan);
    const db = new PipelineDb(paths.dbPath);
    try {
      const outcome = await runProxyStage({
        paths,
        plan,
        db,
        transcoder: remotionTranscoder(),
        ...(options.file ? { files: options.file } : {}),
        ...(options.force !== undefined ? { force: options.force } : {}),
        onProgress: proxyProgressPrinter(),
        log: {
          info: (message) => console.log(message),
          warn: (message) => console.warn(message),
        },
      });
      console.log("");
      printStageResults("Proxy", outcome.results);
      const next = `${JSON.stringify(outcome.plan, null, 2)}\n`;
      if (next !== `${JSON.stringify(plan, null, 2)}\n`) {
        atomicWriteFile(absPlan, next);
        console.log(`\n  renderState ditulis ke ${absPlan}`);
      } else {
        console.log("\n  Tidak ada perubahan pada renderState.");
      }
      if (outcome.results.some((result) => result.status === "error")) {
        process.exitCode = 1;
      }
    } finally {
      db.close();
    }
  });

program
  .command("publish")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .option("--file <nama>", "berkas di .dalang/renders (bawaan: render terbaru)")
  .option("--judul <judul>", "judul video (bawaan: judul proyek)")
  .option("--deskripsi <teks>", "deskripsi (bawaan: narasi yang dibacakan)")
  .option("--tag <tag...>", "tag video (bawaan: format proyek + dalang)")
  .addOption(
    new Option("--privasi <privasi>", "private (bawaan) | unlisted | public")
      .choices(PUBLISH_PRIVACIES)
      .default("private"),
  )
  .option("--force", "unggah lagi walau berkas yang sama sudah pernah terunggah")
  .option("--yes", "tanpa pertanyaan konfirmasi")
  .description(
    "Unggah berkas render ke YouTube (ADR-0030) — butuh YOUTUBE_ACCESS_TOKEN; bawaan privat, dan berkas yang sama tidak diunggah dua kali tanpa --force",
  )
  .action(
    async (
      planPath: string,
      options: {
        file?: string;
        judul?: string;
        deskripsi?: string;
        tag?: string[];
        privasi: (typeof PUBLISH_PRIVACIES)[number];
        force?: boolean;
        yes?: boolean;
      },
    ) => {
      const absPlan = planPathOf(planPath);
      const paths = projectPaths(absPlan);
      const plan = readPlanFile(absPlan);
      const [target] = buildPublishTargets();
      if (!target) throw new Error(PUBLISH_SETUP_HINT);

      const rendersDir = join(paths.dalangDir, "renders");
      const name = options.file ? basename(options.file) : latestRenderFile(rendersDir);
      if (!name) {
        throw new Error(
          `Belum ada berkas render di ${rendersDir} — jalankan dalang render lebih dulu`,
        );
      }
      const filePath = join(rendersDir, name);
      if (!existsSync(filePath))
        throw new Error(`Berkas render tidak ditemukan: ${filePath}`);

      const metadata = {
        ...defaultPublishMetadata(plan),
        ...(options.judul ? { title: options.judul } : {}),
        ...(options.deskripsi !== undefined ? { description: options.deskripsi } : {}),
        ...(options.tag ? { tags: options.tag } : {}),
        privacy: options.privasi,
      };
      const sizeMb = (statSync(filePath).size / 1024 / 1024).toFixed(1);
      const firstLine = metadata.description.split("\n")[0] ?? "";
      console.log(
        `  berkas   : ${name} (${sizeMb} MB)\n` +
          `  tujuan   : ${target.label}\n` +
          `  judul    : ${metadata.title}\n` +
          `  privasi  : ${PUBLISH_PRIVACY_LABEL[metadata.privacy]}\n` +
          `  tag      : ${metadata.tags.join(", ") || "-"}\n` +
          `  deskripsi: ${firstLine.length > 90 ? `${firstLine.slice(0, 89)}…` : firstLine}`,
      );

      const db = new PipelineDb(paths.dbPath);
      try {
        const existing = publishedRecordFor(db, plan.projectId, paths, filePath);
        if (existing && !options.force) {
          console.log(
            `\n  Berkas ini sudah terunggah ${existing.at} → ${existing.url}\n` +
              "  Pakai --force untuk mengunggahnya lagi sebagai video baru.",
          );
          return;
        }
        if (!options.yes) {
          if (!process.stdin.isTTY) {
            throw new Error(
              "Unggahan butuh konfirmasi: jalankan di terminal interaktif atau tambahkan --yes",
            );
          }
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const answer = await rl.question(
            `\n  Unggah sekarang sebagai ${PUBLISH_PRIVACY_LABEL[metadata.privacy]}? Tidak bisa diurungkan dari sini. (y/T) `,
          );
          rl.close();
          if (!answer.trim().toLowerCase().startsWith("y")) {
            console.log("  Dibatalkan.");
            return;
          }
        }
        const outcome = await publishRender({
          paths,
          db,
          projectId: plan.projectId,
          target,
          filePath,
          metadata,
          force: options.force ?? false,
          onProgress: publishProgressPrinter(),
        });
        process.stdout.write("\n");
        if (outcome.status === "error") {
          process.exitCode = 1;
          console.error(`GAGAL: ${outcome.reason}`);
          return;
        }
        console.log(
          outcome.status === "cached"
            ? `  sudah terunggah sebelumnya: ${outcome.record.url}`
            : `  terunggah: ${outcome.record.url} (${PUBLISH_PRIVACY_LABEL[outcome.record.privacy]})`,
        );
      } finally {
        db.close();
      }
    },
  );

program
  .command("memori")
  .argument("[aksi]", "daftar | tambah | hapus", "daftar")
  .argument("[teks...]", "teks preferensi (tambah) atau id (hapus)")
  .option("--jenis <jenis>", `jenis preferensi: ${MEMORY_KINDS.join(" | ")}`, "catatan")
  .description(
    "Memori preferensi agent lintas proyek (ADR-0029) — satu berkas di rumah Dalang, dibaca dalang chat dan Studio",
  )
  .action((aksi: string, teks: string[], options: { jenis: string }) => {
    const store = fileMemoryStore(defaultMemoryPath());
    const memory = store.read();
    if (aksi === "daftar") {
      console.log(`  berkas: ${store.path}`);
      if (memory.entries.length === 0) {
        console.log(
          '  Belum ada preferensi. Tambah: dalang memori tambah --jenis gaya "Selalu pakai caption tegas"',
        );
        return;
      }
      for (const line of memoryContextLines(memory)) console.log(`  ${line}`);
      const conflicts = memoryConflictLines(memory);
      if (conflicts.length > 0) {
        console.log("");
        for (const line of conflicts) console.log(`  ${line}`);
      }
      return;
    }
    if (aksi === "tambah") {
      const jenis = MEMORY_KINDS.find((kind) => kind === options.jenis);
      if (!jenis)
        throw new Error(`--jenis harus salah satu dari: ${MEMORY_KINDS.join(", ")}`);
      const result = addMemoryEntry(memory, {
        kind: jenis,
        text: teks.join(" "),
        source: "user",
      });
      if (!result.ok) throw new Error(result.reason);
      if (!result.duplicate) store.write(result.memory);
      console.log(
        result.duplicate
          ? `  sudah ada: [${result.entry.id}] ${result.entry.text}`
          : `  disimpan: [${result.entry.id}] ${result.entry.text} (${MEMORY_KIND_LABEL[jenis]})`,
      );
      return;
    }
    if (aksi === "hapus") {
      const id = teks[0];
      if (!id) throw new Error("Sebutkan id preferensi: dalang memori hapus <id>");
      const { memory: next, removed } = removeMemoryEntry(memory, id);
      if (!removed) throw new Error(`Tidak ada preferensi ber-id ${id}`);
      store.write(next);
      console.log(`  dihapus: ${removed.text}`);
      return;
    }
    throw new Error(`Aksi tidak dikenal: ${aksi} (daftar | tambah | hapus)`);
  });

program
  .command("transcribe")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .option("--scene <id...>", "batasi ke scene tertentu")
  .option("--pembicara", "minta label pembicara (A/B) untuk wawancara/podcast")
  .option("--force", "abaikan cache — transkripsi ulang")
  .description(
    "Transkripsi rekaman video/audio di plan jadi teks berwaktu (ADR-0021), lalu tulis ke renderState",
  )
  .action(
    async (
      planPath: string,
      options: { scene?: string[]; pembicara?: boolean; force?: boolean },
    ) => {
      const absPlan = planPathOf(planPath);
      const paths = projectPaths(absPlan);
      const plan = readPlanFile(absPlan);

      const recordings = recordingsInPlan(plan, options.scene);
      if (recordings.size === 0) {
        console.log(
          "Tidak ada scene yang memakai rekaman video/audio — tidak ada yang perlu ditranskrip.",
        );
        console.log(
          "  Daftarkan rekaman lebih dulu (mis. lewat `dalang chat` dan tool ingestVideo).",
        );
        return;
      }

      const providers = buildAsrChain();
      if (providers.length === 0) {
        // Disebutkan persis apa yang kurang, bukan "gagal": mesin tanpa jalur
        // ASR adalah keadaan sah yang cuma butuh satu langkah pemasangan.
        process.exitCode = 1;
        console.error("Tidak ada jalur transkripsi di mesin ini. Pilih salah satu:");
        console.error(
          "  offline  pasang whisper.cpp + satu model GGML, atau set WHISPER_CPP_BIN & WHISPER_CPP_MODEL",
        );
        console.error("  API      set DEEPGRAM_API_KEY, atau ELEVENLABS_API_KEY");
        return;
      }

      console.log(
        `Transkripsi ${recordings.size} rekaman lewat ${providers.map((provider) => provider.label).join(" -> ")}`,
      );
      if (!providers[0]?.offline) {
        console.log(
          "  Catatan: provider pertama bukan jalur offline — rekaman dikirim ke layanan pihak ketiga.",
        );
      }

      const db = new PipelineDb(paths.dbPath);
      const outcome = await runAsrStage({
        paths,
        plan,
        providers,
        db,
        ...(options.scene ? { sceneIds: options.scene } : {}),
        ...(options.pembicara !== undefined ? { diarize: options.pembicara } : {}),
        ...(options.force !== undefined ? { force: options.force } : {}),
        log: {
          info: (message) => console.log(message),
          warn: (message) => console.warn(message),
        },
      });

      console.log("");
      printStageResults("Transkrip", outcome.results);

      const errors = outcome.results.filter((result) => result.status === "error").length;
      // Dibandingkan ISINYA, bukan identitas objeknya: cache hit tetap
      // menghasilkan objek baru (setTranscript menyalin), jadi `!==` akan
      // menulis ulang plan.json pada setiap jalan dan mengotori mtime-nya
      // tanpa satu pun perubahan nyata.
      const next = `${JSON.stringify(outcome.plan, null, 2)}\n`;
      if (next !== `${JSON.stringify(plan, null, 2)}\n`) {
        atomicWriteFile(absPlan, next);
        console.log(`\n  transkrip ditulis ke ${absPlan}`);
      } else {
        console.log("\n  tidak ada perubahan pada plan (semua dari cache)");
      }
      const cost = outcome.results.reduce(
        (sum, result) => sum + (result.costUsd ?? 0),
        0,
      );
      if (cost > 0) console.log(`  perkiraan biaya ~$${cost.toFixed(4)}`);

      for (const [file, transcript] of Object.entries(
        outcome.plan.renderState.transcripts,
      )) {
        const speakers = new Set(
          transcript.words.map((word) => word.speaker).filter((s) => s !== undefined),
        );
        console.log(
          `  ${file} — ${transcript.words.length} kata · ${transcript.language} · ` +
            `${transcript.durationSec.toFixed(1)} dtk` +
            (speakers.size > 1 ? ` · ${speakers.size} pembicara` : ""),
        );
      }

      if (errors > 0) {
        process.exitCode = 1;
        console.error(`\nGAGAL: ${errors} rekaman bermasalah — lihat detail di atas`);
      }
    },
  );

registerInteropCommands(program);
registerMcpCommand(program);
registerReviewCommand(program);
registerChatCommand(program);
registerLogCommand(program);
registerStudioCommand(program);

registerProvidersCheckCommand(program);

program.parseAsync().catch((error: unknown) => {
  console.error(`\nGAGAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
