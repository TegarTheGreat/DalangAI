import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderEnvExample } from "../src/env-example";

/**
 * Menulis `.env.example` dari katalog konfigurasi (ADR-0032).
 * Jalankan: pnpm env:gen
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const target = join(repoRoot, ".env.example");
writeFileSync(target, renderEnvExample());
console.log(`.env.example ditulis dari katalog: ${target}`);
