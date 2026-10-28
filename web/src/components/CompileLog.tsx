import type { CompileOutput, LogDiagnostic } from "@oleafly/compile-port";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useActions } from "./context";

function SeverityIcon({ severity }: Readonly<{ severity: LogDiagnostic["severity"] }>) {
  if (severity === "error") return <CircleAlert aria-hidden className="size-3.5 shrink-0 text-destructive" />;
  if (severity === "warning") return <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-amber-600" />;
  return <Info aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
}

function place(diagnostic: LogDiagnostic): string | null {
  if (!diagnostic.file) return diagnostic.line === null ? null : `${diagnostic.line}`;
  const file = diagnostic.file.replace(/^(?:\.\/)+/u, "");
  return diagnostic.line === null ? file : `${file}:${diagnostic.line}`;
}

/** The compile's problems, each opening its source line, and the full log under them. */
export function CompileLog({ output }: Readonly<{ output: CompileOutput }>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const [raw, setRaw] = useState(false);
  const problems = output.diagnostics.filter((entry) => entry.severity === "error" || entry.severity === "warning");
  const errors = problems.filter((entry) => entry.severity === "error").length;
  return (
    <section
      aria-label={t(($) => $.web.compile.logTitle)}
      data-testid="compile-log"
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t bg-background"
    >
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <p className="flex-1 text-xs font-medium">
          {problems.length === 0
            ? t(($) => $.web.compile.noProblems)
            : t(($) => $.web.compile.problems, { errors, warnings: problems.length - errors })}
        </p>
        <Button type="button" size="xs" variant="ghost" aria-pressed={raw} onClick={() => setRaw((value) => !value)}>
          {raw ? t(($) => $.web.compile.showProblems) : t(($) => $.web.compile.showRawLog)}
        </Button>
      </div>
      {raw ? (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[0.6875rem] leading-relaxed">
          {output.log}
        </pre>
      ) : problems.length > 0 ? (
        <ul className="min-h-0 flex-1 overflow-auto py-1">
          {problems.map((entry, index) => {
            const where = place(entry);
            const file = entry.file ?? output.target.mainDocument;
            const line = entry.line;
            return (
              <li key={`${index}:${entry.message}`}>
                <button
                  type="button"
                  disabled={line === null}
                  onClick={() => line !== null && actions.openLocation(file, line)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs",
                    line === null ? "cursor-default" : "hover:bg-accent focus-visible:bg-accent",
                  )}
                >
                  <SeverityIcon severity={entry.severity} />
                  <span className="min-w-0 flex-1 break-words">{entry.message}</span>
                  {where ? <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground">{where}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
