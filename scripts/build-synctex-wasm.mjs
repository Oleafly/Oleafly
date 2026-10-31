#!/usr/bin/env node
// Builds the browser app's SyncTeX (crates/oleafly-synctex-wasm) for
// WebAssembly and copies it to web/src/synctex/oleafly_synctex.wasm, where
// the web build picks it up. `pnpm web:dev`, `web:test` and `web:build` run
// it first; cargo makes a repeat run a quick no-op.
//
// OLEAFLY_SYNCTEX_WASM_PREBUILT=1 skips cargo and only checks that the file
// is there, for a build stage that copied it in from a Rust stage.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = "wasm32-unknown-unknown";
const PROFILE = "wasm-release";
const CRATE = "oleafly-synctex-wasm";
const output = path.join(repo, "web/src/synctex/oleafly_synctex.wasm");

function fail(message) {
  console.error(`synctex wasm: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, encoding: "utf8", ...options });
  if (result.error?.code === "ENOENT") {
    fail(`\`${command}\` isn't on PATH. The browser app's SyncTeX is built from Rust; install it with rustup (https://rustup.rs).`);
  }
  return result;
}

function report(file) {
  const bytes = readFileSync(file);
  const kib = (size) => `${(size / 1024).toFixed(1)} KiB`;
  console.log(`synctex wasm: ${path.relative(repo, file)} ${kib(bytes.length)} (${kib(gzipSync(bytes, { level: 9 }).length)} gzipped)`);
}

if (process.env.OLEAFLY_SYNCTEX_WASM_PREBUILT === "1") {
  if (!existsSync(output)) {
    fail(`OLEAFLY_SYNCTEX_WASM_PREBUILT is set, but ${path.relative(repo, output)} is missing.`);
  }
  report(output);
  process.exit(0);
}

// rustup reads rust-toolchain.toml here, so this asks about the pinned
// toolchain. Without rustup, cargo's own error has to do.
const targets = run("rustup", ["target", "list", "--installed"]);
if (targets.status === 0 && !targets.stdout.split(/\s+/).includes(TARGET)) {
  fail(`the ${TARGET} target isn't installed for this toolchain. Add it with:\n\n    rustup target add ${TARGET}\n`);
}

const metadata = run("cargo", ["metadata", "--format-version", "1", "--no-deps"], { maxBuffer: 64 * 1024 * 1024 });
if (metadata.status !== 0) {
  fail(`\`cargo metadata\` failed:\n${metadata.stderr}`);
}
const targetDir = JSON.parse(metadata.stdout).target_directory;

const cargoHome = process.env.CARGO_HOME ?? path.join(homedir(), ".cargo");
const rustflagsKey = `CARGO_TARGET_${TARGET.toUpperCase().replaceAll("-", "_")}_RUSTFLAGS`;
const rustflags = [process.env[rustflagsKey], `--remap-path-prefix=${cargoHome}=/cargo`, `--remap-path-prefix=${repo}=/oleafly`]
  .filter(Boolean)
  .join(" ");
const build = run("cargo", ["build", "-p", CRATE, "--target", TARGET, "--profile", PROFILE], {
  stdio: "inherit",
  env: { ...process.env, [rustflagsKey]: rustflags },
});
if (build.status !== 0) {
  fail(`\`cargo build -p ${CRATE}\` failed.`);
}

const built = path.join(targetDir, TARGET, PROFILE, `${CRATE.replaceAll("-", "_")}.wasm`);
if (!existsSync(built) || statSync(built).size === 0) {
  fail(`cargo finished, but ${built} is missing.`);
}
mkdirSync(path.dirname(output), { recursive: true });
copyFileSync(built, output);
report(output);
