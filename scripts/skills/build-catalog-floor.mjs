#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { floorGeneratedAt } from "./timestamps.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const PACK_PATH = join(REPO_ROOT, "src-tauri", "resources", "skills", "pack.json");
const CATALOG_PATH = join(REPO_ROOT, "src-tauri", "resources", "skills-catalog.json");

const SCHEMA_VERSION = 1;

function entryFor(pack, skill) {
  const entry = {
    id: skill.id,
    name: skill.name ?? skill.id,
    description: skill.description ?? "",
  };
  if (skill.phase) entry.phase = skill.phase;
  if (skill.domain) entry.domain = skill.domain;
  entry.license = skill.license ?? "";
  entry.version = skill.version ?? pack.version;
  entry.bytes = skill.bytes ?? 0;
  entry.files = skill.files ?? 0;
  entry.pack = pack.pack;
  if (skill.origin) entry.origin = skill.origin;
  return entry;
}

async function main() {
  const pack = JSON.parse(await readFile(PACK_PATH, "utf8"));
  if (pack.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`pack.json uses unsupported schemaVersion ${pack.schemaVersion}`);
  }
  const skills = [...(pack.skills ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set();
  for (const skill of skills) {
    if (seen.has(skill.id)) throw new Error(`pack.json lists "${skill.id}" twice`);
    seen.add(skill.id);
  }
  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: floorGeneratedAt(pack.version),
    packs: [{ id: pack.pack, version: pack.version, kind: "bundled" }],
    skills: skills.map((skill) => entryFor(pack, skill)),
  };
  await writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(
    `wrote ${CATALOG_PATH} (${catalog.skills.length} skills, pack ${pack.version}, generatedAt ${catalog.generatedAt})`,
  );
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
