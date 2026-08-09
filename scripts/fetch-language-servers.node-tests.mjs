import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  appDataExecutablePath,
  assertDirectorySnapshot,
  assertHttpsUrl,
  assertWindowsReparseQuerySafe,
  atomicWrite,
  captureDirectorySnapshot,
  currentTarget,
  defaultAppDataDirectory,
  extractPinnedBinary,
  isSafeArchivePath,
  openExclusiveNoFollow,
  parseArgs,
  resourceArchivePath,
} from "./fetch-language-servers.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = join(SCRIPT_DIR, "language-servers", "manifest.json");
const FETCHER_PATH = join(SCRIPT_DIR, "fetch-language-servers.mjs");
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const EXPECTED_TARGETS = [
  "aarch64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
];
const EXPECTED_DOWNLOAD_HOSTS = [
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
];
const SHA256_RE = /^[a-f0-9]{64}$/;

function workflowJobBlocks(rawSource) {
  // Git hands Windows checkouts CRLF, and every marker below is written in
  // terms of "\n". Normalise once so this parses YAML shape rather than
  // whichever platform checked the file out.
  const source = rawSource.replace(/\r\n/gu, "\n");
  const jobsMarker = "\njobs:\n";
  const jobsStart = source.indexOf(jobsMarker);
  assert.notEqual(jobsStart, -1, "workflow must contain a jobs mapping");
  const jobsSource = source.slice(jobsStart + jobsMarker.length);
  const markers = [
    ...jobsSource.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm),
  ];
  return markers.map((marker, index) => {
    const end = markers[index + 1]?.index ?? jobsSource.length;
    return {
      id: marker[1],
      source: jobsSource.slice(marker.index, end),
    };
  });
}

function workflowJobBlock(source, jobId) {
  const job = workflowJobBlocks(source).find(
    (candidate) => candidate.id === jobId,
  );
  assert.ok(job, `workflow job is missing: ${jobId}`);
  return job.source;
}

function assertTinymistFetchBeforeBuild(
  workflow,
  jobId,
  target,
  buildPattern,
) {
  const job = workflowJobBlock(workflow, jobId);
  const command =
    "run: node scripts/fetch-language-servers.mjs " +
    `--server tinymist --target ${target} --install-mode resource`;
  const fetchIndex = job.indexOf(command);
  assert.notEqual(
    fetchIndex,
    -1,
    `${jobId} must fetch checksum-pinned Tinymist for ${target}`,
  );
  assert.equal(
    job.indexOf(command, fetchIndex + command.length),
    -1,
    `${jobId} must have exactly one Tinymist fetch`,
  );
  const buildIndex = job.search(buildPattern);
  assert.notEqual(buildIndex, -1, `${jobId} build entry point is missing`);
  assert.ok(
    fetchIndex < buildIndex,
    `${jobId} must fetch Tinymist before its first Tauri build`,
  );
}

async function temporaryDirectory(t) {
  const canonicalTemporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(
    join(canonicalTemporaryRoot, "oleafly-language-server-test-"),
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function writeTarOctal(header, value, offset, length) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  header.write(encoded, offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function makeTarGz(entries) {
  const blocks = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    writeTarOctal(header, 0o755, 100, 8);
    writeTarOctal(header, 0, 108, 8);
    writeTarOctal(header, 0, 116, 8);
    writeTarOctal(header, data.length, 124, 12);
    writeTarOctal(header, 0, 136, 12);
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    header.write("ustar", 257, 5, "ascii");
    header[262] = 0;
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    const checksumText = checksum.toString(8).padStart(6, "0");
    header.write(checksumText, 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function crc32(data) {
  let crc = 0xffff_ffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function makeStoredZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data ?? "");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.unixMode ?? 0o100755) << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);

    localRecords.push(local, name, data);
    centralRecords.push(central, name);
    localOffset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function fixtureTarget(archiveType, archiveMember, binary) {
  return {
    archiveType,
    archiveMember,
    binarySize: binary.length,
    binarySha256: createHash("sha256").update(binary).digest("hex"),
  };
}

test("manifest has a closed schema and the pinned production releases", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(manifest.supportedTargets, EXPECTED_TARGETS);
  assert.deepEqual(
    manifest.allowedDownloadHosts,
    EXPECTED_DOWNLOAD_HOSTS,
  );
  assert.deepEqual(Object.keys(manifest.servers).sort(), ["texlab", "tinymist"]);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(manifest.servers).map(([id, server]) => [id, server.version]),
    ),
    {
      texlab: "5.26.0",
      tinymist: "0.15.2",
    },
  );
  for (const [serverId, server] of Object.entries(manifest.servers)) {
    assert.equal(server.tag, `v${server.version}`);
    assert.match(server.releaseApi, new RegExp(`/releases/tags/${server.tag}$`));
    const sampleVersionOutput =
      serverId === "texlab"
        ? `texlab ${server.version}`
        : `Build Git Describe:  v${server.version}`;
    assert.equal(new RegExp(server.versionProbe.pattern, "m").test(sampleVersionOutput), true);
    assert.deepEqual(
      Object.keys(server.lsp).sort(),
      [
        "args",
        "didChangeConfiguration",
        "helpArgs",
        "initializationOptions",
      ].sort(),
    );
    assert.equal("runtimeProfile" in server, false);
  }
  assert.deepEqual(manifest.servers.texlab.lsp, {
    args: ["run"],
    helpArgs: ["run", "--help"],
    initializationOptions: {},
    didChangeConfiguration: {
      settings: {
        texlab: {
          build: {
            onSave: false,
          },
        },
      },
    },
  });
  assert.deepEqual(manifest.servers.tinymist.lsp, {
    args: ["lsp"],
    helpArgs: ["lsp", "--help"],
    initializationOptions: {
      exportPdf: "never",
      compileStatus: "disable",
    },
    didChangeConfiguration: null,
  });
});

test("every server covers the exact supported target allowlist", () => {
  const filenames = new Set();
  for (const [serverId, server] of Object.entries(manifest.servers)) {
    assert.deepEqual(Object.keys(server.targets), EXPECTED_TARGETS);
    for (const [target, entry] of Object.entries(server.targets)) {
      assert.equal(entry.outputFilename.startsWith(`${serverId}-`), true);
      assert.equal(entry.outputFilename.endsWith(".exe"), target.includes("windows"));
      assert.equal(filenames.has(entry.outputFilename), false, entry.outputFilename);
      filenames.add(entry.outputFilename);
    }
  }
  assert.equal(filenames.size, EXPECTED_TARGETS.length * Object.keys(manifest.servers).length);
});

test("all artifacts have pinned archive and extracted-binary integrity metadata", () => {
  for (const server of Object.values(manifest.servers)) {
    for (const entry of Object.values(server.targets)) {
      assert.match(entry.archiveSha256, SHA256_RE);
      assert.match(entry.binarySha256, SHA256_RE);
      assert.ok(Number.isSafeInteger(entry.archiveSize) && entry.archiveSize > 0);
      assert.ok(Number.isSafeInteger(entry.binarySize) && entry.binarySize > 0);
      assert.ok(["tar.gz", "zip"].includes(entry.archiveType));
      assert.equal(entry.asset.endsWith(entry.archiveType === "zip" ? ".zip" : ".tar.gz"), true);
    }
  }
});

test("only Tinymist declares exact target-specific Tauri resource archives", () => {
  for (const entry of Object.values(manifest.servers.texlab.targets)) {
    assert.equal(entry.resourceRelativePath, undefined);
  }
  for (const [target, entry] of Object.entries(
    manifest.servers.tinymist.targets,
  )) {
    assert.equal(
      entry.resourceRelativePath,
      `resources/language-servers/tinymist/0.15.2/${entry.asset}`,
      target,
    );
    assert.equal(
      resourceArchivePath(entry).endsWith(
        join(
          "src-tauri",
          "resources",
          "language-servers",
          "tinymist",
          "0.15.2",
          entry.asset,
        ),
      ),
      true,
    );
  }
  assert.throws(
    () =>
      resourceArchivePath({
        resourceRelativePath: "../binaries/tinymist",
      }),
    /unsafe Tauri resource path/,
  );
});

test("download URLs, assets, and archive members are safe and exact", () => {
  const allowedHosts = new Set(EXPECTED_DOWNLOAD_HOSTS);
  assert.equal(
    assertHttpsUrl(
      "https://github.com/latex-lsp/texlab",
      allowedHosts,
    ).hostname,
    "github.com",
  );
  for (const unsafeUrl of [
    "http://github.com/latex-lsp/texlab",
    "https://user@github.com/latex-lsp/texlab",
    "https://github.com:444/latex-lsp/texlab",
    "https://github.com.example.test/latex-lsp/texlab",
    "https://example.test/latex-lsp/texlab",
  ]) {
    assert.throws(
      () => assertHttpsUrl(unsafeUrl, allowedHosts),
      /refusing/u,
      unsafeUrl,
    );
  }

  for (const server of Object.values(manifest.servers)) {
    const repository = new URL(server.repository);
    for (const entry of Object.values(server.targets)) {
      const url = new URL(entry.url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "github.com");
      assert.equal(url.username, "");
      assert.equal(url.password, "");
      assert.equal(url.search, "");
      assert.equal(url.hash, "");
      assert.equal(
        url.pathname,
        `${repository.pathname}/releases/download/${server.tag}/${entry.asset}`,
      );
      assert.match(entry.asset, /^[A-Za-z0-9][A-Za-z0-9._+-]*$/);
      assert.equal(isSafeArchivePath(entry.archiveMember), true, entry.archiveMember);
      assert.equal(entry.archiveMember.endsWith("/"), false);
      if (entry.upstreamChecksumUrl) {
        const checksumUrl = new URL(entry.upstreamChecksumUrl);
        assert.equal(checksumUrl.protocol, "https:");
        assert.equal(checksumUrl.hostname, "github.com");
        assert.equal(checksumUrl.pathname, `${url.pathname}.sha256`);
      }
    }
  }

  for (const unsafe of [
    "",
    "/absolute",
    "../escape",
    "nested/../escape",
    "nested//file",
    "C:\\escape.exe",
    "nested\\escape",
    ".",
    "nested/.",
    "entry\0name",
    "-option",
  ]) {
    assert.equal(isSafeArchivePath(unsafe), false, unsafe);
  }
});

test("extractor returns only the exact checksum-pinned tar and ZIP member", () => {
  const binary = Buffer.from("fixture-language-server");
  const tarTarget = fixtureTarget("tar.gz", "nested/server", binary);
  const zipTarget = fixtureTarget("zip", "nested/server.exe", binary);

  assert.deepEqual(
    extractPinnedBinary(
      makeTarGz([
        { name: "nested/", type: "5" },
        { name: "nested/server", data: binary },
      ]),
      tarTarget,
    ),
    binary,
  );
  assert.deepEqual(
    extractPinnedBinary(makeStoredZip([{ name: "nested/server.exe", data: binary }]), zipTarget),
    binary,
  );
});

test("extractor rejects traversal, links, duplicates, and checksum mismatches", () => {
  const binary = Buffer.from("fixture-language-server");
  const tarTarget = fixtureTarget("tar.gz", "server", binary);
  const zipTarget = fixtureTarget("zip", "server.exe", binary);

  assert.throws(
    () =>
      extractPinnedBinary(
        makeTarGz([
          { name: "../escape", data: "bad" },
          { name: "server", data: binary },
        ]),
        tarTarget,
      ),
    /unsafe tar entry/,
  );
  assert.throws(
    () =>
      extractPinnedBinary(
        makeTarGz([
          { name: "link", type: "2" },
          { name: "server", data: binary },
        ]),
        tarTarget,
      ),
    /unsupported tar entry type/,
  );
  assert.throws(
    () =>
      extractPinnedBinary(
        makeStoredZip([
          { name: "server.exe", data: binary },
          { name: "server.exe", data: binary },
        ]),
        zipTarget,
      ),
    /duplicate ZIP entry/,
  );
  assert.throws(
    () =>
      extractPinnedBinary(
        makeStoredZip([
          { name: "link", unixMode: 0o120777 },
          { name: "server.exe", data: binary },
        ]),
        zipTarget,
      ),
    /non-regular ZIP entry/,
  );
  assert.throws(
    () => extractPinnedBinary(makeStoredZip([{ name: "server.exe", data: "tampered" }]), zipTarget),
    /binary (size|checksum) mismatch/,
  );
});

test("secure output rejects linked ancestors and linked destination files", async (t) => {
  const root = await temporaryDirectory(t);
  const realCache = join(root, "real-cache");
  const linkedCache = join(root, "linked-cache");
  const output = join(root, "output");
  const outside = join(root, "outside");
  await mkdir(realCache);
  await mkdir(output);
  await writeFile(outside, "outside-content");
  await symlink(realCache, linkedCache, "dir");

  await assert.rejects(
    atomicWrite(join(linkedCache, "archives", "server.bin"), Buffer.from("server"), 0o600),
    /linked directory ancestor|realpath changed/,
  );

  const linkedOutput = join(output, "server");
  await symlink(outside, linkedOutput, "file");
  await assert.rejects(
    atomicWrite(linkedOutput, Buffer.from("replacement"), 0o700),
    /symbolic-link file|realpath changed/,
  );
  assert.equal(await readFile(outside, "utf8"), "outside-content");
});

test("exclusive temporary descriptors reject a pre-existing link", async (t) => {
  const root = await temporaryDirectory(t);
  const outside = join(root, "outside");
  const temporary = join(root, ".server.tmp");
  await writeFile(outside, "outside-content");
  await symlink(outside, temporary, "file");

  await assert.rejects(
    async () => {
      const handle = await openExclusiveNoFollow(temporary);
      await handle.close();
    },
    (error) => ["EEXIST", "ELOOP"].includes(error?.code),
  );
  assert.equal(await readFile(outside, "utf8"), "outside-content");
});

test(
  "exclusive temporary descriptors apply the requested mode when the file is created",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await temporaryDirectory(t);
    const temporary = join(root, ".server.tmp");
    const requestedMode = 0o640;
    const expectedMode = requestedMode & ~process.umask();

    const handle = await openExclusiveNoFollow(temporary, requestedMode);
    try {
      const opened = await handle.stat();
      assert.equal(opened.mode & 0o777, expectedMode);
    } finally {
      await handle.close();
    }

    assert.equal((await stat(temporary)).mode & 0o777, expectedMode);
  },
);

test("Windows reparse-point queries fail closed on links and ambiguity", () => {
  assert.doesNotThrow(() =>
    assertWindowsReparseQuerySafe("C:\\safe", {
      error: undefined,
      status: 1,
      stderr:
        "Error 4390: The file or directory is not a reparse point.",
    }),
  );
  assert.throws(
    () =>
      assertWindowsReparseQuerySafe("C:\\linked", {
        error: undefined,
        status: 0,
      }),
    /reparse-point path/,
  );
  assert.throws(
    () =>
      assertWindowsReparseQuerySafe("C:\\ambiguous", {
        error: undefined,
        status: 2,
      }),
    /ambiguous Windows reparse-point query/,
  );
  assert.throws(
    () =>
      assertWindowsReparseQuerySafe("C:\\access-denied", {
        error: undefined,
        status: 1,
        stderr: "Access is denied.",
      }),
    /ambiguous Windows reparse-point query/,
  );
  assert.throws(
    () =>
      assertWindowsReparseQuerySafe("C:\\unknown", {
        error: new Error("fsutil unavailable"),
        status: null,
      }),
    /cannot rule out a Windows reparse point/,
  );
});

test("directory snapshots detect an ancestor swap before rename", async (t) => {
  const root = await temporaryDirectory(t);
  const output = join(root, "output");
  const movedOutput = join(root, "moved-output");
  await mkdir(output);
  const snapshot = await captureDirectorySnapshot(output);

  await rename(output, movedOutput);
  await symlink(movedOutput, output, "dir");
  await assert.rejects(
    assertDirectorySnapshot(snapshot),
    /linked directory ancestor|directory changed/,
  );
});

test("atomic write rechecks directory identity around the final rename", async (t) => {
  const root = await temporaryDirectory(t);
  const output = join(root, "output");
  const movedOutput = join(root, "moved-output");
  await mkdir(output);

  await assert.rejects(
    atomicWrite(
      join(output, "server"),
      Buffer.from("pinned-server"),
      0o700,
      {
        async afterTemporarySync() {
          await rename(output, movedOutput);
          await symlink(movedOutput, output, "dir");
        },
      },
    ),
    /linked directory ancestor|directory changed/,
  );
});

test("CLI rejects a symlinked archive-cache ancestor without network access", async (t) => {
  const root = await temporaryDirectory(t);
  const realCache = join(root, "real-cache");
  const linkedCache = join(root, "linked-cache");
  const appData = join(root, "app-data");
  await mkdir(realCache);
  await symlink(realCache, linkedCache, "dir");

  const result = spawnSync(
    process.execPath,
    [
      FETCHER_PATH,
      "--offline",
      "--server",
      "texlab",
      "--install-mode",
      "app-data",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        [manifest.cacheEnvironmentVariable]: linkedCache,
        [manifest.appDataInstallation.overrideEnvironmentVariable]: appData,
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /linked directory ancestor|realpath changed/);
});

test("license and redistribution metadata is explicit and pinned", async () => {
  const toolchainDocument = await readFile(join(ROOT, "docs", "language-server-toolchain.md"), "utf8");
  const thirdPartyLicenses = await readFile(
    join(ROOT, "THIRD_PARTY_LICENSES.md"),
    "utf8",
  );
  const tinymistLicensePath = join(
    ROOT,
    "src-tauri",
    "resources",
    "licenses",
    "tinymist-0.15.2-LICENSE",
  );
  const tinymistLicense = await readFile(tinymistLicensePath);
  const tauriConfig = JSON.parse(
    await readFile(
      join(ROOT, "src-tauri", "tauri.conf.json"),
      "utf8",
    ),
  );
  for (const [serverId, server] of Object.entries(manifest.servers)) {
    const license = server.license;
    assert.ok(["GPL-3.0-only", "Apache-2.0"].includes(license.spdx));
    assert.equal(new URL(license.licenseUrl).protocol, "https:");
    assert.equal(new URL(license.sourceUrl).protocol, "https:");
    assert.equal(new URL(license.sourceArchiveUrl).protocol, "https:");
    assert.ok(license.licenseUrl.includes(`/${server.tag}/`));
    assert.ok(license.sourceUrl.endsWith(`/tree/${server.tag}`));
    assert.ok(license.sourceArchiveUrl.endsWith(`/${server.tag}.tar.gz`));
    assert.ok(license.copyrightNotice.length > 20);
    assert.equal(license.upstreamNotice.presentAtPinnedTag, false);
    assert.equal(license.upstreamNotice.url, null);
    assert.ok(license.distributionObligations.length >= 3);
    assert.ok(toolchainDocument.includes(server.displayName));
    assert.ok(toolchainDocument.includes(server.version));
    assert.ok(toolchainDocument.includes(license.spdx));
    assert.ok(toolchainDocument.includes(server.repository));
    assert.equal(server.distribution.decisionDocument, "docs/language-server-toolchain.md");
    assert.ok(
      ["resource-archive", "app-data-download"].includes(
        server.distribution.defaultPolicy,
      ),
    );
    if (serverId === "texlab") {
      assert.equal(server.tauriExternalBin, null);
      assert.equal(server.distribution.defaultPolicy, "app-data-download");
      assert.equal(server.distribution.runtimeLocation, "app-data");
      assert.equal(server.distribution.requiresUserConsent, true);
      assert.equal(server.distribution.retryRequiresUserAction, true);
      assert.equal(server.distribution.redistributionApproved, false);
      assert.equal(server.distribution.bundleOverrideFlag, null);
    } else {
      assert.equal(server.tauriExternalBin, null);
      assert.equal(server.distribution.defaultPolicy, "resource-archive");
      assert.equal(
        server.distribution.runtimeLocation,
        "app-data-from-resource",
      );
      assert.equal(server.distribution.requiresUserConsent, false);
      assert.equal(server.distribution.redistributionApproved, true);
      assert.equal(server.distribution.bundleOverrideFlag, null);
    }
  }
  assert.deepEqual(manifest.appDataInstallation, {
    applicationIdentifier: "com.oleafly.app",
    overrideEnvironmentVariable: "OLEAFLY_LANGUAGE_SERVER_APP_DATA_DIR",
    relativeDirectory: "language-servers",
  });
  for (const requiredPolicyText of [
    "explicit user action",
    "Retry",
    "GPL-3.0-only license",
    "pinned corresponding source",
    "OLEAFLY_LANGUAGE_SERVER_APP_DATA_DIR",
    "normal release builds do not require or",
    "no technical bundle override",
  ]) {
    assert.ok(
      toolchainDocument.includes(requiredPolicyText),
      requiredPolicyText,
    );
  }
  assert.ok(thirdPartyLicenses.includes("Tinymist 0.15.2"));
  assert.ok(
    thirdPartyLicenses.includes(
      "https://github.com/Myriad-Dreamin/tinymist/tree/v0.15.2",
    ),
  );
  assert.ok(thirdPartyLicenses.includes("Apache-2.0"));
  assert.equal(
    manifest.servers.tinymist.license.licenseUrl,
    "https://raw.githubusercontent.com/Myriad-Dreamin/tinymist/v0.15.2/LICENSE",
  );
  assert.equal(
    createHash("sha256").update(tinymistLicense).digest("hex"),
    "a9f29769fd3a7ee2976e6e161a93e16461fa305c088c4806242e50ec8ef86bce",
  );
  assert.match(
    tinymistLicense.toString("utf8"),
    /Copyright 2023-2025 Myriad Dreamin, Nathan Varner/u,
  );
  assert.ok(
    tauriConfig.bundle.resources.includes(
      "resources/licenses/**/*",
    ),
    "Tauri bundles the pinned Tinymist license resource",
  );
  assert.ok(
    tauriConfig.bundle.resources.includes(
      "resources/language-servers/**/*",
    ),
    "Tauri bundles the checksum-pinned Tinymist archive resource",
  );
  assert.ok(
    toolchainDocument.includes(
      "a9f29769fd3a7ee2976e6e161a93e16461fa305c088c4806242e50ec8ef86bce",
    ),
  );
});

test("Tauri resources and package scripts mirror the manifest without a Tinymist externalBin", async () => {
  const tauriConfig = JSON.parse(await readFile(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
  const packageManifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const expectedBins = Object.values(manifest.servers)
    .map((server) => server.tauriExternalBin)
    .filter((value) => value !== null);
  for (const externalBin of expectedBins) {
    assert.ok(tauriConfig.bundle.externalBin.includes(externalBin), externalBin);
  }
  assert.equal(tauriConfig.bundle.externalBin.includes("binaries/texlab"), false);
  assert.equal(tauriConfig.bundle.externalBin.includes("binaries/tinymist"), false);
  assert.equal(
    tauriConfig.bundle.resources.includes(
      "resources/language-servers/**/*",
    ),
    true,
  );
  assert.equal(
    tauriConfig.bundle.externalBin.some((entry) =>
      /(?:texlab|tinymist)/u.test(entry),
    ),
    false,
  );
  assert.equal(
    packageManifest.scripts["language-servers:fetch"],
    "node scripts/fetch-language-servers.mjs",
  );
  assert.equal(
    packageManifest.scripts["language-servers:check"],
    "node scripts/fetch-language-servers.mjs --check",
  );
  assert.equal(
    packageManifest.scripts["language-servers:test"],
    "node --test scripts/fetch-language-servers.node-tests.mjs",
  );
  assert.equal(
    packageManifest.scripts["language-servers:smoke"],
    "node scripts/smoke-language-servers.mjs",
  );
  assert.equal(packageManifest.scripts.build, "tsc -b && vite build");
});

test("every clean CI and release Tauri build fetches only pinned Tinymist", async () => {
  const [releaseWorkflow, ciWorkflow] = await Promise.all([
    readFile(join(ROOT, ".github", "workflows", "release.yml"), "utf8"),
    readFile(join(ROOT, ".github", "workflows", "ci.yml"), "utf8"),
  ]);
  const tauriActionPattern = /uses:\s*tauri-apps\/tauri-action@/;
  const cargoBuildPattern = /run:\s*cargo (?:build|check|clippy|run|test)\b/;
  const e2eBuildPattern = /run:\s*[^\n]*scripts\/e2e\.(?:sh|ps1)\b/;

  assertTinymistFetchBeforeBuild(
    releaseWorkflow,
    "build",
    "${{ matrix.rust_target }}",
    tauriActionPattern,
  );
  assertTinymistFetchBeforeBuild(
    ciWorkflow,
    "rust",
    "x86_64-unknown-linux-gnu",
    cargoBuildPattern,
  );
  assertTinymistFetchBeforeBuild(
    ciWorkflow,
    "rust-windows",
    "x86_64-pc-windows-msvc",
    cargoBuildPattern,
  );
  assertTinymistFetchBeforeBuild(
    ciWorkflow,
    "e2e",
    "aarch64-apple-darwin",
    e2eBuildPattern,
  );
  assertTinymistFetchBeforeBuild(
    ciWorkflow,
    "e2e-linux",
    "x86_64-unknown-linux-gnu",
    e2eBuildPattern,
  );
  assertTinymistFetchBeforeBuild(
    ciWorkflow,
    "e2e-windows",
    "x86_64-pc-windows-msvc",
    e2eBuildPattern,
  );

  const exactFetchPattern =
    /^run: node scripts\/fetch-language-servers\.mjs --server tinymist --target (?:\$\{\{ matrix\.rust_target \}\}|aarch64-apple-darwin|aarch64-unknown-linux-gnu|x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc) --install-mode resource$/;
  for (const [name, workflow, expectedFetchCount] of [
    ["release", releaseWorkflow, 1],
    ["CI", ciWorkflow, 5],
  ]) {
    const fetchCommands = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) =>
        line.includes("scripts/fetch-language-servers.mjs") &&
        !line.includes("--check"),
      );
    assert.equal(
      fetchCommands.length,
      expectedFetchCount,
      `${name} has an unexpected language-server fetch count`,
    );
    for (const command of fetchCommands) {
      assert.match(command, exactFetchPattern);
    }

    for (const job of workflowJobBlocks(workflow)) {
      const buildIndex = job.source.search(
        new RegExp(
          `${tauriActionPattern.source}|${cargoBuildPattern.source}|${e2eBuildPattern.source}`,
        ),
      );
      if (buildIndex === -1) continue;
      const fetchIndex = job.source.indexOf(
        "run: node scripts/fetch-language-servers.mjs --server tinymist",
      );
      assert.notEqual(
        fetchIndex,
        -1,
        `${name}/${job.id} builds Tauri without fetching Tinymist`,
      );
      assert.ok(
        fetchIndex < buildIndex,
        `${name}/${job.id} fetches Tinymist after starting its build`,
      );
    }
  }

  assert.doesNotMatch(
    `${releaseWorkflow}\n${ciWorkflow}`,
    /fetch-language-servers\.mjs[^\n]*--server (?:all|texlab)\b/,
  );
  assert.doesNotMatch(
    `${releaseWorkflow}\n${ciWorkflow}`,
    /fetch-language-servers\.mjs[^\n]*--install-mode bundle\b/,
  );
  assert.doesNotMatch(
    `${releaseWorkflow}\n${ciWorkflow}`,
    /src-tauri\/binaries\/tinymist/,
  );
  const releaseJob = workflowJobBlock(releaseWorkflow, "build");
  assert.match(releaseJob, /test ! -e "\$RUNTIME_DIR\/tinymist"/);
  assert.match(releaseJob, /test ! -e "\$RUNTIME_DIR\/tinymist\.exe"/);
  assert.match(
    releaseJob,
    /fetch-language-servers\.mjs --check --server tinymist[^\n]*--install-mode resource/,
  );
  const rustJob = workflowJobBlock(ciWorkflow, "rust");
  const stageIndex = rustJob.indexOf(
    "fetch-language-servers.mjs --server tinymist",
  );
  const smokeIndex = rustJob.indexOf(
    "smoke-language-servers.mjs --server tinymist",
  );
  assert.ok(stageIndex >= 0 && smokeIndex > stageIndex);
});

test("the release workflow carries no live-provider gate", async () => {
  const workflow = await readFile(
    join(ROOT, ".github", "workflows", "release.yml"),
    "utf8",
  );
  // Provider wire formats are covered by unit tests, so publishing no longer
  // depends on live third-party credentials. Guard against reintroducing that
  // coupling by accident.
  assert.ok(!/^\s{2}provider-[a-z]+:/m.test(workflow));
  assert.ok(!workflow.includes("ANTHROPIC_API_KEY"));
  assert.ok(!workflow.includes("GOOGLE_API_KEY"));
});

test("app-data resolution matches Tauri's identifier-scoped directory model", () => {
  assert.equal(
    defaultAppDataDirectory(
      "com.oleafly.app",
      "darwin",
      {},
      "/Users/researcher",
    ),
    "/Users/researcher/Library/Application Support/com.oleafly.app",
  );
  assert.equal(
    defaultAppDataDirectory(
      "com.oleafly.app",
      "linux",
      { XDG_DATA_HOME: "/data/researcher" },
      "/home/researcher",
    ),
    "/data/researcher/com.oleafly.app",
  );
  assert.equal(
    defaultAppDataDirectory(
      "com.oleafly.app",
      "linux",
      {},
      "/home/researcher",
    ),
    "/home/researcher/.local/share/com.oleafly.app",
  );
  assert.match(
    defaultAppDataDirectory(
      "com.oleafly.app",
      "win32",
      { LOCALAPPDATA: "C:\\Users\\Researcher\\AppData\\Local" },
      "C:\\Users\\Researcher",
    ),
    /com\.oleafly\.app$/,
  );
  assert.throws(
    () =>
      defaultAppDataDirectory(
        "com.oleafly.app",
        "win32",
        {},
        "C:\\Users\\Researcher",
      ),
    /LOCALAPPDATA is unavailable/,
  );
  assert.equal(
    appDataExecutablePath(
      manifest,
      "texlab",
      manifest.servers.texlab,
      "aarch64-apple-darwin",
    ).endsWith(
      join(
        "language-servers",
        "texlab",
        "5.26.0",
        "aarch64-apple-darwin",
        "texlab",
      ),
    ),
    true,
  );
  assert.equal(
    appDataExecutablePath(
      manifest,
      "texlab",
      manifest.servers.texlab,
      "x86_64-pc-windows-msvc",
    ).endsWith(
      join(
        "language-servers",
        "texlab",
        "5.26.0",
        "x86_64-pc-windows-msvc",
        "texlab.exe",
      ),
    ),
    true,
  );
});

test("diagnostic smoke reads all runtime behavior from the manifest profile", async () => {
  const smokeSource = await readFile(
    join(ROOT, "scripts", "smoke-language-servers.mjs"),
    "utf8",
  );
  assert.match(smokeSource, /server\.lsp/);
  assert.match(smokeSource, /profile\.args/);
  assert.match(smokeSource, /profile\.initializationOptions/);
  assert.match(smokeSource, /profile\.didChangeConfiguration/);
  for (const forbiddenRuntimeLiteral of [
    "exportPdf",
    "compileStatus",
    "onSave",
    '"run"',
    '"lsp"',
  ]) {
    assert.equal(
      smokeSource.includes(forbiddenRuntimeLiteral),
      false,
      forbiddenRuntimeLiteral,
    );
  }
  assert.match(smokeSource, /observedAfterSentEpoch/);
  assert.match(smokeSource, /acceptedFinalDiagnosticSequence/);
  assert.match(smokeSource, /staleRegressionCount/);
});

test("CLI parsing and host mapping fail closed", () => {
  assert.deepEqual(parseArgs([]), {
    target: "current",
    server: "all",
    installMode: "policy",
    check: false,
    offline: false,
    force: false,
    help: false,
  });
  assert.equal(parseArgs(["all", "--server", "texlab", "--offline"]).target, "all");
  assert.equal(parseArgs(["--", "--force"]).force, true);
  assert.equal(parseArgs(["--install-mode=app-data"]).installMode, "app-data");
  assert.equal(parseArgs(["--install-mode=resource"]).installMode, "resource");
  assert.throws(() => parseArgs(["--install-mode=bundle"]), /unknown install mode/);
  assert.throws(() => parseArgs(["--check", "--force"]), /cannot be combined/);
  assert.throws(() => parseArgs(["--offline", "--force"]), /cannot be combined/);
  assert.throws(() => parseArgs(["--install-mode", "unsafe"]), /unknown install mode/);
  assert.throws(() => parseArgs(["--unknown"]), /unknown option/);

  assert.equal(currentTarget("darwin", "arm64"), "aarch64-apple-darwin");
  assert.equal(currentTarget("linux", "arm64"), "aarch64-unknown-linux-gnu");
  assert.equal(currentTarget("linux", "x64"), "x86_64-unknown-linux-gnu");
  assert.equal(currentTarget("win32", "x64"), "x86_64-pc-windows-msvc");
  assert.throws(() => currentTarget("darwin", "x64"), /unsupported host platform/);
});

test("CLI help succeeds and unresolved TexLab resource mode is blocked", () => {
  const help = spawnSync(process.execPath, [FETCHER_PATH, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--check/);
  assert.match(help.stdout, /--force/);
  assert.match(help.stdout, /app-data/);
  assert.doesNotMatch(help.stdout, /allow-unresolved/);

  const blocked = spawnSync(
    process.execPath,
    [
      FETCHER_PATH,
      "--check",
      "--target",
      "aarch64-apple-darwin",
      "--server",
      "texlab",
      "--install-mode",
      "resource",
    ],
    { encoding: "utf8" },
  );
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /blocked-pending-maintainer-approval/);
  assert.match(blocked.stderr, /consent-gated app-data setup/);
});

test("resource staging rejects a multi-target bundle before filesystem or network work", () => {
  const result = spawnSync(
    process.execPath,
    [
      FETCHER_PATH,
      "--check",
      "--target",
      "all",
      "--server",
      "tinymist",
      "--install-mode",
      "resource",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /resource-archive mode requires exactly one target/,
  );
});
