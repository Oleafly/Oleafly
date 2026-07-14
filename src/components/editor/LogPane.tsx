import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useCompileStore } from "@/store/compile";
import { cn } from "@/lib/utils";

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
  let m: RegExpExecArray | null;
  let key = 0;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line))) {
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
      {lines.map((ln, i) => {
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
            key={i}
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

export function LogPane() {
  const log = useCompileStore((s) => s.log);
  const errors = useCompileStore((s) => s.errors);
  const endRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
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

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {errors.length > 0 && (
        <div className="border-b border-sidebar-border bg-sidebar-accent/40">
          {errors.map((err, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-1.5 text-xs">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded px-1 font-mono text-[10px] uppercase",
                  err.kind === "error"
                    ? "bg-red-500/15 text-red-500"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                )}
              >
                {err.kind}
              </span>
              <span className="text-sidebar-foreground">{err.message}</span>
              {err.line != null && (
                <span className="ml-auto shrink-0 font-mono text-muted-foreground">l.{err.line}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex h-7 shrink-0 items-center justify-end border-b border-sidebar-border px-2">
        <button
          onClick={() => void copy()}
          disabled={!log}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy log"}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
          {log ? <LogText text={log} /> : <span className="text-muted-foreground">Compile output will appear here.</span>}
          <div ref={endRef} />
        </pre>
      </div>
    </div>
  );
}
