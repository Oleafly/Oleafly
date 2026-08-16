#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { request } from "node:https";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = join(SCRIPT_DIR, "language-servers", "manifest.json");
const TAURI_DIR = join(ROOT, "src-tauri");
const DOWNLOAD_RETRIES = 3;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const OPEN_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const OPEN_DIRECTORY = fsConstants.O_DIRECTORY ?? 0;

function usage() {
  return `Usage:
  node scripts/fetch-language-servers.mjs [<target>|all] [options]

Options:
  --target <target|current|all>  Select a Tauri target (default: current)
  --server <texlab|tinymist|all>
                                Select a server (default: all)
  --install-mode <policy|app-data|resource>
                                Follow the manifest policy, install in the app
                                data directory, or stage an immutable Tauri
                                resource archive
  --check                       Validate current files without network access
  --offline                     Install only from a verified local archive
  --force                       Redownload and replace selected files
  -h, --help                    Show this help

The default policy stages Tinymist's checksum-pinned upstream archive as a
Tauri resource and keeps TexLab in app data after explicit user consent while
GPL redistribution is unresolved.
Normal frontend builds never run this script.`;
}

export function isSafeArchivePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return false;
  if (value.includes("\\") || isAbsolute(value) || /^[A-Za-z]:/.test(value)) return false;
  const trimmed = value.endsWith("/") ? value.slice(0, -1) : value;
  if (trimmed.length === 0) return false;
  return trimmed.split("/").every((segment) => SAFE_SEGMENT_RE.test(segment));
}

function isSafeAssetName(value) {
  return (
    typeof value === "string" &&
    value === basename(value) &&
    SAFE_SEGMENT_RE.test(value) &&
    !value.startsWith(".")
  );
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (manifest.schemaVersion !== 1) {
    throw new Error(`unsupported language-server manifest schema: ${manifest.schemaVersion}`);
  }
  return manifest;
}

function readOptionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv) {
  const options = {
    target: "current",
    server: "all",
    installMode: "policy",
    check: false,
    offline: false,
    force: false,
    help: false,
  };
  let positionalTarget;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    } else if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else if (argument === "--check") {
      options.check = true;
    } else if (argument === "--offline") {
      options.offline = true;
    } else if (argument === "--force") {
      options.force = true;
    } else if (argument === "--target") {
      options.target = readOptionValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith("--target=")) {
      options.target = argument.slice("--target=".length);
    } else if (argument === "--server") {
      options.server = readOptionValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith("--server=")) {
      options.server = argument.slice("--server=".length);
    } else if (argument === "--install-mode") {
      options.installMode = readOptionValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith("--install-mode=")) {
      options.installMode = argument.slice("--install-mode=".length);
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown option: ${argument}`);
    } else if (positionalTarget) {
      throw new Error(`unexpected positional argument: ${argument}`);
    } else {
      positionalTarget = argument;
    }
  }

  if (positionalTarget) {
    if (options.target !== "current") {
      throw new Error("target was provided both positionally and with --target");
    }
    options.target = positionalTarget;
  }
  if (options.check && options.force) throw new Error("--check and --force cannot be combined");
  if (options.offline && options.force) throw new Error("--offline and --force cannot be combined");
  if (!["policy", "app-data", "resource"].includes(options.installMode)) {
    throw new Error(`unknown install mode: ${options.installMode}`);
  }
  return options;
}

export function currentTarget(platform = process.platform, architecture = process.arch) {
  const target = {
    "darwin:arm64": "aarch64-apple-darwin",
    "linux:arm64": "aarch64-unknown-linux-gnu",
    "linux:x64": "x86_64-unknown-linux-gnu",
    "win32:x64": "x86_64-pc-windows-msvc",
  }[`${platform}:${architecture}`];
  if (!target) throw new Error(`unsupported host platform: ${platform}/${architecture}`);
  return target;
}

function selectedTargets(manifest, requestedTarget) {
  const target = requestedTarget === "current" ? currentTarget() : requestedTarget;
  if (target === "all") return manifest.supportedTargets;
  if (!manifest.supportedTargets.includes(target)) {
    throw new Error(
      `unsupported target: ${target}; expected one of ${manifest.supportedTargets.join(", ")}`,
    );
  }
  return [target];
}

function selectedServers(manifest, requestedServer) {
  if (requestedServer === "all") return Object.entries(manifest.servers);
  const server = manifest.servers[requestedServer];
  if (!server) {
    throw new Error(
      `unsupported server: ${requestedServer}; expected one of ${Object.keys(manifest.servers).join(", ")}`,
    );
  }
  return [[requestedServer, server]];
}

function resolvedInstallMode(server, requestedMode) {
  if (requestedMode !== "policy") return requestedMode;
  return server.distribution.defaultPolicy === "resource-archive"
    ? "resource"
    : "app-data";
}

function assertDistributionPolicy(server, mode) {
  if (mode !== "resource") return;
  if (
    server.distribution.defaultPolicy === "resource-archive" &&
    server.distribution.redistributionApproved
  ) {
    return;
  }
  throw new Error(
    `${server.displayName} resource-archive mode is ${server.distribution.bundleStatus}. ` +
      "Use its consent-gated app-data setup until the maintainer completes " +
      "and records the GPL distribution checklist.",
  );
}

function cacheRoot(manifest) {
  const configured = process.env[manifest.cacheEnvironmentVariable];
  return configured ? resolve(configured) : join(ROOT, "src-tauri", "target", "language-servers");
}

export function defaultAppDataDirectory(
  applicationIdentifier,
  platform = process.platform,
  environment = process.env,
  userHome = homedir(),
) {
  // The target platform is a parameter, so the separator has to come from that
  // platform rather than from whichever host is running this. Using the host's
  // join builds a macOS path out of backslashes when a Windows runner asks
  // about darwin.
  if (platform === "darwin") {
    return posix.join(userHome, "Library", "Application Support", applicationIdentifier);
  }
  if (platform === "linux") {
    const dataHome = environment.XDG_DATA_HOME?.trim();
    return posix.join(
      dataHome ? posix.resolve(dataHome) : posix.join(userHome, ".local", "share"),
      applicationIdentifier,
    );
  }
  if (platform === "win32") {
    const localData = environment.LOCALAPPDATA?.trim();
    if (!localData) {
      throw new Error(
        "LOCALAPPDATA is unavailable; cannot resolve the Oleafly app-local-data directory",
      );
    }
    return win32.join(win32.resolve(localData), applicationIdentifier);
  }
  throw new Error(`unsupported app-data platform: ${platform}`);
}

export function appDataInstallRoot(manifest) {
  const policy = manifest.appDataInstallation;
  const configured =
    process.env[policy.overrideEnvironmentVariable]?.trim();
  const appDataDirectory = configured
    ? resolve(configured)
    : defaultAppDataDirectory(policy.applicationIdentifier);
  return join(appDataDirectory, policy.relativeDirectory);
}

export function appDataExecutablePath(manifest, serverId, server, target) {
  for (const [field, value] of [
    ["server id", serverId],
    ["server version", server.version],
    ["target", target],
    ["binary base name", server.binaryBaseName],
  ]) {
    if (!isSafeAssetName(value)) {
      throw new Error(`unsafe ${field}: ${String(value)}`);
    }
  }
  const directory = join(
    appDataInstallRoot(manifest),
    serverId,
    server.version,
    target,
  );
  const executableName =
    target === "x86_64-pc-windows-msvc"
      ? `${server.binaryBaseName}.exe`
      : server.binaryBaseName;
  return confinedPath(directory, executableName);
}

function confinedPath(directory, filename) {
  if (!isSafeAssetName(filename)) throw new Error(`unsafe output filename: ${filename}`);
  const root = resolve(directory);
  const candidate = resolve(root, filename);
  if (!candidate.startsWith(`${root}${sep}`)) throw new Error(`output escapes ${root}: ${filename}`);
  return candidate;
}

export function resourceArchivePath(targetEntry) {
  if (!isSafeArchivePath(targetEntry.resourceRelativePath)) {
    throw new Error(
      `unsafe Tauri resource path: ${String(targetEntry.resourceRelativePath)}`,
    );
  }
  const root = resolve(TAURI_DIR);
  const candidate = resolve(root, targetEntry.resourceRelativePath);
  if (!candidate.startsWith(`${root}${sep}`)) {
    throw new Error(
      `Tauri resource path escapes ${root}: ${targetEntry.resourceRelativePath}`,
    );
  }
  return candidate;
}

function outputPath(manifest, serverId, server, target) {
  return appDataExecutablePath(manifest, serverId, server, target);
}

function archivePath(manifest, serverId, server, targetEntry) {
  if (!isSafeAssetName(serverId) || !isSafeAssetName(server.version)) {
    throw new Error(`unsafe server metadata for ${serverId}`);
  }
  const directory = join(cacheRoot(manifest), "archives", serverId, server.version);
  return confinedPath(directory, targetEntry.asset);
}

function comparablePath(value, platform = process.platform) {
  const normalized = resolve(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export function assertWindowsReparseQuerySafe(path, query) {
  if (query.error) {
    throw new Error(
      `cannot rule out a Windows reparse point at ${path}: ${query.error.message}`,
    );
  }
  if (query.status === 0) {
    throw new Error(`refusing Windows reparse-point path: ${path}`);
  }
  const output = `${query.stdout ?? ""}\n${query.stderr ?? ""}`;
  const isConfirmedNotReparsePoint =
    query.status === 1 &&
    (/\b4390\b/.test(output) || /not a reparse point/i.test(output));
  if (!isConfirmedNotReparsePoint) {
    throw new Error(
      `ambiguous Windows reparse-point query for ${path} (status ${String(query.status)})`,
    );
  }
}

// Absolute path: resolving fsutil through PATH would let a writable directory
// earlier in PATH decide which binary vets the reparse point.
const DEFAULT_SYSTEM_ROOT = String.raw`C:\Windows`;
const FSUTIL = String.raw`${process.env.SystemRoot ?? DEFAULT_SYSTEM_ROOT}\System32\fsutil.exe`;

function assertNoWindowsReparsePoint(path, platform = process.platform) {
  if (platform !== "win32") return;
  const query = spawnSync(FSUTIL, ["reparsepoint", "query", path], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  assertWindowsReparseQuerySafe(path, query);
}

async function inspectDirectoryNode(path, platform = process.platform) {
  const before = await lstat(path);
  if (before.isSymbolicLink()) {
    throw new Error(`refusing linked directory ancestor: ${path}`);
  }
  if (!before.isDirectory()) {
    throw new Error(`refusing non-directory ancestor: ${path}`);
  }
  assertNoWindowsReparsePoint(path, platform);
  let handle;
  try {
    if (platform !== "win32") {
      handle = await open(
        path,
        fsConstants.O_RDONLY | OPEN_DIRECTORY | OPEN_NOFOLLOW,
      );
      const opened = await handle.stat();
      if (!opened.isDirectory() || !sameIdentity(before, opened)) {
        throw new Error(`directory changed while opening with O_NOFOLLOW: ${path}`);
      }
    }
    const canonical = await realpath(path);
    if (comparablePath(canonical, platform) !== comparablePath(path, platform)) {
      const detail =
        platform === "win32" ? "reparse-point or ambiguous" : "realpath changed";
      throw new Error(`refusing ${detail} directory ancestor: ${path} -> ${canonical}`);
    }
    const after = await lstat(path);
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      !sameIdentity(before, after)
    ) {
      throw new Error(`directory changed during secure inspection: ${path}`);
    }
    return {
      path,
      canonical,
      dev: after.dev,
      ino: after.ino,
    };
  } finally {
    await handle?.close();
  }
}

function directoryComponents(directory) {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  const remainder = relative(root, absolute);
  const components = remainder === "" ? [] : remainder.split(sep);
  const paths = [root];
  let current = root;
  for (const component of components) {
    // Directory names are user/OS controlled and can contain spaces or dots.
    // The resolved relative path must still consist only of real child names.
    if (
      component === "" ||
      component === "." ||
      component === ".." ||
      component.includes("\0")
    ) {
      throw new Error(`unsafe directory component: ${component}`);
    }
    current = join(current, component);
    paths.push(current);
  }
  return paths;
}

export async function captureDirectorySnapshot(
  directory,
  platform = process.platform,
) {
  const snapshot = [];
  for (const path of directoryComponents(directory)) {
    snapshot.push(await inspectDirectoryNode(path, platform));
  }
  return snapshot;
}

export async function assertDirectorySnapshot(
  snapshot,
  platform = process.platform,
) {
  for (const expected of snapshot) {
    const current = await inspectDirectoryNode(expected.path, platform);
    if (
      !sameIdentity(current, expected) ||
      comparablePath(current.canonical, platform) !==
        comparablePath(expected.canonical, platform)
    ) {
      throw new Error(`directory changed during secure file operation: ${expected.path}`);
    }
  }
}

async function ensureSafeDirectory(directory, platform = process.platform) {
  const paths = directoryComponents(directory);
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    try {
      await inspectDirectoryNode(path, platform);
    } catch (error) {
      if (error?.code !== "ENOENT" || index === 0) throw error;
      const parentSnapshot = await captureDirectorySnapshot(paths[index - 1], platform);
      await assertDirectorySnapshot(parentSnapshot, platform);
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") throw mkdirError;
      }
      await assertDirectorySnapshot(parentSnapshot, platform);
      await inspectDirectoryNode(path, platform);
    }
  }
  return captureDirectorySnapshot(directory, platform);
}

async function inspectRegularLeaf(path, directorySnapshot, platform = process.platform) {
  await assertDirectorySnapshot(directorySnapshot, platform);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`refusing symbolic-link file: ${path}`);
  }
  if (!metadata.isFile()) {
    throw new Error(`refusing non-regular file: ${path}`);
  }
  assertNoWindowsReparsePoint(path, platform);
  const canonical = await realpath(path);
  if (comparablePath(canonical, platform) !== comparablePath(path, platform)) {
    const detail =
      platform === "win32" ? "reparse-point or ambiguous" : "realpath changed";
    throw new Error(`refusing ${detail} file: ${path} -> ${canonical}`);
  }
  return metadata;
}

async function readHandleSha256(handle) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

async function readHandleBytes(handle, size) {
  const bytes = Buffer.alloc(size);
  let position = 0;
  while (position < size) {
    const result = await handle.read(bytes, position, size - position, position);
    if (result.bytesRead === 0) {
      throw new Error(`secure file read ended at ${position} of ${size} bytes`);
    }
    position += result.bytesRead;
  }
  return bytes;
}

async function inspectRegularFile(path, options = {}) {
  let handle;
  try {
    const directorySnapshot = await captureDirectorySnapshot(dirname(path));
    const before = await inspectRegularLeaf(path, directorySnapshot);
    handle = await open(path, fsConstants.O_RDONLY | OPEN_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened)) {
      throw new Error(`file changed while opening with O_NOFOLLOW: ${path}`);
    }
    const bytes = options.bytes
      ? await readHandleBytes(handle, Number(opened.size))
      : undefined;
    const digest = options.digest
      ? bytes
        ? sha256(bytes)
        : await readHandleSha256(handle)
      : undefined;
    const after = await inspectRegularLeaf(path, directorySnapshot);
    if (!sameIdentity(opened, after)) {
      throw new Error(`file changed during secure read: ${path}`);
    }
    return { ok: true, metadata: opened, digest, bytes };
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, reason: "is missing" };
    throw error;
  } finally {
    await handle?.close();
  }
}

function probeVersion(server, binaryPath) {
  const result = spawnSync(binaryPath, server.versionProbe.args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) return { ok: false, reason: result.error.message };
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) return { ok: false, reason: `version probe exited ${result.status}` };
  if (!new RegExp(server.versionProbe.pattern, "m").test(output)) {
    return { ok: false, reason: `version output did not match ${server.version}` };
  }
  return { ok: true };
}

async function validateInstalled(server, target, targetEntry, path, hostTarget) {
  const inspected = await inspectRegularFile(path, { digest: true });
  if (!inspected.ok) return inspected;
  if (inspected.metadata.size !== targetEntry.binarySize) {
    return {
      ok: false,
      reason: `has size ${inspected.metadata.size}, expected ${targetEntry.binarySize}`,
    };
  }
  const actualSha = inspected.digest;
  if (actualSha !== targetEntry.binarySha256) {
    return { ok: false, reason: `has SHA-256 ${actualSha}` };
  }
  if (process.platform !== "win32" && (inspected.metadata.mode & 0o111) === 0) {
    return { ok: false, reason: "is not executable" };
  }
  if (target === hostTarget) {
    const beforeProbe = await inspectRegularFile(path, { digest: true });
    if (
      !beforeProbe.ok ||
      !sameIdentity(inspected.metadata, beforeProbe.metadata) ||
      beforeProbe.digest !== targetEntry.binarySha256
    ) {
      return { ok: false, reason: "changed immediately before its version probe" };
    }
    const probe = probeVersion(server, path);
    if (!probe.ok) return probe;
    const afterProbe = await inspectRegularFile(path, { digest: true });
    if (
      !afterProbe.ok ||
      !sameIdentity(beforeProbe.metadata, afterProbe.metadata) ||
      afterProbe.digest !== targetEntry.binarySha256
    ) {
      return { ok: false, reason: "changed during its version probe" };
    }
  }
  return { ok: true };
}

export function assertHttpsUrl(rawUrl, allowedHosts) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error(`refusing non-HTTPS URL: ${url.href}`);
  if (url.username || url.password) throw new Error(`refusing URL credentials: ${url.href}`);
  if (url.port) throw new Error(`refusing non-default HTTPS port: ${url.href}`);
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`refusing unapproved download host: ${url.hostname}`);
  }
  return url;
}

function fetchHttpsBuffer(url, expectedSize, allowedHosts, redirects = 0) {
  if (redirects > MAX_REDIRECTS) throw new Error(`too many redirects while fetching ${url}`);
  const parsedUrl = assertHttpsUrl(url, allowedHosts);

  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(
      parsedUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "Oleafly-language-server-fetcher/1",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            rejectPromise(new Error(`redirect from ${parsedUrl.href} had no location`));
            return;
          }
          let redirected;
          try {
            redirected = new URL(location, parsedUrl);
            assertHttpsUrl(redirected.href, allowedHosts);
          } catch (error) {
            rejectPromise(error);
            return;
          }
          fetchHttpsBuffer(redirected.href, expectedSize, allowedHosts, redirects + 1).then(
            resolvePromise,
            rejectPromise,
          );
          return;
        }
        if (status !== 200) {
          response.resume();
          rejectPromise(new Error(`download returned HTTP ${status}: ${parsedUrl.href}`));
          return;
        }
        const contentLength = response.headers["content-length"];
        if (contentLength && Number(contentLength) !== expectedSize) {
          response.resume();
          rejectPromise(
            new Error(
              `download length mismatch for ${parsedUrl.href}: expected ${expectedSize}, got ${contentLength}`,
            ),
          );
          return;
        }

        const chunks = [];
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > expectedSize) {
            response.destroy(new Error(`download exceeded pinned size ${expectedSize}`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (received !== expectedSize) {
            rejectPromise(
              new Error(`download was ${received} bytes, expected exactly ${expectedSize}`),
            );
            return;
          }
          resolvePromise(Buffer.concat(chunks, received));
        });
        response.on("error", rejectPromise);
      },
    );
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error(`download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`));
    });
    req.on("error", rejectPromise);
    req.end();
  });
}

async function downloadWithRetry(targetEntry, allowedHosts) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt += 1) {
    try {
      const buffer = await fetchHttpsBuffer(
        targetEntry.url,
        targetEntry.archiveSize,
        allowedHosts,
      );
      const actualSha = sha256(buffer);
      if (actualSha !== targetEntry.archiveSha256) {
        throw new Error(
          `archive checksum mismatch: expected ${targetEntry.archiveSha256}, got ${actualSha}`,
        );
      }
      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt < DOWNLOAD_RETRIES) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * attempt));
      }
    }
  }
  throw lastError;
}

async function inspectDestination(path, directorySnapshot) {
  try {
    return await inspectRegularLeaf(path, directorySnapshot);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertOwnedRegularFile(path, expected, directorySnapshot) {
  const current = await inspectRegularLeaf(path, directorySnapshot);
  if (!sameIdentity(current, expected)) {
    throw new Error(`temporary/output file identity changed: ${path}`);
  }
  return current;
}

async function removeOwnedFile(path, expected, directorySnapshot) {
  try {
    await assertOwnedRegularFile(path, expected, directorySnapshot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await rm(path);
}

export async function openExclusiveNoFollow(path, mode = 0o600) {
  return open(
    path,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      OPEN_NOFOLLOW,
    mode,
  );
}

async function renameWindowsReplacingRegular(
  temporary,
  destination,
  temporaryIdentity,
  directorySnapshot,
) {
  const destinationIdentity = await inspectDestination(destination, directorySnapshot);
  if (!destinationIdentity) {
    await rename(temporary, destination);
    return;
  }

  const backup = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${randomUUID()}.previous`,
  );
  await assertDirectorySnapshot(directorySnapshot);
  await rename(destination, backup);
  try {
    const movedIdentity = await assertOwnedRegularFile(
      backup,
      destinationIdentity,
      directorySnapshot,
    );
    await assertDirectorySnapshot(directorySnapshot);
    await assertOwnedRegularFile(temporary, temporaryIdentity, directorySnapshot);
    await rename(temporary, destination);
    await assertDirectorySnapshot(directorySnapshot);
    await removeOwnedFile(backup, movedIdentity, directorySnapshot);
  } catch (error) {
    try {
      await assertDirectorySnapshot(directorySnapshot);
      if (!(await inspectDestination(destination, directorySnapshot))) {
        await rename(backup, destination);
      }
    } catch {
      // Preserve both entries for manual recovery if the directory changed.
    }
    throw error;
  }
}

export async function atomicWrite(path, buffer, mode, testHooks = {}) {
  const directory = dirname(path);
  const directorySnapshot = await ensureSafeDirectory(directory);
  await assertDirectorySnapshot(directorySnapshot);
  await inspectDestination(path, directorySnapshot);

  const temporary = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  let temporaryIdentity;
  let renamed = false;
  try {
    await assertDirectorySnapshot(directorySnapshot);
    handle = await openExclusiveNoFollow(temporary, mode);
    temporaryIdentity = await handle.stat();
    if (!temporaryIdentity.isFile()) {
      throw new Error(`exclusive temporary output is not a regular file: ${temporary}`);
    }
    await assertOwnedRegularFile(temporary, temporaryIdentity, directorySnapshot);
    await handle.writeFile(buffer);
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await testHooks.afterTemporarySync?.({
      destination: path,
      directory,
      temporary,
    });
    await assertDirectorySnapshot(directorySnapshot);
    await assertOwnedRegularFile(temporary, temporaryIdentity, directorySnapshot);
    await inspectDestination(path, directorySnapshot);

    try {
      await rename(temporary, path);
    } catch (error) {
      if (process.platform !== "win32" || !["EEXIST", "EPERM"].includes(error?.code)) throw error;
      await renameWindowsReplacingRegular(
        temporary,
        path,
        temporaryIdentity,
        directorySnapshot,
      );
    }
    renamed = true;
    await assertDirectorySnapshot(directorySnapshot);
    await assertOwnedRegularFile(path, temporaryIdentity, directorySnapshot);
  } finally {
    await handle?.close();
    if (!renamed && temporaryIdentity) {
      try {
        await assertDirectorySnapshot(directorySnapshot);
        await removeOwnedFile(temporary, temporaryIdentity, directorySnapshot);
      } catch {
        // Fail closed: never unlink through a directory whose identity changed.
      }
    }
  }
}

async function validateArchiveFile(path, targetEntry) {
  const inspected = await inspectRegularFile(path, { digest: true });
  if (!inspected.ok) return inspected;
  if (inspected.metadata.size !== targetEntry.archiveSize) {
    return { ok: false, reason: `has unexpected size ${inspected.metadata.size}` };
  }
  const actualSha = inspected.digest;
  if (actualSha !== targetEntry.archiveSha256) {
    return { ok: false, reason: `has SHA-256 ${actualSha}` };
  }
  return { ok: true };
}

async function validateResourceArchive(path, targetEntry) {
  const inspected = await inspectRegularFile(path, {
    bytes: true,
    digest: true,
  });
  if (!inspected.ok) return inspected;
  if (inspected.metadata.size !== targetEntry.archiveSize) {
    return {
      ok: false,
      reason: `has unexpected size ${inspected.metadata.size}`,
    };
  }
  if (inspected.digest !== targetEntry.archiveSha256) {
    return { ok: false, reason: `has SHA-256 ${inspected.digest}` };
  }
  try {
    extractPinnedBinary(inspected.bytes, targetEntry);
  } catch (error) {
    return {
      ok: false,
      reason: `does not contain the pinned executable: ${error.message}`,
    };
  }
  return { ok: true };
}

async function enforceSingleTargetResource(
  server,
  selectedEntry,
  removeStale,
) {
  const selectedPath = resourceArchivePath(selectedEntry);
  const directory = dirname(selectedPath);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const knownAssets = new Set(
    Object.values(server.targets).map((entry) => entry.asset),
  );
  for (const entry of entries) {
    if (entry.name === selectedEntry.asset) continue;
    if (!knownAssets.has(entry.name)) {
      throw new Error(
        `unexpected file in Tinymist resource staging directory: ${entry.name}`,
      );
    }
    if (!removeStale) {
      throw new Error(
        `another target's Tinymist resource archive is staged: ${entry.name}`,
      );
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(
        `refusing non-regular stale Tinymist resource: ${entry.name}`,
      );
    }
    const stale = join(directory, entry.name);
    const snapshot = await captureDirectorySnapshot(directory);
    const identity = await inspectRegularLeaf(stale, snapshot);
    await removeOwnedFile(stale, identity, snapshot);
  }
}

async function ensureArchive(manifest, serverId, server, targetEntry, options) {
  const path = archivePath(manifest, serverId, server, targetEntry);
  if (!options.force) {
    const current = await validateArchiveFile(path, targetEntry);
    if (current.ok) return path;
    if (options.offline) {
      throw new Error(`offline archive ${path} ${current.reason}`);
    }
  }
  if (options.offline) throw new Error(`offline archive is unavailable: ${path}`);

  const allowedHosts = new Set(manifest.allowedDownloadHosts);
  const buffer = await downloadWithRetry(targetEntry, allowedHosts);
  await atomicWrite(path, buffer, 0o600);
  const installed = await validateArchiveFile(path, targetEntry);
  if (!installed.ok) throw new Error(`downloaded archive ${path} ${installed.reason}`);
  return path;
}

function tarString(block, start, length) {
  const end = block.indexOf(0, start);
  const stop = end >= start && end < start + length ? end : start + length;
  return block.subarray(start, stop).toString("utf8");
}

function tarOctal(block, start, length, fieldName) {
  const raw = block
    .subarray(start, start + length)
    .toString("ascii")
    .replace(/\0.*$/s, "")
    .trim();
  if (raw === "") return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error(`invalid tar ${fieldName}: ${JSON.stringify(raw)}`);
  return Number.parseInt(raw, 8);
}

function extractTarGz(archive, expectedMember, maxOutputLength) {
  const tar = gunzipSync(archive, { maxOutputLength });
  let offset = 0;
  let matched;
  const names = new Set();

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (!tar.subarray(offset).every((byte) => byte === 0)) {
        throw new Error("tar archive has non-zero data after its end marker");
      }
      break;
    }

    const storedChecksum = tarOctal(header, 148, 8, "checksum");
    let calculatedChecksum = 0;
    for (let index = 0; index < header.length; index += 1) {
      calculatedChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (storedChecksum !== calculatedChecksum) throw new Error("tar header checksum mismatch");

    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    if (!isSafeArchivePath(fullName)) throw new Error(`unsafe tar entry: ${fullName}`);
    if (names.has(fullName)) throw new Error(`duplicate tar entry: ${fullName}`);
    names.add(fullName);

    const type = String.fromCharCode(header[156] || 0x30);
    if (!["0", "5"].includes(type)) throw new Error(`unsupported tar entry type for ${fullName}`);
    const size = tarOctal(header, 124, 12, "size");
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error(`truncated tar entry: ${fullName}`);
    if (type === "5" && size !== 0) throw new Error(`tar directory has content: ${fullName}`);
    if (fullName === expectedMember) {
      if (type !== "0") throw new Error(`expected tar member is not a regular file: ${fullName}`);
      matched = Buffer.from(tar.subarray(dataStart, dataEnd));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  if (!matched) throw new Error(`archive member is missing: ${expectedMember}`);
  return matched;
}

function findZipEocd(archive) {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) return offset;
  }
  throw new Error("ZIP end-of-central-directory record is missing");
}

function extractZip(archive, expectedMember, maxOutputLength) {
  const eocd = findZipEocd(archive);
  const disk = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("multi-disk ZIP archives are not supported");
  }
  if (entryCount === 0xffff || centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff) {
    throw new Error("ZIP64 archives are not supported");
  }
  if (centralOffset + centralSize > eocd) throw new Error("invalid ZIP central directory bounds");

  let offset = centralOffset;
  let matched;
  const names = new Set();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("invalid ZIP central directory entry");
    }
    const versionMadeBy = archive.readUInt16LE(offset + 4);
    const flags = archive.readUInt16LE(offset + 8);
    const compression = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const startDisk = archive.readUInt16LE(offset + 34);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localOffset = archive.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > archive.length) {
      throw new Error("truncated ZIP central directory entry");
    }
    const name = archive.subarray(nameStart, nameEnd).toString("utf8");
    if (!isSafeArchivePath(name)) throw new Error(`unsafe ZIP entry: ${name}`);
    if (names.has(name)) throw new Error(`duplicate ZIP entry: ${name}`);
    names.add(name);
    if (flags & 0x1) throw new Error(`encrypted ZIP entry is forbidden: ${name}`);
    if (![0, 8].includes(compression)) {
      throw new Error(`unsupported ZIP compression method for ${name}: ${compression}`);
    }
    if (startDisk !== 0) throw new Error(`multi-disk ZIP entry is forbidden: ${name}`);

    const origin = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    const unixType = unixMode & 0o170000;
    if (origin === 3 && unixType && ![0o040000, 0o100000].includes(unixType)) {
      throw new Error(`non-regular ZIP entry is forbidden: ${name}`);
    }

    if (name === expectedMember) {
      if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error(`invalid ZIP local header for ${name}`);
      }
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const localNameStart = localOffset + 30;
      const localNameEnd = localNameStart + localNameLength;
      const localName = archive.subarray(localNameStart, localNameEnd).toString("utf8");
      if (localName !== name) throw new Error(`ZIP local filename mismatch for ${name}`);
      const dataStart = localNameEnd + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > archive.length) throw new Error(`truncated ZIP data for ${name}`);
      const compressed = archive.subarray(dataStart, dataEnd);
      const value =
        compression === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength });
      if (value.length !== uncompressedSize) {
        throw new Error(`ZIP member size mismatch for ${name}`);
      }
      matched = value;
    }
    offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error("ZIP central directory size mismatch");
  if (!matched) throw new Error(`archive member is missing: ${expectedMember}`);
  return matched;
}

export function extractPinnedBinary(archive, targetEntry) {
  if (!isSafeArchivePath(targetEntry.archiveMember)) {
    throw new Error(`unsafe archive member: ${targetEntry.archiveMember}`);
  }
  const maxOutputLength = targetEntry.binarySize + 1024 * 1024;
  const binary =
    targetEntry.archiveType === "tar.gz"
      ? extractTarGz(archive, targetEntry.archiveMember, maxOutputLength)
      : targetEntry.archiveType === "zip"
        ? extractZip(archive, targetEntry.archiveMember, maxOutputLength)
        : (() => {
            throw new Error(`unsupported archive type: ${targetEntry.archiveType}`);
          })();
  if (binary.length !== targetEntry.binarySize) {
    throw new Error(
      `binary size mismatch: expected ${targetEntry.binarySize}, got ${binary.length}`,
    );
  }
  const actualSha = sha256(binary);
  if (actualSha !== targetEntry.binarySha256) {
    throw new Error(
      `binary checksum mismatch: expected ${targetEntry.binarySha256}, got ${actualSha}`,
    );
  }
  return binary;
}

async function installSelection(
  manifest,
  serverId,
  server,
  target,
  targetEntry,
  options,
  hostTarget,
) {
  const mode = resolvedInstallMode(server, options.installMode);
  assertDistributionPolicy(server, mode);
  if (mode === "resource") {
    const destination = resourceArchivePath(targetEntry);
    await enforceSingleTargetResource(
      server,
      targetEntry,
      !options.check,
    );
    const current = await validateResourceArchive(destination, targetEntry);
    if (options.check) {
      if (!current.ok) throw new Error(`${destination} ${current.reason}`);
      console.log(
        `✓ ${server.displayName} ${server.version} ${target} (resource archive)`,
      );
      return;
    }
    if (current.ok && !options.force) {
      console.log(
        `✓ current ${server.displayName} ${server.version} ${target} (resource archive)`,
      );
      return;
    }

    console.log(
      `→ fetching ${server.displayName} ${server.version} for ${target} (resource archive)`,
    );
    const archive = await ensureArchive(
      manifest,
      serverId,
      server,
      targetEntry,
      options,
    );
    const archiveFile = await inspectRegularFile(archive, {
      bytes: true,
      digest: true,
    });
    if (!archiveFile.ok) {
      throw new Error(
        `verified archive disappeared before resource staging: ${archive}`,
      );
    }
    if (
      archiveFile.bytes.length !== targetEntry.archiveSize ||
      archiveFile.digest !== targetEntry.archiveSha256
    ) {
      throw new Error(`archive changed before resource staging: ${archive}`);
    }
    // Parse and verify the exact binary before publishing the archive. Runtime
    // repeats these checks before installing into app-local-data.
    extractPinnedBinary(archiveFile.bytes, targetEntry);
    // Keep the source resource writable by its owner so Tauri's incremental
    // resource copier can refresh build outputs. Runtime immutability is
    // enforced cryptographically by the exact pinned size and SHA-256.
    await atomicWrite(destination, archiveFile.bytes, 0o644);
    const staged = await validateResourceArchive(destination, targetEntry);
    if (!staged.ok) {
      throw new Error(`staged resource ${destination} ${staged.reason}`);
    }
    await enforceSingleTargetResource(server, targetEntry, false);
    console.log(`✓ staged immutable resource ${destination}`);
    return;
  }

  const destination = outputPath(
    manifest,
    serverId,
    server,
    target,
  );
  const current = await validateInstalled(
    server,
    target,
    targetEntry,
    destination,
    hostTarget,
  );

  if (options.check) {
    if (!current.ok) throw new Error(`${destination} ${current.reason}`);
    console.log(`✓ ${server.displayName} ${server.version} ${target} (${mode})`);
    return;
  }
  if (current.ok && !options.force) {
    console.log(`✓ current ${server.displayName} ${server.version} ${target} (${mode})`);
    return;
  }

  console.log(`→ fetching ${server.displayName} ${server.version} for ${target} (${mode})`);
  const archive = await ensureArchive(manifest, serverId, server, targetEntry, options);
  const archiveFile = await inspectRegularFile(archive, { bytes: true, digest: true });
  if (!archiveFile.ok) {
    throw new Error(`verified archive disappeared before extraction: ${archive}`);
  }
  const archiveBuffer = archiveFile.bytes;
  if (archiveBuffer.length !== targetEntry.archiveSize) {
    throw new Error(`archive changed while reading: ${archive}`);
  }
  if (sha256(archiveBuffer) !== targetEntry.archiveSha256) {
    throw new Error(`archive checksum changed while reading: ${archive}`);
  }
  const binary = extractPinnedBinary(archiveBuffer, targetEntry);
  await atomicWrite(destination, binary, 0o755);
  const installed = await validateInstalled(
    server,
    target,
    targetEntry,
    destination,
    hostTarget,
  );
  if (!installed.ok) {
    throw new Error(`installed ${destination} ${installed.reason}`);
  }
  console.log(`✓ installed ${destination}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const manifest = await loadManifest();
  const targets = selectedTargets(manifest, options.target);
  const servers = selectedServers(manifest, options.server);
  let hostTarget;
  try {
    hostTarget = currentTarget();
  } catch {
    hostTarget = undefined;
  }

  for (const [serverId, server] of servers) {
    const mode = resolvedInstallMode(server, options.installMode);
    assertDistributionPolicy(server, mode);
    if (mode === "resource" && targets.length !== 1) {
      throw new Error(
        "resource-archive mode requires exactly one target so a release cannot bundle multiple platform archives",
      );
    }
    for (const target of targets) {
      const targetEntry = server.targets[target];
      if (!targetEntry) throw new Error(`${server.displayName} has no asset for ${target}`);
      if (!SHA256_RE.test(targetEntry.archiveSha256) || !SHA256_RE.test(targetEntry.binarySha256)) {
        throw new Error(`${server.displayName} has invalid checksum metadata for ${target}`);
      }
      if (mode === "resource") {
        const expectedResourcePath =
          `resources/language-servers/${serverId}/${server.version}/${targetEntry.asset}`;
        if (targetEntry.resourceRelativePath !== expectedResourcePath) {
          throw new Error(
            `${server.displayName} has an unexpected resource path for ${target}`,
          );
        }
      } else if (targetEntry.resourceRelativePath !== undefined) {
        throw new Error(
          `${server.displayName} declares a resource path outside resource-archive mode`,
        );
      }
      await installSelection(
        manifest,
        serverId,
        server,
        target,
        targetEntry,
        options,
        hostTarget,
      );
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`language-server fetch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
