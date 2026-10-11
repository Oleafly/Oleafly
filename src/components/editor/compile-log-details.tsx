import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { CompileError, ComponentInfo } from "@/lib/tauri";
import { compileErrorExcerpt } from "@/lib/compile-error-excerpt";
import { missingTypstFont, packForFamily, type TypstFontPackId } from "@/lib/typst-font-packs";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useFontPacksStore } from "@/store/font-packs";

function useMissingFontPack(message: string): { family: string; pack: ComponentInfo } | null {
  const family = missingTypstFont(message);
  const packs = useFontPacksStore((state) => state.packs);
  const status = useFontPacksStore((state) => state.status);
  const load = useFontPacksStore((state) => state.load);
  useEffect(() => {
    if (family && status === "idle") void load();
  }, [family, status, load]);
  const pack = family ? packForFamily(packs, family) : undefined;
  return family && pack && !pack.installed ? { family, pack } : null;
}

function MissingFontPackHint({ family, pack }: Readonly<{ family: string; pack: ComponentInfo }>) {
  const { t } = useTranslation(["editor", "settings"]);
  const installing = useFontPacksStore((state) => state.installing);
  const install = useFontPacksStore((state) => state.install);
  const label = t(($) => $.settings.downloads.fontPacks[pack.id as TypstFontPackId].label);
  const downloadAndCompile = async () => {
    if (await install(pack.id)) {
      await useFilesStore.getState().refreshEngine();
      void useCompileStore.getState().recompile();
    } else {
      toast.error(t(($) => $.editor.log.fontPackFailed));
    }
  };
  return (
    <div
      data-testid="font-pack-hint"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-[0.71875rem] leading-snug text-muted-foreground"
    >
      <span>{t(($) => $.editor.log.fontPack, { family, pack: label })}</span>
      <button
        type="button"
        onClick={() => void downloadAndCompile()}
        disabled={installing !== null}
        className="rounded-md border border-input px-2 py-0.5 text-[0.71875rem] text-foreground hover:bg-accent disabled:opacity-50"
      >
        {installing === pack.id ? t(($) => $.editor.log.fontPackDownloading) : t(($) => $.editor.log.fontPackAction)}
      </button>
    </div>
  );
}

export function CompileErrorDetails({ err }: Readonly<{ err: CompileError }>) {
  const { t } = useTranslation(["editor"]);
  const excerpt = compileErrorExcerpt(err);
  const hints = err.hints ?? [];
  const missingFont = useMissingFontPack(err.message);
  if (!excerpt && hints.length === 0 && !missingFont) return null;
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
      {missingFont && <MissingFontPackHint family={missingFont.family} pack={missingFont.pack} />}
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
