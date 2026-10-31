// xterm's `windowsPty` option: telling it ConPTY and the Windows build stops
// a second reflow on resize. The build comes from the OS plugin.
import { version as osVersion } from "@tauri-apps/plugin-os";
import { type TerminalPlatform, terminalPlatform } from "./terminal-keys";

export function windowsBuildNumber(version: string): number | undefined {
  const match = /^\d+\.\d+\.(\d+)/.exec(version.trim());
  if (!match) return undefined;
  const build = Number(match[1]);
  return Number.isFinite(build) && build > 0 ? build : undefined;
}

export function windowsPtyOption(
  platform: TerminalPlatform = terminalPlatform(),
  version: () => string = osVersion,
): { backend: "conpty"; buildNumber?: number } | undefined {
  if (platform !== "windows") return undefined;
  let buildNumber: number | undefined;
  try {
    buildNumber = windowsBuildNumber(version());
  } catch {
    buildNumber = undefined;
  }
  return buildNumber === undefined ? { backend: "conpty" } : { backend: "conpty", buildNumber };
}
