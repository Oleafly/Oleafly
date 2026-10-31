import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { measurePdfjsAssets, pdfjsAssetFailures, pdfjsAssetSummary } from "./pdfjs-asset-budget.mjs";

const dist = new URL("../web/dist/", import.meta.url);
const assetsDir = new URL("assets/", dist);

const limits = {
  startupJavaScript: 460_000,
  totalJavaScript: 7_570_000,
  wasm: {
    oleafly_synctex: 360_000,
  },
};

const names = await readdir(assetsDir);
const assets = await Promise.all(
  names.map(async (name) => ({ name, bytes: (await stat(fileURLToPath(new URL(name, assetsDir)))).size })),
);
const byName = new Map(assets.map((asset) => [asset.name, asset]));
const javascript = assets.filter((asset) => asset.name.endsWith(".js"));
const modules = assets.filter((asset) => asset.name.endsWith(".wasm"));

const indexHtml = await readFile(new URL("index.html", dist), "utf8");
const entryName = indexHtml.match(/<script[^>]+src="\/web\/assets\/([^"]+\.js)"/u)?.[1];
const failures = [];
if (!entryName || !byName.has(entryName)) failures.push("the entry chunk named in web/dist/index.html is missing");

const sources = new Map(
  await Promise.all(
    javascript.map(async (asset) => [asset.name, await readFile(new URL(asset.name, assetsDir), "utf8")]),
  ),
);

// Static imports only: `import ... from "./x.js"`, `export ... from "./x.js"`
// and bare `import "./x.js"`, not `import("./x.js")`, which is what loads on
// demand.
const STATIC_IMPORT = /(?:(?:^|[;\s}])import|\bfrom)\s*["']\.\/([^"']+)["']/gu;
const startup = new Set();
const queue = entryName ? [entryName] : [];
for (const preload of indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/web\/assets\/([^"]+\.js)"/gu)) {
  queue.push(preload[1]);
}
while (queue.length > 0) {
  const name = queue.shift();
  const text = sources.get(name);
  if (startup.has(name) || text === undefined) continue;
  startup.add(name);
  for (const [, target] of text.matchAll(STATIC_IMPORT)) {
    if (target.endsWith(".js")) queue.push(target);
  }
}

const sum = (items) => items.reduce((total, asset) => total + asset.bytes, 0);
const startupJavaScript = sum([...startup].map((name) => byName.get(name)));
const totalJavaScript = sum(javascript);

if (startupJavaScript > limits.startupJavaScript) failures.push(`startup JavaScript is ${startupJavaScript} bytes`);
if (totalJavaScript > limits.totalJavaScript) failures.push(`total JavaScript is ${totalJavaScript} bytes`);
for (const module of modules) {
  const name = module.name.replace(/-[\w-]{8}\.wasm$/u, "");
  const limit = limits.wasm[name];
  if (limit === undefined) failures.push(`${module.name} has no size limit; add it to the budget`);
  else if (module.bytes > limit) failures.push(`${module.name} is ${module.bytes} bytes, over ${limit}`);
}
for (const [name, text] of sources) {
  if (text.includes("Oleafly test engine")) failures.push(`${name} carries the test engine, which production builds leave out`);
}
const pdfjs = await measurePdfjsAssets(new URL("pdfjs/", dist));
failures.push(...pdfjsAssetFailures(pdfjs));

if (failures.length > 0) throw new Error(failures.join("\n"));

console.log(
  JSON.stringify({
    startupChunks: startup.size,
    startupJavaScript,
    totalJavaScript,
    wasm: Object.fromEntries(modules.map((module) => [module.name, module.bytes])),
    pdfjs: pdfjsAssetSummary(pdfjs),
  }),
);
