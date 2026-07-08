import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { platform as osPlatform, arch as osArch, version as osVersion } from "@tauri-apps/plugin-os";
import { appVersion, readAppLog } from "@/lib/tauri";

const NEW_ISSUE_URL = "https://github.com/prajwal-svm/OpenLeaf/issues/new";
/** Keep the assembled body comfortably under GitHub's new-issue URL limit. */
const MAX_LOG_BYTES = 5000;
const MAX_BODY = 6500;

/** Gather app version + OS + time into a short markdown block. */
async function systemBlock(): Promise<string> {
  const lines: string[] = [];
  try {
    lines.push(`- OpenLeaf: v${await appVersion()}`);
  } catch {
    /* ignore */
  }
  if (isTauri()) {
    try {
      lines.push(`- OS: ${osPlatform()} ${osArch()} (${osVersion()})`);
    } catch {
      /* ignore */
    }
  }
  lines.push(`- Time: ${new Date().toISOString()}`);
  return lines.join("\n");
}

/**
 * Open a pre-filled GitHub issue on the OpenLeaf repo with the error, system
 * info, and the tail of app.log. The user reviews and submits (no token needed,
 * and they see exactly what's shared). Best-effort; never throws.
 */
export async function reportCrashToGithub(errorTitle?: string): Promise<void> {
  const title = errorTitle ? `Crash: ${errorTitle}` : "Crash report";
  const sections: string[] = [
    "<!-- Please review the details below, then click Submit. -->",
    `### System\n${await systemBlock()}`,
  ];
  if (errorTitle) {
    sections.push(`### Error\n\`\`\`\n${errorTitle}\n\`\`\``);
  }
  try {
    const log = (await readAppLog(MAX_LOG_BYTES)).trim();
    if (log) sections.push(`### Recent log (app.log)\n\`\`\`\n${log}\n\`\`\``);
  } catch {
    /* log may be unreadable */
  }
  let body = sections.join("\n\n");
  if (body.length > MAX_BODY) {
    body = `${body.slice(0, MAX_BODY)}\n…(truncated — attach ~/.openleaf/app.log for the full log)`;
  }
  const url = `${NEW_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=crash`;
  try {
    await open(url);
  } catch {
    /* nothing more we can do */
  }
}
