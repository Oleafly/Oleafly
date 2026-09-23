#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");
const NPM_SCOPE = "@tauri-apps";
const CORE_CRATE = "tauri";
const CRATE_PLUGIN_PREFIX = "tauri-plugin-";
const NPM_PLUGIN_PREFIX = "plugin-";
const LOCK_ORIGIN = "Cargo.lock";
const MANIFEST_ORIGIN = "src-tauri/Cargo.toml";
const NPM_ORIGIN = "node_modules";
const NOT_COMPARED_EITHER = "so tauri build does not compare this pair either.";
const NUMERIC_IDENTIFIER = /^(?:0|[1-9]\d*)$/u;
const DIGITS = /^\d+$/u;
const IDENTIFIER = /^[0-9A-Za-z-]+$/u;
const LOCK_FIELD = /^(name|version|source)\s*=\s*"([^"]*)"/u;
const DEPENDENCY_ENTRY = /^"?([A-Za-z0-9_-]+)"?\s*=(.*)$/u;
const STRING_REQUIREMENT = /^"([^"]*)"|^'([^']*)'/u;
const INLINE_REQUIREMENT = /(?:^\{|,)\s*version\s*=\s*(?:"([^"]*)"|'([^']*)')/u;

function usage() {
  return `Usage:
  node scripts/check-tauri-versions.mjs [--root <dir>]

Pairs each ${NPM_SCOPE} package in node_modules with its Rust crate in
Cargo.lock (api with tauri, plugin-<name> with tauri-plugin-<name>) and fails
when a pair differs in major.minor. tauri build refuses to build in that case,
so this reports it without compiling anything. Packages with no crate
counterpart, such as the cli, are listed as not compared.

Options:
  --root <dir>  Repository root holding Cargo.lock, src-tauri/Cargo.toml and
                node_modules (default: this repository)
  -h, --help    Show this help`;
}

function byCodeUnit(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function rootFrom(value) {
  if (!value || value.startsWith("-")) throw new Error("--root requires a directory");
  return resolve(value);
}

export function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, help: false };
  let index = 0;
  while (index < argv.length) {
    const argument = argv[index];
    index += 1;
    if (argument === "--") continue;
    if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else if (argument === "--root") {
      options.root = rootFrom(argv[index]);
      index += 1;
    } else if (argument.startsWith("--root=")) {
      options.root = rootFrom(argument.slice("--root=".length));
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  return options;
}

function validIdentifiers(text, rejectLeadingZeros) {
  return text
    .split(".")
    .every(
      (identifier) =>
        IDENTIFIER.test(identifier) &&
        !(rejectLeadingZeros && DIGITS.test(identifier) && !NUMERIC_IDENTIFIER.test(identifier)),
    );
}

export function parseVersion(text) {
  if (typeof text !== "string") return undefined;
  const plus = text.indexOf("+");
  const build = plus === -1 ? undefined : text.slice(plus + 1);
  const withoutBuild = plus === -1 ? text : text.slice(0, plus);
  const dash = withoutBuild.indexOf("-");
  const prerelease = dash === -1 ? undefined : withoutBuild.slice(dash + 1);
  const core = (dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)).split(".");
  if (core.length !== 3 || !core.every((part) => NUMERIC_IDENTIFIER.test(part))) return undefined;
  if (prerelease !== undefined && !validIdentifiers(prerelease, true)) return undefined;
  if (build !== undefined && !validIdentifiers(build, false)) return undefined;
  const [major, minor, patch] = core;
  return { major, minor, patch, prerelease: prerelease ?? "", build: build ?? "" };
}

export function sameMajorMinor(left, right) {
  return left.major === right.major && left.minor === right.minor;
}

export function readLockPackages(lockText) {
  const packages = [];
  let current;
  for (const rawLine of lockText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      current = line === "[[package]]" ? {} : undefined;
      if (current) packages.push(current);
      continue;
    }
    const field = current ? LOCK_FIELD.exec(line) : null;
    if (field) current[field[1]] = field[2];
  }
  return packages.filter((entry) => entry.name !== undefined && entry.version !== undefined);
}

function tableName(line) {
  const end = line.indexOf("]");
  return end === -1 ? line : line.slice(1, end).trim();
}

function requirementFrom(value) {
  const match = value.startsWith("{")
    ? INLINE_REQUIREMENT.exec(value)
    : STRING_REQUIREMENT.exec(value);
  return match?.[1] ?? match?.[2];
}

export function declaredRequirement(manifestText, crateName) {
  if (typeof manifestText !== "string") return undefined;
  let inDependencies = false;
  for (const rawLine of manifestText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inDependencies = tableName(line) === "dependencies";
      continue;
    }
    const entry = inDependencies ? DEPENDENCY_ENTRY.exec(line) : null;
    if (entry?.[1] === crateName) return requirementFrom(entry[2].trim());
  }
  return undefined;
}

export function isTauriCrate(name) {
  return (
    name === CORE_CRATE ||
    (name.startsWith(CRATE_PLUGIN_PREFIX) && name.length > CRATE_PLUGIN_PREFIX.length)
  );
}

export function crateForNpmPackage(npmName) {
  const prefix = `${NPM_SCOPE}/`;
  if (!npmName.startsWith(prefix)) return undefined;
  const name = npmName.slice(prefix.length);
  if (name === "api") return CORE_CRATE;
  if (name.startsWith(NPM_PLUGIN_PREFIX) && name.length > NPM_PLUGIN_PREFIX.length) {
    return `${CORE_CRATE}-${name}`;
  }
  return undefined;
}

function npmPackageForCrate(crateName) {
  if (crateName === CORE_CRATE) return `${NPM_SCOPE}/api`;
  return `${NPM_SCOPE}/${crateName.slice(CORE_CRATE.length + 1)}`;
}

function unpairedNpmReason(npmName) {
  if (npmName === `${NPM_SCOPE}/cli`) {
    return "this is the Tauri CLI. It pairs with the tauri-cli crate, a command line tool that no crate in this workspace depends on, so it is never in Cargo.lock and tauri build does not compare it.";
  }
  return `no Rust crate pairs with it. tauri build compares only ${NPM_SCOPE}/api and ${NPM_SCOPE}/plugin-* packages.`;
}

function resolveCrate(crateName, lockPackages, manifestText) {
  const listed = lockPackages
    .filter((entry) => entry.name === crateName)
    .map((entry) => entry.version);
  if (listed.length === 1) return { version: listed[0], origin: LOCK_ORIGIN, listed };
  return {
    version: declaredRequirement(manifestText, crateName),
    origin: MANIFEST_ORIGIN,
    listed,
  };
}

function unresolvedCrateReason(crateName, crate) {
  const inLock =
    crate.listed.length === 0
      ? `${crateName} is not in Cargo.lock`
      : `${crateName} is listed ${crate.listed.length} times in Cargo.lock (${crate.listed.join(", ")})`;
  const inManifest =
    crate.version === undefined
      ? `${MANIFEST_ORIGIN} gives no version for it`
      : `${MANIFEST_ORIGIN} asks for "${crate.version}", which is not an exact version`;
  return `${inLock} and ${inManifest}, ${NOT_COMPARED_EITHER}`;
}

function skipReason(npm, crateName, crate) {
  if (parseVersion(crate.version) === undefined) {
    if (crate.origin === LOCK_ORIGIN) {
      return `${crateName} ${crate.version} in Cargo.lock is not a semantic version, ${NOT_COMPARED_EITHER}`;
    }
    return unresolvedCrateReason(crateName, crate);
  }
  if (npm.version === undefined) {
    return `its package.json has no version, ${NOT_COMPARED_EITHER}`;
  }
  if (parseVersion(npm.version) === undefined) {
    return `its version "${npm.version}" is not a semantic version, ${NOT_COMPARED_EITHER}`;
  }
  return undefined;
}

function rustOnlyNotes(lockPackages, pairedCrates) {
  const versions = new Map();
  for (const entry of lockPackages) {
    if (!isTauriCrate(entry.name) || pairedCrates.has(entry.name)) continue;
    versions.set(entry.name, [...(versions.get(entry.name) ?? []), entry.version]);
  }
  return [...versions.keys()]
    .sort(byCodeUnit)
    .map(
      (name) =>
        `${name} ${versions.get(name).join(", ")}: no ${npmPackageForCrate(name)} package in node_modules, so there is nothing to compare.`,
    );
}

export function compareTauriPackages({ lockPackages, npmPackages, manifestText }) {
  const pairs = [];
  const notCompared = [];
  const pairedCrates = new Set();
  const sorted = [...npmPackages].sort((left, right) => byCodeUnit(left.name, right.name));
  for (const npm of sorted) {
    const label = `${npm.name} ${npm.version ?? "(no version)"}`;
    const crateName = crateForNpmPackage(npm.name);
    if (crateName === undefined) {
      notCompared.push(`${label}: ${unpairedNpmReason(npm.name)}`);
      continue;
    }
    pairedCrates.add(crateName);
    const crate = resolveCrate(crateName, lockPackages, manifestText);
    const reason = skipReason(npm, crateName, crate);
    if (reason !== undefined) {
      notCompared.push(`${label}: ${reason}`);
      continue;
    }
    pairs.push({
      npmName: npm.name,
      npmVersion: npm.version,
      crateName,
      crateVersion: crate.version,
      crateOrigin: crate.origin,
      matches: sameMajorMinor(parseVersion(npm.version), parseVersion(crate.version)),
    });
  }
  notCompared.push(...rustOnlyNotes(lockPackages, pairedCrates));
  return { pairs, notCompared };
}

export function formatReport({ pairs, notCompared }) {
  const output = [];
  const errors = [];
  if (pairs.length > 0) {
    output.push(
      "Tauri npm packages and their Rust crates (tauri build requires the same major.minor):",
    );
    for (const pair of pairs) {
      const status = pair.matches ? "ok      " : "MISMATCH";
      output.push(
        `  ${status}  ${pair.npmName} ${pair.npmVersion} and ${pair.crateName} ${pair.crateVersion}`,
      );
    }
  }
  if (notCompared.length > 0) {
    output.push("Not compared:");
    for (const note of notCompared) output.push(`  ${note}`);
  }
  const mismatched = pairs.filter((pair) => !pair.matches);
  if (pairs.length === 0) {
    errors.push(
      `tauri version check failed: no ${NPM_SCOPE} package in node_modules pairs with a crate in Cargo.lock, so nothing was compared. Run pnpm install and check that Cargo.lock is at the repository root.`,
    );
  } else if (mismatched.length > 0) {
    errors.push(
      'tauri version check failed: tauri build stops with "Found version mismatched Tauri packages" because these pairs differ in major.minor:',
    );
    for (const pair of mismatched) {
      errors.push(
        `  ${pair.crateName} ${pair.crateVersion} (${pair.crateOrigin}) and ${pair.npmName} ${pair.npmVersion} (${NPM_ORIGIN})`,
      );
    }
    errors.push(
      "Bring both sides of each pair to the same major.minor release, then commit package.json, pnpm-lock.yaml and Cargo.lock together.",
    );
  } else if (pairs.length === 1) {
    output.push("The compared pair shares major.minor.");
  } else {
    output.push(`All ${pairs.length} compared pairs share major.minor.`);
  }
  return { output, errors };
}

async function readText(path, missingHint) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (missingHint === undefined) return undefined;
    throw new Error(`${path} does not exist. ${missingHint}`);
  }
}

async function readNpmPackages(scopeDirectory) {
  let entries;
  try {
    entries = await readdir(scopeDirectory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(`${scopeDirectory} does not exist. Run pnpm install first.`);
  }
  const packages = [];
  for (const entry of entries.filter((name) => !name.startsWith(".")).sort(byCodeUnit)) {
    const manifestPath = join(scopeDirectory, entry, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`cannot read ${manifestPath}: ${error.message}`);
    }
    packages.push({ name: `${NPM_SCOPE}/${entry}`, version: manifest.version });
  }
  return packages;
}

export async function readTauriPackages(root) {
  const lockText = await readText(
    join(root, "Cargo.lock"),
    "Pass --root with the directory that holds the workspace Cargo.lock.",
  );
  return {
    lockPackages: readLockPackages(lockText),
    npmPackages: await readNpmPackages(join(root, "node_modules", NPM_SCOPE)),
    manifestText: await readText(join(root, "src-tauri", "Cargo.toml")),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const report = formatReport(compareTauriPackages(await readTauriPackages(options.root)));
  for (const line of report.output) console.log(line);
  for (const line of report.errors) console.error(line);
  return report.errors.length === 0 ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`tauri version check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
