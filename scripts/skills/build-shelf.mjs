#!/usr/bin/env node
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import {
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
  stat,
  lstat,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  BLOCK_SCALAR_INDICATORS,
  findFrontmatterBounds,
  injectOleaflyMetadata,
  readFrontmatterField,
  validateSkillMarkdown,
} from "./frontmatter.mjs";
import { assertPythonYamlParses } from "./yaml-check.mjs";
import { assertShelfNewerThanFloor, shelfGeneratedAt } from "./timestamps.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const MANIFEST_PATH = join(SCRIPT_DIR, "shelf-manifest.json");
const BUNDLED_PACK_PATH = join(
  REPO_ROOT,
  "src-tauri",
  "resources",
  "skills",
  "pack.json",
);
const BUNDLED_CATALOG_PATH = join(
  REPO_ROOT,
  "src-tauri",
  "resources",
  "skills-catalog.json",
);
const SHELF_COPYRIGHT = "K-Dense Inc.";
const BLOCK_SCALAR_INDICATOR_SET = new Set(BLOCK_SCALAR_INDICATORS);

function byCodeUnit(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseArgs(argv) {
  const args = { source: null, out: null, generatedAt: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") {
      args.source = argv[++i];
    } else if (argv[i] === "--out") {
      args.out = argv[++i];
    } else if (argv[i] === "--generated-at") {
      args.generatedAt = argv[++i];
    }
  }
  return args;
}

function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (".+^${}()|[]\\".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  out += "$";
  return new RegExp(out);
}

function isExcluded(relPath, excludeRegexes) {
  return excludeRegexes.some((re) => re.test(relPath));
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function copySkillTree(srcDir, destDir, excludeRegexes, maxFileBytes) {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  const files = await walk(srcDir);
  let fileCount = 0;
  let byteCount = 0;
  const relPaths = [];
  for (const filePath of files) {
    const rel = relative(srcDir, filePath).split("\\").join("/");
    if (isExcluded(rel, excludeRegexes)) continue;
    const st = await stat(filePath);
    if (st.size > maxFileBytes) continue;
    const destPath = join(destDir, rel);
    await mkdir(dirname(destPath), { recursive: true });
    const content = await readFile(filePath);
    await writeFile(destPath, content);
    fileCount++;
    byteCount += st.size;
    relPaths.push(rel);
  }
  return { fileCount, byteCount, relPaths };
}

function ustarHeader({ name, size, typeflag, mtime, mode }) {
  const buf = Buffer.alloc(512, 0);
  let fullName = name;
  let prefix = "";
  if (Buffer.byteLength(fullName, "utf8") > 100) {
    const parts = fullName.split("/");
    let split = -1;
    for (let i = parts.length - 1; i > 0; i--) {
      const candidatePrefix = parts.slice(0, i).join("/");
      const candidateName = parts.slice(i).join("/");
      if (
        Buffer.byteLength(candidatePrefix, "utf8") <= 155 &&
        Buffer.byteLength(candidateName, "utf8") <= 100
      ) {
        split = i;
        prefix = candidatePrefix;
        fullName = candidateName;
        break;
      }
    }
    if (split === -1) {
      throw new Error(`path too long for ustar: ${name}`);
    }
  }
  buf.write(fullName, 0, 100, "utf8");
  buf.write(`${mode}\0`, 100, 8, "utf8");
  buf.write("0000000\0", 108, 8, "utf8");
  buf.write("0000000\0", 116, 8, "utf8");
  buf.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf8");
  buf.write(mtime.toString(8).padStart(11, "0") + "\0", 136, 12, "utf8");
  buf.write("        ", 148, 8, "utf8");
  buf.write(typeflag, 156, 1, "utf8");
  buf.write("ustar\0", 257, 6, "utf8");
  buf.write("00", 263, 2, "utf8");
  buf.write("oleafly", 265, 32, "utf8");
  buf.write("oleafly", 297, 32, "utf8");
  buf.write("0000000\0", 329, 8, "utf8");
  buf.write("0000000\0", 337, 8, "utf8");
  buf.write(prefix, 345, 155, "utf8");
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += buf[i];
  buf.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return buf;
}

function padTo512(buf) {
  const remainder = buf.length % 512;
  if (remainder === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(512 - remainder, 0)]);
}

function buildUstarTar(rootName, relPaths, readFileSync) {
  const dirs = new Set();
  for (const rel of relPaths) {
    const parts = rel.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      dirs.add(acc);
    }
  }
  const sortedDirs = [...dirs].sort(byCodeUnit);
  const sortedFiles = [...relPaths].sort(byCodeUnit);

  const chunks = [];
  chunks.push(
    ustarHeader({ name: `${rootName}/`, size: 0, typeflag: "5", mtime: 0, mode: "0000755" }),
  );
  for (const d of sortedDirs) {
    chunks.push(
      ustarHeader({ name: `${rootName}/${d}/`, size: 0, typeflag: "5", mtime: 0, mode: "0000755" }),
    );
  }
  for (const f of sortedFiles) {
    const content = readFileSync(f);
    chunks.push(
      ustarHeader({ name: `${rootName}/${f}`, size: content.length, typeflag: "0", mtime: 0, mode: "0000644" }),
    );
    chunks.push(padTo512(content));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

function deterministicGzip(buf) {
  const gz = gzipSync(buf, { level: 9 });
  gz.writeUInt32LE(0, 4);
  gz.writeUInt8(0xff, 9);
  return gz;
}

function licenseFor(entry, manifest, upstreamLicense) {
  return (
    `# License: ${entry.id}\n\n` +
    `Upstream repository: ${manifest.repo}\n` +
    `Pinned commit: ${manifest.pin}\n\n` +
    `This skill is redistributed by Oleafly under the terms below. ` +
    `The frontmatter "license" field (${entry.license}) names the license of the tool the skill wraps, ` +
    `not the terms of the skill text itself.\n\n` +
    `---\n\n` +
    `${upstreamLicense}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source) throw new Error("Pass --source <path-to-scientific-agent-skills-clone>");
  if (!args.out) throw new Error("Pass --out <path-to-oleafly-assets-repo>");

  const sourceRoot = resolve(args.source);
  const assetsRoot = resolve(args.out);
  const downloadsRoot = join(assetsRoot, "downloads", "skills");
  const catalogPath = join(assetsRoot, "catalogs", "skills.json");

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const excludeRegexes = manifest.exclude.map((rule) => globToRegExp(rule.glob));
  const maxFileBytes = manifest.maxFileBytes ?? 5 * 1024 * 1024;

  const pluginJson = JSON.parse(
    await readFile(join(sourceRoot, "plugin.json"), "utf8"),
  );
  const version = pluginJson.version;
  if (!version) throw new Error("plugin.json has no version field");

  const bundledCatalog = JSON.parse(await readFile(BUNDLED_CATALOG_PATH, "utf8"));
  const floorGeneratedAt = bundledCatalog.generatedAt;
  const generatedAt =
    args.generatedAt ??
    shelfGeneratedAt({
      packVersion: bundledCatalog.packs?.[0]?.version,
      pinDate: manifest.pinDate,
    });
  assertShelfNewerThanFloor(generatedAt, floorGeneratedAt);

  const upstreamLicense = await readFile(join(sourceRoot, "LICENSE.md"), "utf8");

  const stagingRoot = await (async () => {
    const dir = join(tmpdir(), `oleafly-shelf-${process.pid}`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    return dir;
  })();

  const shelfCatalogEntries = [];
  const stagedSkillMdPaths = [];
  let largest = { id: null, bytes: 0 };

  for (const entry of manifest.skills) {
    const skillSrcDir = join(sourceRoot, "skills", entry.id);
    const skillMdPath = join(skillSrcDir, "SKILL.md");
    const skillMdRaw = await readFile(skillMdPath, "utf8");
    const bounds = findFrontmatterBounds(skillMdRaw);
    if (!bounds) throw new Error(`${entry.id}: SKILL.md has no frontmatter block`);
    const license = readFrontmatterField(skillMdRaw, "license");
    if (license !== entry.license) {
      throw new Error(
        `${entry.id}: license drifted since manifest was built (was "${entry.license}", now "${license}")`,
      );
    }
    const description = readFrontmatterField(skillMdRaw, "description");
    if (!description || BLOCK_SCALAR_INDICATOR_SET.has(description)) {
      throw new Error(
        `${entry.id}: SKILL.md description resolved to "${description ?? "(missing)"}", which is not usable text`,
      );
    }
    if (description !== entry.description) {
      throw new Error(
        `${entry.id}: description drifted since manifest was built (manifest has "${entry.description}", SKILL.md has "${description}")`,
      );
    }

    const stageDir = join(stagingRoot, entry.id);
    const { fileCount, byteCount, relPaths } = await copySkillTree(
      skillSrcDir,
      stageDir,
      excludeRegexes,
      maxFileBytes,
    );

    const finalSkillMd = injectOleaflyMetadata(skillMdRaw, {
      tier: "shelf",
      phase: "domain",
      domain: entry.domain,
      origin: { repo: manifest.repo, commit: manifest.pin },
    });
    validateSkillMarkdown(finalSkillMd, `${entry.id}/SKILL.md`);
    const stagedSkillMd = join(stageDir, "SKILL.md");
    await writeFile(stagedSkillMd, finalSkillMd, "utf8");
    stagedSkillMdPaths.push(stagedSkillMd);
    await writeFile(join(stageDir, "LICENSE.md"), licenseFor(entry, manifest, upstreamLicense), "utf8");
    const finalRelPaths = [
      ...new Set([...relPaths, "SKILL.md", "LICENSE.md"]),
    ];

    const readSync = (rel) => readFileSync(join(stageDir, rel));
    const tarBuf = buildUstarTar(entry.id, finalRelPaths, readSync);
    const gzBuf = deterministicGzip(tarBuf);

    const destDir = join(downloadsRoot, entry.id, version);
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, `${entry.id}.tar.gz`);
    await writeFile(destPath, gzBuf);

    const sha256 = createHash("sha256").update(gzBuf).digest("hex");
    const bytes = gzBuf.length;
    if (bytes > largest.bytes) largest = { id: entry.id, bytes };

    shelfCatalogEntries.push({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      phase: "domain",
      domain: entry.domain,
      license: entry.license,
      copyright: SHELF_COPYRIGHT,
      version,
      bytes,
      files: finalRelPaths.length,
      sha256,
      url: `https://cdn.oleafly.com/downloads/skills/${entry.id}/${version}/${entry.id}.tar.gz`,
      pack: "shelf",
      origin: { repo: manifest.repo, commit: manifest.pin },
    });

    console.log(
      `  ${entry.id.padEnd(30)} domain=${entry.domain.padEnd(16)} files=${String(fileCount).padStart(3)} bytes=${bytes}`,
    );
  }

  assertPythonYamlParses(stagedSkillMdPaths, "shelf skills");

  await rm(stagingRoot, { recursive: true, force: true });

  const bundledPack = JSON.parse(await readFile(BUNDLED_PACK_PATH, "utf8"));
  const bundledCatalogEntries = bundledPack.skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    phase: s.phase,
    license: s.license,
    version: s.version,
    bytes: s.bytes,
    files: s.files,
    pack: bundledPack.pack,
    origin: s.origin,
  }));

  const catalog = {
    schemaVersion: 1,
    generatedAt,
    packs: [{ id: bundledPack.pack, version: bundledPack.version, kind: "bundled" }],
    skills: [...bundledCatalogEntries, ...shelfCatalogEntries],
  };

  await mkdir(dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  console.log(
    `\nWrote ${shelfCatalogEntries.length} shelf skills + ${bundledCatalogEntries.length} bundled entries to ${catalogPath}`,
  );
  console.log(`Largest shelf archive: ${largest.id} (${largest.bytes} bytes)`);
  console.log(`generatedAt: shelf ${generatedAt} > bundled floor ${floorGeneratedAt}`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exit(1);
});
