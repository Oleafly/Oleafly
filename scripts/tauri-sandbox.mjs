import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const env = { ...process.env };

// Interactive development must never open the user's real Oleafly library.
// CI and e2e callers already provide their own temporary OLEAFLY_DATA_DIR, so
// preserve an explicit value and only supply the persistent local sandbox.
if (args[0] === "dev" && !env.OLEAFLY_DATA_DIR) {
  env.OLEAFLY_DATA_DIR = join(homedir(), ".oleafly-dev");
  process.stderr.write(`Oleafly dev library: ${env.OLEAFLY_DATA_DIR}\n`);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const tauriCli = join(scriptDir, "..", "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(process.execPath, [tauriCli, ...args], {
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  process.stderr.write(`Could not start the Tauri CLI: ${error.message}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
