#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://github.com/latex3/tagging-project/blob/main/_data/tagging-status.yml";
const RAW = "https://raw.githubusercontent.com/latex3/tagging-project/main/_data/tagging-status.yml";
export const KEPT_STATUSES = [
  "compatible",
  "partially-compatible",
  "currently-incompatible",
  "no-support",
  "unchecked",
];
export const ALLOWED_TYPES = ["class", "package", "library"];
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,79}$/;
const MINIMUM_COUNTS = {
  classes: 50,
  "packages:compatible": 700,
  "packages:partially-compatible": 200,
  "packages:currently-incompatible": 350,
  "packages:no-support": 25,
  "packages:unchecked": 100,
};
const NOTE_LIMIT = 220;

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../packages/preflight/src/tagging-status.json");

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
  }
  return text;
}

export function parseTaggingStatusYaml(text) {
  const entries = [];
  const lines = text.split("\n");
  let current = null;
  let lastKey = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const start = /^- name:\s*(.*)$/.exec(line);
    if (start) {
      if (current) entries.push(current);
      current = { name: start[1] };
      lastKey = "name";
      continue;
    }
    const field = /^ {2}([a-z-]+):\s*(.*)$/.exec(line);
    if (field && current) {
      const [, key, rest] = field;
      current[key] = rest === ">" || rest === "|" ? "" : rest;
      lastKey = key;
      continue;
    }
    if (/^ {3,}\S/.test(line) && current && lastKey) {
      const carried = current[lastKey];
      current[lastKey] = carried ? `${carried} ${line.trim()}` : line.trim();
      continue;
    }
    throw new Error(`update-tagging-status: unparsed line ${i + 1}: ${line}`);
  }
  if (current) entries.push(current);
  return entries.map((entry) =>
    Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, unquote(value)])),
  );
}

function trimNote(entry) {
  const note = (entry.comments ?? "").replace(/\s+/g, " ").trim();
  if (!note) return null;
  return note.length > NOTE_LIMIT ? `${note.slice(0, NOTE_LIMIT - 1).trimEnd()}...` : note;
}

const byName = (left, right) => left.localeCompare(right, "en");

export function validateEntries(entries) {
  const problems = [];
  if (entries.length < 1500) problems.push(`only ${entries.length} entries parsed`);
  const seen = new Set();
  let badNames = 0;
  let badTypes = 0;
  let badStatuses = 0;
  let duplicates = 0;
  for (const entry of entries) {
    if (typeof entry.name !== "string" || !NAME_PATTERN.test(entry.name)) {
      if (badNames++ === 0) problems.push(`unusable entry name ${JSON.stringify(entry.name ?? null)}`);
      continue;
    }
    if (!ALLOWED_TYPES.includes(entry.type)) {
      if (badTypes++ === 0) problems.push(`unknown type ${JSON.stringify(entry.type ?? null)} on ${entry.name}`);
      continue;
    }
    if (!KEPT_STATUSES.includes(entry.status)) {
      if (badStatuses++ === 0) problems.push(`unknown status ${JSON.stringify(entry.status ?? null)} on ${entry.name}`);
      continue;
    }
    const key = `${entry.type}:${entry.name}`;
    if (seen.has(key)) {
      if (duplicates++ === 0) problems.push(`duplicate entry ${key}`);
      continue;
    }
    seen.add(key);
  }
  const counted = { names: badNames, types: badTypes, statuses: badStatuses, duplicates };
  for (const [label, count] of Object.entries(counted)) {
    if (count > 1) problems.push(`${count} entries with rejected ${label}`);
  }
  if (problems.length > 0) throw new Error(`update-tagging-status: ${problems.join("; ")}`);
  return entries;
}

export function validateCatalog(catalog, entries) {
  const problems = [];
  for (const [key, minimum] of Object.entries(MINIMUM_COUNTS)) {
    const count = catalog.counts[key] ?? 0;
    if (count < minimum) problems.push(`${key} holds ${count}, expected at least ${minimum}`);
  }
  const expectedClasses = entries.filter((entry) => entry.type === "class").length;
  if (catalog.classes.length !== expectedClasses) {
    problems.push(`kept ${catalog.classes.length} of ${expectedClasses} classes`);
  }
  for (const status of KEPT_STATUSES) {
    const expected = entries.filter((entry) => entry.type === "package" && entry.status === status).length;
    const kept = catalog.packages[status]?.length ?? 0;
    if (kept !== expected) problems.push(`kept ${kept} of ${expected} ${status} packages`);
  }
  const names = catalog.classes.map((entry) => entry.name);
  if (new Set(names).size !== names.length) problems.push("duplicate class names in the catalog");
  for (const [status, kept] of Object.entries(catalog.packages)) {
    if (new Set(kept).size !== kept.length) problems.push(`duplicate package names under ${status}`);
  }
  const assigned = new Map();
  for (const [status, kept] of Object.entries(catalog.packages)) {
    for (const name of kept) {
      const previous = assigned.get(name);
      if (previous) problems.push(`${name} is listed under both ${previous} and ${status}`);
      else assigned.set(name, status);
    }
  }
  if (!catalog.classes.some((entry) => entry.name === "IEEEtran")) problems.push("IEEEtran missing");
  if (!catalog.packages["currently-incompatible"].includes("float")) problems.push("float missing");
  if (!catalog.packages.compatible.includes("booktabs")) problems.push("booktabs missing");
  if (problems.length > 0) throw new Error(`update-tagging-status: ${problems.join("; ")}`);
  return catalog;
}

export function buildCatalog(entries, retrieved) {
  const usable = entries.filter((entry) => entry.name && entry.type && entry.status);
  const classes = usable
    .filter((entry) => entry.type === "class")
    .map((entry) => {
      const note = entry.status === "compatible" ? null : trimNote(entry);
      return {
        name: entry.name,
        status: entry.status,
        ...(note ? { note } : {}),
        ...(entry.updated ? { updated: entry.updated } : {}),
      };
    })
    .sort((left, right) => byName(left.name, right.name));
  const packages = {};
  for (const status of KEPT_STATUSES) {
    packages[status] = usable
      .filter((entry) => entry.type === "package" && entry.status === status)
      .map((entry) => entry.name)
      .sort(byName);
  }
  const counts = { classes: classes.length };
  for (const [status, names] of Object.entries(packages)) counts[`packages:${status}`] = names.length;
  return {
    source: SOURCE,
    raw: RAW,
    retrieved,
    license: "LPPL 1.3c (latex3/tagging-project)",
    counts,
    classes,
    packages,
  };
}

export function serializeCatalog(catalog) {
  const { classes, packages, ...head } = catalog;
  return [
    JSON.stringify(head, null, 2).replace(/\n}$/, ","),
    '  "classes": [',
    classes.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n"),
    "  ],",
    '  "packages": {',
    Object.entries(packages)
      .map(([status, names]) => `    ${JSON.stringify(status)}: ${JSON.stringify(names)}`)
      .join(",\n"),
    "  }",
    "}",
  ].join("\n");
}

async function main() {
  const response = await fetch(RAW);
  if (!response.ok) throw new Error(`update-tagging-status: ${RAW} returned ${response.status}`);
  const text = await response.text();
  const entries = validateEntries(parseTaggingStatusYaml(text));
  const catalog = validateCatalog(buildCatalog(entries, new Date().toISOString().slice(0, 10)), entries);
  await writeFile(OUT, `${serializeCatalog(catalog)}\n`, "utf8");
  process.stdout.write(`written to ${path.relative(process.cwd(), OUT)}\n`);
  for (const [key, count] of Object.entries(catalog.counts).sort()) process.stdout.write(`  ${key}: ${count}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
