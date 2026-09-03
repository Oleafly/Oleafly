import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const SEEDS = path.join(REPO, "fixtures/research-seeds");
const INDEXABLE = /\.(?:tex|typ|md|markdown|bib)$/i;
const MAX_FILES = 40;
const TOP_K = 8;

const PROJECTS = [
  "computational-physics-phd-thesis",
  "sparse-attention-systems-paper",
  "bilingual-cjk-research-note",
];

const QUERIES = [
  "block sparse attention kernel throughput",
  "\\section{Evaluation} table latency",
  "adaptive lattice refinement solver blocks",
  "morphological prior vocabulary transfer",
  "bibliography entry doi year",
  "GPU memory during prefill OOM",
  "中文 摘要 abstract",
  "a b c d",
  "the the the the the",
  "convergence validation error norm equation label reference numbering appendix coefficient solver configuration lattice",
];

async function loadScorer() {
  const source = fs.readFileSync(path.join(REPO, "src/lib/ai-rag.ts"), "utf8");
  const pure = source
    .split("\n")
    .filter((line) => !/^import .* from "@\//.test(line))
    .join("\n");
  const target = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "oleafly-rag-golden-")),
    "ai-rag.ts",
  );
  fs.writeFileSync(target, pure);
  return import(pathToFileURL(target).href);
}

function byName(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function walk(root, dir, out) {
  if (out.length >= MAX_FILES) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => byName(a.name, b.name));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.name === ".oleafly" || entry.name === ".git") continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, out);
      continue;
    }
    if (!INDEXABLE.test(entry.name)) continue;
    out.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

function collectSources(root) {
  const paths = [];
  walk(root, root, paths);
  return paths.map((rel) => {
    const bytes = fs.readFileSync(path.join(root, rel));
    const content = bytes.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(bytes)) {
      throw new Error(`${rel} is not valid UTF-8; this generator assumes lossless decoding`);
    }
    return { path: rel, content: content.replace(/\r\n/g, "\n") };
  });
}

const rag = await loadScorer();
const cases = [];
for (const project of PROJECTS) {
  const sources = collectSources(path.join(SEEDS, project));
  for (const query of QUERIES) {
    const tokens = rag.queryTokens(query.trim());
    const chunks = tokens.length ? rag.rankChunks(tokens, sources, TOP_K) : [];
    cases.push({ project, query, topK: TOP_K, files: sources.length, chunks });
  }
}

const target = path.join(HERE, "golden.json");
fs.writeFileSync(
  target,
  `${JSON.stringify(
    {
      source: "src/lib/ai-rag.ts rankChunks over fixtures/research-seeds",
      topK: TOP_K,
      projects: PROJECTS,
      cases,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${target}: ${cases.length} cases`);
