import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scenePlanJsonSchema } from "../src/json-schema";

const out = fileURLToPath(
  new URL("../schema/scene-plan.v1.schema.json", import.meta.url),
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(scenePlanJsonSchema(), null, 2)}\n`);
console.log(`JSON Schema ditulis ke ${out}`);
