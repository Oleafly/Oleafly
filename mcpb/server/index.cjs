#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ARGS = ["mcp", "--bridge", "always"];

const NOT_FOUND =
  "Can't find Oleafly's oleafly command. Install Oleafly from https://oleafly.com " +
  "and open it once, or choose the command in this extension's settings.\n";

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function candidates({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
} = {}) {
  const windows = platform === "win32";
  const join = windows ? path.win32.join : path.posix.join;
  const exe = windows ? ".exe" : "";
  const list = [];

  const chosen = env.OLEAFLY_CLI;
  if (chosen && !chosen.includes("${")) list.push(chosen);

  const data = env.OLEAFLY_DATA_DIR || join(home, ".oleafly");
  list.push(join(data, "cli", "bin", `oleafly${exe}`));

  const searchPath = env.PATH || env.Path || "";
  for (const folder of searchPath.split(windows ? ";" : ":")) {
    if (folder) list.push(join(folder, `oleafly${exe}`));
  }

  if (platform === "darwin") {
    for (const apps of ["/Applications", join(home, "Applications")]) {
      list.push(join(apps, "Oleafly.app", "Contents", "MacOS", "oleafly-cli"));
    }
  } else if (windows) {
    const local = env.LOCALAPPDATA || join(home, "AppData", "Local");
    list.push(join(local, "Oleafly", "oleafly-cli.exe"));
    for (const programs of [env.ProgramFiles, env["ProgramFiles(x86)"]]) {
      if (programs) list.push(join(programs, "Oleafly", "oleafly-cli.exe"));
    }
  } else {
    list.push("/usr/bin/oleafly-cli");
  }

  return [...new Set(list)];
}

function main() {
  const command = candidates().find(isFile);
  if (!command) {
    process.stderr.write(NOT_FOUND);
    process.exit(1);
  }
  const child = spawn(command, ARGS, { stdio: "inherit", windowsHide: true });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    process.stderr.write(`Couldn't start ${command}: ${error.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

if (require.main === module) main();

module.exports = { ARGS, candidates };
