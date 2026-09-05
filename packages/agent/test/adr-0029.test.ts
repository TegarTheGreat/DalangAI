import { addMemoryEntry, emptyMemory } from "@dalang/core";
import type { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { memoryStoreInMemory, runAgentTurn, SYSTEM_PROMPT } from "../src/index";
import {
  basicPlan,
  makeDeps,
  resolvedScripted,
  tempProject,
  textStep,
  toolCallStep,
} from "./helpers";

/**
 * Memori preferensi lintas proyek (ADR-0029): agent menyimpan hanya lewat
 * tool, membacanya lewat blok konteks tiap giliran, dan tanpa store ia
 * mengatakan tidak bisa — bukan pura-pura ingat.
 */
let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});
const open = () => {
  const project = tempProject(basicPlan());
  cleanups.push(project.cleanup);
  return project;
};

describe("memori preferensi lintas proyek", () => {
  it("rememberPreference menulis ke store dengan sumber agent dan proyek asal; duplikat tidak digandakan; forgetPreference menghapus", async () => {
    const project = open();
    const memory = memoryStoreInMemory();
    const { deps } = makeDeps({ memory });
    const model = resolvedScripted([
      toolCallStep("rememberPreference", {
        jenis: "gaya",
        teks: "Selalu pakai caption tegas untuk klip",
      }),
      toolCallStep("rememberPreference", {
        jenis: "gaya",
        teks: "selalu pakai  caption tegas untuk klip",
      }),
      textStep("Kuingat: caption tegas untuk klip."),
    ]);
    const result = await runAgentTurn({
      session: project.session,
      deps,
      model,
      userText: "Ke depannya selalu pakai caption tegas ya.",
    });
    expect(result.stop).toBe("selesai");
    expect(memory.current.entries).toHaveLength(1);
    expect(memory.current.entries[0]).toMatchObject({
      kind: "gaya",
      source: "agent",
      projectId: "proj-agent-test",
      text: "Selalu pakai caption tegas untuk klip",
    });
    const id = memory.current.entries[0]?.id ?? "";

    const forget = resolvedScripted([
      toolCallStep("forgetPreference", { id }),
      textStep("Sudah kulupakan."),
    ]);
    await runAgentTurn({
      session: project.session,
      deps,
      model: forget,
      userText: "Lupakan soal caption tegas.",
    });
    expect(memory.current.entries).toHaveLength(0);
    const events = project.session.events.recent();
    expect(events.some((event) => event.name === "rememberPreference")).toBe(true);
    expect(events.some((event) => event.name === "forgetPreference")).toBe(true);
  });

  it("preferensi yang ada masuk ke blok konteks tiap giliran; tanpa preferensi bloknya tidak ada", async () => {
    const project = open();
    const seeded = addMemoryEntry(emptyMemory(), {
      kind: "larangan",
      text: "Jangan pernah pakai musik dramatis",
      source: "user",
      now: "2026-09-02T00:00:00.000Z",
    });
    if (!seeded.ok) throw new Error(seeded.reason);
    const memory = memoryStoreInMemory(seeded.memory);
    const { deps } = makeDeps({ memory });
    const model = resolvedScripted([textStep("Baik.")]);
    await runAgentTurn({ session: project.session, deps, model, userText: "Halo." });
    const prompt = JSON.stringify(
      (model.model as MockLanguageModelV3).doGenerateCalls[0]?.prompt,
    );
    expect(prompt).toContain("[PREFERENSI USER LINTAS PROYEK — dari memori");
    expect(prompt).toContain("Jangan pernah pakai musik dramatis");
    expect(prompt).toContain(seeded.entry.id);

    const bare = open();
    const { deps: noMemory } = makeDeps({ memory: memoryStoreInMemory() });
    const quiet = resolvedScripted([textStep("Baik.")]);
    await runAgentTurn({
      session: bare.session,
      deps: noMemory,
      model: quiet,
      userText: "Halo.",
    });
    const bareprompt = JSON.stringify(
      (quiet.model as MockLanguageModelV3).doGenerateCalls[0]?.prompt,
    );
    // System prompt menyebut nama bloknya; yang tidak boleh ada adalah BLOK-nya.
    expect(bareprompt).not.toContain("[PREFERENSI USER LINTAS PROYEK — dari memori");
  });

  it("tanpa store, tool mengatakan memori tidak tersedia — bukan pura-pura menyimpan", async () => {
    const project = open();
    const { deps } = makeDeps({});
    const model = resolvedScripted([
      toolCallStep("rememberPreference", {
        jenis: "catatan",
        teks: "Sebut sumber di akhir video",
      }),
      textStep("Tidak bisa kusimpan di sini."),
    ]);
    await runAgentTurn({ session: project.session, deps, model, userText: "Ingat ya." });
    const event = project.session.events
      .recent()
      .find((item) => item.name === "rememberPreference");
    expect(event?.outputJson ?? "").toContain("tidak tersedia");
  });

  it("dua preferensi mutlak yang bertabrakan masuk konteks sebagai PERTENTANGAN yang menyuruh bertanya", async () => {
    const project = open();
    let seeded = emptyMemory();
    for (const text of ["Selalu 9:16 untuk semua video", "Setiap video wajib 16:9"]) {
      const added = addMemoryEntry(seeded, { kind: "format", text, source: "user" });
      if (!added.ok) throw new Error(added.reason);
      seeded = added.memory;
    }
    const memory = memoryStoreInMemory(seeded);
    const { deps } = makeDeps({ memory });
    const model = resolvedScripted([textStep("Baik.")]);
    await runAgentTurn({ session: project.session, deps, model, userText: "Halo" });
    const prompt = JSON.stringify(
      (model.model as MockLanguageModelV3).doGenerateCalls[0]?.prompt,
    );
    expect(prompt).toContain("PERTENTANGAN");
    expect(prompt).toContain("tanyakan user mana yang berlaku");
  });

  it("system prompt memuat kaidah memori: eksplisit saja, tanpa data pribadi", () => {
    expect(SYSTEM_PROMPT).toContain("MEMORI PREFERENSI LINTAS PROYEK");
    expect(SYSTEM_PROMPT).toContain("data pribadi");
    expect(SYSTEM_PROMPT).toContain("rememberPreference");
  });
});
