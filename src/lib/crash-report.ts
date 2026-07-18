import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { platform as osPlatform, arch as osArch, version as osVersion } from "@tauri-apps/plugin-os";
import { appVersion, readAppLog } from "@/lib/tauri";

const NEW_ISSUE_URL = "https://github.com/prajwal-svm/OpenLeaf/issues/new";
// Keep the assembled body comfortably under GitHub's new-issue URL limit.
const MAX_LOG_BYTES = 5000;
// Cap the *encoded* body length, since percent-encoding expands the raw text
// 2-3x and it is the encoded URL that GitHub limits (~8KB). We keep the whole
// URL comfortably under that.
const MAX_ENCODED_BODY = 7000;
const TRUNCATION_MARKER = "\n…(truncated, attach ~/.openleaf/app.log for the full log)";

async function systemBlock(): Promise<string> {
  const lines: string[] = [];
  try {
    lines.push(`- Oleafly: v${await appVersion()}`);
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

// No token needed: the user reviews and submits the pre-filled issue
// themselves, so they see exactly what's shared. Best-effort; never throws.
export async function reportCrashToGithub(errorTitle?: string): Promise<void> {
  const title = errorTitle ? `Crash: ${errorTitle}` : "Crash report";
  const sections: string[] = [
    "<!-- Please review the details below, then click Submit. -->",
    `### System\n${await systemBlock()}`,
  ];
  if (errorTitle) {
    sections.push(`### Error\n\`\`\`\n${errorTitle}\n\`\`\``);
  }
  let log = "";
  try {
    log = (await readAppLog(MAX_LOG_BYTES)).trim();
  } catch {
    /* log may be unreadable */
  }

  // Trim only the log tail until the *encoded* body fits under the cap; other
  // sections stay intact.
  const logSection = (text: string) => `### Recent log (app.log)\n\`\`\`\n${text}\n\`\`\``;
  const build = (logText: string) =>
    (logText ? [...sections, logSection(logText)] : sections).join("\n\n");

  let body = build(log);
  if (log && encodeURIComponent(body).length > MAX_ENCODED_BODY) {
    // Binary-search the longest log prefix that fits; the head is more useful
    // than the tail for a crash trace.
    let lo = 0;
    let hi = log.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = build(log.slice(0, mid) + TRUNCATION_MARKER);
      if (encodeURIComponent(candidate).length <= MAX_ENCODED_BODY) lo = mid;
      else hi = mid - 1;
    }
    body = build(log.slice(0, lo) + TRUNCATION_MARKER);
  }
  const url = `${NEW_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=crash`;
  try {
    await open(url);
  } catch {
    /* nothing more we can do */
  }
}
