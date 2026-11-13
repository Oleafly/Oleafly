import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public/artifact-runtime/react-runtime.js");
const config = path.join(root, "vite.artifact-runtime.config.ts");
const inputs = [
  path.join(root, "src/components/notes/artifact-runtime/react-runtime.ts"),
  path.join(root, "src/components/notes/artifact-runtime/runtime-core.ts"),
  config,
  path.join(root, "scripts/build-artifact-runtime.mjs"),
  path.join(root, "pnpm-lock.yaml"),
];

export function isFresh() {
  if (!existsSync(output)) return false;
  const built = statSync(output).mtimeMs;
  return inputs.every((input) => !existsSync(input) || statSync(input).mtimeMs <= built);
}

async function main() {
  if (!process.argv.includes("--force") && isFresh()) {
    console.log("artifact runtime is up to date");
    return;
  }
  const { build } = await import("vite");
  await build({ configFile: config, root, mode: "production" });
  const size = statSync(output).size;
  console.log(`artifact runtime built: ${(size / 1024 / 1024).toFixed(2)} MiB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
