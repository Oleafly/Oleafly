import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
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
  buildCatalog,
  compareVersions,
  downloadUrls,
  executableName,
  extractArchiveMember,
  hostTarget,
  isSafeArchiveMember,
  listArchive,
  locateExecutable,
  main,
  minorOf,
  parsePossibleValues,
  portableCompileArgs,
  probeTinymist,
  probeTypst,
  serializeCatalog,
  sha256Hex,
  tinymistAssetCandidates,
  typstAssetFor,
  validateCatalog,
  withoutGeneratedAt,
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

test("validation reports every problem in a fixed order", () => {
  assert.deepEqual(validateCatalog(null), ["catalog is not an object"]);
  assert.deepEqual(validateCatalog({}), [
    "schemaVersion is not 1",
    "generatedAt is not a YYYY-MM-DD date",
    "supportedTargets is not the app's target allowlist",
    "allowedDownloadHosts is not the expected allowlist",
    "typst.repository is wrong",
    "typst.versions is empty",
    "bundled Typst undefined is not a curated version",
    "tinymist.repository is wrong",
    "bundled Tinymist undefined is not listed",
  ]);

  const header = clone(catalog);
  header.schemaVersion = 2;
  header.generatedAt = "2026/10/02";
  header.supportedTargets = [...SUPPORTED_TARGETS].reverse();
  header.allowedDownloadHosts = ALLOWED_DOWNLOAD_HOSTS.slice(1);
  assert.deepEqual(validateCatalog(header), [
    "schemaVersion is not 1",
    "generatedAt is not a YYYY-MM-DD date",
    "supportedTargets is not the app's target allowlist",
    "allowedDownloadHosts is not the expected allowlist",
  ]);

  const releases = clone(catalog);
  const [first, second, third, fourth, fifth] = releases.typst.versions;
  first.tag = first.version;
  first.minor = "0.1";
  first.releasedAt = "soon";
  first.capabilities = { flags: ["--ppi", "--color"], outputFormats: ["svg"], pdfStandards: [""] };
  second.version = "0.12";
  second.capabilities = null;
  second.targets = null;
  third.capabilities.pdfStandards = [];
  fourth.capabilities.outputFormats = ["pdf", "gif"];
  fifth.capabilities.flags = ["--shell-escape"];
  assert.deepEqual(validateCatalog(releases), [
    "Typst 0.11.1 tag is wrong",
    "Typst 0.11.1 minor is wrong",
    "Typst 0.11.1 releasedAt is not a date",
    "Typst 0.11.1 flags are not sorted",
    "Typst 0.11.1 cannot produce PDF",
    "Typst 0.11.1 has unusable PDF standards",
    "Typst 0.12 has an unusable version",
    "Typst 0.12 has no capabilities",
    "Typst 0.12 has no targets",
    "Typst 0.13.1 PDF standards disagree with --pdf-standard support",
    "Typst 0.14.2 lists an unknown output format",
    "Typst 0.14.2 HTML output disagrees with --features support",
    "Typst 0.15.0 lists an unknown flag",
    "Typst 0.15.0 PDF standards disagree with --pdf-standard support",
    "Typst 0.15.0 HTML output disagrees with --features support",
  ]);

  const targets = clone(catalog);
  const typstTargets = targets.typst.versions[0].targets;
  delete typstTargets["aarch64-apple-darwin"];
  Object.assign(typstTargets["aarch64-unknown-linux-gnu"], { archiveType: "rar", asset: "-typst.rar" });
  Object.assign(typstTargets["x86_64-unknown-linux-gnu"], {
    archiveMember: "../typst",
    archiveSha256: "ABC",
    archiveSize: "12",
    binarySize: 0,
  });
  Object.assign(typstTargets["x86_64-pc-windows-msvc"], {
    archiveMember: "typst-x86_64-pc-windows-msvc/tinymist.exe",
    mirrorUrl: "http://mirrors.oleafly.com/typst.zip",
    githubUrl: "https://example.com/typst.zip",
  });
  targets.typst.versions[1].targets = "none";
  const bare = targets.tinymist.versions[0].targets;
  Object.assign(bare["aarch64-apple-darwin"], {
    archiveMember: "tinymist",
    binarySize: bare["aarch64-apple-darwin"].binarySize + 1,
  });
  bare["aarch64-unknown-linux-gnu"].asset = "tinymist-linux-arm64.tar.gz";
  assert.deepEqual(validateCatalog(targets), [
    "Typst 0.11.1 does not list exactly the supported targets in order",
    "Typst 0.11.1 is missing aarch64-apple-darwin",
    "Typst 0.11.1 aarch64-unknown-linux-gnu has an unknown archive type",
    "Typst 0.11.1 aarch64-unknown-linux-gnu has an unusable asset name",
    "Typst 0.11.1 aarch64-unknown-linux-gnu mirrorUrl is not the canonical mirror address",
    "Typst 0.11.1 aarch64-unknown-linux-gnu githubUrl is not the canonical release address",
    "Typst 0.11.1 x86_64-unknown-linux-gnu has an unsafe archive member",
    "Typst 0.11.1 x86_64-unknown-linux-gnu archiveSha256 is not 64 hex characters",
    "Typst 0.11.1 x86_64-unknown-linux-gnu archiveSize is not a positive integer",
    "Typst 0.11.1 x86_64-unknown-linux-gnu binarySize is not a positive integer",
    "Typst 0.11.1 x86_64-pc-windows-msvc archive member is not the typst executable",
    "Typst 0.11.1 x86_64-pc-windows-msvc mirrorUrl is not the canonical mirror address",
    "Typst 0.11.1 x86_64-pc-windows-msvc githubUrl is not the canonical release address",
    "Typst 0.11.1 x86_64-pc-windows-msvc has a download address outside the allowed hosts",
    "Typst 0.11.1 x86_64-pc-windows-msvc has a download address outside the allowed hosts",
    "Typst 0.12.0 has no targets",
    "Tinymist 0.11.32 aarch64-apple-darwin is a bare binary but names a member",
    "Tinymist 0.11.32 aarch64-apple-darwin is a bare binary whose archive and binary digests differ",
    "Tinymist 0.11.32 aarch64-unknown-linux-gnu mirrorUrl is not the canonical mirror address",
    "Tinymist 0.11.32 aarch64-unknown-linux-gnu githubUrl is not the canonical release address",
  ]);

  const tinymist = clone(catalog);
  tinymist.tinymist.repository = "https://github.com/example/tinymist";
  tinymist.tinymist.bundled = "0.15.9";
  const [oldest, next] = tinymist.tinymist.versions;
  oldest.tag = oldest.version;
  oldest.releasedAt = "2024";
  next.typstMinor = "0.11";
  tinymist.tinymist.versions.push(clone(oldest));
  assert.deepEqual(validateCatalog(tinymist), [
    "tinymist.repository is wrong",
    "tinymist repeats a version",
    "tinymist versions are not in ascending order",
    "bundled Tinymist 0.15.9 is not listed",
    "tinymist lists one Typst minor twice",
    "no Tinymist release covers Typst 0.12",
    "Tinymist 0.11.32 tag is wrong",
    "Tinymist 0.11.32 releasedAt is not a date",
    "Tinymist 0.12.22 does not match its Typst minor",
    "Tinymist 0.11.32 tag is wrong",
    "Tinymist 0.11.32 releasedAt is not a date",
  ]);

  const bundle = clone(catalog);
  bundle.typst.bundled = "0.14.2";
  assert.deepEqual(validateCatalog(bundle), ["bundled Tinymist does not match the bundled Typst minor"]);
});

test("withoutGeneratedAt drops only generatedAt and keeps the key order", () => {
  const stripped = withoutGeneratedAt(catalog);
  assert.deepEqual(
    Object.keys(stripped),
    Object.keys(catalog).filter((key) => key !== "generatedAt"),
  );
  assert.equal(catalog.generatedAt.length, 10);
  assert.equal(stripped.typst, catalog.typst);
});

const UNIX_ONLY = process.platform === "win32" && "the fake tools are Node scripts started through a shebang";
const FAKE_PUBLISHED_AT = "2026-03-04T05:06:07Z";
const SCRATCH = await mkdtemp(join(tmpdir(), "oleafly-typst-fakes-"));
after(() => rm(SCRATCH, { recursive: true, force: true }));

function fakeTypstRejection(profile, extra) {
  const accepted = new Set(profile.flags);
  if (accepted.has("--deps")) accepted.add("--deps-format");
  const flag = extra.find((arg) => arg.startsWith("--") && (arg === profile.brokenFlag || !accepted.has(arg)));
  if (flag === undefined) return null;
  if (flag === profile.brokenFlag) return { stderr: `error: ${flag} exploded\n`, code: 1 };
  return { stderr: `error: unexpected argument '${flag}' found\n`, code: 2 };
}

function fakeTypstWrite(fs, input, output, extra) {
  const value = (flag) => extra[extra.indexOf(flag) + 1];
  if (extra.includes("--deps")) fs.writeFileSync(value("--deps"), JSON.stringify({ inputs: [input] }));
  const format = extra.includes("--format") ? value("--format") : "pdf";
  if (format !== "png") {
    const text = { pdf: "%PDF-1.7\n", svg: "<svg></svg>\n", html: "<!DOCTYPE html>\n<html></html>\n" }[format];
    fs.writeFileSync(output, text);
    return;
  }
  const scale = Number(value("--ppi")) / 72;
  const png = Buffer.alloc(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "latin1");
  png.writeUInt32BE(Math.round(120 * scale), 16);
  png.writeUInt32BE(Math.round(80 * scale), 20);
  fs.writeFileSync(output, png);
}

function fakeTypstReply(profile, args, fs) {
  if (args[0] === "--version") return { stdout: profile.versionOutput, code: 0 };
  if (args[0] === "compile" && args[1] === "-h") return { stdout: profile.help, code: 0 };
  if (args[0] === "--color" && args[1] === "never" && !profile.appArgv) {
    return { stderr: "error: unrecognized subcommand 'never'\n", code: 2 };
  }
  const rest = args.slice(args.indexOf("compile"));
  const [, input, output] = rest;
  const extra = rest.slice(7);
  if (fs.readFileSync(input, "utf8").includes("#this-function-does-not-exist")) {
    return { stderr: `${input}:1:2: error: unknown variable: this-function-does-not-exist\n`, code: 1 };
  }
  const rejected = fakeTypstRejection(profile, extra);
  if (rejected) return rejected;
  fakeTypstWrite(fs, input, output, extra);
  return { code: 0 };
}

function fakeTinymistReply(profile, args) {
  if (args[0] === "--version") {
    return { stdout: `tinymist ${profile.version}\nBuild Git Describe: v${profile.version}-fake\n`, code: 0 };
  }
  if (args[0] === "lsp" && args[1] === "--help") return { stdout: "Runs the language server\n", code: 0 };
  return { stderr: `error: unexpected argument '${args[0]}' found\n`, code: 2 };
}

function fakeToolMain(reply, profile) {
  const result = reply(profile, process.argv.slice(2), process.getBuiltinModule("node:fs"));
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.code;
}

function fakeTypstScript(profile) {
  return [
    "#!/usr/bin/env node",
    fakeTypstRejection.toString(),
    fakeTypstWrite.toString(),
    fakeTypstReply.toString(),
    fakeToolMain.toString(),
    `fakeToolMain(fakeTypstReply, ${JSON.stringify(profile)});`,
    "",
  ].join("\n");
}

function fakeTinymistScript(version) {
  return [
    "#!/usr/bin/env node",
    fakeTinymistReply.toString(),
    fakeToolMain.toString(),
    `fakeToolMain(fakeTinymistReply, ${JSON.stringify({ version })});`,
    "",
  ].join("\n");
}

function typstProfile(release, overrides = {}) {
  const { flags, pdfStandards } = release.capabilities;
  return {
    versionOutput: `typst ${release.version} (fake)\n`,
    appArgv: flags.includes("--color"),
    flags: flags.filter((flag) => flag !== "--color"),
    help: [
      "      --pdf-standard <PDF_STANDARD>",
      `          PDF standards [possible values: ${pdfStandards.join(", ")}]`,
      "      --ppi <PPI>",
      "          The PPI [default: 144]",
      "",
    ].join("\n"),
    ...overrides,
  };
}

async function stageFake(name, script) {
  const dir = await mkdtemp(join(SCRATCH, "tool-"));
  const path = join(dir, name);
  await writeFile(path, script, { mode: 0o755 });
  return { dir, path };
}

async function packFake(job) {
  if (job.archiveType === "binary") return job.contents;
  const top = job.asset.replace(/\.(?:tar\.xz|tar\.gz|zip)$/u, "");
  const member = `${top}/${job.executable}`;
  if (job.archiveType === "zip") return storedZip([{ name: member, data: job.contents, compress: true }]);
  const dir = await mkdtemp(join(SCRATCH, "pack-"));
  await mkdir(join(dir, top));
  await writeFile(join(dir, member), job.contents, { mode: 0o755 });
  const flag = job.archiveType === "tar.xz" ? "J" : "z";
  const packed = spawnSync("tar", [`-c${flag}f`, "-", "-C", dir, top], { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(packed.status, 0, packed.stderr?.toString());
  return packed.stdout;
}

function fakeJobs() {
  const typst = catalog.typst.versions.flatMap((release) =>
    SUPPORTED_TARGETS.map((target) => ({
      tool: TYPST_TOOL,
      version: release.version,
      target,
      ...typstAssetFor(target),
      executable: executableName("typst", target),
      contents: Buffer.from(fakeTypstScript(typstProfile(release))),
      digest: true,
    })),
  );
  const tinymist = catalog.tinymist.versions.flatMap((release) =>
    SUPPORTED_TARGETS.flatMap((target) =>
      tinymistAssetCandidates(target)
        .filter((candidate) => release.targets[target].archiveType !== "binary" || candidate.archiveType === "binary")
        .map((candidate) => ({
          tool: TINYMIST_TOOL,
          version: release.version,
          target,
          ...candidate,
          executable: executableName("tinymist", target),
          contents: Buffer.from(fakeTinymistScript(release.version)),
          digest: false,
        })),
    ),
  );
  return [...typst, ...tinymist];
}

function fakeRelease(tool, version, jobs) {
  const assets = jobs
    .filter((job) => job.tool === tool && job.version === version)
    .map((job) => ({
      name: job.asset,
      size: job.bytes.length,
      browser_download_url: downloadUrls(tool, version, job.asset).githubUrl,
      ...(job.digest ? { digest: `sha256:${sha256Hex(job.bytes)}` } : {}),
    }));
  return { draft: false, prerelease: false, published_at: FAKE_PUBLISHED_AT, assets };
}

let fakeWorldPromise;

async function buildFakeWorld() {
  const jobs = await Promise.all(fakeJobs().map(async (job) => ({ ...job, bytes: await packFake(job) })));
  const routes = new Map();
  for (const job of jobs) {
    routes.set(downloadUrls(job.tool, job.version, job.asset).githubUrl, { bytes: job.bytes });
    const api = `https://api.github.com/repos/${job.tool.apiRepository}/releases/tags/v${job.version}`;
    if (!routes.has(api)) routes.set(api, { json: fakeRelease(job.tool, job.version, jobs) });
  }
  return { jobs, routes };
}

function fakeWorld() {
  fakeWorldPromise ??= buildFakeWorld();
  return fakeWorldPromise;
}

function stubGithub(t, routes, failures = new Map()) {
  const calls = [];
  t.mock.method(globalThis, "fetch", (url) => {
    calls.push(url);
    const failure = failures.get(url)?.shift();
    if (failure !== undefined) return Promise.resolve({ ok: false, status: failure, url });
    const route = routes.get(url);
    if (!route) return Promise.resolve({ ok: false, status: 404, url });
    return Promise.resolve({
      ok: true,
      status: 200,
      url,
      json: () => Promise.resolve(structuredClone(route.json)),
      arrayBuffer: () => Promise.resolve(Uint8Array.from(route.bytes).buffer),
    });
  });
  return calls;
}

function chosenJob(world, tool, version, target) {
  return world.jobs.find((job) => {
    if (job.tool !== tool || job.version !== version || job.target !== target) return false;
    return tool === TYPST_TOOL || job.archiveType === catalog.tinymist.versions.find((release) => release.version === version).targets[target].archiveType;
  });
}

function expectedTargets(world, tool, version) {
  return Object.fromEntries(
    SUPPORTED_TARGETS.map((target) => {
      const job = chosenJob(world, tool, version, target);
      const top = job.asset.replace(/\.(?:tar\.xz|tar\.gz|zip)$/u, "");
      const urls = downloadUrls(tool, version, job.asset);
      return [
        target,
        {
          asset: job.asset,
          archiveType: job.archiveType,
          archiveMember: job.archiveType === "binary" ? null : `${top}/${job.executable}`,
          archiveSha256: sha256Hex(job.bytes),
          archiveSize: job.bytes.length,
          binarySha256: sha256Hex(job.contents),
          binarySize: job.contents.length,
          mirrorUrl: urls.mirrorUrl,
          githubUrl: urls.githubUrl,
        },
      ];
    }),
  );
}

function expectedCatalog(world, generatedAt) {
  return {
    schemaVersion: 1,
    generatedAt,
    supportedTargets: SUPPORTED_TARGETS,
    allowedDownloadHosts: ALLOWED_DOWNLOAD_HOSTS,
    typst: {
      repository: TYPST_TOOL.repository,
      bundled: BUNDLED_TYPST_VERSION,
      versions: catalog.typst.versions.map((release) => ({
        version: release.version,
        tag: `v${release.version}`,
        minor: minorOf(release.version),
        releasedAt: FAKE_PUBLISHED_AT.slice(0, 10),
        capabilities: release.capabilities,
        targets: expectedTargets(world, TYPST_TOOL, release.version),
      })),
    },
    tinymist: {
      repository: TINYMIST_TOOL.repository,
      bundled: BUNDLED_TINYMIST_VERSION,
      versions: catalog.tinymist.versions.map((release) => ({
        typstMinor: release.typstMinor,
        version: release.version,
        tag: `v${release.version}`,
        releasedAt: FAKE_PUBLISHED_AT.slice(0, 10),
        targets: expectedTargets(world, TINYMIST_TOOL, release.version),
      })),
    },
  };
}

function expectedLog(world) {
  const header = (tool, version) =>
    tool === TYPST_TOOL ? `Typst ${version}` : `Tinymist ${version} (Typst ${minorOf(version)})`;
  const releases = [
    ...catalog.typst.versions.map((release) => [TYPST_TOOL, release.version]),
    ...catalog.tinymist.versions.map((release) => [TINYMIST_TOOL, release.version]),
  ];
  const headers = releases.map(([tool, version]) => header(tool, version));
  const targetLines = releases.flatMap(([tool, version]) =>
    Object.entries(expectedTargets(world, tool, version)).map(([target, entry]) => {
      const source = tool === TYPST_TOOL ? "GitHub digest verified" : "hashed locally, no GitHub digest";
      const member = entry.archiveMember ? ` member ${entry.archiveMember}` : "";
      return `  ${target}: ${entry.asset} (${source})${member}`;
    }),
  );
  return { headers, all: [...headers, ...targetLines].sort(compareText) };
}

function compareText(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

test("buildCatalog reuses committed capabilities and keeps an unchanged generatedAt", { skip: UNIX_ONLY }, async (t) => {
  const world = await fakeWorld();
  stubGithub(t, world.routes);
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  const first = await buildCatalog({ skipProbe: true, committed: catalog, log: (line) => lines.push(line) });
  assert.equal(first.host, null);
  assert.deepEqual(first.probes, { typst: [], tinymist: [] });
  assert.equal(serializeCatalog(first.catalog), serializeCatalog(expectedCatalog(world, today)));
  assert.deepEqual(validateCatalog(first.catalog), []);
  const log = expectedLog(world);
  assert.deepEqual(
    lines.filter((line) => !line.startsWith("  ")),
    log.headers,
  );
  assert.deepEqual([...lines].sort(compareText), log.all);

  const unchanged = { ...first.catalog, generatedAt: "2000-01-02" };
  const second = await buildCatalog({ skipProbe: true, committed: unchanged, log: () => {} });
  assert.equal(second.catalog.generatedAt, "2000-01-02");
  const undated = { ...first.catalog, generatedAt: "someday" };
  const third = await buildCatalog({ skipProbe: true, committed: undated, log: () => {} });
  assert.equal(third.catalog.generatedAt, today);
});

test("buildCatalog without committed capabilities refuses to skip the probe", { skip: UNIX_ONLY }, async (t) => {
  const world = await fakeWorld();
  stubGithub(t, world.routes);
  await assert.rejects(
    buildCatalog({ skipProbe: true, committed: null, log: () => {} }),
    /no committed capabilities for Typst 0\.11\.1/u,
  );
});

test("downloads retry with a growing delay and report the last failure", { skip: UNIX_ONLY }, async (t) => {
  const world = await fakeWorld();
  const api = "https://api.github.com/repos/typst/typst/releases/tags/v0.11.1";
  const delays = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    delays.push(delay);
    callback();
  });
  const failures = new Map([[api, [503, 502]]]);
  const calls = stubGithub(t, world.routes, failures);
  const recovered = await buildCatalog({ skipProbe: true, committed: catalog, log: () => {} });
  assert.deepEqual(validateCatalog(recovered.catalog), []);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(calls.filter((url) => url === api).length, 3);

  delays.length = 0;
  failures.set(api, [503, 502, 500]);
  await assert.rejects(
    buildCatalog({ skipProbe: true, committed: catalog, log: () => {} }),
    new Error(`${api} answered HTTP 500`),
  );
  assert.deepEqual(delays, [1000, 2000]);
});

test("probing the host binaries records each release's capabilities", { skip: UNIX_ONLY || (!hostTarget() && "no probe host") }, async (t) => {
  const world = await fakeWorld();
  stubGithub(t, world.routes);
  const result = await buildCatalog({ skipProbe: false, committed: null, log: () => {} });
  assert.equal(result.host, hostTarget());
  assert.deepEqual(
    result.catalog.typst.versions.map((release) => release.capabilities),
    catalog.typst.versions.map((release) => release.capabilities),
  );
  assert.deepEqual(validateCatalog(result.catalog), []);
  assert.deepEqual(
    result.probes.typst.map((report) => [report.version, report.appArgv, report.versionOutput]),
    catalog.typst.versions.map((release) => [
      release.version,
      release.capabilities.flags.includes("--color"),
      `typst ${release.version} (fake)`,
    ]),
  );
  assert.deepEqual(
    result.probes.tinymist,
    catalog.tinymist.versions.map((release) => ({
      version: release.version,
      versionLine: `Build Git Describe: v${release.version}-fake`,
      lsp: true,
    })),
  );
});

test("probeTypst records unsupported flags as notes and fails on real errors", { skip: UNIX_ONLY }, async () => {
  const oldest = catalog.typst.versions[0];
  const typst = await stageFake("typst", fakeTypstScript(typstProfile(oldest)));
  const report = await probeTypst(typst.path, oldest.version, join(typst.dir, "probe"));
  assert.deepEqual(report, {
    version: "0.11.1",
    appArgv: false,
    portableArgv: true,
    diagnostics: true,
    flags: ["--font-path", "--format", "--input", "--ppi"],
    outputFormats: ["pdf", "png", "svg"],
    pdfStandards: [],
    notes: [
      "--color never: error: unrecognized subcommand 'never'",
      "--ignore-system-fonts: error: unexpected argument '--ignore-system-fonts' found",
      "--pdf-standard: error: unexpected argument '--pdf-standard' found",
      "--pages: error: unexpected argument '--pages' found",
      "--creation-timestamp: error: unexpected argument '--creation-timestamp' found",
      "--deps: error: unexpected argument '--deps' found",
      "--package-path: error: unexpected argument '--package-path' found",
      "--package-cache-path: error: unexpected argument '--package-cache-path' found",
      "--features html --format html: error: unexpected argument '--features' found",
    ],
    versionOutput: "typst 0.11.1 (fake)",
  });

  const newest = catalog.typst.versions.at(-1);
  const current = await stageFake("typst", fakeTypstScript(typstProfile(newest)));
  const full = await probeTypst(current.path, newest.version, join(current.dir, "probe"));
  assert.deepEqual(
    { flags: full.flags, outputFormats: full.outputFormats, pdfStandards: full.pdfStandards },
    newest.capabilities,
  );
  assert.deepEqual(full.notes, []);

  const mislabelled = await stageFake("typst", fakeTypstScript(typstProfile(newest, { versionOutput: "typst 0.15.0\n" })));
  await assert.rejects(
    probeTypst(mislabelled.path, newest.version, join(mislabelled.dir, "probe")),
    new Error('Typst 0.15.1 reports "typst 0.15.0"'),
  );
  const broken = await stageFake("typst", fakeTypstScript(typstProfile(newest, { brokenFlag: "--deps" })));
  await assert.rejects(
    probeTypst(broken.path, newest.version, join(broken.dir, "probe")),
    new Error("Typst 0.15.1 failed the --deps probe: error: --deps exploded"),
  );
});

test("probeTinymist reads the build description and checks the lsp subcommand", { skip: UNIX_ONLY }, async () => {
  const tinymist = await stageFake("tinymist", fakeTinymistScript("0.15.8"));
  assert.deepEqual(await probeTinymist(tinymist.path, "0.15.8", tinymist.dir), {
    version: "0.15.8",
    versionLine: "Build Git Describe: v0.15.8-fake",
    lsp: true,
  });
  await assert.rejects(probeTinymist(tinymist.path, "0.15.9", tinymist.dir), /Tinymist 0\.15\.9 reports/u);
});

test("main prints usage, rejects unknown options and reports a stale catalog", { skip: UNIX_ONLY }, async (t) => {
  const printed = t.mock.method(console, "log", () => {});
  const errors = t.mock.method(console, "error", () => {});
  assert.equal(await main(["--help"]), 0);
  assert.match(printed.mock.calls[0].arguments[0], /^usage: node scripts\/typst\/build-toolchain-catalog\.mjs/u);
  await assert.rejects(main(["--fast"]), /unknown option --fast/u);

  const world = await fakeWorld();
  stubGithub(t, world.routes);
  assert.equal(await main(["--check", "--skip-probe"]), 1);
  const reported = errors.mock.calls.map((call) => call.arguments[0]);
  assert.equal(reported[0], `${CATALOG_PATH} is out of date with GitHub:`);
  const fields = ["archiveSha256", "archiveSize", "binarySha256", "binarySize"];
  const stale = (index) => [
    `  $.typst.versions.${index}.releasedAt`,
    ...SUPPORTED_TARGETS.flatMap((target) => fields.map((field) => `  $.typst.versions.${index}.targets.${target}.${field}`)),
  ];
  assert.deepEqual(reported.slice(1), [...stale(0), ...stale(1)].slice(0, 25));
  assert.equal(await readFile(CATALOG_PATH, "utf8"), catalogText);
});
