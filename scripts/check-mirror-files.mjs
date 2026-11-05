#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");
export const MIRROR = "https://mirrors.oleafly.com/";
const MANIFESTS = [
  "src-tauri/resources/font-packs.json",
  "src-tauri/resources/typst-toolchain.json",
  "scripts/language-servers/manifest.json",
];
const TINYTEX_SOURCE = "src-tauri/src/latex_engine.rs";
const BUNDLE_SOURCE = "crates/oleafly-core/src/engine_spec.rs";
const FETCH_SCRIPTS = ["scripts/fetch-tectonic.sh", "scripts/fetch-pandoc.sh", "scripts/fetch-biber.sh"];
const SCRIPT_VERSION = /^VERSION="([^"]+)"$/mu;
const SCRIPT_MIRROR = /mirror_url="(https:\/\/mirrors\.oleafly\.com\/[^"]+)"/u;
const SCRIPT_ENTRY = /echo "([^":|]+)[:|]/gu;
const ARCHIVE_EXTENSIONS = [".tar.gz", ".tar.xz", ".tgz", ".zip"];
const MIN_SCRIPT_ASSETS = 4;
const TINYTEX_TAG = /const TINYTEX_TAG: &str = "([^"]+)";/u;
const TINYTEX_BASE = /const TINYTEX_MIRROR_BASE: &str = "([^"]+)";/u;
const TINYTEX_ASSET = /\(\s*"(TinyTeX[^"]*)",\s*"([a-z.]+)",\s*ArchiveFormat::\w+,\s*([\d_]+),/gu;
const BUNDLE_URL = /pub const TEX_BUNDLE_MIRROR_URL: &str =\s*"([^"]+)";/u;
const MIN_TINYTEX_ASSETS = 4;
const CONCURRENCY = 8;
const TIMEOUT_MS = 30_000;

function usage() {
  return `Usage:
  node scripts/check-mirror-files.mjs [--root <dir>]

Lists every file the app and its build scripts download from ${MIRROR}
(the manifests in ${MANIFESTS.join(", ")}, the TinyTeX archives in
${TINYTEX_SOURCE}, the Tectonic bundle in ${BUNDLE_SOURCE} and the
sidecar archives in ${FETCH_SCRIPTS.join(", ")}) and sends a HEAD request
for each.
A file the bucket has is then read one byte at a time through the edge cache.
A missing file, a wrong size, or an edge that still answers 404 for an
uploaded file fails the check. A refusal, rate limit, server error or network
failure is reported as unverified, because it says nothing about whether the
file was uploaded.

The first request is a HEAD on purpose: the mirror's edge cache keeps a GET
404 for days, so a file is only read with GET once the bucket has it.

Options:
  --root <dir>  Repository root (default: this repository)
  --list        Print the file addresses, one per line, and check nothing.
                A copy of these files at the same paths is a complete mirror.
  -h, --help    Show this help`;
}

export function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, help: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") options.help = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--root" && index + 1 < argv.length) {
      options.root = resolve(argv[index + 1]);
      index += 1;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function sizeOf(entry) {
  for (const key of ["archiveSize", "size", "bytes"]) {
    if (Number.isSafeInteger(entry[key]) && entry[key] > 0) return entry[key];
  }
  return null;
}

export function mirrorFilesInManifest(value, origin) {
  const found = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const field of Object.values(node)) {
      if (typeof field === "string" && field.startsWith(MIRROR) && field.length > MIRROR.length) {
        found.push({ url: field, size: sizeOf(node), origin });
      } else {
        visit(field);
      }
    }
  };
  visit(value);
  return found;
}

export function tinytexFiles(source, origin = TINYTEX_SOURCE) {
  const tag = TINYTEX_TAG.exec(source)?.[1];
  const base = TINYTEX_BASE.exec(source)?.[1];
  if (!tag || !base) throw new Error(`${origin} no longer declares TINYTEX_TAG and TINYTEX_MIRROR_BASE`);
  const files = [...source.matchAll(TINYTEX_ASSET)].map(([, name, extension, size]) => ({
    url: `${base}/${tag}/${name}-${tag}.${extension}`,
    size: Number(size.replaceAll("_", "")),
    origin,
  }));
  if (files.length < MIN_TINYTEX_ASSETS) {
    throw new Error(`${origin} lists ${files.length} TinyTeX archives, expected at least ${MIN_TINYTEX_ASSETS}`);
  }
  return files;
}

export function bundleFiles(source, origin = BUNDLE_SOURCE) {
  const url = BUNDLE_URL.exec(source)?.[1];
  if (!url) throw new Error(`${origin} no longer declares TEX_BUNDLE_MIRROR_URL`);
  return [
    { url, size: null, origin },
    { url: `${url}.index.gz`, size: null, origin },
  ];
}

export function fetchScriptFiles(source, origin) {
  const version = SCRIPT_VERSION.exec(source)?.[1];
  const template = SCRIPT_MIRROR.exec(source)?.[1];
  if (!version || !template?.includes("$VERSION") || !template.includes("$asset")) {
    throw new Error(`${origin} no longer declares VERSION and a mirror_url built from $VERSION and $asset`);
  }
  const files = [...source.matchAll(SCRIPT_ENTRY)]
    .map(([, asset]) => asset.replaceAll("$VERSION", version))
    .filter((asset) => ARCHIVE_EXTENSIONS.some((extension) => asset.endsWith(extension)))
    .map((asset) => ({
      url: template.replaceAll("$VERSION", version).replaceAll("$asset", asset),
      size: null,
      origin,
    }));
  if (files.length < MIN_SCRIPT_ASSETS) {
    throw new Error(`${origin} lists ${files.length} archives, expected at least ${MIN_SCRIPT_ASSETS}`);
  }
  return files;
}

export async function collectMirrorFiles(root) {
  const read = (path) => readFile(join(root, path), "utf8");
  const [manifests, tinytex, bundle, scripts] = await Promise.all([
    Promise.all(MANIFESTS.map(read)),
    read(TINYTEX_SOURCE),
    read(BUNDLE_SOURCE),
    Promise.all(FETCH_SCRIPTS.map(read)),
  ]);
  const files = [
    ...manifests.flatMap((text, index) => mirrorFilesInManifest(JSON.parse(text), MANIFESTS[index])),
    ...tinytexFiles(tinytex),
    ...bundleFiles(bundle),
    ...scripts.flatMap((text, index) => fetchScriptFiles(text, FETCH_SCRIPTS[index])),
  ];
  const byUrl = new Map();
  for (const file of files) {
    if (!byUrl.has(file.url)) byUrl.set(file.url, file);
  }
  return [...byUrl.values()];
}

export function classify(file, outcome) {
  if (outcome.error) return { verdict: "unverified", reason: `request failed: ${outcome.error}` };
  const { status, length } = outcome;
  if (status === 404 || status === 410) return { verdict: "missing", reason: `HTTP ${status}` };
  if (status < 200 || status > 299) return { verdict: "unverified", reason: `HTTP ${status}` };
  if (file.size !== null && length !== null && length !== file.size) {
    return { verdict: "wrong-size", reason: `${length} bytes instead of ${file.size}` };
  }
  return { verdict: "ok", reason: `HTTP ${status}` };
}

export function classifyEdge(file, outcome) {
  if (outcome.error) return { verdict: "unverified", reason: `edge read failed: ${outcome.error}` };
  const { status, total, cache } = outcome;
  if (status === 404 || status === 410) {
    const cacheStatus = cache ? ` (${cache})` : "";
    return {
      verdict: "stale-edge",
      reason: `the bucket has it, but the edge cache answers HTTP ${status}${cacheStatus}. Purge this address in the Cloudflare dashboard`,
    };
  }
  if (status !== 200 && status !== 206) return { verdict: "unverified", reason: `edge read HTTP ${status}` };
  if (file.size !== null && total !== null && total !== file.size) {
    return { verdict: "wrong-size", reason: `the edge serves ${total} bytes instead of ${file.size}` };
  }
  return { verdict: "ok", reason: `HTTP ${status}` };
}

async function headRequest(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const header = response.headers.get("content-length");
    const length = header !== null && /^\d+$/u.test(header) ? Number(header) : null;
    return { status: response.status, length };
  } catch (error) {
    return { error: error?.message ?? String(error) };
  }
}

async function edgeRead(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel?.();
    const range = /\/(\d+)$/u.exec(response.headers.get("content-range") ?? "")?.[1];
    const length = response.headers.get("content-length");
    const whole = response.status === 200 && length !== null && /^\d+$/u.test(length) ? Number(length) : null;
    return {
      status: response.status,
      total: range === undefined ? whole : Number(range),
      cache: response.headers.get("cf-cache-status"),
    };
  } catch (error) {
    return { error: error?.message ?? String(error) };
  }
}

async function checkFile(file, fetchImpl) {
  const bucket = classify(file, await headRequest(file.url, fetchImpl));
  if (bucket.verdict !== "ok") return bucket;
  return classifyEdge(file, await edgeRead(file.url, fetchImpl));
}

export async function checkFiles(files, fetchImpl = fetch, concurrency = CONCURRENCY) {
  const results = new Array(files.length);
  let next = 0;
  const worker = async () => {
    const index = next;
    if (index >= files.length) return;
    next += 1;
    const file = files[index];
    results[index] = { ...file, ...(await checkFile(file, fetchImpl)) };
    await worker();
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return results;
}

export function formatReport(results, annotate = false) {
  const failing = new Set(["missing", "wrong-size", "stale-edge"]);
  const labels = { missing: "missing", "wrong-size": "wrong size", "stale-edge": "stale edge 404" };
  const failed = results.filter((result) => failing.has(result.verdict));
  const unverified = results.filter((result) => result.verdict === "unverified");
  const output = [];
  const errors = [];
  for (const result of failed) {
    const line = `${labels[result.verdict]}: ${result.url} (${result.reason}, listed in ${result.origin})`;
    errors.push(annotate ? `::error title=Mirror file ${result.verdict}::${line}` : line);
  }
  for (const result of unverified) {
    const line = `unverified: ${result.url} (${result.reason})`;
    output.push(annotate ? `::warning title=Mirror file unverified::${line}` : line);
  }
  const ok = results.length - failed.length - unverified.length;
  output.push(`${results.length} mirror files: ${ok} present, ${failed.length} missing or wrong, ${unverified.length} unverified`);
  return { output, errors };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const files = await collectMirrorFiles(options.root);
  if (options.list) {
    for (const file of files) console.log(file.url);
    return 0;
  }
  const results = await checkFiles(files);
  const report = formatReport(results, process.env.GITHUB_ACTIONS === "true");
  for (const line of report.output) console.log(line);
  for (const line of report.errors) console.error(line);
  return report.errors.length === 0 ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`mirror file check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
