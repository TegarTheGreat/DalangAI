import { describe, expect, it } from "vitest";
import {
  parseScenePlan,
  rebaseRenderState,
  type ScenePlanInput,
  setNarrationAudio,
  setResolvedAsset,
} from "../src";

/**
 * Koherensi Studio–server MCP: tahap pipeline bekerja pada snapshot, pihak
 * lain mengubah berkasnya di tengah jalan, dan yang boleh menang hanya
 * DELTA renderState milik tahap — bukan seluruh snapshot-nya.
 */
const input = (): ScenePlanInput => ({
  version: 1,
  projectId: "uji-rebase",
  meta: { title: "Judul awal", aspectRatio: "16:9", language: "id" },
  audio: {},
  scenes: [
    { id: "sc-1", narration: "Satu.", visual: { type: "image" } },
    { id: "sc-2", narration: "Dua.", visual: { type: "image" } },
    { id: "sc-3", narration: "Tiga.", visual: { type: "image" } },
  ],
  renderState: {
    narrationAudio: {},
    resolvedAssets: {
      "sc-2": { file: "assets/lama.png", kind: "image", source: "local" },
    },
  },
});

const asset = (file: string) => ({
  file,
  kind: "image" as const,
  source: "local" as const,
});

describe("rebaseRenderState", () => {
  it("membawa entri yang ditambah dan dihapus tahap, mempertahankan kreatif dan turunan milik base", () => {
    const before = parseScenePlan(input());
    // Tahap: menambah narasi sc-1, menghapus aset sc-2.
    let after = setNarrationAudio(before, "sc-1", {
      file: ".dalang/tts/sc-1.wav",
      durationSec: 2.5,
      fallbackQuality: false,
      wordTimestamps: [],
    });
    after = structuredClone(after);
    delete after.renderState.resolvedAssets["sc-2"];
    // Sementara itu pihak lain: judul berubah, aset sc-3 dipasang, sc-2 diganti.
    let base = structuredClone(before);
    base.meta.title = "Diubah dari luar";
    base = setResolvedAsset(base, "sc-3", asset("assets/dari-mcp.png"));
    base = setResolvedAsset(base, "sc-2", asset("assets/diganti-dari-luar.png"));

    const merged = rebaseRenderState(base, before, after);
    expect(merged.meta.title).toBe("Diubah dari luar");
    expect(merged.renderState.narrationAudio["sc-1"]?.file).toBe(".dalang/tts/sc-1.wav");
    expect(merged.renderState.resolvedAssets["sc-3"]?.file).toBe("assets/dari-mcp.png");
    // Tahap menghapus sc-2 dari snapshot-nya: penghapusan itu ikut, walau
    // pihak lain sempat menggantinya — tahap memang memutuskannya.
    expect(merged.renderState.resolvedAssets["sc-2"]).toBeUndefined();
    // Tidak menyentuh masukan.
    expect(base.renderState.resolvedAssets["sc-2"]?.file).toBe(
      "assets/diganti-dari-luar.png",
    );
  });

  it("entri yang tidak disentuh tahap tidak ditulis ulang: perubahan pihak lain padanya bertahan", () => {
    const before = parseScenePlan(input());
    const after = setNarrationAudio(before, "sc-3", {
      file: ".dalang/tts/sc-3.wav",
      durationSec: 1,
      fallbackQuality: false,
      wordTimestamps: [],
    });
    const base = setResolvedAsset(before, "sc-2", asset("assets/baru-dari-luar.png"));
    const merged = rebaseRenderState(base, before, after);
    expect(merged.renderState.resolvedAssets["sc-2"]?.file).toBe(
      "assets/baru-dari-luar.png",
    );
    expect(merged.renderState.narrationAudio["sc-3"]?.durationSec).toBe(1);
  });

  it("tanpa perubahan tahap, hasilnya sama dengan base", () => {
    const plan = parseScenePlan(input());
    const base = structuredClone(plan);
    base.meta.title = "Lain";
    expect(rebaseRenderState(base, plan, plan)).toEqual(base);
  });
});
