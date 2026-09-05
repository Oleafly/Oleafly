#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packVersion } from "./build-pack.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "src-tauri", "resources", "skills");
const PACK_PATH = join(SKILLS_ROOT, "pack.json");

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

async function main() {
  const packRaw = await readFile(PACK_PATH, "utf8");
  const pack = JSON.parse(packRaw);
  let mismatches = 0;

  for (const record of pack.skills) {
    const skillDir = join(SKILLS_ROOT, record.id);
    const { sha256, files, bytes } = await computeTreeSha256(skillDir);
    if (sha256 !== record.treeSha256 || files !== record.files || bytes !== record.bytes) {
      mismatches++;
      console.error(
        `MISMATCH ${record.id}: pack says sha256=${record.treeSha256} files=${record.files} bytes=${record.bytes}; ` +
          `on disk sha256=${sha256} files=${files} bytes=${bytes}`,
      );
    }
  }

  const expectedVersion = packVersion(pack.skills);
  if (pack.version !== expectedVersion) {
    mismatches++;
    console.error(
      `MISMATCH pack version: pack.json says ${pack.version}, its skill hashes give ${expectedVersion}`,
    );
  }

  if (mismatches > 0) {
    console.error(`${mismatches} skill(s) out of sync with pack.json. Run "pnpm skills:pack" to regenerate.`);
    process.exit(1);
  }

  console.log(
    `pack.json verified: ${pack.skills.length} skills match their on-disk trees (pack version ${pack.version}).`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
