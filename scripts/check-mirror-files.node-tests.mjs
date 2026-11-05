import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MIRROR,
  bundleFiles,
  checkFiles,
  classify,
  classifyEdge,
  collectMirrorFiles,
  formatReport,
  mirrorFilesInManifest,
  parseArgs,
  tinytexFiles,
} from "./check-mirror-files.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TINYTEX_SOURCE = `
const TINYTEX_TAG: &str = "v2026.08";
const TINYTEX_MIRROR_BASE: &str = "https://mirrors.oleafly.com/binaries/tinytex";
fn tinytex_asset_for(os: &str, arch: &str) {
    match (os, arch) {
        ("windows", "x86_64") => Ok(tinytex_asset_metadata(
            &base,
            (
                "TinyTeX",
                "zip",
                ArchiveFormat::Zip,
                246_862_169,
            ),
        )),
        ("macos", "aarch64") => Ok(tinytex_asset_metadata(&base, ("TinyTeX", "tgz", ArchiveFormat::TarGz, 265_813_745,
        ))),
        ("linux", "x86_64") => Ok(tinytex_asset_metadata(&base, ("TinyTeX", "tar.gz", ArchiveFormat::TarGz, 200_145_836,
        ))),
        ("linux", "aarch64") => Ok(tinytex_asset_metadata(&base, ("TinyTeX-linux-arm64", "tar.xz", ArchiveFormat::TarXz, 155_871_496,
        ))),
    }
}
`;

function response(status, headers = {}) {
  const lowered = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { status, headers: { get: (name) => lowered[name] ?? null }, body: null };
}

test("every TinyTeX archive maps to its mirror address and pinned size", () => {
  assert.deepEqual(
    tinytexFiles(TINYTEX_SOURCE, "latex_engine.rs").map(({ url, size }) => [url, size]),
    [
      ["https://mirrors.oleafly.com/binaries/tinytex/v2026.08/TinyTeX-v2026.08.zip", 246862169],
      ["https://mirrors.oleafly.com/binaries/tinytex/v2026.08/TinyTeX-v2026.08.tgz", 265813745],
      ["https://mirrors.oleafly.com/binaries/tinytex/v2026.08/TinyTeX-v2026.08.tar.gz", 200145836],
      ["https://mirrors.oleafly.com/binaries/tinytex/v2026.08/TinyTeX-linux-arm64-v2026.08.tar.xz", 155871496],
    ],
  );
});

test("a TinyTeX source the pattern no longer understands fails loudly", () => {
  assert.throws(() => tinytexFiles("const TINYTEX_TAG: &str = \"v1\";"), /TINYTEX_MIRROR_BASE/u);
  const renamed = TINYTEX_SOURCE.replaceAll("ArchiveFormat", "Format");
  assert.throws(() => tinytexFiles(renamed), /lists 0 TinyTeX archives/u);
});

test("the Tectonic bundle brings its index along", () => {
  const files = bundleFiles(
    'pub const TEX_BUNDLE_MIRROR_URL: &str =\n    "https://mirrors.oleafly.com/tex-bundles/x.tar";',
  );
  assert.deepEqual(
    files.map((file) => file.url),
    ["https://mirrors.oleafly.com/tex-bundles/x.tar", "https://mirrors.oleafly.com/tex-bundles/x.tar.index.gz"],
  );
});

test("manifest entries carry their pinned size and skip other hosts", () => {
  const manifest = {
    allowedDownloadHosts: ["mirrors.oleafly.com"],
    typst: {
      versions: [
        {
          targets: {
            a: {
              archiveSize: 10,
              mirrorUrl: `${MIRROR}binaries/typst/a.tar.xz`,
              githubUrl: "https://github.com/typst/typst/releases/download/a.tar.xz",
            },
          },
        },
      ],
    },
    files: [{ name: "OFL.txt", url: `${MIRROR}fonts/lato/OFL.txt` }],
    bare: MIRROR,
  };
  assert.deepEqual(mirrorFilesInManifest(manifest, "m.json"), [
    { url: `${MIRROR}binaries/typst/a.tar.xz`, size: 10, origin: "m.json" },
    { url: `${MIRROR}fonts/lato/OFL.txt`, size: null, origin: "m.json" },
  ]);
});

test("the repository's own manifests and sources all resolve to mirror files", async () => {
  const files = await collectMirrorFiles(ROOT);
  const urls = files.map((file) => file.url);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every((url) => url.startsWith(MIRROR)));
  assert.ok(urls.some((url) => url.includes("/binaries/tinytex/")));
  assert.ok(urls.some((url) => url.endsWith(".tar.index.gz")));
  assert.ok(urls.some((url) => url.includes("/fonts/")));
  assert.ok(urls.some((url) => url.includes("/language-servers/")));
  assert.ok(urls.some((url) => url.includes("/binaries/typst/")));
});

test("a missing file and a wrong size fail, anything inconclusive is only unverified", () => {
  const pinned = { url: `${MIRROR}a`, size: 5, origin: "m" };
  const open = { url: `${MIRROR}b`, size: null, origin: "m" };
  assert.equal(classify(pinned, { status: 200, length: 5 }).verdict, "ok");
  assert.equal(classify(pinned, { status: 200, length: null }).verdict, "ok");
  assert.equal(classify(pinned, { status: 200, length: 6 }).verdict, "wrong-size");
  assert.equal(classify(open, { status: 200, length: 6 }).verdict, "ok");
  assert.equal(classify(open, { status: 404, length: null }).verdict, "missing");
  assert.equal(classify(open, { status: 410, length: null }).verdict, "missing");
  for (const status of [403, 429, 500, 503]) {
    assert.equal(classify(open, { status, length: null }).verdict, "unverified", String(status));
  }
  assert.equal(classify(open, { error: "ECONNRESET" }).verdict, "unverified");
});

test("the edge read catches a 404 the cache kept from before the upload", () => {
  const file = { url: `${MIRROR}a`, size: 5, origin: "m" };
  assert.equal(classifyEdge(file, { status: 206, total: 5, cache: "HIT" }).verdict, "ok");
  assert.equal(classifyEdge(file, { status: 200, total: null, cache: "DYNAMIC" }).verdict, "ok");
  assert.equal(classifyEdge(file, { status: 206, total: 4, cache: "MISS" }).verdict, "wrong-size");
  const stale = classifyEdge(file, { status: 404, total: null, cache: "HIT" });
  assert.equal(stale.verdict, "stale-edge");
  assert.match(stale.reason, /HIT.*Purge/u);
  assert.equal(classifyEdge(file, { status: 403, total: null, cache: null }).verdict, "unverified");
  assert.equal(classifyEdge(file, { error: "timeout" }).verdict, "unverified");
});

test("only files the bucket has are read through the edge, one byte at a time", async () => {
  const files = [
    { url: `${MIRROR}present`, size: 3, origin: "m" },
    { url: `${MIRROR}gone`, size: null, origin: "m" },
    { url: `${MIRROR}blocked`, size: null, origin: "m" },
    { url: `${MIRROR}offline`, size: null, origin: "m" },
    { url: `${MIRROR}stale`, size: 9, origin: "m" },
  ];
  const requests = [];
  const fetchImpl = async (url, init) => {
    const name = url.slice(MIRROR.length);
    requests.push(`${init.method} ${name} ${init.headers?.Range ?? ""}`.trim());
    if (name === "gone") return response(404);
    if (name === "blocked") return response(403);
    if (name === "offline") throw new Error("getaddrinfo ENOTFOUND");
    if (init.method === "HEAD") return response(200, { "Content-Length": name === "present" ? 3 : 9 });
    if (name === "stale") return response(404, { "cf-cache-status": "HIT" });
    return response(206, { "Content-Range": "bytes 0-0/3", "cf-cache-status": "HIT" });
  };
  const results = await checkFiles(files, fetchImpl, 1);
  assert.deepEqual(
    results.map((result) => result.verdict),
    ["ok", "missing", "unverified", "unverified", "stale-edge"],
  );
  assert.deepEqual(requests, [
    "HEAD present",
    "GET present bytes=0-0",
    "HEAD gone",
    "HEAD blocked",
    "HEAD offline",
    "HEAD stale",
    "GET stale bytes=0-0",
  ]);
  const report = formatReport(results, true);
  assert.equal(report.errors.length, 2);
  assert.match(report.errors[0], /^::error title=Mirror file missing::missing: https:\/\/mirrors\.oleafly\.com\/gone/u);
  assert.match(report.errors[1], /^::error title=Mirror file stale-edge::stale edge 404: https:\/\/mirrors\.oleafly\.com\/stale/u);
  assert.equal(report.output.filter((line) => line.startsWith("::warning")).length, 2);
  assert.equal(report.output.at(-1), "5 mirror files: 1 present, 2 missing or wrong, 2 unverified");
});

test("arguments", () => {
  assert.equal(parseArgs(["--root", "/tmp/x"]).root, "/tmp/x");
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs(["--list"]).list, true);
  assert.equal(parseArgs([]).list, false);
  assert.throws(() => parseArgs(["--nope"]), /unknown argument/u);
});
