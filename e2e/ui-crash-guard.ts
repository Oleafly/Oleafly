import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TestInfo } from "@playwright/test";

export const ALLOWS_UI_CRASH = "allows-ui-crash";
export const UI_CRASH_MARKERS = ["UI crash:", "Maximum update depth"];
export const CRASH_BOUNDARY_SELECTOR =
  '[data-testid="error-boundary"],[data-testid="surface-error-boundary"]';
const APP_LOG_ENTRY = /^\[\d+\] /;
const CRASH_STACK_LINES = 6;
const CRASH_ENTRIES_SHOWN = 5;
const CRASH_LINE_CHARS = 400;
const MAX_LOG_SCAN_BYTES = 16 << 20;
const BOUNDARY_PROBE_LIMIT_MS = 10_000;
const BOUNDARY_PROBE = `(function(){
  const element = document.querySelector(${JSON.stringify(CRASH_BOUNDARY_SELECTOR)});
  if (!element) return "";
  const text = (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 300);
  return (element.getAttribute("data-testid") || "crash fallback") + ": " + text;
})()`;

export interface EvaluatingPage {
  evaluate<T = unknown>(expression: string): Promise<T>;
}

export function appLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const dataDir = env.OLEAFLY_DATA_DIR;
  return join(dataDir ? dataDir : join(homedir(), ".oleafly"), "app.log");
}

export function appLogSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function appLogSince(path: string, offset: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(size < offset ? 0 : offset, size - MAX_LOG_SCAN_BYTES);
    const length = size - start;
    if (length <= 0) return "";
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const count = readSync(fd, buffer, filled, length - filled, start + filled);
      if (count <= 0) break;
      filled += count;
    }
    return buffer.subarray(0, filled).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function uiCrashEntries(log: string): string[] {
  const lines = log.split(/\r?\n/);
  const entries: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!UI_CRASH_MARKERS.some((marker) => lines[index].includes(marker))) continue;
    const entry = [lines[index].slice(0, CRASH_LINE_CHARS)];
    while (
      entry.length <= CRASH_STACK_LINES &&
      index + 1 < lines.length &&
      lines[index + 1].trim() !== "" &&
      !APP_LOG_ENTRY.test(lines[index + 1])
    ) {
      index++;
      entry.push(`    ${lines[index].trim().slice(0, CRASH_LINE_CHARS)}`);
    }
    entries.push(entry.join("\n"));
  }
  return entries;
}

export async function crashBoundaryOnPage(
  page: EvaluatingPage,
  limitMs = BOUNDARY_PROBE_LIMIT_MS,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const found = await Promise.race([
      page.evaluate<string>(BOUNDARY_PROBE),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(""), limitMs);
      }),
    ]);
    return typeof found === "string" ? found : "";
  } catch {
    return "";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function allowsUiCrash(testInfo: Pick<TestInfo, "annotations">): boolean {
  return testInfo.annotations.some((annotation) => annotation.type === ALLOWS_UI_CRASH);
}

export async function uiCrashProblems(
  page: EvaluatingPage | null,
  logPath: string,
  offset: number,
): Promise<string[]> {
  const problems: string[] = [];
  const boundary = page ? await crashBoundaryOnPage(page) : "";
  if (boundary) problems.push(`The window is showing an error boundary: ${boundary}`);
  const entries = uiCrashEntries(appLogSince(logPath, offset));
  if (entries.length > 0) {
    const hidden = entries.length - CRASH_ENTRIES_SHOWN;
    problems.push(
      [
        `${logPath} recorded ${entries.length} UI crash entr${entries.length === 1 ? "y" : "ies"} during this test:`,
        ...entries.slice(0, CRASH_ENTRIES_SHOWN),
        ...(hidden > 0 ? [`(${hidden} more not shown)`] : []),
      ].join("\n"),
    );
  }
  return problems;
}

export function uiCrashFailure(problems: readonly string[]): Error {
  return new Error(
    [
      "The app caught a UI crash during this test. Fix the crash, or give the test an",
      `{ type: "${ALLOWS_UI_CRASH}", description: "<why>" } annotation if it triggers one on purpose.`,
      ...problems,
    ].join("\n"),
  );
}
