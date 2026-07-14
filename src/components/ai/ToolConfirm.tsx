import { useEffect } from "react";
import { CheckCircle2, FileText, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import type { ToolApprovalRequest } from "@/lib/ai-tools";
import { AiChrome, AiMark, AI_GRADIENT } from "@/components/ai/AiChrome";
import { gotoLine } from "@/components/editor/cm/controller";
import { useFilesStore } from "@/store/files";

export function firstChangedLine(oldText: string, newText: string): number {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if ((a[i] ?? "") !== (b[i] ?? "")) return i + 1;
  }
  return 1;
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

const WRITE_TOOLS = new Set([
  "write_file",
  "replace_in_file",
  "create_file",
  "rename_file",
]);

const ALWAYS_CONFIRM = new Set(["delete_file"]);

export function isAutoApprovable(tool: string): boolean {
  return WRITE_TOOLS.has(tool) && !ALWAYS_CONFIRM.has(tool);
}

// Re-export so MCP shell and others keep a single import path.
export { AI_GRADIENT, AiChrome, AiMark };

export function ToolConfirm({
  req,
  onApprove,
  onReject,
  onApproveSession,
  sessionAutoApprove,
  embedded,
}: {
  req: ToolApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
  onApproveSession?: () => void;
  sessionAutoApprove?: boolean;
  embedded?: boolean;
}) {
  const canSession = isAutoApprovable(req.tool) && !!onApproveSession;
  const filePath = req.diff?.path ?? req.path;
  const changeLine = req.diff ? firstChangedLine(req.diff.oldText, req.diff.newText) : null;

  // Jump the editor to the first changed line so the user sees the edit site
  // next to the approval card (open the file first if it isn't active).
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    void (async () => {
      const files = useFilesStore.getState();
      if (files.activePath !== filePath) {
        await files.openFile(filePath);
      }
      // Let CodeMirror remount on the new active file before scrolling.
      await new Promise((r) => window.setTimeout(r, 40));
      if (cancelled) return;
      gotoLine(changeLine ?? 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [req, filePath, changeLine]);

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <AiMark className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold leading-snug text-foreground">
            The assistant wants to change your files
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="inline-flex items-center rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none text-primary">
              {req.tool}
            </code>
            {filePath && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/80 bg-muted/50 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                <FileText className="size-3 shrink-0 opacity-70" aria-hidden />
                <span className="truncate font-medium text-foreground/80" title={filePath}>
                  {basename(filePath)}
                </span>
              </span>
            )}
            {changeLine != null && (
              <span className="rounded-md px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                line {changeLine}
              </span>
            )}
          </div>
          {sessionAutoApprove && (
            <p className="text-[11px] leading-snug text-[#9B72CB] dark:text-[#c4a5e8]">
              Session auto-approve is on for writes (deletes still need a click).
            </p>
          )}
        </div>
      </div>

      {req.image && (
        <div className="flex justify-center overflow-hidden rounded-lg border bg-white p-2">
          <img
            src={req.image}
            alt="Figure preview"
            className="max-h-64 max-w-full object-contain"
          />
        </div>
      )}

      {req.diff && (
        <div className="overflow-hidden rounded-lg border border-border/80 bg-background shadow-inner">
          <div className="flex items-center gap-1.5 border-b border-border/70 bg-muted/40 px-2.5 py-1.5">
            <FileText className="size-3 text-muted-foreground" aria-hidden />
            <span className="truncate font-mono text-[11px] text-muted-foreground" title={req.diff.path}>
              {req.diff.path}
            </span>
            {changeLine != null && (
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                first change · L{changeLine}
              </span>
            )}
          </div>
          <div className="text-[12px] leading-relaxed [&_.cm-editor]:bg-transparent [&_.cm-gutters]:bg-muted/30 [&_.cm-gutters]:border-border/50 [&_.cm-lineNumbers]:min-w-[2.25rem] [&_.cm-lineNumbers_.cm-gutterElement]:px-1.5 [&_.cm-lineNumbers_.cm-gutterElement]:text-[10px] [&_.cm-lineNumbers_.cm-gutterElement]:text-muted-foreground/70">
            <InlineDiffPreview
              path={req.diff.path}
              oldText={req.diff.oldText}
              newText={req.diff.newText}
              scrollToLine={changeLine ?? undefined}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/50 pt-2.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Reject"
          data-testid="tool-confirm-reject"
          onClick={onReject}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <XCircle className="size-3.5" /> Reject
        </Button>
        {canSession && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Always allow"
            data-testid="tool-confirm-approve-session"
            onClick={onApproveSession}
            className="border-0 bg-emerald-600 text-white shadow-sm hover:bg-emerald-600/90 hover:text-white"
          >
            <CheckCircle2 className="size-3.5" /> Always allow
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          aria-label="Approve"
          data-testid="tool-confirm-approve"
          onClick={onApprove}
        >
          <CheckCircle2 className="size-3.5" /> Approve
        </Button>
      </div>
    </div>
  );

  // Content only; the MCP floating panel owns the gradient shell.
  if (embedded) {
    return (
      <div role="alertdialog" aria-modal="true" aria-label="Confirm AI edit" className="p-1">
        {body}
      </div>
    );
  }

  return (
    <AiChrome className="mx-3 mb-2" contentClassName="p-3.5">
      <div role="alertdialog" aria-modal="true" aria-label="Confirm AI edit">
        {body}
      </div>
    </AiChrome>
  );
}
