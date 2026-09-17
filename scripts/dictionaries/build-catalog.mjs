import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DICTIONARY_CODES = [
  "bg",
  "br",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "de-at",
  "de-ch",
  "el",
  "en",
  "en-au",
  "en-ca",
  "en-gb",
  "en-za",
  "eo",
  "es",
  "es-ar",
  "es-cl",
  "es-co",
  "es-mx",
  "et",
  "eu",
  "fa",
  "fo",
  "fr",
  "fy",
  "ga",
  "gd",
  "gl",
  "he",
  "hr",
  "hu",
  "hy",
  "is",
  "it",
  "ka",
  "ko",
  "la",
  "lb",
  "lt",
  "lv",
  "mk",
  "mn",
  "nb",
  "ne",
  "nl",
  "nn",
  "oc",
  "pl",
  "pt",
  "pt-pt",
  "ro",
  "ru",
  "rw",
  "sk",
  "sl",
  "sr",
  "sr-latn",
  "sv",
  "sv-fi",
  "tk",
  "tr",
  "uk",
  "vi",
];

export const BUNDLED_LOCALE_IDS = [
  "de_DE",
  "en_AU",
  "en_GB",
  "en_US",
  "fr_FR",
];

const LOCALE_ID_OVERRIDES = new Map([
  ["eo", "eo"],
  ["la", "la"],
]);

const REGISTRY = "https://registry.npmjs.org";
const CDN = "https://cdn.jsdelivr.net/npm";
const PACK_FILES = ["aff", "dic"];
const REQUEST_CONCURRENCY = 4;

export function npmNameFor(code) {
  return `dictionary-${code}`;
}

export function localeIdFor(code) {
  const override = LOCALE_ID_OVERRIDES.get(code);
  if (override) return override;
  const locale = new Intl.Locale(code);
  if (locale.script) {
    return `${locale.language}_${locale.script}`;
  }
  const region = locale.region ?? locale.maximize().region;
  if (!region || !/^[A-Z]{2}$/u.test(region)) {
    return locale.language;
  }
  return `${locale.language}_${region}`;
}

export function displayNamesFor(localeId) {
  const [language, qualifier] = localeId.split("_");
  const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
  const name = languageNames.of(language) ?? language;
  if (!qualifier) return { language: name, region: null };
  if (/^[A-Z]{2}$/u.test(qualifier)) {
    const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    return { language: name, region: regionNames.of(qualifier) ?? qualifier };
  }
  const scriptNames = new Intl.DisplayNames(["en"], { type: "script" });
  return { language: name, region: scriptNames.of(qualifier) ?? qualifier };
}

export function jsdelivrUrl(npmName, version, file) {
  return `${CDN}/${npmName}@${version}/${file}`;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function licenseIdFrom(manifest) {
  const raw = manifest?.license;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw.type === "string") return raw.type;
  return "";
}

export function buildPack({ code, version, licenseId, downloads }) {
  const id = localeIdFor(code);
  const npmName = npmNameFor(code);
  const names = displayNamesFor(id);
  return {
    id,
    language: names.language,
    region: names.region,
    npmName,
    version,
    bundled: BUNDLED_LOCALE_IDS.includes(id),
    files: PACK_FILES.map((extension) => {
      const download = downloads[extension];
      return {
        name: `${id}.${extension}`,
        url: jsdelivrUrl(npmName, version, `index.${extension}`),
        sha256: download.sha256,
        bytes: download.bytes,
      };
    }),
    license: {
      id: licenseId,
      url: jsdelivrUrl(npmName, version, "license"),
    },
  };
}

export function sortPacks(packs) {
  return [...packs].sort((a, b) =>
    a.id < b.id ? -1 : Number(a.id > b.id),
  );
}

function fileProblems(pack, file) {
  const problems = [];
  if (!/^[0-9a-f]{64}$/u.test(file.sha256)) {
    problems.push(`${pack.id} has no usable checksum for ${file.name}`);
  }
  if (!Number.isInteger(file.bytes) || file.bytes <= 0) {
    problems.push(`${pack.id} has no usable size for ${file.name}`);
  }
  if (!file.url.startsWith("https://")) {
    problems.push(`${pack.id} has a non-HTTPS address`);
  }
  return problems;
}

function packProblems(pack) {
  const problems = [];
  if (!/^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/u.test(pack.id)) {
    problems.push(`unusable id ${pack.id}`);
  }
  if (pack.files.length !== PACK_FILES.length) {
    problems.push(`${pack.id} does not carry both files`);
  }
  for (const file of pack.files) problems.push(...fileProblems(pack, file));
  if (!pack.license.id) problems.push(`${pack.id} has no license identifier`);
  return problems;
}

export function validateCatalog(packs) {
  const problems = [];
  const seen = new Set();
  for (const pack of packs) {
    if (seen.has(pack.id)) problems.push(`duplicate id ${pack.id}`);
    seen.add(pack.id);
    problems.push(...packProblems(pack));
  }
  for (const id of BUNDLED_LOCALE_IDS) {
    if (!seen.has(id)) problems.push(`bundled locale ${id} is missing`);
  }
  return problems;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function resolvePack(code) {
  const npmName = npmNameFor(code);
  const manifest = await fetchJson(`${REGISTRY}/${npmName}/latest`);
  const version = manifest.version;
  if (typeof version !== "string" || !version) {
    throw new Error(`${npmName} has no published version`);
  }
  const downloads = {};
  for (const extension of PACK_FILES) {
    const bytes = await fetchBytes(
      jsdelivrUrl(npmName, version, `index.${extension}`),
    );
    downloads[extension] = { sha256: sha256Hex(bytes), bytes: bytes.length };
  }
  return buildPack({
    code,
    version,
    licenseId: licenseIdFrom(manifest),
    downloads,
  });
}

async function runPool(items, worker, limit) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    })(),
  );
  await Promise.all(runners);
  return results;
}

async function main() {
  const skipped = [];
  const resolved = await runPool(
    DICTIONARY_CODES,
    async (code) => {
      try {
        return await resolvePack(code);
      } catch (error) {
        skipped.push(`${code}: ${error.message}`);
        return null;
      }
    },
    REQUEST_CONCURRENCY,
  );
  const packs = sortPacks(resolved.filter(Boolean));
  const problems = validateCatalog(packs);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exitCode = 1;
    return;
  }
  const out = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../src-tauri/resources/dictionary-packs.json",
  );
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(packs, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${packs.length} dictionary packs to ${out}\n`);
  for (const note of skipped.toSorted((a, b) => a.localeCompare(b))) {
    process.stdout.write(`skipped ${note}\n`);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  await main();
}
