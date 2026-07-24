import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Copy } from "lucide-react";
import { useCompileStore } from "@/store/compile";
import type { CompileError } from "@/lib/tauri";
import { openFileAndGotoLine } from "@/features/synctex";
import { cn } from "@/lib/utils";
import { objectKey } from "@/lib/react-key";
import { Tooltip } from "@/components/ui/tooltip";

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
  const startIndex = lines.findIndex((ln) => ln === `! ${message}`);
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

  const copyError = async (e: MouseEvent) => {
    e.stopPropagation();
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
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
        }}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            err.kind === "error" ? "bg-red-500" : "bg-amber-500"
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug text-foreground">{title}</p>
          {location && <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{location}</p>}
        </div>
        <Tooltip label={copied ? "Copied" : "Copy error"} side="top">
          <button
            type="button"
            aria-label="Copy error"
            onClick={(e) => void copyError(e)}
            className="flex shrink-0 items-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
        </Tooltip>
        {expanded && err.line != null && (
          <Tooltip label="Go to code location" side="top">
            <button
              type="button"
              aria-label="Go to code location"
              onClick={(e) => {
                e.stopPropagation();
                void openFileAndGotoLine(err.file, err.line as number);
              }}
              className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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

function RawLogSection({ log, defaultOpen }: { log: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  const scrollToBottom = () =>
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });

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
        <div className="relative border-t border-sidebar-border">
          <pre
            ref={scrollRef}
            className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-relaxed"
          >
            <LogText text={log} />
          </pre>
          <div className="absolute bottom-2 right-2 flex flex-col gap-1">
            <Tooltip label="Scroll to top" side="left">
              <button
                type="button"
                aria-label="Scroll to top"
                onClick={scrollToTop}
                className="flex size-6 items-center justify-center rounded-full border border-sidebar-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronsUp className="size-3.5" />
              </button>
            </Tooltip>
            <Tooltip label="Scroll to bottom" side="left">
              <button
                type="button"
                aria-label="Scroll to bottom"
                onClick={scrollToBottom}
                className="flex size-6 items-center justify-center rounded-full border border-sidebar-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronsDown className="size-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

export function LogPane() {
  const log = useCompileStore((s) => s.log);
  const errors = useCompileStore((s) => s.errors);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void log;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex-1 overflow-auto p-3">
        <div className="space-y-3">
          {errors.length > 0 &&
            errors.map((err) => <ErrorCard key={objectKey(err, "compile-error")} err={err} log={log} />)}
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
        <div ref={endRef} />
      </div>
    </div>
  );
}
