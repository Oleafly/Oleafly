import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Crosshair, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompileStore } from "@/store/compile";
import { useAgentHandoffStore } from "@/store/agent-handoff";
import { useSettingsStore } from "@/store/settings";
import { hasConfiguredProvider } from "@/lib/ai-providers";
import { getConfig, type CompileError } from "@/lib/tauri";
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
  const excerpt = extractErrorExcerpt(log, err.message);
  const title = err.explanation ?? err.message;
  const location = err.file ? `${err.file}${err.line != null ? `, ${err.line}` : ""}` : err.line != null ? `l.${err.line}` : "";

  return (
    <div className="border-b border-sidebar-border">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
        }}
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-xs font-medium",
              err.kind === "error" ? "text-red-500" : "text-amber-600 dark:text-amber-400"
            )}
          >
            {title}
          </p>
          {location && <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{location}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {err.line != null && (
            <Tooltip label="Go to code location" side="top">
              <button
                type="button"
                aria-label="Go to code location"
                onClick={(e) => {
                  e.stopPropagation();
                  void openFileAndGotoLine(err.file, err.line as number);
                }}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Crosshair className="size-3.5" />
              </button>
            </Tooltip>
          )}
          {expanded ? (
            <ChevronUp className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          )}
        </div>
      </div>
      {expanded && excerpt && (
        <pre className="mx-3 mb-2 whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[10.5px] leading-relaxed">
          <LogText text={excerpt} />
        </pre>
      )}
    </div>
  );
}

function RawLogSection({ log, defaultOpen }: { log: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-sidebar-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-sidebar-foreground"
      >
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        Raw logs
      </button>
      {open && (
        <pre className="whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[11px] leading-relaxed">
          <LogText text={log} />
        </pre>
      )}
    </div>
  );
}

export function LogPane() {
  const log = useCompileStore((s) => s.log);
  const errors = useCompileStore((s) => s.errors);
  const status = useCompileStore((s) => s.status);
  const endRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const hasCompileError = status === "error" || errors.some((error) => error.kind === "error");

  useEffect(() => {
    void log;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const copy = async () => {
    if (!log) return;
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const askAi = async () => {
    let configured = false;
    try {
      configured = hasConfiguredProvider(await getConfig());
    } catch {
      configured = false;
    }
    const settings = useSettingsStore.getState();
    if (!configured) {
      settings.setSettingsInitialSection("ai");
      settings.setSettingsOpen(true);
      return;
    }
    const details = errors
      .filter((error) => error.kind === "error")
      .slice(0, 8)
      .map((error) => {
        const location = error.file
          ? `${error.file}${error.line != null ? `:${error.line}` : ""}`
          : error.line != null
            ? `line ${error.line}`
            : "";
        return `- ${location ? `${location}: ` : ""}${error.message}`;
      });
    const prompt = [
      "Fix the current document compilation failure.",
      details.length > 0 ? `\nCompiler errors:\n${details.join("\n")}` : "",
      "\nInspect the relevant project files and the full compile log, make the smallest correct changes, then recompile until it succeeds and verify the resulting document.",
    ].join("");
    useAgentHandoffStore.getState().handoff(prompt, { autoSend: false });
    settings.setRailTab("ai");
    if (!settings.showTree) settings.toggleTree();
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-7 shrink-0 items-center justify-end border-b border-sidebar-border px-2">
        {hasCompileError && (
          <Button
            variant="ghostPrimary"
            size="xs"
            onClick={() => void askAi()}
          >
            <Sparkles data-icon="inline-start" />
            Ask AI
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copy()}
          disabled={!log}
          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check data-icon="inline-start" className="text-emerald-500" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          {copied ? "Copied" : "Copy log"}
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {errors.length > 0 &&
          errors.map((err) => <ErrorCard key={objectKey(err, "compile-error")} err={err} log={log} />)}
        {!log && errors.length === 0 && (
          <p className="p-3 text-[11px] text-muted-foreground">Compile output will appear here.</p>
        )}
        {log && (
          <RawLogSection
            key={errors.length === 0 ? "clean" : "errors"}
            log={log}
            defaultOpen={errors.length === 0}
          />
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
