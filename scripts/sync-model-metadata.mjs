import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");

export const SNAPSHOT_PATH = resolve(
  REPOSITORY_ROOT,
  "src-tauri",
  "resources",
  "model-metadata.json",
);
export const UPSTREAM_URL = "https://models.dev/api.json";
export const SCHEMA_VERSION = 1;
export const SOURCE_NAME = "models.dev";
export const FETCH_TIMEOUT_MS = 30_000;

export const PROVIDER_IDS = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  openrouter: "openrouter",
  groq: "groq",
  deepseek: "deepseek",
  mistral: "mistral",
  xai: "xai",
  perplexity: "perplexity",
  zai: "zai",
};

const STATUSES = new Set(["active", "deprecated", "alpha", "beta"]);
const MODALITIES = new Set(["text", "image", "audio", "video", "pdf"]);

function byId(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0) return undefined;
  return Math.trunc(value);
}

function price(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  return value;
}

function isoDate(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

export function normalizeStatus(value) {
  if (typeof value !== "string") return "active";
  const status = value.trim().toLowerCase();
  return STATUSES.has(status) ? status : "active";
}

export function normalizeModalities(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const modality = entry.trim().toLowerCase();
    if (MODALITIES.has(modality)) seen.add(modality);
  }
  return [...seen];
}

export function normalizeCost(value) {
  if (!isRecord(value)) return undefined;
  const cost = {};
  const input = price(value.input);
  if (input !== undefined) cost.input = input;
  const output = price(value.output);
  if (output !== undefined) cost.output = output;
  const cacheRead = price(value.cache_read);
  if (cacheRead !== undefined) cost.cacheRead = cacheRead;
  return Object.keys(cost).length > 0 ? cost : undefined;
}

export function trimModel(modelId, model) {
  const source = isRecord(model) ? model : {};
  const limit = isRecord(source.limit) ? source.limit : {};
  const modalities = isRecord(source.modalities) ? source.modalities : {};
  const entry = {};

  entry.name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : modelId;

  const contextWindow = positiveInteger(limit.context);
  if (contextWindow !== undefined) entry.contextWindow = contextWindow;
  const outputLimit = positiveInteger(limit.output);
  if (outputLimit !== undefined) entry.outputLimit = outputLimit;

  entry.inputModalities = normalizeModalities(modalities.input);
  entry.outputModalities = normalizeModalities(modalities.output);
  entry.toolCall = source.tool_call === true;
  entry.reasoning = source.reasoning === true;
  entry.attachment = source.attachment === true;
  entry.structuredOutput = source.structured_output === true;
  entry.status = normalizeStatus(source.status);

  const releaseDate = isoDate(source.release_date);
  if (releaseDate !== undefined) entry.releaseDate = releaseDate;
  const lastUpdated = isoDate(source.last_updated);
  if (lastUpdated !== undefined) entry.lastUpdated = lastUpdated;

  const cost = normalizeCost(source.cost);
  if (cost !== undefined) entry.cost = cost;

  return entry;
}

export function buildSnapshot(upstream, { generatedAt = new Date().toISOString() } = {}) {
  if (!isRecord(upstream)) {
    throw new TypeError("Upstream payload is not an object");
  }
  const providers = {};
  for (const upstreamId of Object.keys(PROVIDER_IDS).sort(byId)) {
    const provider = upstream[upstreamId];
    if (!isRecord(provider) || !isRecord(provider.models)) continue;
    const models = {};
    for (const modelId of Object.keys(provider.models).sort(byId)) {
      models[modelId] = trimModel(modelId, provider.models[modelId]);
    }
    if (Object.keys(models).length === 0) continue;
    providers[PROVIDER_IDS[upstreamId]] = models;
  }
  return { schemaVersion: SCHEMA_VERSION, source: SOURCE_NAME, generatedAt, providers };
}

export function summarize(snapshot) {
  const rows = Object.entries(snapshot.providers).map(([providerId, models]) => ({
    providerId,
    count: Object.keys(models).length,
  }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return { rows, total };
}

export function serializeSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

async function loadUpstream(source) {
  if (!source || source === UPSTREAM_URL || /^https?:\/\//i.test(source)) {
    const url = source && /^https?:\/\//i.test(source) ? source : UPSTREAM_URL;
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`Fetching ${url} failed with HTTP ${response.status}`);
    }
    return { origin: url, payload: await response.json() };
  }
  const path = resolve(process.cwd(), source);
  return { origin: path, payload: JSON.parse(await readFile(path, "utf8")) };
}

async function main(argv) {
  const source = argv.find((argument) => !argument.startsWith("-"));
  const { origin, payload } = await loadUpstream(source);
  const snapshot = buildSnapshot(payload);
  const text = serializeSnapshot(snapshot);
  await writeFile(SNAPSHOT_PATH, text, "utf8");

  const { rows, total } = summarize(snapshot);
  const width = rows.reduce((longest, row) => Math.max(longest, row.providerId.length), 0);
  process.stdout.write(`Read ${origin}\n`);
  process.stdout.write(`Wrote ${SNAPSHOT_PATH}\n`);
  for (const row of rows) {
    process.stdout.write(`  ${row.providerId.padEnd(width)}  ${row.count}\n`);
  }
  process.stdout.write(
    `${rows.length} providers, ${total} models, ${Buffer.byteLength(text, "utf8")} bytes\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
