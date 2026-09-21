import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, ScrollText, XCircle } from "lucide-react";
import type { CompileState } from "@/store/compile";
import { cn } from "@/lib/utils";

export function CompileLogControls({ active, onToggle, status, errors, compileTimeMs }: Readonly<
  Pick<CompileState, "status" | "errors" | "compileTimeMs"> & { active: boolean; onToggle: () => void }
>) {
  const { t } = useTranslation(["preview"]);
  const compiling = status === "compiling";
  const derivePreviewSeverity = () => {
    const hasError =
      status === "error" ||
      status === "unavailable" ||
      errors.some((error) => error.kind === "error");
    const hasWarning = !hasError && errors.some((e) => e.kind === "warning");
    const nonErrorSeverity: "warning" | "ok" = hasWarning ? "warning" : "ok";
    const severity: "error" | "warning" | "ok" = hasError ? "error" : nonErrorSeverity;
    return { hasError, severity };
  };
  const { severity } = derivePreviewSeverity();
  const severityToneClass = () => {
    if (severity === "error") return "text-red-500";
    if (severity === "warning") return "text-amber-500";
    return "text-emerald-500";
  };
  const severityTitle = (): string => {
    if (severity === "error") return t(($) => $.preview.toolbar.compiledWithErrors);
    if (severity === "warning") return t(($) => $.preview.toolbar.compiledWithWarnings);
    return t(($) => $.preview.toolbar.compiledSuccessfully);
  };
  const renderSeverityIcon = () => {
    if (severity === "error") return <XCircle className="size-3.5" />;
    if (severity === "warning") return <AlertTriangle className="size-3.5" />;
    return <CheckCircle2 className="size-3.5" />;
  };
  return (
      <div
        data-tour="project-compile-logs"
        className="flex shrink-0 items-center gap-1 whitespace-nowrap"
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            active
              ? t(($) => $.preview.toolbar.showPdf)
              : t(($) => $.preview.toolbar.showLogs)
          }
          aria-pressed={active}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
            active
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <ScrollText className="size-3.5" />
          {t(($) => $.preview.toolbar.logs)}
          {errors.length > 0 && (
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-semibold text-white",
                severity === "error" ? "bg-red-500" : "bg-amber-500"
              )}
            >
              {errors.length}
            </span>
          )}
        </button>

        {!compiling && status !== "idle" && (
          <span
            className={cn(
              "flex items-center gap-1 text-[10px] font-medium tabular-nums",
              severityToneClass()
            )}
            title={severityTitle()}
            data-testid="compile-status"
            data-severity={severity}
          >
            {renderSeverityIcon()}
            {severity === "error" || compileTimeMs == null
              ? t(($) => $.preview.toolbar.failed)
              : t(($) => $.preview.toolbar.duration, {
                  seconds: (compileTimeMs / 1000).toFixed(1),
                })}
          </span>
        )}

      </div>

  );
}
