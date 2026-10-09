import { useTranslation } from "react-i18next";
import type { CompileError } from "@/lib/tauri";
import { compileErrorExcerpt } from "@/lib/compile-error-excerpt";
import { cn } from "@/lib/utils";

export function CompileErrorDetails({ err }: Readonly<{ err: CompileError }>) {
  const { t } = useTranslation(["editor"]);
  const excerpt = compileErrorExcerpt(err);
  const hints = err.hints ?? [];
  if (!excerpt && hints.length === 0) return null;
  const tone = err.kind === "error" ? "text-red-500" : "text-amber-500";
  return (
    <div className="mx-3 mb-3 space-y-2">
      {excerpt && (
        <figure
          aria-label={t(($) => $.editor.log.sourceExcerpt, { line: excerpt.line })}
          className="overflow-hidden rounded-md border border-sidebar-border/70 bg-background/80"
        >
          <pre
            data-testid="compile-error-excerpt"
            className="overflow-x-auto p-2.5 font-mono text-[0.65625rem] leading-relaxed"
          >
            <span className="block whitespace-pre">
              <span className="select-none text-muted-foreground/70">{`${excerpt.line} │ `}</span>
              <span className="text-foreground/80">{`${excerpt.clippedStart ? "…" : ""}${excerpt.before}`}</span>
              <span className={cn("font-semibold", tone)}>{excerpt.span}</span>
              <span className="text-foreground/80">{`${excerpt.after}${excerpt.clippedEnd ? "…" : ""}`}</span>
            </span>
            <span aria-hidden="true" className="block select-none whitespace-pre">
              <span className="invisible">{String(excerpt.line)}</span>
              <span className="text-muted-foreground/70">{" │ "}</span>
              <span className="invisible">{`${excerpt.clippedStart ? "…" : ""}${excerpt.before}`}</span>
              <span data-caret className={cn("font-semibold", tone)}>
                {"^".repeat(Math.max(1, Array.from(excerpt.span).length))}
              </span>
            </span>
          </pre>
        </figure>
      )}
      {hints.length > 0 && (
        <ul className="space-y-1 px-0.5">
          {hints.map((hint) => (
            <li key={hint} className="flex gap-1.5 text-[0.71875rem] leading-snug text-muted-foreground">
              <span className="shrink-0 font-medium text-foreground">{t(($) => $.editor.log.hint)}</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{hint}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CompileLogSummary({
  errors,
  warnings,
  references,
}: Readonly<{ errors: number; warnings: number; references: number }>) {
  const { t } = useTranslation(["editor"]);
  const parts = [
    errors > 0 && {
      key: "errors",
      text: t(($) => $.editor.log.summaryErrors, { count: errors }),
      tone: "text-red-500",
    },
    warnings > 0 && {
      key: "warnings",
      text: t(($) => $.editor.log.summaryWarnings, { count: warnings }),
      tone: "text-amber-600 dark:text-amber-400",
    },
    references > 0 && {
      key: "references",
      text: t(($) => $.editor.log.summaryReferences, { count: references }),
      tone: "text-muted-foreground",
    },
  ].filter((part) => part !== false);
  if (parts.length === 0) return null;
  return (
    <p
      data-testid="compile-log-summary"
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[0.71875rem] font-medium"
    >
      {parts.map((part, index) => (
        <span key={part.key} className="flex items-center gap-2">
          {index > 0 && (
            <span aria-hidden="true" className="text-muted-foreground/60">
              ·
            </span>
          )}
          <span className={part.tone}>{part.text}</span>
        </span>
      ))}
    </p>
  );
}
