#!/usr/bin/env node
//
// Re-sign the bundled Tinymist binary so the macOS app can be notarized.
//
// Apple's notary service unpacks archives inside the bundle and validates every
// Mach-O it finds. The Tinymist archive we stage as a Tauri resource holds an
// unsigned upstream binary, so notarization rejects the whole app with:
//
//     The binary is not signed with a valid Developer ID certificate.
//     The signature does not include a secure timestamp.
//     The executable does not have the hardened runtime enabled.
//
// So: extract the pinned binary, sign it with our Developer ID under the
// hardened runtime with a secure timestamp, rebuild the archive, and re-pin the
// manifest to what we actually ship.
//
// KNOWN WEAKNESS (tracked in docs/language-server-toolchain.md): re-pinning
// means the manifest no longer records upstream's published checksum for this
// target, so the bundled copy is verified against ourselves rather than against
// upstream. The upstream digest is preserved under `upstreamArchiveSha256` for
// auditing, but nothing enforces it after this rewrite. The durable fix is to
// carry both digests and verify the download against upstream while verifying
// the bundled copy against the re-signed hash.
//
// Runs only on macOS, only when a signing identity is configured. Without one
// it exits quietly so unsigned local builds keep working.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resourceArchivePath } from "./fetch-language-servers.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const MANIFEST_PATH = join(SCRIPT_DIR, "language-servers", "manifest.json");
const TARGET = "aarch64-apple-darwin";

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const run = (file, args, options = {}) =>
  execFileSync(file, args, { stdio: "inherit", ...options });

if (process.platform !== "darwin") {
  console.log("sign-bundled-tinymist: not macOS, nothing to do");
  process.exit(0);
}

const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
if (!identity) {
  console.log(
    "sign-bundled-tinymist: APPLE_SIGNING_IDENTITY unset, leaving the archive as fetched",
  );
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const entry = manifest.servers.tinymist.targets[TARGET];
if (!entry) throw new Error(`manifest has no ${TARGET} entry for tinymist`);

// resourceRelativePath is relative to src-tauri, and the safety checks that
// resolver applies are worth keeping rather than re-deriving the path here.
const archivePath = resourceArchivePath(entry);
const staged = readFileSync(archivePath);
// Refuse to touch anything other than the exact bytes the fetch step verified
// against upstream. Signing an archive we cannot vouch for would launder an
// unverified payload into a signed bundle.
const stagedDigest = sha256(staged);
const expected = entry.upstreamArchiveSha256 ?? entry.archiveSha256;
if (stagedDigest !== expected) {
  throw new Error(
    `staged archive is not the pinned upstream payload:\n` +
      `  expected ${expected}\n  actual   ${stagedDigest}`,
  );
}

const workspace = mkdtempSync(join(tmpdir(), "oleafly-tinymist-"));
run("tar", ["-xzf", archivePath, "-C", workspace]);

const binaryPath = join(workspace, entry.archiveMember);
run("codesign", [
  "--force",
  // Hardened runtime and a secure timestamp are both notarization
  // requirements, and both are missing from the upstream binary.
  "--options",
  "runtime",
  "--timestamp",
  "--sign",
  identity,
  binaryPath,
]);
run("codesign", ["--verify", "--strict", "--verbose=2", binaryPath]);

// Rebuild with the same internal layout the manifest pins, so extraction at
// runtime still finds `archiveMember` exactly where it expects it.
const memberRoot = entry.archiveMember.split("/")[0];
run("tar", ["--format", "ustar", "-czf", archivePath, "-C", workspace, memberRoot], {
  // codesign attaches extended attributes, and macOS tar then emits an
  // AppleDouble "._" sidecar entry for the signed file. The archive verifier
  // rejects those as unsafe entries, and macOS tar hides them from -t listings,
  // so the archive looks correct while failing verification. ustar is requested
  // for the same reason: macOS tar writes pax extended headers eagerly, and the
  // verifier accepts only regular-file and directory entries.
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});

const resigned = readFileSync(archivePath);
const signedBinary = readFileSync(binaryPath);
if (entry.upstreamArchiveSha256 === undefined) {
  entry.upstreamArchiveSha256 = entry.archiveSha256;
  entry.upstreamBinarySha256 = entry.binarySha256;
}
entry.archiveSha256 = sha256(resigned);
entry.archiveSize = resigned.length;
entry.binarySha256 = sha256(signedBinary);
entry.binarySize = signedBinary.length;
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `sign-bundled-tinymist: signed and re-pinned ${entry.asset}\n` +
    `  upstream archive ${entry.upstreamArchiveSha256}\n` +
    `  bundled  archive ${entry.archiveSha256}`,
);
