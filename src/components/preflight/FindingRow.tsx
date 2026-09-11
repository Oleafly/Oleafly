import { memo, useState } from "react";
import { AlertCircle, AlertTriangle, ChevronRight, CornerDownLeft, Info, Sparkles } from "lucide-react";
import { standardChips, type Finding, type Severity } from "@oleafly/preflight";
import { gotoRange } from "@/components/editor/cm/controller";
import { revealSourceEditor } from "@/components/editor/wysiwyg/controller";
import { askAiAboutFinding } from "@/features/ask-ai-preflight";
import { useFilesStore } from "@/store/files";
import { cn } from "@/lib/utils";

const SEV: Record<Severity, { icon: typeof Info; color: string; label: string }> = {
  error: { icon: AlertCircle, color: "text-red-500", label: "Error" },
  warning: { icon: AlertTriangle, color: "text-amber-500", label: "Warning" },
  info: { icon: Info, color: "text-muted-foreground", label: "Note" },
};

const LENS_LABEL: Record<Finding["lens"], string> = {
  ats: "ATS",
  a11y: "Accessibility",
  both: "ATS + Accessibility",
  refs: "References",
  compile: "Compile",
  submission: "Submission",
  privacy: "Privacy",
};

export const FindingRow = memo(function FindingRow({ finding }: { finding: Finding }) {
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
          <span className="block text-sm leading-snug">{finding.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{LENS_LABEL[finding.lens]}</span>
            {finding.page != null && <span>· p.{finding.page}</span>}
            {finding.file && <span className="truncate">· {finding.file}</span>}
            {finding.certainty === "advisory" && <span>· Review</span>}
            {finding.certainty === "manual" && <span>· Manual</span>}
          </span>
        </span>
        <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="border-t border-sidebar-border px-2.5 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
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
              Needs your judgment. No tool can decide this one from the file alone.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {sourceRange && (
              <button type="button"
                onClick={() => void jumpToSource()}
                className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent"
              >
                <CornerDownLeft className="size-3" /> Jump to source
              </button>
            )}
            <button type="button"
              onClick={() => void askAiAboutFinding(finding)}
              className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs text-primary hover:bg-accent"
            >
              <Sparkles className="size-3" /> Fix with AI
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
