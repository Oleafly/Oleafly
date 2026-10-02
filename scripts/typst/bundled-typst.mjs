#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CATALOG_PATH, bundledTypstRelease, validateCatalog } from "./build-toolchain-catalog.mjs";

export const TARGET_FIELDS = [
  "asset",
  "archiveType",
  "archiveMember",
  "archiveSha256",
  "binarySha256",
  "mirrorUrl",
  "githubUrl",
];

export function loadCatalog(path = CATALOG_PATH) {
  const catalog = JSON.parse(readFileSync(path, "utf8"));
  const problems = validateCatalog(catalog);
  if (problems.length > 0) throw new Error(`${path} is invalid: ${problems.join("; ")}`);
  return catalog;
}

export function bundledTypstTarget(catalog, target) {
  const release = bundledTypstRelease(catalog);
  const entry = release.targets[target];
  if (!entry) throw new Error(`unsupported Typst target: ${target}`);
  return { version: release.version, ...entry };
}

export function answer(catalog, argv) {
  const [command, target] = argv;
  if (command === "version" && argv.length === 1) return bundledTypstRelease(catalog).version;
  if (command === "target" && argv.length === 2) {
    const entry = bundledTypstTarget(catalog, target);
    return TARGET_FIELDS.map((field) => entry[field]).join(" ");
  }
  throw new Error(
    `usage: node scripts/typst/bundled-typst.mjs version | target <triple> (prints ${TARGET_FIELDS.join(" ")})`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  try {
    process.stdout.write(`${answer(loadCatalog(), process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
