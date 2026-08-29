import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import {
  loadResearchSeedCatalog,
  seedArchiveName,
  seedFixtureDir,
} from "./research-seed-catalog.mjs";

const MAX_PROJECT_BYTES = 25 * 1024 * 1024;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..");
const defaultSeedRoot = join(homedir(), "Codespace", "Oleafly", "oleafly-seed");
const seedRoot = resolve(process.env.OLEAFLY_SEED_ROOT || defaultSeedRoot);
const archiveRoot = join(seedRoot, "archives");
const encoder = new TextEncoder();

const IGNORED_ENTRIES = new Set([".DS_Store", ".oleafly", ".build", "project.json"]);

async function collectFiles(root, current = root, found = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (IGNORED_ENTRIES.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, absolute, found);
      continue;
    }
    if (!entry.isFile()) continue;
    found.push(relative(root, absolute).split(sep).join("/"));
  }
  return found;
}

function fixtureNote(project, fileCount) {
  return [
    "# Oleafly research seed fixture",
    "",
    `This development-only project is first-party content authored in the Oleafly`,
    `desktop repository. It is not a snapshot of an upstream repository, so it`,
    `cannot drift when an upstream file moves or a package version is withdrawn.`,
    "",
    `- Fixture: \`fixtures/research-seeds/${project.slug}\``,
    `- Files: ${fileCount}`,
    `- Engine: ${project.engine}`,
    `- Main document: \`${project.mainDoc}\``,
    `- Exercises: ${project.figureTypes.join(", ")}`,
    "",
    project.summary,
    "",
    "Every fixture is verified to compile with the sidecar the desktop app",
    "bundles. Run `pnpm seed:research:validate` to check them again.",
    "",
  ].join("\n");
}

function projectMetadata(project) {
  return JSON.stringify(
    {
      name: project.name,
      main_doc: project.mainDoc,
      engine: project.engine,
      tex_flavor: null,
      color: project.color,
      kind: project.kind,
      exports: [],
      hidden: false,
      forked_from: null,
    },
    null,
    2,
  );
}

async function buildArchive(project, index, total) {
  const source = seedFixtureDir(repositoryRoot, project);
  const info = await stat(source).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Missing fixture directory: fixtures/research-seeds/${project.slug}`);
  }
  const paths = await collectFiles(source);
  if (paths.length === 0) throw new Error("Fixture directory is empty");
  if (!paths.includes(project.mainDoc)) {
    throw new Error(`Fixture does not contain its main document ${project.mainDoc}`);
  }

  const archiveFiles = {};
  let totalBytes = 0;
  for (const path of paths) {
    const bytes = new Uint8Array(await readFile(join(source, path)));
    totalBytes += bytes.byteLength;
    archiveFiles[path] = bytes;
  }
  if (totalBytes > MAX_PROJECT_BYTES) throw new Error("Fixture exceeds the 25 MB limit");
  archiveFiles["FIXTURE.md"] = encoder.encode(fixtureNote(project, paths.length));
  archiveFiles["project.json"] = encoder.encode(projectMetadata(project));

  const output = join(archiveRoot, seedArchiveName(project));
  const temporary = `${output}.tmp`;
  await writeFile(temporary, zipSync(archiveFiles, { level: 6 }));
  await rename(temporary, output);
  process.stdout.write(
    `[${index}/${total}] packed ${project.name} (${paths.length} files, ${(totalBytes / 1024).toFixed(0)} KB)\n`,
  );
  return { project, archive: output, files: paths.length, bytes: totalBytes };
}

async function pruneStaleArchives(expected) {
  const present = await readdir(archiveRoot).catch(() => []);
  const removed = [];
  for (const name of present) {
    if (!name.endsWith(".zip") || expected.has(name)) continue;
    await rm(join(archiveRoot, name), { force: true });
    removed.push(name);
  }
  return removed;
}

const catalog = loadResearchSeedCatalog(repositoryRoot);
await mkdir(archiveRoot, { recursive: true });
const completed = [];
const failures = [];
for (const [index, project] of catalog.entries()) {
  try {
    completed.push(await buildArchive(project, index + 1, catalog.length));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name: project.name, message });
    process.stderr.write(`[${index + 1}/${catalog.length}] failed ${project.name}: ${message}\n`);
  }
}

const removed = await pruneStaleArchives(new Set(catalog.map(seedArchiveName)));
await writeFile(
  join(seedRoot, "manifest.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: "fixtures/research-seeds",
      projects: completed.map((entry) => ({
        name: entry.project.name,
        slug: entry.project.slug,
        engine: entry.project.engine,
        kind: entry.project.kind,
        mainDoc: entry.project.mainDoc,
        color: entry.project.color,
        archive: entry.archive,
        files: entry.files,
        bytes: entry.bytes,
      })),
      removed,
      failures,
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(`Research seed cache: ${seedRoot}\n`);
if (removed.length > 0) process.stdout.write(`${removed.length} stale archives removed\n`);
process.stdout.write(`${completed.length} ready, ${failures.length} failed\n`);
if (failures.length > 0) process.exitCode = 1;
