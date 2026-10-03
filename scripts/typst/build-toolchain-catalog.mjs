#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(SCRIPT_DIR, "..", "..");
export const CATALOG_PATH = join(ROOT, "src-tauri", "resources", "typst-toolchain.json");

export const SCHEMA_VERSION = 1;
export const SUPPORTED_TARGETS = [
  "aarch64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
];
export const ALLOWED_DOWNLOAD_HOSTS = [
  "mirrors.oleafly.com",
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
];
export const TYPST_VERSIONS = ["0.11.1", "0.12.0", "0.13.1", "0.14.2", "0.15.0", "0.15.1"];
export const BUNDLED_TYPST_VERSION = "0.15.1";
export const TINYMIST_BY_TYPST_MINOR = {
  "0.11": "0.11.32",
  "0.12": "0.12.22",
  "0.13": "0.13.30",
  "0.14": "0.14.20",
  "0.15": "0.15.8",
};
export const BUNDLED_TINYMIST_VERSION = "0.15.8";
export const ARCHIVE_TYPES = ["tar.xz", "tar.gz", "zip", "binary"];
export const OPTIONAL_TYPST_FLAGS = [
  "--color",
  "--creation-timestamp",
  "--deps",
  "--features",
  "--font-path",
  "--format",
  "--ignore-system-fonts",
  "--input",
  "--package-cache-path",
  "--package-path",
  "--pages",
  "--pdf-standard",
  "--ppi",
];
export const PROBED_OUTPUT_FORMATS = ["html", "pdf", "png", "svg"];

export const TYPST_TOOL = {
  repository: "https://github.com/typst/typst",
  apiRepository: "typst/typst",
  binaryName: "typst",
  mirrorBase: "https://mirrors.oleafly.com/binaries/typst",
};
export const TINYMIST_TOOL = {
  repository: "https://github.com/Myriad-Dreamin/tinymist",
  apiRepository: "Myriad-Dreamin/tinymist",
  binaryName: "tinymist",
  mirrorBase: "https://mirrors.oleafly.com/language-servers/tinymist",
};

const TYPST_ASSET_TRIPLES = {
  "aarch64-apple-darwin": "aarch64-apple-darwin",
  "aarch64-unknown-linux-gnu": "aarch64-unknown-linux-musl",
  "x86_64-unknown-linux-gnu": "x86_64-unknown-linux-musl",
  "x86_64-pc-windows-msvc": "x86_64-pc-windows-msvc",
};
const TINYMIST_BINARY_ASSETS = {
  "aarch64-apple-darwin": "tinymist-darwin-arm64",
  "aarch64-unknown-linux-gnu": "tinymist-linux-arm64",
  "x86_64-unknown-linux-gnu": "tinymist-linux-x64",
  "x86_64-pc-windows-msvc": "tinymist-win32-x64.exe",
};
const SHA256_RE = /^[0-9a-f]{64}$/u;
const VERSION_RE = /^\d+\.\d+\.\d+$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 120_000;
const MAX_TOOL_OUTPUT = 1024 * 1024 * 1024;
const UNSUPPORTED_ARGUMENT_RE =
  /unexpected argument|unrecognized|wasn't expected|invalid value/iu;

export function minorOf(version) {
  const match = /^(\d+)\.(\d+)\.\d+$/u.exec(version);
  if (!match) throw new Error(`not a release version: ${version}`);
  return `${match[1]}.${match[2]}`;
}

export function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function executableName(binaryName, target) {
  return target.includes("windows") ? `${binaryName}.exe` : binaryName;
}

export function typstAssetFor(target) {
  const triple = TYPST_ASSET_TRIPLES[target];
  if (!triple) throw new Error(`unsupported target: ${target}`);
  const archiveType = target.includes("windows") ? "zip" : "tar.xz";
  return { asset: `typst-${triple}.${archiveType}`, archiveType };
}

export function tinymistAssetCandidates(target) {
  const binaryAsset = TINYMIST_BINARY_ASSETS[target];
  if (!binaryAsset) throw new Error(`unsupported target: ${target}`);
  const archiveType = target.includes("windows") ? "zip" : "tar.gz";
  return [
    { asset: `tinymist-${target}.${archiveType}`, archiveType },
    { asset: binaryAsset, archiveType: "binary" },
  ];
}

export function downloadUrls(tool, version, asset) {
  return {
    mirrorUrl: `${tool.mirrorBase}/${version}/${asset}`,
    githubUrl: `${tool.repository}/releases/download/v${version}/${asset}`,
  };
}

export function isSafeArchiveMember(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

export function hostTarget(platform = process.platform, architecture = process.arch) {
  const key = `${platform}/${architecture}`;
  return (
    {
      "darwin/arm64": "aarch64-apple-darwin",
      "linux/arm64": "aarch64-unknown-linux-gnu",
      "linux/x64": "x86_64-unknown-linux-gnu",
      "win32/x64": "x86_64-pc-windows-msvc",
    }[key] ?? null
  );
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function targetProblems(label, tool, version, target, entry) {
  const problems = [];
  if (!entry || typeof entry !== "object") return [`${label} is missing ${target}`];
  const where = `${label} ${target}`;
  if (!ARCHIVE_TYPES.includes(entry.archiveType)) problems.push(`${where} has an unknown archive type`);
  if (typeof entry.asset !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(entry.asset)) {
    problems.push(`${where} has an unusable asset name`);
  }
  if (entry.archiveType === "binary") {
    if (entry.archiveMember !== null) problems.push(`${where} is a bare binary but names a member`);
    if (entry.archiveSha256 !== entry.binarySha256 || entry.archiveSize !== entry.binarySize) {
      problems.push(`${where} is a bare binary whose archive and binary digests differ`);
    }
  } else {
    if (!isSafeArchiveMember(entry.archiveMember)) problems.push(`${where} has an unsafe archive member`);
    if (typeof entry.asset === "string" && !entry.asset.endsWith(`.${entry.archiveType}`)) {
      problems.push(`${where} asset does not match its archive type`);
    }
    if (
      typeof entry.archiveMember === "string" &&
      posix.basename(entry.archiveMember) !== executableName(tool.binaryName, target)
    ) {
      problems.push(`${where} archive member is not the ${tool.binaryName} executable`);
    }
  }
  for (const field of ["archiveSha256", "binarySha256"]) {
    if (!SHA256_RE.test(entry[field] ?? "")) problems.push(`${where} ${field} is not 64 hex characters`);
  }
  for (const field of ["archiveSize", "binarySize"]) {
    if (!Number.isSafeInteger(entry[field]) || entry[field] <= 0) problems.push(`${where} ${field} is not a positive integer`);
  }
  const expected = downloadUrls(tool, version, entry.asset);
  if (entry.mirrorUrl !== expected.mirrorUrl) problems.push(`${where} mirrorUrl is not the canonical mirror address`);
  if (entry.githubUrl !== expected.githubUrl) problems.push(`${where} githubUrl is not the canonical release address`);
  for (const url of [entry.mirrorUrl, entry.githubUrl]) {
    if (!String(url).startsWith("https://") || !ALLOWED_DOWNLOAD_HOSTS.includes(hostOf(url))) {
      problems.push(`${where} has a download address outside the allowed hosts`);
    }
  }
  return problems;
}

function targetsProblems(label, tool, version, targets) {
  const problems = [];
  if (!targets || typeof targets !== "object") return [`${label} has no targets`];
  if (JSON.stringify(Object.keys(targets)) !== JSON.stringify(SUPPORTED_TARGETS)) {
    problems.push(`${label} does not list exactly the supported targets in order`);
  }
  for (const target of SUPPORTED_TARGETS) {
    problems.push(...targetProblems(label, tool, version, target, targets[target]));
  }
  return problems;
}

function capabilitiesProblems(label, capabilities) {
  const problems = [];
  if (!capabilities || typeof capabilities !== "object") return [`${label} has no capabilities`];
  const { flags, outputFormats, pdfStandards } = capabilities;
  if (!Array.isArray(flags) || flags.some((flag) => !OPTIONAL_TYPST_FLAGS.includes(flag))) {
    problems.push(`${label} lists an unknown flag`);
  } else if (JSON.stringify(flags) !== JSON.stringify([...flags].sort())) {
    problems.push(`${label} flags are not sorted`);
  }
  if (!Array.isArray(outputFormats) || !outputFormats.includes("pdf")) {
    problems.push(`${label} cannot produce PDF`);
  } else if (outputFormats.some((format) => !PROBED_OUTPUT_FORMATS.includes(format))) {
    problems.push(`${label} lists an unknown output format`);
  }
  if (!Array.isArray(pdfStandards) || pdfStandards.some((value) => typeof value !== "string" || !value)) {
    problems.push(`${label} has unusable PDF standards`);
  } else if (Array.isArray(flags) && flags.includes("--pdf-standard") !== pdfStandards.length > 0) {
    problems.push(`${label} PDF standards disagree with --pdf-standard support`);
  }
  if (Array.isArray(flags) && Array.isArray(outputFormats) && flags.includes("--features") !== outputFormats.includes("html")) {
    problems.push(`${label} HTML output disagrees with --features support`);
  }
  return problems;
}

function releaseListProblems(label, releases, versionField) {
  const problems = [];
  const versions = releases.map((release) => release[versionField]);
  if (new Set(versions).size !== versions.length) problems.push(`${label} repeats a version`);
  const sorted = [...versions].sort(compareVersions);
  if (JSON.stringify(sorted) !== JSON.stringify(versions)) problems.push(`${label} versions are not in ascending order`);
  return problems;
}

export function validateCatalog(catalog) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return ["catalog is not an object"];
  if (catalog.schemaVersion !== SCHEMA_VERSION) problems.push("schemaVersion is not 1");
  if (!DATE_RE.test(catalog.generatedAt ?? "")) problems.push("generatedAt is not a YYYY-MM-DD date");
  if (JSON.stringify(catalog.supportedTargets) !== JSON.stringify(SUPPORTED_TARGETS)) {
    problems.push("supportedTargets is not the app's target allowlist");
  }
  if (JSON.stringify(catalog.allowedDownloadHosts) !== JSON.stringify(ALLOWED_DOWNLOAD_HOSTS)) {
    problems.push("allowedDownloadHosts is not the expected allowlist");
  }
  const typst = catalog.typst ?? {};
  const typstVersions = Array.isArray(typst.versions) ? typst.versions : [];
  if (typst.repository !== TYPST_TOOL.repository) problems.push("typst.repository is wrong");
  if (typstVersions.length === 0) problems.push("typst.versions is empty");
  problems.push(...releaseListProblems("typst", typstVersions, "version"));
  if (!typstVersions.some((release) => release.version === typst.bundled)) {
    problems.push(`bundled Typst ${typst.bundled} is not a curated version`);
  }
  for (const release of typstVersions) {
    const label = `Typst ${release.version}`;
    if (!VERSION_RE.test(release.version ?? "")) problems.push(`${label} has an unusable version`);
    else {
      if (release.tag !== `v${release.version}`) problems.push(`${label} tag is wrong`);
      if (release.minor !== minorOf(release.version)) problems.push(`${label} minor is wrong`);
    }
    if (!DATE_RE.test(release.releasedAt ?? "")) problems.push(`${label} releasedAt is not a date`);
    problems.push(...capabilitiesProblems(label, release.capabilities));
    problems.push(...targetsProblems(label, TYPST_TOOL, release.version, release.targets));
  }
  const tinymist = catalog.tinymist ?? {};
  const tinymistVersions = Array.isArray(tinymist.versions) ? tinymist.versions : [];
  if (tinymist.repository !== TINYMIST_TOOL.repository) problems.push("tinymist.repository is wrong");
  problems.push(...releaseListProblems("tinymist", tinymistVersions, "version"));
  if (!tinymistVersions.some((release) => release.version === tinymist.bundled)) {
    problems.push(`bundled Tinymist ${tinymist.bundled} is not listed`);
  }
  const minors = new Set(tinymistVersions.map((release) => release.typstMinor));
  if (minors.size !== tinymistVersions.length) problems.push("tinymist lists one Typst minor twice");
  for (const release of typstVersions) {
    if (VERSION_RE.test(release.version ?? "") && !minors.has(minorOf(release.version))) {
      problems.push(`no Tinymist release covers Typst ${minorOf(release.version)}`);
    }
  }
  for (const release of tinymistVersions) {
    const label = `Tinymist ${release.version}`;
    if (!VERSION_RE.test(release.version ?? "")) problems.push(`${label} has an unusable version`);
    else {
      if (release.tag !== `v${release.version}`) problems.push(`${label} tag is wrong`);
      if (release.typstMinor !== minorOf(release.version)) problems.push(`${label} does not match its Typst minor`);
    }
    if (!DATE_RE.test(release.releasedAt ?? "")) problems.push(`${label} releasedAt is not a date`);
    problems.push(...targetsProblems(label, TINYMIST_TOOL, release.version, release.targets));
  }
  if (typstVersions.some((release) => release.version === typst.bundled)) {
    const bundledMinor = minorOf(typst.bundled);
    const bundledTinymist = tinymistVersions.find((release) => release.version === tinymist.bundled);
    if (bundledTinymist && bundledTinymist.typstMinor !== bundledMinor) {
      problems.push("bundled Tinymist does not match the bundled Typst minor");
    }
  }
  return problems;
}

export function bundledTypstRelease(catalog) {
  const release = catalog.typst.versions.find((entry) => entry.version === catalog.typst.bundled);
  if (!release) throw new Error(`bundled Typst ${catalog.typst.bundled} is missing from the catalog`);
  return release;
}

export function withoutGeneratedAt(catalog) {
  const { generatedAt: _ignored, ...rest } = catalog;
  return rest;
}

export function serializeCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function githubHeaders() {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "oleafly-typst-toolchain-catalog",
    "x-github-api-version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function fetchWithRetry(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < DOWNLOAD_ATTEMPTS) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

async function fetchRelease(tool, version) {
  const url = `https://api.github.com/repos/${tool.apiRepository}/releases/tags/v${version}`;
  const response = await fetchWithRetry(url, { headers: githubHeaders() });
  const release = await response.json();
  if (release.draft || release.prerelease) {
    throw new Error(`${tool.repository} v${version} is not a published stable release`);
  }
  return release;
}

async function downloadAsset(url, expectedSize) {
  const response = await fetchWithRetry(url, {
    headers: { "user-agent": "oleafly-typst-toolchain-catalog" },
    redirect: "follow",
  });
  const finalHost = hostOf(response.url);
  if (!response.url.startsWith("https://") || !ALLOWED_DOWNLOAD_HOSTS.includes(finalHost)) {
    throw new Error(`${url} redirected outside the allowed hosts (${finalHost})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== expectedSize) {
    throw new Error(`${url} returned ${bytes.length} bytes, GitHub lists ${expectedSize}`);
  }
  return bytes;
}

function runTar(args, input) {
  const result = spawnSync("tar", args, { input, maxBuffer: MAX_TOOL_OUTPUT });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`tar ${args.join(" ")} failed: ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

function tarCompressionFlag(archiveType) {
  return archiveType === "tar.xz" ? "J" : "z";
}

function listTar(bytes, archiveType) {
  const flag = tarCompressionFlag(archiveType);
  const lines = (output) => output.toString("utf8").split(/\r?\n/u).filter((line) => line.length > 0);
  const names = lines(runTar([`-t${flag}f`, "-"], bytes));
  const details = lines(runTar([`-tv${flag}f`, "-"], bytes));
  if (names.length !== details.length) throw new Error("tar listing is inconsistent");
  return names.map((name, index) => ({
    name: name.replace(/^\.\//u, ""),
    regular: details[index].startsWith("-"),
  }));
}

function readZipEntries(bytes) {
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP end of central directory is missing");
  const count = bytes.readUInt16LE(eocd + 10);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported");
  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ZIP central directory is corrupt");
    const versionMadeBy = bytes.readUInt16LE(cursor + 4);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const unixMode = versionMadeBy >> 8 === 3 ? externalAttributes >>> 16 : 0;
    entries.push({
      name,
      regular: !name.endsWith("/") && (unixMode & 0o170000) !== 0o120000,
      flags: bytes.readUInt16LE(cursor + 8),
      method: bytes.readUInt16LE(cursor + 10),
      compressedSize: bytes.readUInt32LE(cursor + 20),
      uncompressedSize: bytes.readUInt32LE(cursor + 24),
      localOffset: bytes.readUInt32LE(cursor + 42),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extractZipMember(bytes, member) {
  const matches = readZipEntries(bytes).filter((entry) => entry.name === member);
  if (matches.length !== 1) throw new Error(`ZIP member ${member} is missing or duplicated`);
  const [entry] = matches;
  if ((entry.flags & 1) !== 0) throw new Error(`ZIP member ${member} is encrypted`);
  if (bytes.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new Error("ZIP local header is corrupt");
  const start =
    entry.localOffset + 30 + bytes.readUInt16LE(entry.localOffset + 26) + bytes.readUInt16LE(entry.localOffset + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  let output;
  if (entry.method === 0) output = Buffer.from(data);
  else if (entry.method === 8) output = inflateRawSync(data);
  else throw new Error(`ZIP member ${member} uses unsupported method ${entry.method}`);
  if (output.length !== entry.uncompressedSize) throw new Error(`ZIP member ${member} has the wrong size`);
  return output;
}

export function listArchive(bytes, archiveType) {
  if (archiveType === "zip") return readZipEntries(bytes).map(({ name, regular }) => ({ name, regular }));
  if (archiveType === "tar.xz" || archiveType === "tar.gz") return listTar(bytes, archiveType);
  throw new Error(`cannot list a ${archiveType} asset`);
}

export function extractArchiveMember(bytes, archiveType, member) {
  if (archiveType === "binary") return bytes;
  if (archiveType === "zip") return extractZipMember(bytes, member);
  if (archiveType === "tar.xz" || archiveType === "tar.gz") {
    return runTar([`-xO${tarCompressionFlag(archiveType)}f`, "-", member], bytes);
  }
  throw new Error(`cannot extract a ${archiveType} asset`);
}

export function locateExecutable(entries, executable) {
  const matches = entries.filter((entry) => entry.regular && posix.basename(entry.name) === executable);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${executable} in the archive, found ${matches.length}`);
  }
  if (!isSafeArchiveMember(matches[0].name)) throw new Error(`unsafe archive member ${matches[0].name}`);
  return matches[0].name;
}

function verifyDigest(asset, actual, label) {
  if (typeof asset.digest === "string" && asset.digest.length > 0) {
    if (asset.digest !== `sha256:${actual}`) {
      throw new Error(`${label} digest mismatch: GitHub lists ${asset.digest}, download hashes to ${actual}`);
    }
    return "github";
  }
  return "computed";
}

async function resolveTarget(tool, version, release, target, candidates, log) {
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  const candidate = candidates.find((entry) => assets.has(entry.asset));
  if (!candidate) {
    throw new Error(`${tool.repository} v${version} has no asset for ${target}`);
  }
  const githubAsset = assets.get(candidate.asset);
  const urls = downloadUrls(tool, version, candidate.asset);
  if (githubAsset.browser_download_url !== urls.githubUrl) {
    throw new Error(`${candidate.asset} download address differs from ${urls.githubUrl}`);
  }
  const bytes = await downloadAsset(urls.githubUrl, githubAsset.size);
  const archiveSha256 = sha256Hex(bytes);
  const digestSource = verifyDigest(githubAsset, archiveSha256, candidate.asset);
  const executable = executableName(tool.binaryName, target);
  const archiveMember =
    candidate.archiveType === "binary"
      ? null
      : locateExecutable(listArchive(bytes, candidate.archiveType), executable);
  const binary = extractArchiveMember(bytes, candidate.archiveType, archiveMember);
  if (binary.length === 0) throw new Error(`${candidate.asset} holds an empty ${executable}`);
  log(
    `  ${target}: ${candidate.asset} (${digestSource === "github" ? "GitHub digest verified" : "hashed locally, no GitHub digest"})${archiveMember ? ` member ${archiveMember}` : ""}`,
  );
  return {
    entry: {
      asset: candidate.asset,
      archiveType: candidate.archiveType,
      archiveMember,
      archiveSha256,
      archiveSize: bytes.length,
      binarySha256: sha256Hex(binary),
      binarySize: binary.length,
      mirrorUrl: urls.mirrorUrl,
      githubUrl: urls.githubUrl,
    },
    binary,
  };
}

async function resolveTargets(tool, version, release, candidatesFor, log) {
  const resolved = await Promise.all(
    SUPPORTED_TARGETS.map((target) => resolveTarget(tool, version, release, target, candidatesFor(target), log)),
  );
  const targets = {};
  const binaries = {};
  SUPPORTED_TARGETS.forEach((target, index) => {
    targets[target] = resolved[index].entry;
    binaries[target] = resolved[index].binary;
  });
  return { targets, binaries };
}

function runTool(binary, args, cwd) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("TYPST_") && key !== "SOURCE_DATE_EPOCH"),
  );
  const result = spawnSync(binary, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

export function appCompileArgs(input, output, root) {
  return ["--color", "never", "compile", input, output, "--root", root, "--diagnostic-format", "short"];
}

export function portableCompileArgs(input, output, root) {
  return ["--color=never", "compile", input, output, "--root", root, "--diagnostic-format", "short"];
}

export function parsePossibleValues(help, flag) {
  const lines = help.split(/\r?\n/u);
  const start = lines.findIndex((line) => new RegExp(`(?:^|\\s)${escapeRegExp(flag)}(?:\\s|$|=|<)`, "u").test(line));
  if (start < 0) return [];
  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*(?:-[A-Za-z],\s+)?--[a-z]/u.test(lines[index])) break;
    block.push(lines[index]);
  }
  const text = block.map((line) => line.trim()).join(" ");
  const match = /\[possible values: ([^\]]+)\]/u.exec(text);
  if (!match) return [];
  return match[1].split(",").map((value) => value.trim()).filter(Boolean);
}

function pngWidth(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  return bytes.readUInt32BE(16);
}

const PROBE_SOURCE = "#set page(width: 120pt, height: 80pt)\n= Oleafly Typst probe\n\nThe engine works.\n";
const HTML_PROBE_SOURCE = "= Oleafly Typst probe\n\nThe engine works.\n";
const PACKAGE_MANIFEST = '[package]\nname = "oleafly-probe"\nversion = "0.1.0"\nentrypoint = "lib.typ"\n';
const PACKAGE_LIBRARY = '#let greeting = [Hello from a package]\n';

async function writePackage(directory) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "typst.toml"), PACKAGE_MANIFEST);
  await writeFile(join(directory, "lib.typ"), PACKAGE_LIBRARY);
}

const TYPST_FLAG_PROBES = [
  {
    flag: "--font-path",
    async prepare(dir) {
      await mkdir(join(dir, "fonts"), { recursive: true });
      return { source: PROBE_SOURCE, args: ["--font-path", join(dir, "fonts")] };
    },
  },
  {
    flag: "--ignore-system-fonts",
    async prepare() {
      return { source: PROBE_SOURCE, args: ["--ignore-system-fonts"] };
    },
  },
  {
    flag: "--input",
    async prepare() {
      return {
        source: `${PROBE_SOURCE}#sys.inputs.at("oleafly")\n`,
        args: ["--input", "oleafly=probe"],
      };
    },
  },
  {
    flag: "--pdf-standard",
    async prepare() {
      return { source: PROBE_SOURCE, args: ["--pdf-standard", "a-2b"] };
    },
  },
  {
    flag: "--pages",
    async prepare() {
      return { source: `${PROBE_SOURCE}#pagebreak()\nSecond page.\n`, args: ["--pages", "2"] };
    },
  },
  {
    flag: "--creation-timestamp",
    async prepare() {
      return { source: PROBE_SOURCE, args: ["--creation-timestamp", "0"] };
    },
  },
  {
    flag: "--deps",
    async prepare(dir) {
      return { source: PROBE_SOURCE, args: ["--deps", join(dir, "deps.json"), "--deps-format", "json"] };
    },
    async verify(dir) {
      try {
        const deps = JSON.parse(await readFile(join(dir, "deps.json"), "utf8"));
        return Array.isArray(deps.inputs) && deps.inputs.some((input) => String(input).endsWith("main.typ"));
      } catch {
        return false;
      }
    },
  },
  {
    flag: "--package-path",
    async prepare(dir) {
      await writePackage(join(dir, "packages", "local", "oleafly-probe", "0.1.0"));
      return {
        source: `#import "@local/oleafly-probe:0.1.0": greeting\n${PROBE_SOURCE}#greeting\n`,
        args: ["--package-path", join(dir, "packages")],
      };
    },
  },
  {
    flag: "--package-cache-path",
    async prepare(dir) {
      await writePackage(join(dir, "cache", "preview", "oleafly-probe", "0.1.0"));
      return {
        source: `#import "@preview/oleafly-probe:0.1.0": greeting\n${PROBE_SOURCE}#greeting\n`,
        args: ["--package-cache-path", join(dir, "cache")],
      };
    },
  },
];

async function probeCompile(binary, workDir, name, source, extraArgs, outputName, argv = portableCompileArgs) {
  const dir = join(workDir, name);
  await mkdir(dir, { recursive: true });
  const input = join(dir, "main.typ");
  const output = join(dir, outputName);
  await writeFile(input, source);
  const result = runTool(binary, [...argv(input, output, dir), ...extraArgs], dir);
  let bytes = null;
  if (result.status === 0) {
    try {
      bytes = await readFile(output);
    } catch {
      bytes = null;
    }
  }
  return { ...result, dir, input, output, bytes };
}

function unsupported(result) {
  return result.status !== 0 && UNSUPPORTED_ARGUMENT_RE.test(result.stderr);
}

export async function probeTypst(binary, version, workDir) {
  const report = {
    version,
    appArgv: false,
    portableArgv: false,
    diagnostics: false,
    flags: [],
    outputFormats: [],
    pdfStandards: [],
    notes: [],
  };
  await mkdir(workDir, { recursive: true });
  const versionResult = runTool(binary, ["--version"], workDir);
  if (versionResult.status !== 0 || !new RegExp(`^typst ${escapeRegExp(version)}(?:\\s|$)`, "u").test(versionResult.stdout)) {
    throw new Error(`Typst ${version} reports ${JSON.stringify(versionResult.stdout.trim())}`);
  }
  report.versionOutput = versionResult.stdout.trim();
  const isPdf = (result) => result.status === 0 && result.bytes?.subarray(0, 5).toString("latin1") === "%PDF-";
  const app = await probeCompile(binary, workDir, "app", PROBE_SOURCE, [], "out.pdf", appCompileArgs);
  if (isPdf(app)) {
    report.appArgv = true;
    report.flags.push("--color");
  } else if (app.status !== 0 && /unrecognized subcommand 'never'/u.test(app.stderr)) {
    report.notes.push(`--color never: ${app.stderr.trim().split("\n")[0]}`);
  } else {
    throw new Error(`Typst ${version} failed the app argv probe: ${app.stderr.trim()}`);
  }
  const base = await probeCompile(binary, workDir, "base", PROBE_SOURCE, [], "out.pdf");
  if (!isPdf(base)) {
    throw new Error(`Typst ${version} cannot compile with --color=never: ${base.stderr.trim()}`);
  }
  report.portableArgv = true;
  report.outputFormats.push("pdf");
  const invalid = await probeCompile(binary, workDir, "invalid", "#this-function-does-not-exist()\n", [], "out.pdf");
  if (invalid.status === 0 || !/main\.typ:\d+:\d+: error: /u.test(invalid.stderr)) {
    throw new Error(`Typst ${version} does not emit short diagnostics: ${invalid.stderr.trim()}`);
  }
  report.diagnostics = true;
  for (const probe of TYPST_FLAG_PROBES) {
    const dir = join(workDir, probe.flag.slice(2));
    await mkdir(dir, { recursive: true });
    const { source, args } = await probe.prepare(dir);
    const result = await probeCompile(binary, dir, "run", source, args, "out.pdf");
    if (isPdf(result) && (!probe.verify || (await probe.verify(dir)))) {
      report.flags.push(probe.flag);
    } else if (unsupported(result)) {
      report.notes.push(`${probe.flag}: ${result.stderr.trim().split("\n")[0]}`);
    } else {
      throw new Error(`Typst ${version} failed the ${probe.flag} probe: ${result.stderr.trim()}`);
    }
  }
  const svg = await probeCompile(binary, workDir, "svg", PROBE_SOURCE, ["--format", "svg"], "out.svg");
  if (svg.status === 0 && svg.bytes?.toString("utf8").includes("<svg")) {
    report.outputFormats.push("svg");
    report.flags.push("--format");
  } else if (unsupported(svg)) {
    report.notes.push(`--format svg: ${svg.stderr.trim().split("\n")[0]}`);
  } else {
    throw new Error(`Typst ${version} failed the SVG probe: ${svg.stderr.trim()}`);
  }
  const png = await probeCompile(binary, workDir, "png", PROBE_SOURCE, ["--format", "png", "--ppi", "144"], "out.png");
  if (png.status === 0 && png.bytes && pngWidth(png.bytes) === 240) {
    report.outputFormats.push("png");
    if (!report.flags.includes("--format")) report.flags.push("--format");
    report.flags.push("--ppi");
  } else if (unsupported(png)) {
    report.notes.push(`--format png --ppi 144: ${png.stderr.trim().split("\n")[0]}`);
  } else {
    throw new Error(`Typst ${version} failed the PNG probe: ${png.stderr.trim()} width ${png.bytes ? pngWidth(png.bytes) : "none"}`);
  }
  const html = await probeCompile(binary, workDir, "html", HTML_PROBE_SOURCE, ["--features", "html", "--format", "html"], "out.html");
  if (html.status === 0 && html.bytes?.toString("utf8").includes("<html")) {
    report.outputFormats.push("html");
    report.flags.push("--features");
  } else if (unsupported(html)) {
    report.notes.push(`--features html --format html: ${html.stderr.trim().split("\n")[0]}`);
  } else {
    throw new Error(`Typst ${version} failed the HTML probe: ${html.stderr.trim()}`);
  }
  const help = runTool(binary, ["compile", "-h"], workDir);
  if (help.status !== 0) throw new Error(`Typst ${version} compile -h failed`);
  report.pdfStandards = report.flags.includes("--pdf-standard") ? parsePossibleValues(help.stdout, "--pdf-standard") : [];
  if (report.flags.includes("--pdf-standard") && !report.pdfStandards.includes("a-2b")) {
    throw new Error(`Typst ${version} accepted --pdf-standard a-2b but does not list it`);
  }
  report.flags.sort();
  report.outputFormats.sort();
  return report;
}

export async function probeTinymist(binary, version, workDir) {
  await mkdir(workDir, { recursive: true });
  const versionResult = runTool(binary, ["--version"], workDir);
  const output = `${versionResult.stdout}\n${versionResult.stderr}`;
  if (versionResult.status !== 0 || !new RegExp(`\\bv?${escapeRegExp(version)}\\b`, "u").test(output)) {
    throw new Error(`Tinymist ${version} reports ${JSON.stringify(output.trim())}`);
  }
  const lspHelp = runTool(binary, ["lsp", "--help"], workDir);
  if (lspHelp.status !== 0) throw new Error(`Tinymist ${version} has no lsp subcommand: ${lspHelp.stderr.trim()}`);
  const describe = /Build Git Describe:\s+(\S+)/u.exec(output);
  return { version, versionLine: describe ? `Build Git Describe: ${describe[1]}` : output.trim().split("\n")[0], lsp: true };
}

async function stageBinary(workDir, name, bytes) {
  await mkdir(workDir, { recursive: true });
  const path = join(workDir, name);
  await writeFile(path, bytes, { mode: 0o755 });
  await chmod(path, 0o755);
  return path;
}

function capabilitiesFrom(report) {
  return {
    flags: report.flags,
    outputFormats: report.outputFormats,
    pdfStandards: report.pdfStandards,
  };
}

async function readCommittedCatalog() {
  try {
    return JSON.parse(await readFile(CATALOG_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function parseArgs(argv) {
  const options = { check: false, skipProbe: false, help: false };
  for (const arg of argv) {
    if (arg === "--check") options.check = true;
    else if (arg === "--skip-probe") options.skipProbe = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "usage: node scripts/typst/build-toolchain-catalog.mjs [--check] [--skip-probe]",
    "",
    "Downloads every curated Typst and Tinymist release asset from GitHub, verifies",
    "GitHub's published digests, hashes each archive and its extracted executable, runs",
    "the current host's binaries to record Typst CLI capabilities, and writes",
    "src-tauri/resources/typst-toolchain.json.",
    "",
    "  --check       rebuild in memory and compare with the committed catalog, never write",
    "  --skip-probe  reuse committed capabilities instead of running host binaries",
  ].join("\n");
}

function differingPaths(left, right, path = "$", out = []) {
  if (out.length >= 25) return out;
  if (typeof left !== typeof right || Array.isArray(left) !== Array.isArray(right) || left === null || right === null) {
    if (left !== right) out.push(path);
    return out;
  }
  if (typeof left !== "object") {
    if (left !== right) out.push(path);
    return out;
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  if (JSON.stringify(Object.keys(left)) !== JSON.stringify(Object.keys(right))) out.push(`${path} (key order or keys)`);
  for (const key of keys) differingPaths(left[key], right[key], `${path}.${key}`, out);
  return out;
}

export async function buildCatalog({ skipProbe, committed, log = console.log }) {
  const host = skipProbe ? null : hostTarget();
  if (!skipProbe && !host) {
    throw new Error(`cannot probe on ${process.platform}/${process.arch}; rerun with --skip-probe`);
  }
  const workRoot = await mkdtemp(join(tmpdir(), "oleafly-typst-catalog-"));
  const probes = { typst: [], tinymist: [] };
  try {
    const typstVersions = [];
    for (const version of [...TYPST_VERSIONS].sort(compareVersions)) {
      log(`Typst ${version}`);
      const release = await fetchRelease(TYPST_TOOL, version);
      const { targets, binaries } = await resolveTargets(TYPST_TOOL, version, release, (target) => [typstAssetFor(target)], log);
      let capabilities;
      if (skipProbe) {
        capabilities = committed?.typst?.versions?.find((entry) => entry.version === version)?.capabilities;
        if (!capabilities) throw new Error(`no committed capabilities for Typst ${version}`);
      } else {
        const dir = join(workRoot, `typst-${version}`);
        const binary = await stageBinary(dir, executableName("typst", host), binaries[host]);
        const report = await probeTypst(binary, version, join(dir, "probe"));
        probes.typst.push(report);
        capabilities = capabilitiesFrom(report);
        await rm(dir, { recursive: true, force: true });
      }
      typstVersions.push({
        version,
        tag: `v${version}`,
        minor: minorOf(version),
        releasedAt: release.published_at.slice(0, 10),
        capabilities,
        targets,
      });
    }
    const tinymistVersions = [];
    const minors = Object.keys(TINYMIST_BY_TYPST_MINOR).sort(compareVersions);
    for (const typstMinor of minors) {
      const version = TINYMIST_BY_TYPST_MINOR[typstMinor];
      log(`Tinymist ${version} (Typst ${typstMinor})`);
      const release = await fetchRelease(TINYMIST_TOOL, version);
      const { targets, binaries } = await resolveTargets(TINYMIST_TOOL, version, release, tinymistAssetCandidates, log);
      if (!skipProbe) {
        const dir = join(workRoot, `tinymist-${version}`);
        const binary = await stageBinary(dir, executableName("tinymist", host), binaries[host]);
        probes.tinymist.push(await probeTinymist(binary, version, dir));
        await rm(dir, { recursive: true, force: true });
      }
      tinymistVersions.push({
        typstMinor,
        version,
        tag: `v${version}`,
        releasedAt: release.published_at.slice(0, 10),
        targets,
      });
    }
    const catalog = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString().slice(0, 10),
      supportedTargets: [...SUPPORTED_TARGETS],
      allowedDownloadHosts: [...ALLOWED_DOWNLOAD_HOSTS],
      typst: {
        repository: TYPST_TOOL.repository,
        bundled: BUNDLED_TYPST_VERSION,
        versions: typstVersions,
      },
      tinymist: {
        repository: TINYMIST_TOOL.repository,
        bundled: BUNDLED_TINYMIST_VERSION,
        versions: tinymistVersions,
      },
    };
    if (
      committed &&
      serializeCatalog(withoutGeneratedAt(committed)) === serializeCatalog(withoutGeneratedAt(catalog)) &&
      DATE_RE.test(committed.generatedAt ?? "")
    ) {
      catalog.generatedAt = committed.generatedAt;
    }
    return { catalog, probes, host };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

function printProbes(probes, host, log) {
  if (!host) return;
  log(`\nCapability probes on ${host}:`);
  for (const report of probes.typst) {
    log(
      `  Typst ${report.version}: app argv ${report.appArgv ? "ok" : "FAILS"}, --color=never argv ok, short diagnostics ok; flags ${report.flags.join(" ") || "(none)"}; formats ${report.outputFormats.join(" ")}; PDF standards ${report.pdfStandards.join(" ") || "(none)"}`,
    );
    for (const note of report.notes) log(`    unsupported ${note}`);
  }
  for (const report of probes.tinymist) {
    log(`  Tinymist ${report.version}: ${report.versionLine}; lsp subcommand ok`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const committed = await readCommittedCatalog();
  if (options.check) {
    if (!committed) throw new Error(`${CATALOG_PATH} does not exist`);
    const committedProblems = validateCatalog(committed);
    if (committedProblems.length > 0) {
      for (const problem of committedProblems) console.error(problem);
      return 1;
    }
  }
  const { catalog, probes, host } = await buildCatalog({ skipProbe: options.skipProbe, committed });
  printProbes(probes, host, console.log);
  const problems = validateCatalog(catalog);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    return 1;
  }
  if (options.check) {
    const expected = withoutGeneratedAt(catalog);
    const actual = withoutGeneratedAt(committed);
    if (serializeCatalog(expected) !== serializeCatalog(actual)) {
      console.error(`${CATALOG_PATH} is out of date with GitHub:`);
      for (const path of differingPaths(actual, expected)) console.error(`  ${path}`);
      return 1;
    }
    console.log(`\n${CATALOG_PATH} matches GitHub.`);
    return 0;
  }
  await mkdir(dirname(CATALOG_PATH), { recursive: true });
  await writeFile(CATALOG_PATH, serializeCatalog(catalog), "utf8");
  console.log(`\nwrote ${CATALOG_PATH}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`typst toolchain catalog failed: ${error.message}`);
    process.exitCode = 1;
  }
}
