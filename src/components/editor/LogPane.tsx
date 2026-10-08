import {
  createContext,
  lazy,
  memo,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { parseLatexLog, type LogDiagnostic } from "@oleafly/latex";
import { useCompileStore, type CompileState } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import type { CompileError } from "@/lib/tauri";
import { openFileAndGotoLine } from "@/features/synctex";
import { cn } from "@/lib/utils";
import { objectKey } from "@/lib/react-key";
import { Tooltip } from "@/components/ui/tooltip";
import { useDelegatedTooltips } from "@/components/ui/delegated-tooltip";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { useDisplayText, useDisplayTextRanges } from "@/lib/display-path";
import { useOverlayScrollbar } from "@/hooks/use-overlay-scrollbar";
import {
  compileLogViewer,
  LOG_TOKEN_RE,
  logLineCategory,
  logTokenClass,
  setLogHomeRanges,
  syncLogDocument,
} from "./compile-log-view";
import { MEASURED_WINDOW_ITEM, useMeasuredWindow } from "./use-measured-window";

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

const scrollAnimations = new WeakMap<HTMLElement, number>();

function smoothScrollTo(el: HTMLElement, target: () => number, duration = 700) {
  const startTop = el.scrollTop;
  const startTime = performance.now();
  const token = (scrollAnimations.get(el) ?? 0) + 1;
  scrollAnimations.set(el, token);
  const destination = () => Math.min(Math.max(0, target()), Math.max(0, el.scrollHeight - el.clientHeight));
  function step(now: number) {
    if (scrollAnimations.get(el) !== token) return;
    const t = Math.min(1, (now - startTime) / duration);
    const end = destination();
    el.scrollTop = t < 1 ? startTop + (end - startTop) * easeInOutQuad(t) : end;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function inline(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of line.matchAll(LOG_TOKEN_RE)) {
    if (m.index > last) out.push(<span key={key++}>{line.slice(last, m.index)}</span>);
    const tok = m[0];
    out.push(
      <span key={key++} className={logTokenClass(tok)}>
        {tok}
      </span>
    );
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(<span key={key++}>{line.slice(last)}</span>);
  return out;
}

// Display only: TeX logs name every package file by its absolute path, so home
// paths are shortened here while the copy buttons keep the real text.
function LogText({ text }: Readonly<{ text: string }>) {
  const displayText = useDisplayText();
  const shown = useMemo(() => displayText(text), [displayText, text]);
  const lines = shown.replaceAll("\r", "").split("\n");
  let depth = 0;
  return (
    <>
      {lines.map((ln, index) => {
        const cat = logLineCategory(ln);
        const lineDepth = depth;
        const opens = (ln.match(/\(/g) || []).length;
        const closes = (ln.match(/\)/g) || []).length;
        depth = Math.max(0, depth + opens - closes);
        const indent = Math.min(lineDepth, 8) * 12;

        let body: ReactNode;
        if (cat === "error") body = <span className="text-red-500 font-semibold">{ln}</span>;
        else if (cat === "warn") body = <span className="text-red-400">{ln}</span>;
        else if (cat === "lineref") {
          const m = /^(l\.\d+)(?!\d)(.*)$/.exec(ln);
          body = m ? (
            <>
              <span className="font-semibold text-primary">{m[1]}</span>
              <span className="text-amber-600 dark:text-amber-400">{m[2]}</span>
            </>
          ) : <span className="text-primary">{ln}</span>;
        } else if (cat === "register") {
          body = <span className="text-muted-foreground/40">{inline(ln)}</span>;
        } else {
          body = <span className="text-muted-foreground">{inline(ln)}</span>;
        }

        // Errors/refs flush-left to stand out.
        const pad = cat === "error" || cat === "warn" || cat === "lineref" ? 0 : indent;
        return (
          <span
            // Log lines are an append-oriented, stateless transcript.
            // biome-ignore lint/suspicious/noArrayIndexKey: preserving a line's position is the intended identity
            key={index}
            className="block whitespace-pre-wrap break-words"
            style={{ paddingLeft: pad }}
          >
            {ln === "" ? "\u00A0" : body}
          </span>
        );
      })}
    </>
  );
}

function RawLogViewer({ log }: Readonly<{ log: string }>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownRef = useRef("");
  const latestLog = useRef(log);
  latestLog.current = log;
  const homeRanges = useDisplayTextRanges();
  const latestRanges = useRef(homeRanges);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const first = latestLog.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: first.replaceAll("\r", ""),
        extensions: compileLogViewer(latestRanges.current),
      }),
    });
    viewRef.current = view;
    shownRef.current = first;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    syncLogDocument(view, shownRef.current, log);
    shownRef.current = log;
  }, [log]);

  useLayoutEffect(() => {
    if (latestRanges.current === homeRanges) return;
    latestRanges.current = homeRanges;
    viewRef.current?.dispatch({ effects: setLogHomeRanges.of(homeRanges) });
  }, [homeRanges]);

  return (
    <div
      ref={hostRef}
      data-testid="compile-log-raw"
      className="select-text border-t border-sidebar-border px-3 py-3 font-mono text-[11px] leading-relaxed"
    />
  );
}

const EXCERPT_LINES = 12;
const NEWLINE = 10;
const CARRIAGE_RETURN = 13;

function lineStartOf(log: string, line: string): number {
  for (let at = log.indexOf(line); at !== -1; at = log.indexOf(line, at + 1)) {
    let before = at - 1;
    while (before >= 0 && log.codePointAt(before) === CARRIAGE_RETURN) before--;
    if (before >= 0 && log.codePointAt(before) !== NEWLINE) continue;
    let after = at + line.length;
    while (after < log.length && log.codePointAt(after) === CARRIAGE_RETURN) after++;
    if (after === log.length || log.codePointAt(after) === NEWLINE) return at;
  }
  return -1;
}

function extractErrorExcerpt(log: string, message: string): string {
  const start = lineStartOf(log, `! ${message}`);
  if (start === -1) return "";
  const excerpt: string[] = [];
  let position = start;
  while (excerpt.length < EXCERPT_LINES) {
    const newline = log.indexOf("\n", position);
    const end = newline === -1 ? log.length : newline;
    const ln = log.slice(position, end).replaceAll("\r", "");
    if (excerpt.length > 0 && ln.startsWith("!")) break;
    excerpt.push(ln);
    if (ln.trim() === "" && excerpt.length > 2) break;
    if (newline === -1) break;
    position = newline + 1;
  }
  return excerpt.join("\n").trimEnd();
}

const LogNavigation = createContext(openFileAndGotoLine);

const CompileErrorDetails = lazy(() =>
  import("./compile-log-details").then((module) => ({ default: module.CompileErrorDetails })),
);
const CompileLogSummary = lazy(() =>
  import("./compile-log-details").then((module) => ({ default: module.CompileLogSummary })),
);

function hasErrorDetails(err: CompileError): boolean {
  return err.source_line != null || (err.hints?.length ?? 0) > 0;
}

type LogT = ReturnType<typeof useTranslation<["common", "editor"]>>["t"];

function errorLocation(err: CompileError, t: LogT): string {
  const column = err.column ?? null;
  if (err.file && err.line != null) {
    return column == null
      ? t(($) => $.editor.log.locationFileLine, { file: err.file, line: err.line })
      : t(($) => $.editor.log.locationFileLineColumn, { file: err.file, line: err.line, column });
  }
  if (err.file) return err.file;
  if (err.line == null) return "";
  return column == null
    ? t(($) => $.editor.log.locationLine, { line: err.line })
    : t(($) => $.editor.log.locationLineColumn, { line: err.line, column });
}

function ErrorCard({ err, log }: Readonly<{ err: CompileError; log: string }>) {
  const { t } = useTranslation(["common", "editor"]);
  const displayText = useDisplayText();
  const openLocation = useContext(LogNavigation);
  const [expanded, setExpanded] = useState(true);
  const { copied, copy } = useCopyStatus();
  const excerpt = useMemo(() => extractErrorExcerpt(log, err.message), [log, err.message]);
  const details = hasErrorDetails(err);
  const collapsible = Boolean(excerpt) || details;
  const title = err.explanation ?? err.message;
  const location = errorLocation(err, t);

  const copyError = async () => {
    const detailText = details
      ? (await import("@/lib/compile-error-excerpt")).formatCompileErrorDetails(
          err,
          t(($) => $.editor.log.hint),
        )
      : "";
    await copy([title, location, excerpt, detailText].filter(Boolean).join("\n"));
  };
  const openErrorLocation = () =>
    err.column == null
      ? openLocation(err.file, err.line as number)
      : openLocation(err.file, err.line as number, err.column);

  return (
    <div className="overflow-hidden rounded-lg border border-sidebar-border bg-background/40">
      <div className="flex w-full items-start gap-1 px-2 py-2.5 text-left">
        <button
          type="button"
          aria-expanded={collapsible ? expanded : undefined}
          disabled={!collapsible}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded px-1 text-left disabled:cursor-default focus-visible:bg-accent/60"
        >
          {/* Only offer a chevron when there is an excerpt to reveal. */}
          {collapsible &&
            (expanded ? (
              <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            ))}
          <span
            aria-hidden="true"
            className={cn(
              "mt-1.5 size-1.5 shrink-0 rounded-full",
              err.kind === "error" ? "bg-red-500" : "bg-amber-500"
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-snug text-foreground">
              {displayText(title)}
            </span>
            {location && (
              <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground">
                {displayText(location)}
              </span>
            )}
          </span>
        </button>
        <Tooltip
          label={copied ? t(($) => $.common.actions.copied) : t(($) => $.editor.log.copyError)}
          side="top"
        >
          <button
            type="button"
            aria-label={t(($) => $.editor.log.copyError)}
            onClick={() => void copyError()}
            className="flex shrink-0 items-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
        </Tooltip>
        {err.line != null && (
          <Tooltip label={t(($) => $.editor.log.goToLocation)} side="top">
            <button
              type="button"
              aria-label={t(($) => $.editor.log.goToLocation)}
              onClick={() => void openErrorLocation()}
              className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            >
              {t(($) => $.editor.log.open)}
              <ArrowUpRight className="size-3" />
            </button>
          </Tooltip>
        )}
      </div>
      {expanded && excerpt && (
        <div className="mx-3 mb-3 overflow-hidden rounded-md border border-sidebar-border/70 bg-background/80">
          <pre className="select-text whitespace-pre-wrap break-words p-2.5 font-mono text-[10.5px] leading-relaxed">
            <LogText text={excerpt} />
          </pre>
        </div>
      )}
      {expanded && details && (
        <Suspense fallback={null}>
          <CompileErrorDetails err={err} />
        </Suspense>
      )}
    </div>
  );
}

const SEVERITY_DOT: Record<LogDiagnostic["severity"], string> = {
  error: "bg-red-500",
  warning: "bg-amber-500",
  typesetting: "bg-sky-500",
  info: "bg-muted-foreground/50",
};

interface RowContext {
  t: LogT;
  displayText: (text: string) => string;
  openLocation: typeof openFileAndGotoLine;
}

const LogRows = createContext<RowContext | null>(null);

const DiagnosticCard = memo(function DiagnosticCard({ d }: Readonly<{ d: LogDiagnostic }>) {
  const { t, displayText, openLocation } = useContext(LogRows) as RowContext;
  const hasLocation = d.file != null && d.line != null;
  let location = "";
  if (d.file) {
    location = d.line != null ? `${d.file}:${d.line}` : d.file;
  } else if (d.line != null) {
    location = t(($) => $.editor.log.locationLine, { line: d.line });
  }

  return (
    <div className="rounded-lg border border-sidebar-border bg-background/40">
      <div className="flex w-full items-start gap-2 px-3 py-2.5 text-left">
        <span
          aria-hidden="true"
          className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", SEVERITY_DOT[d.severity])}
        />
        <span className="min-w-0 flex-1">
          <span className="block whitespace-pre-wrap break-words text-[13px] font-medium leading-snug text-foreground">
            {displayText(d.message)}
          </span>
          {hasLocation ? (
            <span className="inline-flex">
              <button
                type="button"
                data-tooltip={t(($) => $.editor.log.goToLocation)}
                onClick={() => void openLocation(d.file, d.line as number)}
                className="mt-0.5 flex items-center gap-0.5 rounded font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-accent/60"
              >
                {displayText(location)}
                <ArrowUpRight className="size-3" />
              </button>
            </span>
          ) : (
            location && (
              <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground">
                {displayText(location)}
              </span>
            )
          )}
        </span>
      </div>
      {d.errorContext && (
        <div className="mx-3 mb-3 overflow-hidden rounded-md border border-sidebar-border/70 bg-background/80">
          <pre className="select-text whitespace-pre-wrap break-words p-2.5 font-mono text-[10.5px] leading-relaxed">
            <LogText text={d.errorContext} />
          </pre>
        </div>
      )}
    </div>
  );
});

const MESSAGE_CHARS_PER_LINE = 64;
const MESSAGE_LINE_PX = 18;
const CONTEXT_LINE_PX = 17;

function textLines(text: string, perLine: number): number {
  let lines = 0;
  for (const part of text.split("\n")) lines += Math.max(1, Math.ceil(part.length / perLine));
  return lines;
}

function estimateCardHeight(d: LogDiagnostic): number {
  const location = d.file != null || d.line != null ? 16 : 0;
  const context = d.errorContext ? 34 + CONTEXT_LINE_PX * textLines(d.errorContext, 80) : 0;
  return 22 + MESSAGE_LINE_PX * textLines(d.message, MESSAGE_CHARS_PER_LINE) + location + context;
}

const GAP_CLASS = { cards: "pb-3", group: "pb-2" } as const;
const GAP_PX = { cards: 12, group: 8 } as const;

function DiagnosticList({
  items,
  scrollRef,
  gap,
}: Readonly<{ items: readonly LogDiagnostic[]; scrollRef: RefObject<HTMLElement | null>; gap: keyof typeof GAP_CLASS }>) {
  const listRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => items.map((d) => objectKey(d, "log-diagnostic")), [items]);
  const estimate = useCallback(
    (index: number) => estimateCardHeight(items[index]) + (index < items.length - 1 ? GAP_PX[gap] : 0),
    [gap, items],
  );
  const rows = useMeasuredWindow({ keys, estimate, scrollRef, listRef });
  const shown: ReactNode[] = [];
  for (let index = rows.start; index < rows.end; index++) {
    shown.push(
      <div
        key={keys[index]}
        {...{ [MEASURED_WINDOW_ITEM]: index }}
        className={index < items.length - 1 ? GAP_CLASS[gap] : undefined}
      >
        <DiagnosticCard d={items[index]} />
      </div>,
    );
  }
  return (
    <div ref={listRef} style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}>
      {shown}
    </div>
  );
}

function DiagnosticGroup({
  label,
  items,
  scrollRef,
}: Readonly<{ label: string; items: readonly LogDiagnostic[]; scrollRef: RefObject<HTMLElement | null> }>) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-sidebar-border bg-background/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-[13px] font-medium text-sidebar-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {label}
        <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
          {items.length}
        </span>
      </button>
      {open && (
        <div className="border-t border-sidebar-border px-3 py-3">
          <DiagnosticList items={items} scrollRef={scrollRef} gap="group" />
        </div>
      )}
    </div>
  );
}

function RawLogSection({ log, defaultOpen }: Readonly<{ log: string; defaultOpen: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const [open, setOpen] = useState(defaultOpen);
  const { copied, copy } = useCopyStatus();

  return (
    <div className="overflow-hidden rounded-lg border border-sidebar-border bg-background/40">
      <div className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium text-sidebar-foreground"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {t(($) => $.editor.log.rawLogs)}
        </button>
        <button
          type="button"
          onClick={() => void copy(log)}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3 text-emerald-500" />
          ) : (
            <Copy className="size-3" />
          )}
          {copied ? t(($) => $.common.actions.copied) : t(($) => $.editor.log.copyLog)}
        </button>
      </div>
      {open && <RawLogViewer log={log} />}
    </div>
  );
}

const NO_DIAGNOSTICS: readonly LogDiagnostic[] = [];

function errorText(message: string): string {
  return (message.split("\n")[0] ?? "")
    .trim()
    .replace(/^LaTeX Error:\s*/, "")
    .replace(/^((?:Package|Class|Module) \S+) Error:\s*/, "$1: ")
    .replace(/\.$/, "");
}

interface ReportedError {
  text: string;
  warning: boolean;
  line: number | null;
}

function reportedAsCard(diagnostic: LogDiagnostic, errors: readonly ReportedError[]): boolean {
  if (errors.length === 0) return false;
  const text = errorText(diagnostic.message);
  return errors.some(
    (error) =>
      (diagnostic.severity === "error" || error.warning) &&
      error.text === text &&
      (error.line == null || diagnostic.line == null || error.line === diagnostic.line),
  );
}

function coversElement(range: Range, element: Element): boolean {
  const own = element.ownerDocument.createRange();
  own.selectNode(element);
  return (
    range.compareBoundaryPoints(Range.START_TO_START, own) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, own) >= 0
  );
}

export function LogPane({ snapshot, onOpenLocation = openFileAndGotoLine }: Readonly<{
  snapshot?: Pick<CompileState, "log" | "errors" | "status" | "diagnostics"> & { mainDoc: string };
  onOpenLocation?: typeof openFileAndGotoLine;
}> = {}) {
  const { t } = useTranslation(["common", "editor"]);
  const displayText = useDisplayText();
  const storedLog = useCompileStore((s) => s.log);
  const storedErrors = useCompileStore((s) => s.errors);
  const storedStatus = useCompileStore((s) => s.status);
  const storedDiagnostics = useCompileStore((s) => s.diagnostics);
  const storedMainDoc = useFilesStore((s) => s.mainDoc);
  const { log, errors, status, diagnostics, mainDoc } = snapshot ?? {
    log: storedLog, errors: storedErrors, status: storedStatus, diagnostics: storedDiagnostics, mainDoc: storedMainDoc,
  };
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const followTailRef = useRef(true);
  const tailFrameRef = useRef<number | null>(null);
  const latestLog = useRef(log);
  latestLog.current = log;
  useOverlayScrollbar(scrollBoxRef);
  const tooltip = useDelegatedTooltips(scrollBoxRef);
  const rowContext = useMemo<RowContext>(
    () => ({ t, displayText, openLocation: onOpenLocation }),
    [displayText, onOpenLocation, t],
  );

  const structured = useMemo<readonly LogDiagnostic[]>(() => {
    if (diagnostics) return diagnostics;
    if (!log || status === "compiling" || /\.typ$/i.test(mainDoc)) return NO_DIAGNOSTICS;
    return parseLatexLog(log, mainDoc);
  }, [diagnostics, log, mainDoc, status]);
  const groups = useMemo(() => {
    const reported = errors.map((error) => ({
      text: errorText(error.message),
      warning: error.kind === "warning",
      line: error.line,
    }));
    const errs: LogDiagnostic[] = [];
    const refs: LogDiagnostic[] = [];
    const warns: LogDiagnostic[] = [];
    const boxes: LogDiagnostic[] = [];
    const infos: LogDiagnostic[] = [];
    for (const d of structured) {
      if (d.severity === "error") {
        // Rust-side errors[] cards stay authoritative; skip duplicates.
        if (!reportedAsCard(d, reported)) errs.push(d);
      } else if (d.category === "undefined-reference" || d.category === "undefined-citation") {
        if (!reportedAsCard(d, reported)) refs.push(d);
      } else if (d.severity === "typesetting") {
        boxes.push(d);
      } else if (d.severity === "info") {
        infos.push(d);
      } else if (!reportedAsCard(d, reported)) {
        warns.push(d);
      }
    }
    return { cards: [...errs, ...refs, ...warns], errs, refs, warns, boxes, infos };
  }, [structured, errors]);
  const summary = useMemo(() => {
    const errorCards = errors.filter((error) => error.kind === "error").length;
    return {
      errors: errorCards + groups.errs.length,
      warnings: errors.length - errorCards + groups.refs.length + groups.warns.length,
      references: structured.filter(
        (d) => d.category === "undefined-reference" || d.category === "undefined-citation",
      ).length,
    };
  }, [errors, groups, structured]);

  useEffect(() => {
    if (!E2E_HOOKS) return;
    const target = window as unknown as { __e2eRenderedCompileLog?: string };
    target.__e2eRenderedCompileLog = log;
    return () => {
      if (target.__e2eRenderedCompileLog === log) {
        delete target.__e2eRenderedCompileLog;
      }
    };
  }, [log]);

  useEffect(() => {
    void log;
    if (!followTailRef.current || tailFrameRef.current !== null) return;
    tailFrameRef.current = requestAnimationFrame(() => {
      tailFrameRef.current = null;
      const scrollBox = scrollBoxRef.current;
      if (!scrollBox || !followTailRef.current) return;
      scrollBox.scrollTop = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
    });
  }, [log]);

  useEffect(
    () => () => {
      if (tailFrameRef.current !== null) cancelAnimationFrame(tailFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    const scrollBox = scrollBoxRef.current;
    if (!scrollBox) return;
    const onCopy = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData) return;
      const raw = scrollBox.querySelector("[data-testid=compile-log-raw]");
      const selection = scrollBox.ownerDocument.getSelection();
      if (!raw || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      if (!coversElement(selection.getRangeAt(0), raw)) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", latestLog.current);
    };
    scrollBox.addEventListener("copy", onCopy, true);
    return () => scrollBox.removeEventListener("copy", onCopy, true);
  }, []);

  const onScroll = () => {
    const scrollBox = scrollBoxRef.current;
    if (!scrollBox) return;
    const maxTop = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
    followTailRef.current = maxTop - scrollBox.scrollTop <= 32;
  };

  const scrollToTop = () => {
    followTailRef.current = false;
    if (scrollBoxRef.current) smoothScrollTo(scrollBoxRef.current, () => 0);
  };
  const scrollToBottom = () => {
    const scrollBox = scrollBoxRef.current;
    if (!scrollBox) return;
    followTailRef.current = true;
    smoothScrollTo(scrollBox, () => scrollBox.scrollHeight - scrollBox.clientHeight);
  };

  return (
    <LogNavigation value={onOpenLocation}>
    <LogRows value={rowContext}>
    <div className="relative flex h-full min-h-0 flex-col bg-sidebar">
      <div
        ref={scrollBoxRef}
        data-testid="compile-log-scroll"
        data-select-all-scope=""
        className="isolate min-h-0 flex-1 overflow-auto p-3"
        onScroll={onScroll}
      >
        <div className="space-y-3">
          {status !== "compiling" && (summary.errors > 0 || summary.warnings > 0) && (
            <Suspense fallback={null}>
              <CompileLogSummary {...summary} />
            </Suspense>
          )}
          {errors.length > 0 &&
            errors.map((err) => <ErrorCard key={objectKey(err, "compile-error")} err={err} log={log} />)}
          {groups.cards.length > 0 && (
            <DiagnosticList items={groups.cards} scrollRef={scrollBoxRef} gap="cards" />
          )}
          <DiagnosticGroup label={t(($) => $.editor.log.typesetting)} items={groups.boxes} scrollRef={scrollBoxRef} />
          <DiagnosticGroup label={t(($) => $.editor.log.info)} items={groups.infos} scrollRef={scrollBoxRef} />
          {!log && errors.length === 0 && (
            <p className="text-[11px] text-muted-foreground">{t(($) => $.editor.log.empty)}</p>
          )}
          {log && (
            <RawLogSection
              key={errors.length === 0 ? "clean" : "errors"}
              log={log}
              defaultOpen={errors.length === 0}
            />
          )}
        </div>
        <div />
      </div>
      {log && (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1">
          <Tooltip label={t(($) => $.editor.log.scrollToTop)} side="left">
            <button
              type="button"
              aria-label={t(($) => $.editor.log.scrollToTop)}
              onClick={scrollToTop}
              className="flex size-7 items-center justify-center rounded-full border border-sidebar-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowUp className="size-3.5" />
            </button>
          </Tooltip>
          <Tooltip label={t(($) => $.editor.log.scrollToBottom)} side="left">
            <button
              type="button"
              aria-label={t(($) => $.editor.log.scrollToBottom)}
              onClick={scrollToBottom}
              className="flex size-7 items-center justify-center rounded-full border border-sidebar-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowDown className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      )}
      {tooltip}
    </div>
    </LogRows>
    </LogNavigation>
  );
}
