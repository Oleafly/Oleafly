#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkillMarkdown } from "./frontmatter.mjs";
import { assertPythonYamlParses } from "./yaml-check.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "src-tauri", "resources", "skills");
const DEFAULT_ASSETS = resolve(REPO_ROOT, "..", "oleafly-assets");
const DEFAULT_SAMPLE = 20;

function parseArgs(argv) {
  const args = { assets: DEFAULT_ASSETS, sample: DEFAULT_SAMPLE, all: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--assets") args.assets = argv[++i];
    else if (argv[i] === "--sample") args.sample = Number.parseInt(argv[++i], 10);
    else if (argv[i] === "--all") args.all = true;
  }
  return args;
}

async function bundledSkillMdPaths() {
  const entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(SKILLS_ROOT, entry.name, "SKILL.md");
    try {
      await stat(path);
    } catch {
      throw new Error(`${entry.name}: no SKILL.md in the bundled skill directory`);
    }
    paths.push(path);
  }
  return paths;
}

async function shelfArchives(assetsRoot) {
  const downloads = join(assetsRoot, "downloads", "skills");
  const ids = (await readdir(downloads, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const archives = [];
  for (const id of ids) {
    const versions = (await readdir(join(downloads, id), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const version of versions) {
      archives.push({ id, version, path: join(downloads, id, version, `${id}.tar.gz`) });
    }
  }
  return archives;
}

function pickSample(archives, size) {
  if (size >= archives.length) return archives;
  const stride = archives.length / size;
  const picked = [];
  for (let i = 0; i < size; i++) picked.push(archives[Math.floor(i * stride)]);
  return picked;
}

function extract(archivePath, destination) {
  const run = spawnSync("tar", ["-xzf", archivePath, "-C", destination], { encoding: "utf8" });
  if (run.error || run.status !== 0) {
    throw new Error(`could not extract ${archivePath}: ${run.stderr ?? run.error?.message ?? "tar failed"}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundled = await bundledSkillMdPaths();
  for (const path of bundled) {
    validateSkillMarkdown(await readFile(path, "utf8"), path);
  }
  console.log(`Checked ${bundled.length} bundled SKILL.md files`);
  assertPythonYamlParses(bundled, "bundled skills");

  let archives = [];
  try {
    archives = await shelfArchives(args.assets);
  } catch (error) {
    console.log(`No shelf archives under ${args.assets} (${error.message}); skipped the archive checks.`);
    return;
  }
  const sample = args.all ? archives : pickSample(archives, args.sample);
  const staging = await mkdtemp(join(tmpdir(), "oleafly-frontmatter-"));
  const extracted = [];
  try {
    for (const archive of sample) {
      const destination = join(staging, `${archive.id}-${archive.version}`);
      await mkdir(destination, { recursive: true });
      extract(archive.path, destination);
      const skillMd = join(destination, archive.id, "SKILL.md");
      validateSkillMarkdown(await readFile(skillMd, "utf8"), `${archive.id}.tar.gz:${archive.id}/SKILL.md`);
      extracted.push(skillMd);
      const licensePath = join(destination, archive.id, "LICENSE.md");
      try {
        await stat(licensePath);
      } catch {
        throw new Error(`${archive.id}.tar.gz is missing ${archive.id}/LICENSE.md`);
      }
    }
    console.log(`Checked ${sample.length} of ${archives.length} shelf archives (SKILL.md parses, LICENSE.md present)`);
    assertPythonYamlParses(extracted, "shelf archives");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
