#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const UPSTREAM_REPO = "https://github.com/James-Yu/LaTeX-Workshop";
const UPSTREAM_COMMIT = "becabe238d3539105dd5bb9b7b3571d26e5d43e0";
const TARBALL_URL = `https://codeload.github.com/James-Yu/LaTeX-Workshop/tar.gz/${UPSTREAM_COMMIT}`;
const ALLOWED_DOWNLOAD_HOST = "codeload.github.com";
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_OUT_DIR = join("public", "latex-intelligence");
const PACKAGE_BASENAME_RE = /^[A-Za-z0-9@_+-]+$/;

function usage() {
  return `Usage:
  node scripts/latex-intelligence-extract.mjs [options]

Options:
  --tarball <path>  Use a local LaTeX Workshop source tarball instead of
                    downloading the pinned commit from ${ALLOWED_DOWNLOAD_HOST}
  --out <dir>       Output directory (default: ${DEFAULT_OUT_DIR})
  -h, --help        Show this help

Downloads the pinned LaTeX Workshop commit (${UPSTREAM_COMMIT.slice(0, 12)}, MIT),
extracts its data/ corpus, and normalizes it into deterministic JSON consumed by
@oleafly/latex-intelligence. Any upstream field the script does not explicitly
handle causes a hard failure so schema drift is never silently dropped.`;
}

function readOptionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv) {
  const options = { tarball: null, out: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    } else if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else if (argument === "--tarball") {
      options.tarball = readOptionValue(argv, index, "--tarball");
      index += 1;
    } else if (argument === "--out") {
      options.out = readOptionValue(argv, index, "--out");
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

/**
 * Convert a VS Code snippet body to the CodeMirror snippet() grammar,
 * which supports \`\${N}\` and \`\${N:placeholder}\` fields only.
 */
export function normalizeSnippet(snippet) {
  // Decode VS Code snippet escapes: \\ -> \, \} -> }, \$ -> $.
  let out = snippet.replace(/\\([\\}$])/g, "$1");
  // VS Code variables (${TM_SELECTED_TEXT}, ...) become an empty field.
  out = out.replace(/\$\{TM_[A-Za-z0-9_]*\}/g, "${}");
  // $0 (final cursor) becomes an empty field; bare $N becomes ${N}.
  out = out.replace(/\$(\d+)/g, (_match, digits) =>
    Number(digits) === 0 ? "${}" : `\${${digits}}`,
  );
  // TeXStudio CWL placeholder classifiers (`options%keyvals`, `unit%formula`)
  // are metadata, not display text — strip them from placeholder labels.
  out = out.replace(
    /\$\{(\d+):([^{}]*?)%[a-z|]+\}/g,
    (_match, digits, label) => `\${${digits}:${label}}`,
  );
  return out;
}

function fail(message) {
  throw new Error(message);
}

function assertString(value, context) {
  if (typeof value !== "string") fail(`${context}: expected a string, got ${typeof value}`);
  return value;
}

function assertBoolean(value, context) {
  if (typeof value !== "boolean") fail(`${context}: expected a boolean, got ${typeof value}`);
  return value;
}

function assertNumber(value, context) {
  if (typeof value !== "number") fail(`${context}: expected a number, got ${typeof value}`);
  return value;
}

function assertStringArray(value, context) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(`${context}: expected an array of strings`);
  }
  return value;
}

function assertPlainObject(value, context) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${context}: expected an object`);
  }
  return value;
}

/**
 * Guard against silently dropping upstream data: every key of `value` must be
 * named in `handled`, otherwise the extraction hard-fails pointing at the file
 * and key so handling can be extended deliberately.
 */
function assertOnlyKeys(value, handled, context) {
  for (const key of Object.keys(value)) {
    if (!handled.includes(key)) {
      fail(`${context}: unhandled key "${key}" (extend scripts/latex-intelligence-extract.mjs)`);
    }
  }
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareStrings);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    const sorted = {};
    for (const key of Object.keys(value).sort(compareStrings)) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

function stableStringify(value) {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

function downloadTarball(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.host !== ALLOWED_DOWNLOAD_HOST) {
    fail(`refusing to download from ${parsed.host}; only ${ALLOWED_DOWNLOAD_HOST} is allowed`);
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(parsed, { method: "GET", timeout: DOWNLOAD_TIMEOUT_MS }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        rejectPromise(new Error(`download failed with HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(resolvePromise));
      file.on("error", rejectPromise);
      response.on("error", rejectPromise);
    });
    req.on("timeout", () => req.destroy(new Error(`download timed out: ${url}`)));
    req.on("error", rejectPromise);
    req.end();
  });
}

function extractDataSubtree(tarballPath, workDir) {
  const list = spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (list.status !== 0) fail(`tar -tzf failed: ${list.stderr}`);
  const firstEntry = list.stdout.split("\n", 1)[0];
  const prefix = firstEntry.split("/", 1)[0];
  if (!/^[A-Za-z0-9._-]+$/.test(prefix)) fail(`unexpected tarball prefix: ${prefix}`);
  const extract = spawnSync("tar", ["-xzf", tarballPath, "-C", workDir, `${prefix}/data`], {
    encoding: "utf8",
  });
  if (extract.status !== 0) fail(`tar -xzf failed: ${extract.stderr}`);
  return join(workDir, prefix, "data");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function withoutUndefined(entry) {
  const cleaned = {};
  for (const [key, value] of Object.entries(entry)) {
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned;
}

function normalizeCoreCommands(raw) {
  assertPlainObject(raw, "commands.json");
  const commands = [];
  for (const [name, entry] of Object.entries(raw)) {
    const context = `commands.json[${name}]`;
    assertPlainObject(entry, context);
    // `postAction` (a VS Code editor command) is intentionally dropped.
    assertOnlyKeys(entry, ["snippet", "detail", "documentation", "postAction"], context);
    commands.push(
      withoutUndefined({
        name,
        snippet:
          entry.snippet === undefined
            ? undefined
            : normalizeSnippet(assertString(entry.snippet, `${context}.snippet`)),
        detail: entry.detail === undefined ? undefined : assertString(entry.detail, `${context}.detail`),
        documentation:
          entry.documentation === undefined
            ? undefined
            : assertString(entry.documentation, `${context}.documentation`),
      }),
    );
  }
  commands.sort((a, b) => compareStrings(a.name, b.name));
  return commands;
}

function normalizeCoreEnvironments(raw) {
  if (!Array.isArray(raw)) fail("environments.json: expected an array");
  const environments = [];
  for (const entry of raw) {
    const context = `environments.json[${entry?.name ?? "?"}]`;
    assertPlainObject(entry, context);
    assertOnlyKeys(entry, ["name", "arg"], context);
    const name = assertString(entry.name, `${context}.name`);
    let snippet;
    if (entry.arg !== undefined) {
      assertPlainObject(entry.arg, `${context}.arg`);
      // `format` (an argument-signature descriptor) is intentionally dropped.
      assertOnlyKeys(entry.arg, ["format", "snippet"], `${context}.arg`);
      snippet = normalizeSnippet(assertString(entry.arg.snippet, `${context}.arg.snippet`));
    }
    environments.push(withoutUndefined({ name, snippet }));
  }
  environments.sort((a, b) => compareStrings(a.name, b.name));
  return environments;
}

function normalizeNameList(raw, sourceName) {
  assertPlainObject(raw, sourceName);
  const names = sortedUnique(Object.keys(raw));
  const details = {};
  for (const [name, entry] of Object.entries(raw)) {
    const context = `${sourceName}[${name}]`;
    assertPlainObject(entry, context);
    // `command` repeats the key and `documentation` is a CTAN link; both are
    // intentionally dropped.
    assertOnlyKeys(entry, ["command", "detail", "documentation"], context);
    const detail = entry.detail === undefined ? "" : assertString(entry.detail, `${context}.detail`);
    if (detail !== "") details[name] = detail;
  }
  return { names, details };
}

function normalizeUnimath(raw) {
  assertPlainObject(raw, "unimathsymbols.json");
  const symbols = {};
  for (const [name, entry] of Object.entries(raw)) {
    const context = `unimathsymbols.json[${name}]`;
    assertPlainObject(entry, context);
    // `command` repeats the key and is intentionally dropped. `snippet` does
    // not exist upstream at the pinned commit; add handling here if it appears.
    assertOnlyKeys(entry, ["command", "detail", "documentation"], context);
    const symbol = withoutUndefined({
      detail: entry.detail === undefined ? undefined : assertString(entry.detail, `${context}.detail`),
      documentation:
        entry.documentation === undefined
          ? undefined
          : assertString(entry.documentation, `${context}.documentation`),
    });
    symbols[name] = symbol;
  }
  return symbols;
}

/**
 * Normalize upstream at-suggestions.json (math-mode `@` shortcut snippets)
 * into a sorted array of { trigger, replacement, detail? }. Triggers keep
 * their leading `@`; duplicate triggers (upstream has two `@|` entries) are
 * kept and disambiguated by the sort tiebreakers.
 */
export function normalizeAtSuggestions(raw) {
  assertPlainObject(raw, "at-suggestions.json");
  const suggestions = [];
  for (const [name, entry] of Object.entries(raw)) {
    const context = `at-suggestions.json[${name}]`;
    assertPlainObject(entry, context);
    assertOnlyKeys(entry, ["prefix", "body", "description"], context);
    const trigger = assertString(entry.prefix, `${context}.prefix`);
    if (!trigger.startsWith("@")) {
      fail(`${context}.prefix: expected a leading "@", got ${JSON.stringify(trigger)}`);
    }
    suggestions.push(
      withoutUndefined({
        trigger,
        replacement: normalizeSnippet(assertString(entry.body, `${context}.body`)),
        detail:
          entry.description === undefined
            ? undefined
            : assertString(entry.description, `${context}.description`),
      }),
    );
  }
  suggestions.sort((a, b) => {
    return (
      compareStrings(a.trigger, b.trigger) ||
      compareStrings(a.replacement, b.replacement) ||
      compareStrings(a.detail ?? "", b.detail ?? "")
    );
  });
  return suggestions;
}

function normalizeBibtexEntries(raw, sourceName) {
  assertPlainObject(raw, sourceName);
  for (const [entryType, fields] of Object.entries(raw)) {
    assertStringArray(fields, `${sourceName}[${entryType}]`);
  }
  return raw;
}

function dedupeSortedEntries(entries) {
  entries.sort((a, b) => {
    return (
      compareStrings(a.name, b.name) ||
      compareStrings(a.snippet ?? "", b.snippet ?? "") ||
      compareStrings(JSON.stringify(sortKeysDeep(a)), JSON.stringify(sortKeysDeep(b)))
    );
  });
  const deduped = [];
  let previous;
  for (const entry of entries) {
    const serialized = JSON.stringify(sortKeysDeep(entry));
    if (serialized !== previous) deduped.push(entry);
    previous = serialized;
  }
  return deduped;
}

function normalizeArgFields(arg, context) {
  assertPlainObject(arg, context);
  // `format` (an argument-signature descriptor such as "[]{}") is
  // intentionally dropped; the snippet already encodes the arguments.
  assertOnlyKeys(arg, ["format", "snippet", "keys", "keyPos"], context);
  return {
    snippet: normalizeSnippet(assertString(arg.snippet, `${context}.snippet`)),
    keys: arg.keys === undefined ? undefined : assertStringArray(arg.keys, `${context}.keys`),
    keyPos: arg.keyPos === undefined ? undefined : assertNumber(arg.keyPos, `${context}.keyPos`),
  };
}

function normalizeModernPackage(raw, sourceName) {
  assertOnlyKeys(raw, ["deps", "macros", "envs", "keys", "args"], sourceName);

  const depNames = [];
  if (!Array.isArray(raw.deps)) fail(`${sourceName}.deps: expected an array`);
  for (const dep of raw.deps) {
    const context = `${sourceName}.deps[]`;
    assertPlainObject(dep, context);
    // `if` marks a dependency loaded only under a package option; the closure
    // keeps every dependency name, so the condition itself is dropped.
    assertOnlyKeys(dep, ["name", "if"], context);
    depNames.push(assertString(dep.name, `${context}.name`));
  }

  const macros = [];
  if (!Array.isArray(raw.macros)) fail(`${sourceName}.macros: expected an array`);
  for (const macro of raw.macros) {
    const context = `${sourceName}.macros[${macro?.name ?? "?"}]`;
    assertPlainObject(macro, context);
    // `if` (option-conditional availability) is intentionally dropped; the
    // macro is offered unconditionally. `doc` is renamed `documentation`.
    assertOnlyKeys(macro, ["name", "arg", "unusual", "if", "detail", "doc"], context);
    const arg = macro.arg === undefined ? {} : normalizeArgFields(macro.arg, `${context}.arg`);
    macros.push(
      withoutUndefined({
        name: assertString(macro.name, `${context}.name`),
        snippet: arg.snippet,
        detail: macro.detail === undefined ? undefined : assertString(macro.detail, `${context}.detail`),
        documentation: macro.doc === undefined ? undefined : assertString(macro.doc, `${context}.doc`),
        unusual: macro.unusual === undefined ? undefined : assertBoolean(macro.unusual, `${context}.unusual`),
        keys: arg.keys,
        keyPos: arg.keyPos,
      }),
    );
  }

  const envs = [];
  if (!Array.isArray(raw.envs)) fail(`${sourceName}.envs: expected an array`);
  for (const env of raw.envs) {
    const context = `${sourceName}.envs[${env?.name ?? "?"}]`;
    assertPlainObject(env, context);
    // `if` is dropped for the same reason as on macros.
    assertOnlyKeys(env, ["name", "arg", "unusual", "if"], context);
    const arg = env.arg === undefined ? {} : normalizeArgFields(env.arg, `${context}.arg`);
    envs.push(
      withoutUndefined({
        name: assertString(env.name, `${context}.name`),
        snippet: arg.snippet,
        unusual: env.unusual === undefined ? undefined : assertBoolean(env.unusual, `${context}.unusual`),
        keys: arg.keys,
        keyPos: arg.keyPos,
      }),
    );
  }

  assertPlainObject(raw.keys, `${sourceName}.keys`);
  for (const [key, values] of Object.entries(raw.keys)) {
    assertStringArray(values, `${sourceName}.keys[${key}]`);
  }

  assertStringArray(raw.args, `${sourceName}.args`);

  return {
    deps: sortedUnique(depNames),
    macros: dedupeSortedEntries(macros),
    envs: dedupeSortedEntries(envs),
    keys: raw.keys,
    args: raw.args,
  };
}

/** Strip a CWL-style argument signature ("foo[]{}{}" -> "foo"). */
function stripCwlSignature(key) {
  return key.replace(/[[{(|].*$/s, "");
}

/**
 * Two files at the pinned commit (class-yathesis.json, secsty.json) still use
 * the older CWL-derived layout: macros/envs are objects keyed by signature,
 * dependencies live in `includes`, and key-value completions live in a
 * `keyvals` array referenced by index. They are normalized into the same
 * shape as the modern files; `keyvals` entries become `keys` entries keyed by
 * their index so `keys`/`keyPos` references keep working.
 */
function normalizeLegacyPackage(raw, sourceName) {
  assertOnlyKeys(raw, ["includes", "macros", "envs", "options", "keyvals"], sourceName);

  assertPlainObject(raw.includes, `${sourceName}.includes`);
  for (const [dep, value] of Object.entries(raw.includes)) {
    if (!Array.isArray(value) || value.length !== 0) {
      fail(`${sourceName}.includes[${dep}]: expected an empty array (extend handling)`);
    }
  }

  if (!Array.isArray(raw.keyvals)) fail(`${sourceName}.keyvals: expected an array`);
  const keys = {};
  raw.keyvals.forEach((values, index) => {
    assertStringArray(values, `${sourceName}.keyvals[${index}]`);
    keys[String(index)] = values;
  });

  assertPlainObject(raw.macros, `${sourceName}.macros`);
  const macros = [];
  for (const [signature, entry] of Object.entries(raw.macros)) {
    const context = `${sourceName}.macros[${signature}]`;
    assertPlainObject(entry, context);
    assertOnlyKeys(entry, ["snippet", "keyvalindex", "keyvalpos"], context);
    const keyvalindex =
      entry.keyvalindex === undefined ? undefined : assertNumber(entry.keyvalindex, `${context}.keyvalindex`);
    if (keyvalindex !== undefined && keys[String(keyvalindex)] === undefined) {
      fail(`${context}.keyvalindex: no keyvals entry at index ${keyvalindex}`);
    }
    macros.push(
      withoutUndefined({
        name: stripCwlSignature(signature),
        snippet:
          entry.snippet === undefined
            ? undefined
            : normalizeSnippet(assertString(entry.snippet, `${context}.snippet`)),
        keys: keyvalindex === undefined ? undefined : [String(keyvalindex)],
        keyPos:
          entry.keyvalpos === undefined ? undefined : assertNumber(entry.keyvalpos, `${context}.keyvalpos`),
      }),
    );
  }

  assertPlainObject(raw.envs, `${sourceName}.envs`);
  const envs = [];
  for (const [signature, entry] of Object.entries(raw.envs)) {
    const context = `${sourceName}.envs[${signature}]`;
    assertPlainObject(entry, context);
    assertOnlyKeys(entry, ["name", "snippet"], context);
    envs.push(
      withoutUndefined({
        name: entry.name === undefined ? stripCwlSignature(signature) : assertString(entry.name, `${context}.name`),
        snippet:
          entry.snippet === undefined
            ? undefined
            : normalizeSnippet(assertString(entry.snippet, `${context}.snippet`)),
      }),
    );
  }

  assertStringArray(raw.options, `${sourceName}.options`);

  const catalog = {
    deps: sortedUnique(Object.keys(raw.includes)),
    macros: dedupeSortedEntries(macros),
    envs: dedupeSortedEntries(envs),
    keys,
    args: [],
  };
  if (raw.options.length > 0) catalog.options = raw.options;
  return catalog;
}

function normalizePackage(raw, sourceName) {
  assertPlainObject(raw, sourceName);
  if (Array.isArray(raw.macros) || raw.deps !== undefined) {
    return normalizeModernPackage(raw, sourceName);
  }
  return normalizeLegacyPackage(raw, sourceName);
}

function extractThirdPartyNotices(readme) {
  const marker = "## Third-Party License Notices";
  const index = readme.indexOf(marker);
  if (index === -1) fail("data/README.md: third-party notice section not found");
  return readme.slice(index);
}

async function buildOutputs(dataDir) {
  const files = new Map();
  const manifestFiles = {};
  const record = (outputPath, content, fromPaths) => {
    files.set(outputPath, content);
    manifestFiles[outputPath] = { from: fromPaths };
  };

  const commands = normalizeCoreCommands(await readJson(join(dataDir, "commands.json")));
  const environments = normalizeCoreEnvironments(await readJson(join(dataDir, "environments.json")));
  record("core.json", stableStringify({ commands, environments }), [
    "data/commands.json",
    "data/environments.json",
  ]);

  record(
    "package-names.json",
    stableStringify(normalizeNameList(await readJson(join(dataDir, "packagenames.json")), "packagenames.json")),
    ["data/packagenames.json"],
  );
  record(
    "class-names.json",
    stableStringify(normalizeNameList(await readJson(join(dataDir, "classnames.json")), "classnames.json")),
    ["data/classnames.json"],
  );

  record(
    "unimath.json",
    stableStringify(normalizeUnimath(await readJson(join(dataDir, "unimathsymbols.json")))),
    ["data/unimathsymbols.json"],
  );

  record(
    "at-suggestions.json",
    stableStringify(normalizeAtSuggestions(await readJson(join(dataDir, "at-suggestions.json")))),
    ["data/at-suggestions.json"],
  );

  record(
    "bibtex.json",
    stableStringify({
      required: normalizeBibtexEntries(await readJson(join(dataDir, "bibtex-entries.json")), "bibtex-entries.json"),
      optional: normalizeBibtexEntries(
        await readJson(join(dataDir, "bibtex-optional-entries.json")),
        "bibtex-optional-entries.json",
      ),
    }),
    ["data/bibtex-entries.json", "data/bibtex-optional-entries.json"],
  );

  const packageFiles = (await readdir(join(dataDir, "packages"))).filter((name) => name.endsWith(".json"));
  packageFiles.sort(compareStrings);
  for (const fileName of packageFiles) {
    const name = basename(fileName, ".json");
    if (!PACKAGE_BASENAME_RE.test(name)) fail(`packages/${fileName}: unexpected basename characters`);
    const normalized = normalizePackage(await readJson(join(dataDir, "packages", fileName)), `packages/${fileName}`);
    record(`packages/${fileName}`, stableStringify(normalized), [`data/packages/${fileName}`]);
  }

  const readme = await readFile(join(dataDir, "README.md"), "utf8");
  const notices = [
    "This file reproduces, verbatim, the third-party notice section of data/README.md",
    `from ${UPSTREAM_REPO} at commit ${UPSTREAM_COMMIT} (MIT).`,
    "",
    extractThirdPartyNotices(readme),
  ].join("\n");
  record("UPSTREAM-NOTICES.md", notices.endsWith("\n") ? notices : `${notices}\n`, ["data/README.md"]);

  const manifest = {
    source: UPSTREAM_REPO,
    commit: UPSTREAM_COMMIT,
    license: "MIT",
    generatedBy: "scripts/latex-intelligence-extract.mjs",
    files: manifestFiles,
    notices: [
      "MIT (c) James Yu and LaTeX Workshop contributors",
      "packages/*.json derived from TeXStudio CWL data (texstudio-org/texstudio completion files)",
      "package/class name lists derived from CTAN package metadata",
      "unimath.json derived from unimathsymbols.txt (c) Guenter Milde, LPPL",
    ],
  };
  files.set("manifest.json", stableStringify(manifest));

  return files;
}

async function writeOutputs(outDir, files) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "packages"), { recursive: true });
  for (const [outputPath, content] of files) {
    await writeFile(join(outDir, outputPath), content, "utf8");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const outDir = resolve(ROOT, options.out ?? DEFAULT_OUT_DIR);
  const workDir = await mkdtemp(join(tmpdir(), "latex-intelligence-"));
  try {
    let tarballPath;
    if (options.tarball) {
      tarballPath = resolve(options.tarball);
    } else {
      tarballPath = join(workDir, "latex-workshop.tar.gz");
      console.log(`downloading ${TARBALL_URL}`);
      await downloadTarball(TARBALL_URL, tarballPath);
    }
    const dataDir = extractDataSubtree(tarballPath, workDir);
    const files = await buildOutputs(dataDir);
    await writeOutputs(outDir, files);
    console.log(`wrote ${files.size} files to ${outDir}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
