"use strict";

// Run with: node --test mcpb/server/index.test.cjs
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ARGS, candidates } = require("./index.cjs");

const LAUNCHER = path.join(__dirname, "index.cjs");

test("macOS looks at the chosen command, the app's link, PATH, then the app", () => {
  const list = candidates({
    platform: "darwin",
    home: "/Users/ada",
    env: { OLEAFLY_CLI: "/opt/oleafly", PATH: "/usr/local/bin:/opt/homebrew/bin" },
  });
  assert.deepEqual(list, [
    "/opt/oleafly",
    "/Users/ada/.oleafly/cli/bin/oleafly",
    "/usr/local/bin/oleafly",
    "/opt/homebrew/bin/oleafly",
    "/Applications/Oleafly.app/Contents/MacOS/oleafly-cli",
    "/Users/ada/Applications/Oleafly.app/Contents/MacOS/oleafly-cli",
  ]);
  // MacOS/oleafly is the app itself, never the command.
  assert.ok(!list.some((file) => file.endsWith("/MacOS/oleafly")));
});

test("an empty setting arrives as a placeholder and is skipped", () => {
  const list = candidates({
    platform: "linux",
    home: "/home/ada",
    env: { OLEAFLY_CLI: "${user_config.oleafly_command}", PATH: "" },
  });
  assert.deepEqual(list, ["/home/ada/.oleafly/cli/bin/oleafly", "/usr/bin/oleafly-cli"]);
});

test("OLEAFLY_DATA_DIR moves the app's link like it moves the app's data", () => {
  const list = candidates({
    platform: "linux",
    home: "/home/ada",
    env: { OLEAFLY_DATA_DIR: "/data/oleafly", PATH: "/usr/bin" },
  });
  assert.deepEqual(list, [
    "/data/oleafly/cli/bin/oleafly",
    "/usr/bin/oleafly",
    "/usr/bin/oleafly-cli",
  ]);
});

test("Windows uses .exe, ; between PATH folders, and both install folders", () => {
  const list = candidates({
    platform: "win32",
    home: "C:\\Users\\ada",
    env: {
      Path: "C:\\Windows;C:\\Users\\ada\\AppData\\Local\\Oleafly\\bin",
      LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
    },
  });
  assert.deepEqual(list, [
    "C:\\Users\\ada\\.oleafly\\cli\\bin\\oleafly.exe",
    "C:\\Windows\\oleafly.exe",
    "C:\\Users\\ada\\AppData\\Local\\Oleafly\\bin\\oleafly.exe",
    "C:\\Users\\ada\\AppData\\Local\\Oleafly\\oleafly-cli.exe",
    "C:\\Program Files\\Oleafly\\oleafly-cli.exe",
  ]);
});

test("the same folder listed twice is checked once", () => {
  const list = candidates({ platform: "linux", home: "/h", env: { PATH: "/usr/bin:/usr/bin" } });
  assert.equal(list.filter((file) => file === "/usr/bin/oleafly").length, 1);
});

test(
  "runs the command with `mcp --bridge always` and passes stdio and the exit code through",
  { skip: process.platform === "win32" && "uses a shell-script stand-in" },
  () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "oleafly-mcpb-"));
    try {
      const fake = path.join(folder, "oleafly");
      fs.writeFileSync(
        fake,
        '#!/bin/sh\nread -r line\nprintf \'{"args":"%s","stdin":%s}\\n\' "$*" "$line"\nexit 7\n',
      );
      fs.chmodSync(fake, 0o755);
      const run = spawnSync(process.execPath, [LAUNCHER], {
        input: '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n',
        env: { ...process.env, OLEAFLY_CLI: fake },
        encoding: "utf8",
      });
      assert.equal(run.status, 7);
      const reply = JSON.parse(run.stdout);
      assert.equal(reply.args, ARGS.join(" "));
      assert.equal(reply.stdin.method, "initialize");
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  },
);

test("says how to fix it when no command is found", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oleafly-mcpb-home-"));
  try {
    const env = { HOME: home, USERPROFILE: home, PATH: "", LOCALAPPDATA: home };
    const defaults = candidates({ env, home });
    if (defaults.some((file) => fs.existsSync(file))) {
      t.skip("Oleafly is installed on this machine");
      return;
    }
    const run = spawnSync(process.execPath, [LAUNCHER], { env, encoding: "utf8" });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Install Oleafly from https:\/\/oleafly\.com/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
