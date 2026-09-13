// Regenerate docs/conversion-matrix.md from the conversion registry.
// Run: pnpm gen:conversion-matrix
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMatrixMarkdown } from "../packages/conversion-registry/src/matrix.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "docs/conversion-matrix.md");
writeFileSync(destination, generateMatrixMarkdown());
console.log(`wrote ${destination}`);
