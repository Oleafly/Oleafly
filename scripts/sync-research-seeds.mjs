import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import ts from "typescript";

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
  const file = ts.createSourceFile(catalogFile, source, ts.ScriptTarget.ESNext, true);
  const declaration = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((entry) => ts.isIdentifier(entry.name) && entry.name.text === "RESEARCH_SEED_PROJECTS");
  if (!declaration?.initializer) {
    throw new Error("Could not find RESEARCH_SEED_PROJECTS in the TypeScript catalog");
  }

  const readLiteral = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(readLiteral);
    if (ts.isObjectLiteralExpression(node)) {
      return Object.fromEntries(node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) {
          throw new Error(`Unsupported catalog property: ${property.getText(file)}`);
        }
        const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : null;
        if (!key) throw new Error(`Unsupported catalog key: ${property.name.getText(file)}`);
        return [key, readLiteral(property.initializer)];
      }));
    }
    throw new Error(`Unsupported catalog value: ${node.getText(file)}`);
  };

  const catalog = readLiteral(declaration.initializer);
  if (!Array.isArray(catalog)) throw new Error("RESEARCH_SEED_PROJECTS must be an array");
  return catalog;
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

async function repositoryTree(project) {
  const key = `${project.repository}@${project.revision}`;
  if (treeCache.has(key)) return treeCache.get(key);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetch(
    `https://api.github.com/repos/${project.repository}/git/trees/${project.revision}?recursive=1`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "oleafly-research-seed-sync",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} while listing ${key}`);
  }
  const body = await response.json();
  if (body.truncated) throw new Error(`GitHub truncated the source tree for ${key}`);
  const tree = body.tree.filter((entry) => entry.type === "blob");
  treeCache.set(key, tree);
  return tree;
}

async function selectedFiles(project) {
  const exact = new Set(project.include.filter((entry) => !entry.endsWith("/")));
  const prefixes = project.include.filter((entry) => entry.endsWith("/"));
  let files = [];
  if (prefixes.length > 0) {
    files = (await repositoryTree(project)).filter(
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
  const files = await selectedFiles(project);
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
