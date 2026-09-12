import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, AlertTriangle, ChevronRight, CornerDownLeft, Info, Sparkles } from "lucide-react";
import { standardChips, type Finding, type Severity } from "@oleafly/preflight";
import { gotoRange } from "@/components/editor/cm/controller";
import { revealSourceEditor } from "@/components/editor/wysiwyg/controller";
import { askAiAboutFinding } from "@/features/ask-ai-preflight";
import { useFilesStore } from "@/store/files";
import { cn } from "@/lib/utils";
import { renderDetail, renderMessage, type PreflightTranslate } from "./message";

const SEV: Record<Severity, { icon: typeof Info; color: string }> = {
  error: { icon: AlertCircle, color: "text-red-500" },
  warning: { icon: AlertTriangle, color: "text-amber-500" },
  info: { icon: Info, color: "text-muted-foreground" },
};

export const FindingRow = memo(function FindingRow({ finding }: { finding: Finding }) {
  const { t } = useTranslation(["common", "preflight"]);
  const tp = t as unknown as PreflightTranslate;
  const [open, setOpen] = useState(false);
  const citations = standardChips(finding.standards);
  const sev = SEV[finding.severity];
  const Icon = sev.icon;
  const sourceRange =
    typeof finding.from === "number" && typeof finding.to === "number"
      ? { from: finding.from, to: finding.to }
      : null;
  const jumpToSource = async () => {
    if (!sourceRange) return;
    if (finding.file && useFilesStore.getState().activePath !== finding.file) {
      await useFilesStore.getState().openFile(finding.file);
    }
    revealSourceEditor();
    requestAnimationFrame(() => gotoRange(sourceRange.from, sourceRange.to));
  };

  return (
    <div className="rounded-md border border-sidebar-border bg-black/[0.03] dark:bg-background">
      <button type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-sidebar-accent"
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0", sev.color)} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug">{renderMessage(tp, finding.title)}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{tp(`preflight:lens.${finding.lens}`)}</span>
            {finding.page != null && <span>·{" "}{t(($) => $.preflight.finding.page, { page: finding.page })}</span>}
            {finding.file && <span className="truncate">·{" "}{finding.file}</span>}
            {finding.certainty === "advisory" && <span>·{" "}{t(($) => $.preflight.finding.review)}</span>}
            {finding.certainty === "manual" && <span>·{" "}{t(($) => $.preflight.finding.manual)}</span>}
          </span>
        </span>
        <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="border-t border-sidebar-border px-2.5 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">{renderDetail(tp, finding)}</p>
          {citations.length > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-[10px] text-muted-foreground">
              {citations.map((citation, index) => (
                <span key={citation.label} className="inline-flex items-center gap-1">
                  {index > 0 && <span aria-hidden="true">·</span>}
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={citation.detail}
                    className="hover:text-foreground hover:underline"
                  >
                    {citation.label}
                  </a>
                </span>
              ))}
            </p>
          )}
          {finding.machineCheckable === false && (
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {t(($) => $.preflight.finding.needsJudgment)}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {sourceRange && (
              <button type="button"
                onClick={() => void jumpToSource()}
                className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent"
              >
                <CornerDownLeft className="size-3" /> {t(($) => $.preflight.finding.jumpToSource)}
              </button>
            )}
            <button type="button"
              onClick={() => void askAiAboutFinding(finding)}
              className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs text-primary hover:bg-accent"
            >
              <Sparkles className="size-3" /> {t(($) => $.preflight.finding.fixWithAi)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
