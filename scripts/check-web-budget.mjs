// Size budget for the browser app in web/dist. WebAssembly modules load on
// demand, so each is measured on its own; every JavaScript chunk, an engine's
// included, counts toward the total.
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = new URL("../web/dist/", import.meta.url);
const assetsDir = new URL("assets/", dist);

const limits = {
  // The chunks index.html loads before first paint: the entry and the chunks
  // it imports statically. 445,181 bytes when this budget was set, 1.6 KB over
  // the browser app before compiling came in.
  startupJavaScript: 460_000,
  // Every JavaScript chunk: 7,105,776 bytes when this budget was set. Each
  // interface language adds about 85 KB of catalog chunks that load on
  // demand; with Vietnamese, the 22nd, the total is 7,288,582 bytes.
  totalJavaScript: 7_450_000,
  // Each WebAssembly module by name. One not listed here fails the check, so
  // a new one is added on purpose, with its size.
  wasm: {
    // The shared SyncTeX code: 319,131 bytes.
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

// Every chunk's text, read once for the startup walk and the test-engine check.
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

if (failures.length > 0) throw new Error(failures.join("\n"));

console.log(
  JSON.stringify({
    startupChunks: startup.size,
    startupJavaScript,
    totalJavaScript,
    wasm: Object.fromEntries(modules.map((module) => [module.name, module.bytes])),
  }),
);
