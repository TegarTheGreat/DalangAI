import { z } from "zod";
import { scenePlanSchema } from "./scene-plan";

/**
 * JSON Schema artifact for editor tooling (autocomplete/validation of
 * plan.json outside TypeScript). Generated into schema/ via `pnpm schema:gen`;
 * a unit test keeps the committed artifact in sync with the zod source.
 *
 * Note: zod refinements (e.g. the duplicate-scene-id check) are not
 * representable in JSON Schema — the runtime parser stays the authority.
 */
export const scenePlanJsonSchema = (): Record<string, unknown> => {
  const generated = z.toJSONSchema(scenePlanSchema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return {
    ...generated,
    title: "Dalang Scene-Plan v1",
    description:
      "Single source of truth sebuah video Dalang (PRD §5.1). Divalidasi runtime oleh @dalang/core (zod).",
  };
};
