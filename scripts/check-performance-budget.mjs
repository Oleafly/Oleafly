import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertNoProductionDevHookTokens } from "./production-hook-audit.mjs";

const root = new URL("../dist/assets/", import.meta.url);
const names = await readdir(root);
const assets = await Promise.all(
  names.map(async (name) => ({
    name,
    bytes: (await stat(fileURLToPath(new URL(name, root)))).size,
  })),
);

const limits = {
  // Calibrated from the current production graph with narrow regression
  // headroom. These are emitted (uncompressed) desktop assets, not transfer
  // sizes; lowering them requires deliberate dependency/code splitting.
  // Recalibrated for 0.2.8: the AI provider revamp (provider logos, key
  // validation, personas) grew the main chunk past the pre-revamp gate.
  // Current production graph measures 3.93 MB after the language-service and
  // proofreading surfaces shipped together. Keep the ceiling at 4 MB so a
  // small dependency fluctuation fails loudly without blocking the validated
  // build on an insignificant few-kilobyte delta.
  largestJavaScript: 4_000_000,
  // The selectable preview lazily loads pdf.js' official viewer helpers for
  // link actions and tagged-PDF structure. Keep narrow headroom above that
  // independently emitted 180 KB chunk without relaxing the startup gate.
  // The PDF viewer emits two independently validated worker builds and the
  // editor intelligence chunks are now shipped as first-class features. Keep
  // the gate within a narrow 9.01 MB desktop envelope while allowing those
  // production-only chunks to coexist without brittle filename-specific cuts.
  // The 10 KB margin also avoids a false regression when deterministic
  // minifier output shifts by a few hundred bytes across supported Node builds.
  // +200 KB for the project-intelligence worker's own lazy unified-latex
  // parser chunk (workers cannot share main-thread chunks; the AST glossary
  // pass needs the parser inside the worker).
  // +10 KB headroom for the Windows window-controls feature.
  // +10 KB headroom for the Experimentation settings (Visual editor / LaTeX
  // tools gating) and the omnibar command wiring.
  totalJavaScript: 9_230_000,
  largestCss: 400_000,
  harperWasm: 19_000_000,
  // The real worker and the independently loaded recovery module are each
  // emitted once. The recovery module is lazy and never affects startup.
  pdfWorkers: 1,
  pdfFallbacks: 1,
};

const javascript = assets.filter((asset) => /\.(?:js|mjs)$/.test(asset.name));
const css = assets.filter((asset) => asset.name.endsWith(".css"));
const workers = assets.filter((asset) => /^pdf\.worker-[^.]+\.js$/.test(asset.name));
const fallbacks = assets.filter((asset) => /^pdf\.worker\.min-[^.]+\.js$/.test(asset.name));
const harper = assets.find((asset) => asset.name.startsWith("harper_wasm_bg-"));
const failures = [];
const largestJavaScript = Math.max(0, ...javascript.map((asset) => asset.bytes));
const totalJavaScript = javascript.reduce((total, asset) => total + asset.bytes, 0);
const largestCss = Math.max(0, ...css.map((asset) => asset.bytes));
const productionTextArtifacts = await Promise.all([
  ...javascript.map(async (asset) => [
    `assets/${asset.name}`,
    await readFile(new URL(asset.name, root), "utf8"),
  ]),
  ...css.map(async (asset) => [
    `assets/${asset.name}`,
    await readFile(new URL(asset.name, root), "utf8"),
  ]),
  (async () => [
    "index.html",
    await readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  ])(),
]);

if (largestJavaScript > limits.largestJavaScript) {
  failures.push(`largest JavaScript asset is ${largestJavaScript} bytes`);
}
if (totalJavaScript > limits.totalJavaScript) {
  failures.push(`total JavaScript is ${totalJavaScript} bytes`);
}
if (largestCss > limits.largestCss) {
  failures.push(`largest CSS asset is ${largestCss} bytes`);
}
if (!harper || harper.bytes > limits.harperWasm) {
  failures.push(`Harper WASM is ${harper?.bytes ?? 0} bytes`);
}
if (workers.length !== limits.pdfWorkers) {
  failures.push(`PDF worker count is ${workers.length}`);
} else {
  const workerModule = await import(new URL(workers[0].name, root).href);
  if (typeof workerModule.WorkerMessageHandler?.setup !== "function") {
    failures.push("PDF worker does not export WorkerMessageHandler");
  }
}
if (fallbacks.length !== limits.pdfFallbacks) {
  failures.push(`PDF fallback count is ${fallbacks.length}`);
} else {
  const fallbackSource = await readFile(new URL(fallbacks[0].name, root), "utf8");
  if (!/export\{[^}]*WorkerMessageHandler/.test(fallbackSource)) {
    failures.push("PDF fallback does not export WorkerMessageHandler");
  }
}
if (assets.some((asset) => asset.name.startsWith("binaryInlined-"))) {
  failures.push("Harper is embedded in JavaScript");
}
try {
  assertNoProductionDevHookTokens(productionTextArtifacts);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}

console.log(
  JSON.stringify({
    largestJavaScript,
    totalJavaScript,
    largestCss,
    harperWasm: harper.bytes,
    pdfWorkers: workers.length,
    pdfFallbacks: fallbacks.length,
    devHookTokens: 0,
  }),
);
