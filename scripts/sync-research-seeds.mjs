import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const MAX_PROJECT_BYTES = 25 * 1024 * 1024;
const FORCE = process.argv.includes("--force");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..");
const defaultSeedRoot = join(homedir(), "Codespace", "Oleafly", "oleafly-seed");
const seedRoot = resolve(process.env.OLEAFLY_SEED_ROOT || defaultSeedRoot);
const archiveRoot = join(seedRoot, "archives");
const catalogFile = join(repositoryRoot, "src", "developer", "research-seed-catalog.ts");
const encoder = new TextEncoder();

function loadCatalog(source) {
  const declaration = source.indexOf("export const RESEARCH_SEED_PROJECTS");
  const equals = source.indexOf("=", declaration);
  const end = source.lastIndexOf("];");
  if (declaration < 0 || equals < 0 || end < equals) {
    throw new Error("Could not read RESEARCH_SEED_PROJECTS from the TypeScript catalog");
  }
  const literal = source.slice(equals + 1, end + 1);
  return Function(`"use strict"; return (${literal});`)();
}

function archiveName(project) {
  const slug = project.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${project.revision.slice(0, 12)}.zip`;
}

const treeCache = new Map();

function repositoryTree(project) {
  const key = `${project.repository}@${project.revision}`;
  if (treeCache.has(key)) return treeCache.get(key);
  let output;
  try {
    output = execFileSync(
      "gh",
      ["api", `repos/${project.repository}/git/trees/${project.revision}?recursive=1`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    throw new Error(`Could not list ${key}. Install and authenticate GitHub CLI first. ${error.message}`);
  }
  const body = JSON.parse(output);
  if (body.truncated) throw new Error(`GitHub truncated the source tree for ${key}`);
  const tree = body.tree.filter((entry) => entry.type === "blob");
  treeCache.set(key, tree);
  return tree;
}

function selectedFiles(project) {
  const exact = new Set(project.include.filter((entry) => !entry.endsWith("/")));
  const prefixes = project.include.filter((entry) => entry.endsWith("/"));
  let files = [];
  if (prefixes.length > 0) {
    files = repositoryTree(project).filter(
      (entry) => exact.has(entry.path) || prefixes.some((prefix) => entry.path.startsWith(prefix)),
    );
  } else {
    files = [...exact].map((path) => ({ path, size: 0 }));
  }
  const selected = new Map(files.map((entry) => [entry.path, entry]));
  for (const path of exact) {
    if (!selected.has(path)) selected.set(path, { path, size: 0 });
  }
  const result = [...selected.values()].sort((left, right) => left.path.localeCompare(right.path));
  const maxFiles = project.maxFiles ?? 180;
  if (result.length === 0) throw new Error("No upstream files matched the manifest");
  if (result.length > maxFiles) {
    throw new Error(`Manifest matched ${result.length} files, above its ${maxFiles} file limit`);
  }
  const knownBytes = result.reduce((total, entry) => total + (entry.size ?? 0), 0);
  if (knownBytes > MAX_PROJECT_BYTES) throw new Error("Selected files exceed the 25 MB limit");
  return result;
}

function rawUrl(project, path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${project.repository}/${project.revision}/${encodedPath}`;
}

async function downloadFile(project, path) {
  const response = await fetch(rawUrl(project, path));
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function mapConcurrent(items, concurrency, callback) {
  const result = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      result[index] = await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

function upstreamNote(project, fileCount) {
  return [
    "# Upstream research fixture",
    "",
    `This development-only fixture snapshots ${fileCount} file${fileCount === 1 ? "" : "s"} from a real public project.`,
    "",
    `- Source: https://github.com/${project.repository}/tree/${project.revision}`,
    `- Revision: \`${project.revision}\``,
    `- Reported license: ${project.license}`,
    `- Oleafly engine: ${project.engine}${project.flavor ? ` (${project.flavor})` : ""}`,
    `- Main document: \`${project.mainDoc}\``,
    `- External commands: ${project.shellEscape ? "required by upstream, not enabled by the seeder" : "not required by this fixture"}`,
    "",
    "Refer to the upstream repository for its complete license terms and history.",
    "",
  ].join("\n");
}

function projectMetadata(project) {
  return JSON.stringify(
    {
      name: project.name,
      main_doc: project.mainDoc,
      engine: project.engine,
      tex_flavor: project.flavor ?? null,
      color: "",
      kind: project.kind,
      exports: [],
      hidden: false,
      forked_from: null,
    },
    null,
    2,
  );
}

async function isFile(path) {
  return stat(path).then((entry) => entry.isFile()).catch(() => false);
}

async function buildArchive(project, index, total) {
  const output = join(archiveRoot, archiveName(project));
  if (!FORCE && await isFile(output)) {
    process.stdout.write(`[${index}/${total}] cached ${project.name}\n`);
    return { project, archive: output, cached: true };
  }
  process.stdout.write(`[${index}/${total}] downloading ${project.name}\n`);
  const files = selectedFiles(project);
  const downloaded = await mapConcurrent(files, 8, async (entry) => ({
    path: entry.path,
    bytes: await downloadFile(project, entry.path),
  }));
  const totalBytes = downloaded.reduce((totalBytes, file) => totalBytes + file.bytes.byteLength, 0);
  if (totalBytes > MAX_PROJECT_BYTES) throw new Error("Downloaded files exceed the 25 MB limit");
  const archiveFiles = Object.fromEntries(downloaded.map((file) => [file.path, file.bytes]));
  archiveFiles["UPSTREAM.md"] = encoder.encode(upstreamNote(project, downloaded.length));
  archiveFiles["project.json"] = encoder.encode(projectMetadata(project));
  const archive = zipSync(archiveFiles, { level: 6 });
  const temporary = `${output}.tmp`;
  await writeFile(temporary, archive);
  await rename(temporary, output);
  return { project, archive: output, cached: false, files: downloaded.length, bytes: totalBytes };
}

const catalog = loadCatalog(await readFile(catalogFile, "utf8"));
await mkdir(archiveRoot, { recursive: true });
const completed = [];
const failures = [];
for (const [index, project] of catalog.entries()) {
  try {
    completed.push(await buildArchive(project, index + 1, catalog.length));
  } catch (error) {
    failures.push({ name: project.name, message: error instanceof Error ? error.message : String(error) });
    process.stderr.write(`[${index + 1}/${catalog.length}] failed ${project.name}: ${failures.at(-1).message}\n`);
  }
}
await writeFile(
  join(seedRoot, "manifest.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), projects: completed, failures }, null, 2)}\n`,
);
process.stdout.write(`Research seed cache: ${seedRoot}\n`);
process.stdout.write(`${completed.length} ready, ${failures.length} failed\n`);
if (failures.length > 0) process.exitCode = 1;
