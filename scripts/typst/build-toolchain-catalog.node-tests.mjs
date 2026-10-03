import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";

import {
  ALLOWED_DOWNLOAD_HOSTS,
  BUNDLED_TINYMIST_VERSION,
  BUNDLED_TYPST_VERSION,
  CATALOG_PATH,
  OPTIONAL_TYPST_FLAGS,
  ROOT,
  SUPPORTED_TARGETS,
  TINYMIST_BY_TYPST_MINOR,
  TINYMIST_TOOL,
  TYPST_TOOL,
  TYPST_VERSIONS,
  appCompileArgs,
  compareVersions,
  downloadUrls,
  extractArchiveMember,
  isSafeArchiveMember,
  listArchive,
  locateExecutable,
  minorOf,
  parsePossibleValues,
  portableCompileArgs,
  serializeCatalog,
  tinymistAssetCandidates,
  typstAssetFor,
  validateCatalog,
} from "./build-toolchain-catalog.mjs";
import { TARGET_FIELDS, answer } from "./bundled-typst.mjs";

const SHA256_RE = /^[0-9a-f]{64}$/u;
const catalogText = await readFile(CATALOG_PATH, "utf8");
const catalog = JSON.parse(catalogText);
const languageServerManifest = JSON.parse(
  await readFile(join(ROOT, "scripts", "language-servers", "manifest.json"), "utf8"),
);
const SHELL_SCRIPTS = ["fetch-typst.sh", "smoke-typst.sh", "ensure-e2e-sidecars.sh"];

function clone(value) {
  return structuredClone(value);
}

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, compress } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const body = compress ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("the committed catalog validates and is serialized deterministically", () => {
  assert.deepEqual(validateCatalog(catalog), []);
  assert.equal(serializeCatalog(catalog), catalogText);
  assert.equal(catalog.schemaVersion, 1);
  assert.match(catalog.generatedAt, /^\d{4}-\d{2}-\d{2}$/u);
  assert.deepEqual(catalog.supportedTargets, SUPPORTED_TARGETS);
  assert.deepEqual(catalog.allowedDownloadHosts, ALLOWED_DOWNLOAD_HOSTS);
});

test("every curated Typst version carries all four targets with full hashes", () => {
  assert.deepEqual(
    catalog.typst.versions.map((release) => release.version),
    [...TYPST_VERSIONS].sort(compareVersions),
  );
  for (const release of catalog.typst.versions) {
    assert.deepEqual(Object.keys(release.targets), SUPPORTED_TARGETS, release.version);
    for (const [target, entry] of Object.entries(release.targets)) {
      const label = `${release.version} ${target}`;
      assert.match(entry.archiveSha256, SHA256_RE, label);
      assert.match(entry.binarySha256, SHA256_RE, label);
      assert.equal(entry.asset, typstAssetFor(target).asset, label);
      assert.equal(entry.archiveType, typstAssetFor(target).archiveType, label);
      assert.equal(
        entry.archiveMember,
        `${entry.asset.replace(/\.(?:tar\.xz|zip)$/u, "")}/${target.includes("windows") ? "typst.exe" : "typst"}`,
        label,
      );
      assert.deepEqual(
        { mirrorUrl: entry.mirrorUrl, githubUrl: entry.githubUrl },
        downloadUrls(TYPST_TOOL, release.version, entry.asset),
        label,
      );
    }
    assert.ok(release.capabilities.outputFormats.includes("pdf"), release.version);
    for (const flag of release.capabilities.flags) assert.ok(OPTIONAL_TYPST_FLAGS.includes(flag), flag);
  }
});

test("the bundled Typst is curated and accepts the app's compile argv", () => {
  assert.equal(catalog.typst.bundled, BUNDLED_TYPST_VERSION);
  const bundled = catalog.typst.versions.find((release) => release.version === catalog.typst.bundled);
  assert.ok(bundled);
  assert.ok(bundled.capabilities.flags.includes("--color"));
  assert.deepEqual(appCompileArgs("in.typ", "out.pdf", "root"), [
    "--color",
    "never",
    "compile",
    "in.typ",
    "out.pdf",
    "--root",
    "root",
    "--diagnostic-format",
    "short",
  ]);
  assert.deepEqual(portableCompileArgs("in.typ", "out.pdf", "root").slice(0, 2), ["--color=never", "compile"]);
});

test("Tinymist covers every curated Typst minor and matches the language-server pin", () => {
  const minors = [...new Set(catalog.typst.versions.map((release) => minorOf(release.version)))];
  assert.deepEqual(
    catalog.tinymist.versions.map((release) => release.typstMinor),
    minors,
  );
  for (const release of catalog.tinymist.versions) {
    assert.equal(release.version, TINYMIST_BY_TYPST_MINOR[release.typstMinor]);
    assert.equal(minorOf(release.version), release.typstMinor);
    assert.deepEqual(Object.keys(release.targets), SUPPORTED_TARGETS, release.version);
    for (const [target, entry] of Object.entries(release.targets)) {
      assert.match(entry.archiveSha256, SHA256_RE);
      assert.match(entry.binarySha256, SHA256_RE);
      assert.ok(
        tinymistAssetCandidates(target).some(
          (candidate) => candidate.asset === entry.asset && candidate.archiveType === entry.archiveType,
        ),
        `${release.version} ${target}`,
      );
      assert.deepEqual(
        { mirrorUrl: entry.mirrorUrl, githubUrl: entry.githubUrl },
        downloadUrls(TINYMIST_TOOL, release.version, entry.asset),
      );
    }
  }
  assert.equal(catalog.tinymist.bundled, BUNDLED_TINYMIST_VERSION);
  assert.equal(minorOf(catalog.tinymist.bundled), minorOf(catalog.typst.bundled));
  const pinned = languageServerManifest.servers.tinymist;
  assert.equal(pinned.version, catalog.tinymist.bundled);
  const bundled = catalog.tinymist.versions.find((release) => release.version === catalog.tinymist.bundled);
  for (const target of SUPPORTED_TARGETS) {
    const fromCatalog = bundled.targets[target];
    const fromManifest = pinned.targets[target];
    for (const field of ["asset", "archiveType", "archiveMember", "archiveSha256", "archiveSize", "binarySha256", "binarySize"]) {
      assert.equal(fromCatalog[field], fromManifest[field], `${target} ${field}`);
    }
    assert.equal(fromCatalog.mirrorUrl, fromManifest.url, target);
  }
});

test("the shell scripts read the bundled Typst pin from the catalog", async () => {
  const typstHashes = catalog.typst.versions.flatMap((release) =>
    Object.values(release.targets).flatMap((entry) => [entry.archiveSha256, entry.binarySha256]),
  );
  for (const name of SHELL_SCRIPTS) {
    const text = await readFile(join(ROOT, "scripts", name), "utf8");
    assert.ok(text.includes("node scripts/typst/bundled-typst.mjs"), name);
    for (const version of TYPST_VERSIONS) assert.equal(text.includes(version), false, `${name} hard-codes ${version}`);
    for (const hash of typstHashes) assert.equal(text.includes(hash), false, `${name} hard-codes a Typst hash`);
    const syntax = spawnSync("bash", ["-n", join(ROOT, "scripts", name)], { encoding: "utf8" });
    assert.equal(syntax.status, 0, `${name}: ${syntax.stderr}`);
  }
  const powershell = await readFile(join(ROOT, "scripts", "ensure-e2e-sidecars.ps1"), "utf8");
  assert.ok(powershell.includes(String.raw`src-tauri\resources\typst-toolchain.json`));
  assert.ok(powershell.includes("ConvertFrom-Json"));
  assert.ok(powershell.includes("$typstCatalog.typst.bundled"));
  assert.match(powershell, /Install-Sidecar "typst" \$typstVersion \$typstTarget\.asset \$typstTarget\.archiveSha256 \$typstTarget\.archiveMember \$typstTarget\.githubUrl/u);
  for (const version of TYPST_VERSIONS) assert.equal(powershell.includes(version), false, `ps1 hard-codes ${version}`);
  for (const hash of typstHashes) assert.equal(powershell.includes(hash), false, "ps1 hard-codes a Typst hash");
});

test("the catalog reader answers the shell scripts' questions", () => {
  assert.equal(answer(catalog, ["version"]), catalog.typst.bundled);
  const bundled = catalog.typst.versions.find((release) => release.version === catalog.typst.bundled);
  for (const target of SUPPORTED_TARGETS) {
    const fields = answer(catalog, ["target", target]).split(" ");
    assert.deepEqual(fields, TARGET_FIELDS.map((field) => bundled.targets[target][field]));
  }
  assert.throws(() => answer(catalog, ["target", "riscv64gc-unknown-linux-gnu"]), /unsupported Typst target/u);
  assert.throws(() => answer(catalog, []), /usage/u);
  const cli = spawnSync(process.execPath, ["scripts/typst/bundled-typst.mjs", "version"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout, `${catalog.typst.bundled}\n`);
});

test("fetch-typst rejects an unknown target before any download", async () => {
  const cache = await mkdtemp(join(tmpdir(), "oleafly-typst-fetch-"));
  try {
    const result = spawnSync("bash", [join(ROOT, "scripts", "fetch-typst.sh"), "riscv64gc-unknown-linux-gnu"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, OLEAFLY_SIDECAR_CACHE_DIR: cache },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported Typst target: riscv64gc-unknown-linux-gnu/u);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test("validation reports missing targets, bad hashes, an uncurated bundle and a Tinymist gap", () => {
  const missingTarget = clone(catalog);
  delete missingTarget.typst.versions[0].targets["x86_64-pc-windows-msvc"];
  assert.ok(validateCatalog(missingTarget).some((problem) => problem.includes("x86_64-pc-windows-msvc")));

  const badHash = clone(catalog);
  badHash.typst.versions[0].targets["aarch64-apple-darwin"].archiveSha256 = "abc";
  assert.ok(validateCatalog(badHash).some((problem) => problem.includes("archiveSha256")));

  const uncurated = clone(catalog);
  uncurated.typst.bundled = "9.9.9";
  assert.ok(validateCatalog(uncurated).some((problem) => problem.includes("not a curated version")));

  const gap = clone(catalog);
  gap.tinymist.versions = gap.tinymist.versions.filter((release) => release.typstMinor !== "0.13");
  assert.ok(validateCatalog(gap).some((problem) => problem.includes("covers Typst 0.13")));

  const foreignHost = clone(catalog);
  foreignHost.typst.versions[0].targets["aarch64-apple-darwin"].mirrorUrl = "https://example.com/typst.tar.xz";
  assert.ok(validateCatalog(foreignHost).length > 0);

  const unknownFlag = clone(catalog);
  unknownFlag.typst.versions[0].capabilities.flags = ["--shell-escape"];
  assert.ok(validateCatalog(unknownFlag).some((problem) => problem.includes("unknown flag")));

  const htmlWithoutFeatures = clone(catalog);
  const newest = htmlWithoutFeatures.typst.versions.at(-1).capabilities;
  newest.flags = newest.flags.filter((flag) => flag !== "--features");
  assert.ok(validateCatalog(htmlWithoutFeatures).some((problem) => problem.includes("HTML output disagrees")));
});

test("capabilities record the flags each Typst release accepted", () => {
  const flags = (version) => catalog.typst.versions.find((release) => release.version === version).capabilities;
  assert.deepEqual(
    ["--pages", "--creation-timestamp", "--deps", "--features"].map((flag) => flags("0.11.1").flags.includes(flag)),
    [false, false, false, false],
  );
  assert.ok(flags("0.12.0").flags.includes("--pages"));
  assert.ok(flags("0.12.0").flags.includes("--creation-timestamp"));
  assert.ok(!flags("0.12.0").outputFormats.includes("html"));
  assert.ok(flags("0.13.1").outputFormats.includes("html"));
  assert.ok(!flags("0.13.1").flags.includes("--deps"));
  assert.ok(flags("0.14.2").flags.includes("--deps"));
  assert.ok(flags("0.15.1").flags.includes("--features"));
});

test("asset naming follows each upstream's release layout", () => {
  assert.deepEqual(typstAssetFor("aarch64-unknown-linux-gnu"), {
    asset: "typst-aarch64-unknown-linux-musl.tar.xz",
    archiveType: "tar.xz",
  });
  assert.deepEqual(typstAssetFor("x86_64-pc-windows-msvc"), {
    asset: "typst-x86_64-pc-windows-msvc.zip",
    archiveType: "zip",
  });
  assert.deepEqual(tinymistAssetCandidates("aarch64-apple-darwin"), [
    { asset: "tinymist-aarch64-apple-darwin.tar.gz", archiveType: "tar.gz" },
    { asset: "tinymist-darwin-arm64", archiveType: "binary" },
  ]);
  assert.deepEqual(tinymistAssetCandidates("x86_64-pc-windows-msvc")[1], {
    asset: "tinymist-win32-x64.exe",
    archiveType: "binary",
  });
  assert.throws(() => typstAssetFor("x86_64-apple-darwin"), /unsupported target/u);
  assert.equal(minorOf("0.15.1"), "0.15");
  assert.equal(compareVersions("0.9.0", "0.11.1"), -1);
  assert.equal(isSafeArchiveMember("typst-x/typst"), true);
  assert.equal(isSafeArchiveMember("../typst"), false);
  assert.equal(isSafeArchiveMember("/typst"), false);
  assert.equal(isSafeArchiveMember(String.raw`typst-x\typst.exe`), false);
});

test("possible values are read from both single-line and wrapped clap help", () => {
  const narrow = [
    "      --pdf-standard <PDF_STANDARD>",
    "          One (or multiple comma-separated) PDF standards that Typst will",
    "          enforce conformance with [possible values: 1.7, a-2b,",
    "          a-3b]",
    "      --ppi <PPI>",
    "          The PPI [default: 144]",
  ].join("\n");
  assert.deepEqual(parsePossibleValues(narrow, "--pdf-standard"), ["1.7", "a-2b", "a-3b"]);
  const wide = "  -f, --format <FORMAT>  The format [possible values: pdf, png, svg]\n      --ppi <PPI>\n";
  assert.deepEqual(parsePossibleValues(wide, "--format"), ["pdf", "png", "svg"]);
  assert.deepEqual(parsePossibleValues(wide, "--pdf-standard"), []);
});

test("ZIP and tar archives are listed and their executable extracted", async () => {
  const binary = Buffer.from("not really typst\n".repeat(50));
  const zip = storedZip([
    { name: "typst-x86_64-pc-windows-msvc/", data: Buffer.alloc(0), compress: false },
    { name: "typst-x86_64-pc-windows-msvc/LICENSE", data: Buffer.from("license"), compress: false },
    { name: "typst-x86_64-pc-windows-msvc/typst.exe", data: binary, compress: true },
  ]);
  const zipEntries = listArchive(zip, "zip");
  assert.equal(locateExecutable(zipEntries, "typst.exe"), "typst-x86_64-pc-windows-msvc/typst.exe");
  assert.deepEqual(extractArchiveMember(zip, "zip", "typst-x86_64-pc-windows-msvc/typst.exe"), binary);
  assert.throws(() => locateExecutable(zipEntries, "tinymist.exe"), /exactly one/u);

  const work = await mkdtemp(join(tmpdir(), "oleafly-typst-tar-"));
  try {
    await mkdir(join(work, "tinymist-x86_64-unknown-linux-gnu"));
    await writeFile(join(work, "tinymist-x86_64-unknown-linux-gnu", "tinymist"), binary);
    const packed = spawnSync("tar", ["-czf", "-", "-C", work, "tinymist-x86_64-unknown-linux-gnu"], {
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(packed.status, 0, packed.stderr?.toString());
    const entries = listArchive(packed.stdout, "tar.gz");
    const member = locateExecutable(entries, "tinymist");
    assert.equal(member, "tinymist-x86_64-unknown-linux-gnu/tinymist");
    assert.deepEqual(extractArchiveMember(packed.stdout, "tar.gz", member), binary);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  assert.equal(extractArchiveMember(binary, "binary", null), binary);
});
