import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const CLASS_STRING = /"[^"\n]*"|`[^`]*`/g;

const SPINNER_HOME = "src/components/ui/spinner.tsx";
const SETTINGS_ROW_HOME = "src/components/settings/SettingsRow.tsx";
const KIT_DIR = "src/components/ui/";
const CODE_BLOCK_HOME = "src/components/ui/code-block.tsx";
const COPYABLE_BLOCK_HOME = "src/components/ui/copyable-block.tsx";
const CODE_BLOCK_IMPORT = /from "(?:@\/components\/ui|\.)\/(?:code|copyable)-block"/;
const PLAIN_TEXT_BLOCKS: Record<string, string> = {
  "src/components/ErrorBoundary.tsx": "a crash report's stack trace",
  "src/components/research/LinkedFoldersSection.tsx": "a linked file's text preview",
  "src/components/research/TaskOutputsSection.tsx": "a task output's text preview",
  "src/components/research/tasks/TaskDetailDialog.tsx": "a task's log output",
  "src/components/research/workspace/ResearchRootsPanel.tsx": "a research file's text preview",
  "src/components/ui/mermaid-diagram.tsx": "the failed diagram's source, already inside the chat's CopyableBlock",
  "src/components/settings/TexPackagesSection.tsx": "a package search error message",
  "src/components/settings/ai/AgentProgramField.tsx": "a program check's diagnostic output",
  "src/components/layout/UpdateDialog.tsx": "an update error message",
  "src/components/typst-upgrade/TypstUpgradeDialog.tsx": "a failed build's log",
  "src/components/ai/ToolConfirm.tsx": "a command or file waiting for approval inside the approval card",
  "src/components/ai/activity/ResearchToolCard.tsx": "a tool result preview",
  "src/components/editor/compile-log-details.tsx": "compile log output",
  "src/components/editor/LogPane.tsx": "compile log output",
  "src/components/preflight/ReaderViewDialog.tsx": "a reader view of the document's text",
};
const PILL_ALLOWLIST: Record<string, string> = {
  "src/components/ai/chat-parts.tsx":
    "the plan approval pill uses the violet plan tone the rest of the chat uses for plan mode",
};

function sourceFiles(): string[] {
  return readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
    .filter((path) => SOURCE_FILE.test(path) && !TEST_FILE.test(path))
    .map((path) => join("src", path).split(sep).join("/"));
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function tokens(classString: string): Set<string> {
  return new Set(classString.replace(/^["`]|["`]$/g, "").split(/\s+/).filter(Boolean));
}

function findRawSpinners(text: string): number[] {
  const lines: number[] = [];
  for (const match of text.matchAll(/<(?:Loader2|LoaderCircle|Loader)\b/g)) {
    const end = text.indexOf(">", match.index);
    const element = text.slice(match.index, end < 0 ? undefined : end + 1);
    if (/animate-spin/.test(element)) lines.push(lineOf(text, match.index));
  }
  return lines;
}

const SETTINGS_ROW_TOKENS = ["flex", "items-center", "justify-between", "rounded-lg", "border", "bg-card", "p-3"];

function isSettingsRowCluster(classString: string): boolean {
  const set = tokens(classString);
  return SETTINGS_ROW_TOKENS.every((token) => set.has(token));
}

const PILL_TEXT = /^text-\[(?:(?:9|10|11)px|0\.5625rem|0\.625rem|0\.6875rem)\]$/;
const PILL_PADDING = /^px-(1|1\.5|2|2\.5)$/;
const PILL_VERTICAL = /^py-(0\.5|px)$/;
const PILL_TINT =
  /^bg-(muted|primary|secondary|destructive|(emerald|amber|red|green|sky|blue|violet|yellow|orange|rose)-\d+)(\/\d+)?$/;
const INTERACTIVE = /^(hover|focus-visible|focus|enabled:hover|group-hover):/;

function isHandWrittenPill(classString: string): boolean {
  const list = [...tokens(classString)];
  if (!list.includes("rounded-full")) return false;
  if (!list.some((token) => PILL_PADDING.test(token))) return false;
  if (!list.some((token) => PILL_TEXT.test(token))) return false;
  if (list.some((token) => token === "border" || token.startsWith("border-"))) return false;
  if (list.some((token) => INTERACTIVE.test(token))) return false;
  return list.some((token) => PILL_TINT.test(token) || PILL_VERTICAL.test(token));
}

function classStringOffenders(
  files: string[],
  matches: (classString: string) => boolean,
  skip: (path: string) => boolean,
): string[] {
  return files
    .filter((path) => !skip(path))
    .flatMap((path) => {
      const text = read(path);
      return [...text.matchAll(CLASS_STRING)]
        .filter(([classString]) => matches(classString))
        .map((match) => `${path}:${lineOf(text, match.index)}`);
    });
}

describe("design system guards", () => {
  const files = sourceFiles();

  it("scans the whole app", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(SPINNER_HOME);
    expect(files).toContain(SETTINGS_ROW_HOME);
  });

  it("recognises a hand-rolled spinner and leaves still icons alone", () => {
    expect(findRawSpinners('<Loader2 className="size-4 animate-spin" />')).toEqual([1]);
    expect(findRawSpinners('\n<LoaderCircle\n  aria-hidden\n  className={cn("size-3", "animate-spin")}\n/>')).toEqual([2]);
    expect(findRawSpinners('<Loader2 className="size-4" /> <Spinner size="sm" />')).toEqual([]);
    expect(findRawSpinners('<RefreshCw className={cn("size-4", busy && "animate-spin")} />')).toEqual([]);
  });

  it("draws every loading spinner through the kit Spinner", () => {
    const offenders = files
      .filter((path) => path !== SPINNER_HOME)
      .flatMap((path) => findRawSpinners(read(path)).map((line) => `${path}:${line}`));
    expect(offenders).toEqual([]);
  });

  it("recognises the settings row card in any token order", () => {
    expect(isSettingsRowCluster('"flex items-center justify-between gap-4 rounded-lg border bg-card p-3"')).toBe(true);
    expect(isSettingsRowCluster('"p-3 bg-card border rounded-lg justify-between items-center flex gap-2"')).toBe(true);
    expect(isSettingsRowCluster('"rounded-lg border bg-card p-3"')).toBe(false);
    expect(isSettingsRowCluster('"flex items-center justify-between rounded-lg border bg-background p-3"')).toBe(false);
  });

  it("shows code only through CodeBlock, which brings the hover copy button", () => {
    const offenders = files
      .filter((path) => path !== CODE_BLOCK_HOME && path !== COPYABLE_BLOCK_HOME && !Object.hasOwn(PLAIN_TEXT_BLOCKS, path))
      .flatMap((path) => {
        const text = read(path);
        if (CODE_BLOCK_IMPORT.test(text)) return [];
        return [...text.matchAll(/<pre\b/g)].map((match) => `${path}:${lineOf(text, match.index)}`);
      });
    expect(offenders).toEqual([]);
  });

  it("keeps the plain text block allowlist current", () => {
    const stale = Object.keys(PLAIN_TEXT_BLOCKS).filter(
      (path) => !files.includes(path) || !/<pre\b/.test(read(path)),
    );
    expect(stale).toEqual([]);
    expect(files).toContain(CODE_BLOCK_HOME);
    expect(files).toContain(COPYABLE_BLOCK_HOME);
  });

  it("builds settings rows only through SettingsRow", () => {
    expect(
      classStringOffenders(files, isSettingsRowCluster, (path) => path === SETTINGS_ROW_HOME),
    ).toEqual([]);
  });

  it("recognises a hand-written status pill and leaves chips and buttons alone", () => {
    expect(isHandWrittenPill('"rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600"')).toBe(true);
    expect(isHandWrittenPill('"shrink-0 rounded-full bg-muted px-2 text-[11px] text-muted-foreground"')).toBe(true);
    expect(isHandWrittenPill('"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"')).toBe(true);
    expect(isHandWrittenPill('"rounded-full border border-primary/30 bg-primary/10 px-1.5 text-[9px]"')).toBe(false);
    expect(isHandWrittenPill('"rounded-full bg-muted px-2 py-0.5 text-[10px] hover:bg-accent"')).toBe(false);
    expect(isHandWrittenPill('"rounded-full bg-muted px-3 py-1 text-xs"')).toBe(false);
    expect(isHandWrittenPill('"size-2 rounded-full bg-emerald-500"')).toBe(false);
  });

  it("draws status pills through Badge variants", () => {
    const offenders = classStringOffenders(
      files,
      isHandWrittenPill,
      (path) => path.startsWith(KIT_DIR) || path in PILL_ALLOWLIST,
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every pill allowlist entry justified and still needed", () => {
    for (const [path, reason] of Object.entries(PILL_ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(20);
      const text = read(path);
      expect([...text.matchAll(CLASS_STRING)].some(([value]) => isHandWrittenPill(value))).toBe(true);
    }
  });
});
