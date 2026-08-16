#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  appDataExecutablePath,
  atomicWrite,
  currentTarget,
  extractPinnedBinary,
  resourceArchivePath,
} from "./fetch-language-servers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(
  ROOT,
  "scripts",
  "language-servers",
  "manifest.json",
);
const DEFAULT_WORKSPACE = join(
  ROOT,
  "test",
  "fixtures",
  "editor-support",
  "project",
);
const TIMEOUT_MS = 30_000;
const STALE_OBSERVATION_MS = 1_200;
const RAPID_EPOCH_COUNT = 7;
const MAX_STDERR_BYTES = 64 * 1024;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  let server = "all";
  let workspace = DEFAULT_WORKSPACE;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    } else if (argument === "--server") {
      server = argv[++index] ?? fail("--server requires a value");
    } else if (argument === "--workspace") {
      workspace = resolve(
        argv[++index] ?? fail("--workspace requires a value"),
      );
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Usage:
  pnpm language-servers:smoke [-- --server texlab|tinymist|all] [--workspace DIR]

This opt-in current-host smoke verifies each pinned executable (extracting
Tinymist from its immutable Tauri resource archive), consumes only its manifest
LSP profile, and exercises rapid open/change diagnostics. It does not run as
part of the network-free unit-test suite.`);
      process.exit(0);
    } else {
      fail(`unknown argument: ${argument}`);
    }
  }
  if (!["texlab", "tinymist", "all"].includes(server)) {
    fail(`unknown server: ${server}`);
  }
  return { server, workspace };
}

async function regularExecutable(path) {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) return false;
    if (resolve(await realpath(path)) !== resolve(path)) return false;
    await access(path, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function executablePath(manifest, serverId, server, target, targetEntry) {
  const location = server.distribution.runtimeLocation;
  if (location === "app-data") {
    const candidate = appDataExecutablePath(
      manifest,
      serverId,
      server,
      target,
    );
    if (await regularExecutable(candidate)) {
      return { path: candidate, cleanup: async () => {} };
    }
    fail(
      `${serverId} is not installed in app data for this host; ` +
        "run pnpm language-servers:fetch after accepting any required license",
    );
  }
  if (location === "app-data-from-resource") {
    const archivePath = resourceArchivePath(targetEntry);
    const metadata = await lstat(archivePath).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      fail(
        `${serverId} resource archive is missing or linked; run ` +
          "pnpm language-servers:fetch -- --server tinymist",
      );
    }
    const archive = await readFile(archivePath);
    if (archive.length !== targetEntry.archiveSize) {
      fail(`${serverId} resource archive size does not match the manifest`);
    }
    const archiveDigest = createHash("sha256").update(archive).digest("hex");
    if (archiveDigest !== targetEntry.archiveSha256) {
      fail(`${serverId} resource archive SHA-256 does not match the manifest`);
    }
    const binary = extractPinnedBinary(archive, targetEntry);
    const directory = await mkdtemp(
      join(await realpath(tmpdir()), "oleafly-language-server-smoke-"),
    );
    const candidate = join(
      directory,
      target.includes("windows")
        ? `${server.binaryBaseName}.exe`
        : server.binaryBaseName,
    );
    try {
      await atomicWrite(candidate, binary, 0o700);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    return {
      path: candidate,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  }
  fail(`${serverId} has unknown runtime location: ${String(location)}`);
}

async function verifyPinnedBinary(path, targetEntry) {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) {
    fail(`${path} is not a regular unlinked executable`);
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (before.dev !== after.dev || before.ino !== after.ino) {
    fail(`${path} changed during pinned-binary verification`);
  }
  if (bytes.byteLength !== targetEntry.binarySize) {
    fail(
      `${path} has ${bytes.byteLength} bytes; expected ${targetEntry.binarySize}`,
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== targetEntry.binarySha256) {
    fail(`${path} SHA-256 does not match the pinned manifest`);
  }
}

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "ascii"),
    body,
  ]);
}

class MessageReader {
  buffer = Buffer.alloc(0);
  listeners = new Set();
  messages = [];
  waiters = [];

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const headers = this.buffer
        .subarray(0, headerEnd)
        .toString("ascii")
        .split("\r\n");
      const lengthHeader = headers.find((line) =>
        /^content-length:/i.test(line),
      );
      if (!lengthHeader) fail("LSP frame has no Content-Length header");
      const length = Number(lengthHeader.split(":")[1]?.trim());
      if (!Number.isSafeInteger(length) || length < 0) {
        fail("LSP frame has an invalid Content-Length");
      }
      const bodyStart = headerEnd + 4;
      const frameEnd = bodyStart + length;
      if (this.buffer.byteLength < frameEnd) return;
      const message = JSON.parse(
        this.buffer.subarray(bodyStart, frameEnd).toString("utf8"),
      );
      this.buffer = this.buffer.subarray(frameEnd);
      for (const listener of this.listeners) listener(message);
      this.messages.push(message);
      this.flush();
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush() {
    for (const waiter of [...this.waiters]) {
      const index = this.messages.findIndex((message) => waiter.predicate(message));
      if (index < 0) continue;
      const [message] = this.messages.splice(index, 1);
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  waitFor(predicate, label) {
    const existing = this.messages.findIndex((message) => predicate(message));
    if (existing >= 0) {
      const [message] = this.messages.splice(existing, 1);
      return Promise.resolve(message);
    }
    return new Promise((resolvePromise, reject) => {
      const waiter = {
        predicate,
        resolve: resolvePromise,
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`timed out waiting for ${label}`));
        }, TIMEOUT_MS),
      };
      this.waiters.push(waiter);
    });
  }

  rejectAll(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

function diagnosticDocument(serverId, epoch) {
  const filler = Array.from(
    { length: epoch * 3 },
    (_, index) =>
      serverId === "texlab"
        ? `% rapid epoch ${epoch}, filler ${index}`
        : `// rapid epoch ${epoch}, filler ${index}`,
  );
  const lines =
    serverId === "texlab"
      ? [
          "\\documentclass{article}",
          "\\begin{document}",
          ...filler,
          `} % rapid-epoch-${epoch}`,
          "\\end{document}",
        ]
      : [
          '#set document(title: "Oleafly diagnostic smoke")',
          ...filler,
          `#let rapid_epoch_${epoch} = missing_epoch_${epoch}`,
        ];
  return {
    epoch,
    version: epoch,
    text: `${lines.join("\n")}\n`,
    fingerprintLine:
      serverId === "texlab" ? lines.length - 2 : lines.length - 1,
    fingerprintToken:
      serverId === "tinymist" ? `missing_epoch_${epoch}` : null,
  };
}

function maxDiagnosticLine(params) {
  let maximum = -1;
  for (const diagnostic of params?.diagnostics ?? []) {
    maximum = Math.max(
      maximum,
      diagnostic?.range?.start?.line ?? -1,
      diagnostic?.range?.end?.line ?? -1,
    );
  }
  return maximum;
}

function matchesDocument(params, document) {
  const lineMatches =
    Array.isArray(params?.diagnostics) &&
    params.diagnostics.length > 0 &&
    params.diagnostics.some(
      (diagnostic) =>
        diagnostic?.range?.start?.line === document.fingerprintLine ||
        diagnostic?.range?.end?.line === document.fingerprintLine,
    );
  if (!lineMatches) return false;
  if (document.fingerprintToken === null) return true;
  return params.diagnostics.some((diagnostic) =>
    String(diagnostic?.message ?? "").includes(document.fingerprintToken),
  );
}

function fullDocumentRange(text) {
  const lines = text.split("\n");
  return {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: 0 },
  };
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function monotonicMilliseconds() {
  return Number(performance.now().toFixed(3));
}

async function smokeDiagnostics(
  serverId,
  server,
  executable,
  workspace,
) {
  const profile = server.lsp;
  const child = spawn(executable, profile.args, {
    cwd: workspace,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const reader = new MessageReader();
  let stderr = "";
  let sentEpoch = 0;
  const sent = [];
  const diagnostics = [];
  let textDocumentSyncKind = null;
  const evidenceByMessage = new WeakMap();
  const exited = new Promise((resolveExit) =>
    child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  child.stdout.on("data", (chunk) => reader.push(chunk));
  child.stderr.on("data", (chunk) => {
    if (Buffer.byteLength(stderr) >= MAX_STDERR_BYTES) return;
    stderr += chunk.toString("utf8");
  });
  child.on("error", (error) => reader.rejectAll(error));
  child.on("exit", (code, signal) => {
    reader.rejectAll(
      new Error(
        `${serverId} exited early (${String(code)}/${String(signal)}): ${stderr.trim()}`,
      ),
    );
  });

  const rootUri = pathToFileURL(workspace).href;
  const documentPath =
    serverId === "texlab"
      ? join(workspace, "malformed.tex")
      : join(workspace, "paper.typ");
  const documentUri = pathToFileURL(documentPath).href;
  const languageId = serverId === "texlab" ? "latex" : "typst";
  const documents = Array.from(
    { length: RAPID_EPOCH_COUNT },
    (_, index) => diagnosticDocument(serverId, index + 1),
  );
  const finalDocument = documents.at(-1);

  const unsubscribe = reader.subscribe((message) => {
    if (
      message?.method !== "textDocument/publishDiagnostics" ||
      message?.params?.uri !== documentUri
    ) {
      return;
    }
    const event = {
      sequence: diagnostics.length + 1,
      receivedAtUnixMs: Date.now(),
      receivedAtMonotonicMs: monotonicMilliseconds(),
      observedAfterSentEpoch: sentEpoch,
      serverDocumentVersion: message.params.version ?? null,
      diagnosticCount: Array.isArray(message.params.diagnostics)
        ? message.params.diagnostics.length
        : -1,
      maxDiagnosticLine: maxDiagnosticLine(message.params),
      matchingEpochs: documents
        .filter((document) => matchesDocument(message.params, document))
        .map((document) => document.epoch),
    };
    diagnostics.push(event);
    evidenceByMessage.set(message, event);
  });

  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri,
      clientInfo: { name: "Oleafly smoke", version: "1" },
      workspaceFolders: [{ uri: rootUri, name: "smoke-project" }],
      initializationOptions: profile.initializationOptions,
      capabilities: {
        general: {
          positionEncodings: ["utf-8", "utf-16", "utf-32"],
        },
        workspace: {
          symbol: {},
          diagnostics: { refreshSupport: true },
        },
        textDocument: {
          completion: {},
          hover: {},
          definition: {},
          references: {},
          documentSymbol: {},
          publishDiagnostics: { versionSupport: true },
          diagnostic: {},
        },
      },
    },
  };

  try {
    child.stdin.write(frame(initialize));
    const initialized = await reader.waitFor(
      (message) => message?.id === 1,
      `${serverId} initialize response`,
    );
    if (
      initialized.error ||
      !initialized.result ||
      typeof initialized.result.capabilities !== "object"
    ) {
      fail(
        `${serverId} returned an invalid initialize response: ${JSON.stringify(initialized)}`,
      );
    }
    const advertisedSync = initialized.result.capabilities.textDocumentSync;
    textDocumentSyncKind =
      typeof advertisedSync === "number"
        ? advertisedSync
        : advertisedSync?.change ?? null;
    if (![1, 2].includes(textDocumentSyncKind)) {
      fail(
        `${serverId} advertised unsupported textDocumentSync: ${JSON.stringify(advertisedSync)}`,
      );
    }
    child.stdin.write(
      frame({ jsonrpc: "2.0", method: "initialized", params: {} }),
    );
    if (profile.didChangeConfiguration !== null) {
      child.stdin.write(
        frame({
          jsonrpc: "2.0",
          method: "workspace/didChangeConfiguration",
          params: profile.didChangeConfiguration,
        }),
      );
    }

    const firstDocument = documents[0];
    sentEpoch = firstDocument.epoch;
    sent.push({
      epoch: firstDocument.epoch,
      version: firstDocument.version,
      fingerprintLine: firstDocument.fingerprintLine,
      sentAtUnixMs: Date.now(),
      sentAtMonotonicMs: monotonicMilliseconds(),
    });
    child.stdin.write(
      frame({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: documentUri,
            languageId,
            version: firstDocument.version,
            text: firstDocument.text,
          },
        },
      }),
    );
    await reader.waitFor(
      (message) =>
        message?.method === "textDocument/publishDiagnostics" &&
        message?.params?.uri === documentUri &&
        matchesDocument(message.params, firstDocument),
      `${serverId} initial-epoch diagnostics`,
    );

    for (const document of documents.slice(1)) {
      const previousDocument = documents[document.epoch - 2];
      sentEpoch = document.epoch;
      sent.push({
        epoch: document.epoch,
        version: document.version,
        fingerprintLine: document.fingerprintLine,
        sentAtUnixMs: Date.now(),
        sentAtMonotonicMs: monotonicMilliseconds(),
      });
      const contentChange =
        textDocumentSyncKind === 2
          ? {
              range: fullDocumentRange(previousDocument.text),
              rangeLength: previousDocument.text.length,
              text: document.text,
            }
          : { text: document.text };
      child.stdin.write(
        frame({
          jsonrpc: "2.0",
          method: "textDocument/didChange",
          params: {
            textDocument: {
              uri: documentUri,
              version: document.version,
            },
            contentChanges: [contentChange],
          },
        }),
      );
    }

    let finalMessage;
    try {
      finalMessage = await reader.waitFor(
        (message) =>
          message?.method === "textDocument/publishDiagnostics" &&
          message?.params?.uri === documentUri &&
          matchesDocument(message.params, finalDocument),
        `${serverId} final-epoch diagnostics`,
      );
    } catch (error) {
      fail(
        `${error.message}; observed diagnostics=${JSON.stringify(diagnostics)}; ` +
          `stderr=${JSON.stringify(stderr.trim())}`,
      );
    }
    const finalEvidence = evidenceByMessage.get(finalMessage);
    if (!finalEvidence) fail(`${serverId} final diagnostics lacked evidence`);

    await sleep(STALE_OBSERVATION_MS);
    const regressions = diagnostics.filter(
      (event) =>
        event.sequence > finalEvidence.sequence &&
        (!event.matchingEpochs.includes(finalDocument.epoch) ||
          (event.serverDocumentVersion !== null &&
            event.serverDocumentVersion < finalDocument.version)),
    );
    if (regressions.length > 0) {
      fail(
        `${serverId} emitted stale diagnostics after the final epoch: ${JSON.stringify(regressions)}`,
      );
    }

    child.stdin.write(
      frame({
        jsonrpc: "2.0",
        method: "textDocument/didClose",
        params: { textDocument: { uri: documentUri } },
      }),
    );
    child.stdin.write(
      frame({
        jsonrpc: "2.0",
        id: 2,
        method: "shutdown",
        params: null,
      }),
    );
    const shutdown = await reader.waitFor(
      (message) => message?.id === 2,
      `${serverId} shutdown response`,
    );
    if (shutdown.error) {
      fail(
        `${serverId} rejected shutdown: ${JSON.stringify(shutdown.error)}`,
      );
    }
    child.stdin.write(frame({ jsonrpc: "2.0", method: "exit" }));
    child.stdin.end();

    const evidence = {
      schemaVersion: 1,
      server: serverId,
      serverVersion: server.version,
      lspProfileSha256: createHash("sha256")
        .update(JSON.stringify(profile))
        .digest("hex"),
      documentUri,
      textDocumentSyncKind,
      finalEpoch: finalDocument.epoch,
      sent,
      diagnostics,
      acceptedFinalDiagnosticSequence: finalEvidence.sequence,
      staleRegressionCount: regressions.length,
      observationWindowMs: STALE_OBSERVATION_MS,
    };
    console.log(`EVIDENCE ${JSON.stringify(evidence)}`);
    console.log(
      `✓ ${server.displayName} ${server.version}: final epoch ${finalDocument.epoch} diagnostics; no stale regression`,
    );
  } finally {
    unsubscribe();
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    const exit = await exited;
    clearTimeout(killTimer);
    if (exit.code !== 0 && exit.signal !== "SIGKILL") {
      fail(
        `${serverId} exited ${String(exit.code)}/${String(exit.signal)}: ${stderr.trim()}`,
      );
    }
  }
}

const options = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const target = currentTarget();
const workspace = resolve(options.workspace);
const workspaceMetadata = await stat(workspace);
if (!workspaceMetadata.isDirectory()) {
  fail(`workspace is not a directory: ${workspace}`);
}
const serverIds =
  options.server === "all" ? ["texlab", "tinymist"] : [options.server];

for (const serverId of serverIds) {
  const server =
    manifest.servers[serverId] ??
    fail(`manifest has no ${serverId} server`);
  const targetEntry =
    server.targets[target] ??
    fail(`${serverId} has no ${target} target`);
  const executable = await executablePath(
    manifest,
    serverId,
    server,
    target,
    targetEntry,
  );
  try {
    await verifyPinnedBinary(executable.path, targetEntry);
    await smokeDiagnostics(
      serverId,
      server,
      executable.path,
      workspace,
    );
  } finally {
    await executable.cleanup();
  }
}
