import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scenePlanJsonSchema } from "../src/index";

const artifactUrl = new URL("../schema/scene-plan.v2.schema.json", import.meta.url);

describe("JSON Schema artifact", () => {
  it("committed artifact matches the zod source (run `pnpm schema:gen` if this fails)", () => {
    const artifact = JSON.parse(readFileSync(artifactUrl, "utf8"));
    expect(artifact).toEqual(scenePlanJsonSchema());
  });

  it("is an input-mode schema: fields with defaults are optional", () => {
    const schema = scenePlanJsonSchema() as {
      required: string[];
      additionalProperties: unknown;
    };
    expect(schema.required).toEqual(["version", "projectId", "meta", "scenes"]);
    expect(schema.additionalProperties).toBe(false);
  });
});
