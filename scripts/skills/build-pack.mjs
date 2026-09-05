#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, stat, lstat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { parseFrontmatterMapping } from "./frontmatter.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "src-tauri", "resources", "skills");
const PACK_PATH = join(SKILLS_ROOT, "pack.json");
const PACK_NAME = "research-core";

const PACK_DATE = "2026.09.04";

export function packVersion(skills) {
  const digest = createHash("sha256");
  for (const skill of skills) {
    digest.update(skill.id);
    digest.update(Buffer.from([0]));
    digest.update(skill.treeSha256);
    digest.update(Buffer.from([10]));
  }
  return `${PACK_DATE}.${digest.digest("hex").slice(0, 8)}`;
}

async function walkFiles(dir, baseDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full, baseDir)));
    } else if (entry.isFile()) {
      const rel = relative(baseDir, full).split("\\").join("/");
      if (rel === "pack.json") continue;
      files.push({ abs: full, rel });
    }
  }
  return files;
}

async function computeTreeSha256(skillDir) {
  const files = (await walkFiles(skillDir, skillDir)).sort((a, b) =>
    a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0,
  );
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const file of files) {
    const content = await readFile(file.abs);
    const pathBytes = Buffer.from(file.rel, "utf8");
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(BigInt(content.length));
    hash.update(pathBytes);
    hash.update(Buffer.from([0]));
    hash.update(lenBuf);
    hash.update(content);
    totalBytes += content.length;
  }
  return { sha256: hash.digest("hex"), files: files.length, bytes: totalBytes };
}

function text(value) {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed === "" ? null : collapsed;
}

function mappingOf(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function main() {
  const entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
  const skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  const skills = [];
  for (const id of skillDirs) {
    const skillDir = join(SKILLS_ROOT, id);
    const skillMdPath = join(skillDir, "SKILL.md");
    let raw;
    try {
      raw = await readFile(skillMdPath, "utf8");
    } catch {
      continue;
    }
    let frontmatter;
    try {
      frontmatter = parseFrontmatterMapping(raw);
    } catch (error) {
      throw new Error(`${id}: ${error.message}`);
    }

    const name = text(frontmatter.name) ?? id;
    const description = text(frontmatter.description) ?? "";
    const license = text(frontmatter.license);
    const metadata = mappingOf(frontmatter.metadata);
    const oleafly = mappingOf(metadata.oleafly);
    const origin = mappingOf(oleafly.origin);
    const tier = text(oleafly.tier) ?? "native";
    const phase = text(oleafly.phase) ?? "tooling";
    const version = text(metadata.version);
    const originRepo = text(origin.repo);
    const originCommit = text(origin.commit);

    const { sha256, files, bytes } = await computeTreeSha256(skillDir);

    const record = {
      id,
      name,
      description,
      tier,
      phase,
      license,
      treeSha256: sha256,
      files,
      bytes,
    };
    if (version) record.version = version;
    if (originRepo && originCommit) {
      record.origin = { repo: originRepo, commit: originCommit };
    }
    skills.push(record);
  }

  skills.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const pack = {
    schemaVersion: 1,
    pack: PACK_NAME,
    version: packVersion(skills),
    skills,
  };

  await writeFile(PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  console.log(`Wrote ${PACK_PATH} with ${skills.length} skills (pack ${pack.pack} ${pack.version}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
