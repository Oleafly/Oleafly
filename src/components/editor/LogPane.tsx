import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompileStore } from "@/store/compile";
import { useAgentHandoffStore } from "@/store/agent-handoff";
import { useSettingsStore } from "@/store/settings";
import { hasConfiguredProvider } from "@/lib/ai-providers";
import { getConfig } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { objectKey } from "@/lib/react-key";

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
      {errors.length > 0 && (
        <div className="border-b border-sidebar-border bg-sidebar-accent/40">
          {errors.map((err) => (
            <div key={objectKey(err, "compile-error")} className="flex flex-col gap-0.5 px-3 py-1.5 text-xs">
              <div className="flex items-start gap-2">
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
                {(err.file || err.line != null) && (
                  <span className="ml-auto shrink-0 font-mono text-muted-foreground">
                    {err.file
                      ? `${err.file}${err.line != null ? `:${err.line}` : ""}`
                      : `l.${err.line}`}
                  </span>
                )}
              </div>
              {err.explanation && (
                <p className="pl-7 text-[11px] leading-snug text-muted-foreground">
                  {err.explanation}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

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

      <div className="flex-1 overflow-auto p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
          {log ? <LogText text={log} /> : <span className="text-muted-foreground">Compile output will appear here.</span>}
          <div ref={endRef} />
        </pre>
      </div>
    </div>
  );
}
