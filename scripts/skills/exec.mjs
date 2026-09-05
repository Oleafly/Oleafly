import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

const FIXED_DIRECTORIES = ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"];

const OVERRIDES = { python3: process.env.OLEAFLY_SKILLS_PYTHON };

function absoluteOverride(name) {
  const value = OVERRIDES[name];
  if (!value || !value.startsWith("/")) return null;
  try {
    accessSync(value, constants.X_OK);
    return value;
  } catch {
    return null;
  }
}

export function resolveCommand(name) {
  const override = absoluteOverride(name);
  if (override) return override;
  for (const directory of FIXED_DIRECTORIES) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function runCommand(name, args, options = {}) {
  const command = resolveCommand(name);
  if (!command) return { status: null, error: new Error(`${name} is not installed in a fixed system directory`) };
  return spawnSync(command, args, {
    ...options,
    env: { PATH: FIXED_DIRECTORIES.join(":"), LANG: "C.UTF-8" },
  });
}
