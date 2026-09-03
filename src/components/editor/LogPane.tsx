import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { parseLatexLog, type LogDiagnostic } from "@oleafly/latex";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import type { CompileError } from "@/lib/tauri";
import { openFileAndGotoLine } from "@/features/synctex";
import { cn } from "@/lib/utils";
import { objectKey } from "@/lib/react-key";
import { Tooltip } from "@/components/ui/tooltip";
import { E2E_HOOKS } from "@/lib/e2e-flags";

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function smoothScrollTo(el: HTMLElement, targetTop: number, duration = 700) {
  const startTop = el.scrollTop;
  const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
  const delta = Math.min(Math.max(0, targetTop), maxTop) - startTop;
  const startTime = performance.now();
  function step(now: number) {
    const t = Math.min(1, (now - startTime) / duration);
    el.scrollTop = startTop + delta * easeInOutQuad(t);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

type Cat = "error" | "warn" | "lineref" | "register" | "normal";

function category(line: string): Cat {
  if (/^!/.test(line)) return "error";
  if (/^Runaway argument|Emergency stop|^<inserted text>/.test(line)) return "warn";
  if (/^l\.\d+/.test(line)) return "lineref";
  if (/^\\[a-zA-Z@]+=/.test(line)) return "register";
  return "normal";
}

const TOKEN_RE = /(\([^\s()]+\.\w+\)|\\[a-zA-Z@]+|[{}()])/g;

function inline(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  TOKEN_RE.lastIndex = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    if (m.index > last) out.push(<span key={key++}>{line.slice(last, m.index)}</span>);
    const tok = m[0];
    let cls = "";
    if (/^\([^)]+\.\w+\)$/.test(tok)) cls = "text-primary";
    else if (tok === "(" || tok === ")") cls = "text-primary/70";
    else if (tok.startsWith("\\")) cls = "text-purple-500 dark:text-purple-400";
    else cls = "text-fuchsia-500";
    out.push(
      <span key={key++} className={cls}>
        {tok}
      </span>
    );
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(<span key={key++}>{line.slice(last)}</span>);
  return out;
}

function LogText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  let depth = 0;
  return (
    <>
      {lines.map((ln, index) => {
        const cat = category(ln);
        const lineDepth = depth;
        const opens = (ln.match(/\(/g) || []).length;
        const closes = (ln.match(/\)/g) || []).length;
        depth = Math.max(0, depth + opens - closes);
        const indent = Math.min(lineDepth, 8) * 12;

        let body: ReactNode;
        if (cat === "error") body = <span className="text-red-500 font-semibold">{ln}</span>;
        else if (cat === "warn") body = <span className="text-red-400">{ln}</span>;
        else if (cat === "lineref") {
          const m = ln.match(/^(l\.\d+)(.*)$/);
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

function extractErrorExcerpt(log: string, message: string): string {
  const lines = log.replace(/\r/g, "").split("\n");
  const startIndex = lines.indexOf(`! ${message}`);
  if (startIndex === -1) return "";
  const excerpt: string[] = [lines[startIndex]];
  for (let i = startIndex + 1; i < lines.length && excerpt.length < 12; i++) {
    const ln = lines[i];
    if (ln.startsWith("!")) break;
    excerpt.push(ln);
    if (ln.trim() === "" && excerpt.length > 2) break;
  }
  return excerpt.join("\n").trimEnd();
}

function ErrorCard({ err, log }: { err: CompileError; log: string }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const excerpt = extractErrorExcerpt(log, err.message);
  const title = err.explanation ?? err.message;
  const location = err.file
    ? `${err.file}${err.line != null ? ` · line ${err.line}` : ""}`
    : err.line != null
      ? `line ${err.line}`
      : "";

  const copyError = async () => {
    const text = [title, location, excerpt].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-sidebar-border bg-background/40">
      <div className="flex w-full items-start gap-1 px-2 py-2.5 text-left">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span
            aria-hidden="true"
            className={cn(
              "mt-1.5 size-1.5 shrink-0 rounded-full",
              err.kind === "error" ? "bg-red-500" : "bg-amber-500"
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-snug text-foreground">{title}</span>
            {location && <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground">{location}</span>}
          </span>
        </button>
        <Tooltip label={copied ? "Copied" : "Copy error"} side="top">
          <button
            type="button"
            aria-label="Copy error"
            onClick={() => void copyError()}
            className="flex shrink-0 items-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
        </Tooltip>
        {expanded && err.line != null && (
          <Tooltip label="Go to code location" side="top">
            <button
              type="button"
              aria-label="Go to code location"
              onClick={() => void openFileAndGotoLine(err.file, err.line as number)}
              className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open
              <ArrowUpRight className="size-3" />
            </button>
          </Tooltip>
        )}
      </div>
      {expanded && excerpt && (
        <div className="mx-3 mb-3 overflow-hidden rounded-md border border-sidebar-border/70 bg-background/80">
          <pre className="whitespace-pre-wrap break-words p-2.5 font-mono text-[10.5px] leading-relaxed">
            <LogText text={excerpt} />
          </pre>
        </div>
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

function DiagnosticCard({ d }: { d: LogDiagnostic }) {
  const hasLocation = d.file != null && d.line != null;
  const location = d.file
    ? `${d.file}${d.line != null ? `:${d.line}` : ""}`
    : d.line != null
      ? `line ${d.line}`
      : "";

  return (
    <div className="overflow-hidden rounded-lg border border-sidebar-border bg-background/40">
      <div className="flex w-full items-start gap-2 px-3 py-2.5 text-left">
        <span
          aria-hidden="true"
          className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", SEVERITY_DOT[d.severity])}
        />
        <span className="min-w-0 flex-1">
          <span className="block whitespace-pre-wrap break-words text-[13px] font-medium leading-snug text-foreground">
            {d.message}
          </span>
          {hasLocation ? (
            <Tooltip label="Go to code location" side="top">
              <button
                type="button"
                onClick={() => void openFileAndGotoLine(d.file, d.line as number)}
                className="mt-0.5 flex items-center gap-0.5 rounded font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {location}
                <ArrowUpRight className="size-3" />
              </button>
            </Tooltip>
          ) : (
            location && (
              <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground">{location}</span>
            )
          )}
        </span>
      </div>
      {d.errorContext && (
        <div className="mx-3 mb-3 overflow-hidden rounded-md border border-sidebar-border/70 bg-background/80">
          <pre className="whitespace-pre-wrap break-words p-2.5 font-mono text-[10.5px] leading-relaxed">
            <LogText text={d.errorContext} />
          </pre>
        </div>
      )}
    </div>
  );
}

function DiagnosticGroup({ label, items }: { label: string; items: LogDiagnostic[] }) {
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
        <div className="space-y-2 border-t border-sidebar-border px-3 py-3">
          {items.map((d) => (
            <DiagnosticCard key={objectKey(d, "log-diagnostic")} d={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function RawLogSection({ log, defaultOpen }: { log: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-sidebar-border bg-background/40">
      <div className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium text-sidebar-foreground"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Raw logs
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3 text-emerald-500" />
          ) : (
            <Copy className="size-3" />
          )}
          {copied ? "Copied" : "Copy log"}
        </button>
      </div>
      {open && (
        <pre className="whitespace-pre-wrap break-words border-t border-sidebar-border px-3 py-3 font-mono text-[11px] leading-relaxed">
          <LogText text={log} />
        </pre>
      )}
    </div>
  );
}

const NO_DIAGNOSTICS: readonly LogDiagnostic[] = [];

export function LogPane() {
  const log = useCompileStore((s) => s.log);
  const errors = useCompileStore((s) => s.errors);
  const status = useCompileStore((s) => s.status);
  const diagnostics = useCompileStore((s) => s.diagnostics);
  const mainDoc = useFilesStore((s) => s.mainDoc);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const followTailRef = useRef(true);
  const tailFrameRef = useRef<number | null>(null);

  const structured = useMemo<readonly LogDiagnostic[]>(() => {
    if (diagnostics) return diagnostics;
    if (!log || status === "compiling") return NO_DIAGNOSTICS;
    return parseLatexLog(log, mainDoc);
  }, [diagnostics, log, mainDoc, status]);
  const groups = useMemo(() => {
    const existing = new Set(errors.map((e) => e.message));
    const errs: LogDiagnostic[] = [];
    const refs: LogDiagnostic[] = [];
    const warns: LogDiagnostic[] = [];
    const boxes: LogDiagnostic[] = [];
    const infos: LogDiagnostic[] = [];
    for (const d of structured) {
      if (d.severity === "error") {
        // Rust-side errors[] cards stay authoritative; skip duplicates.
        if (!existing.has(d.message)) errs.push(d);
      } else if (d.category === "undefined-reference" || d.category === "undefined-citation") {
        refs.push(d);
      } else if (d.severity === "typesetting") {
        boxes.push(d);
      } else if (d.severity === "info") {
        infos.push(d);
      } else {
        warns.push(d);
      }
    }
    return { errs, refs, warns, boxes, infos };
  }, [structured, errors]);

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

  const onScroll = () => {
    const scrollBox = scrollBoxRef.current;
    if (!scrollBox) return;
    const maxTop = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
    followTailRef.current = maxTop - scrollBox.scrollTop <= 32;
  };

  const scrollToTop = () => {
    followTailRef.current = false;
    if (scrollBoxRef.current) smoothScrollTo(scrollBoxRef.current, 0);
  };
  const scrollToBottom = () => {
    const scrollBox = scrollBoxRef.current;
    if (!scrollBox) return;
    followTailRef.current = true;
    smoothScrollTo(scrollBox, scrollBox.scrollHeight - scrollBox.clientHeight);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-sidebar">
      <div
        ref={scrollBoxRef}
        data-testid="compile-log-scroll"
        className="min-h-0 flex-1 overflow-auto p-3"
        onScroll={onScroll}
      >
        <div className="space-y-3">
          {errors.length > 0 &&
            errors.map((err) => <ErrorCard key={objectKey(err, "compile-error")} err={err} log={log} />)}
          {[...groups.errs, ...groups.refs, ...groups.warns].map((d) => (
            <DiagnosticCard key={objectKey(d, "log-diagnostic")} d={d} />
          ))}
          <DiagnosticGroup label="Typesetting" items={groups.boxes} />
          <DiagnosticGroup label="Info" items={groups.infos} />
          {!log && errors.length === 0 && (
            <p className="text-[11px] text-muted-foreground">Compile output will appear here.</p>
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
          <Tooltip label="Scroll to top" side="left">
            <button
              type="button"
              aria-label="Scroll to top"
              onClick={scrollToTop}
              className="flex size-7 items-center justify-center rounded-full border border-sidebar-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowUp className="size-3.5" />
            </button>
          </Tooltip>
          <Tooltip label="Scroll to bottom" side="left">
            <button
              type="button"
              aria-label="Scroll to bottom"
              onClick={scrollToBottom}
              className="flex size-7 items-center justify-center rounded-full border border-sidebar-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowDown className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
