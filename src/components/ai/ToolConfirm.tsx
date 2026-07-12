import { ShieldAlert, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import type { ToolApprovalRequest } from "@/lib/ai-tools";

/** Tools that rewrite project content (session auto-approve may cover these). */
const WRITE_TOOLS = new Set([
  "write_file",
  "replace_in_file",
  "create_file",
  "rename_file",
]);

/** Destructive tools that always require an explicit click (never auto-approved). */
const ALWAYS_CONFIRM = new Set(["delete_file"]);

export function isAutoApprovable(tool: string): boolean {
  return WRITE_TOOLS.has(tool) && !ALWAYS_CONFIRM.has(tool);
}

/**
 * Inline approval prompt shown when the AI wants to run a destructive tool
 * (write / replace / delete / rename). Modeled on the AI SDK Elements
 * "Confirmation" pattern (alert + approve/reject), styled to the app's tokens.
 * The assistant's stream is paused on the tool until the user chooses.
 */
export function ToolConfirm({
  req,
  onApprove,
  onReject,
  onApproveSession,
  sessionAutoApprove,
}: {
  req: ToolApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
  /** Optional: approve this write and auto-approve further writes this session. */
  onApproveSession?: () => void;
  /** When true, a banner notes that session auto-approve is on. */
  sessionAutoApprove?: boolean;
}) {
  const canSession = isAutoApprovable(req.tool) && !!onApproveSession;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirm AI edit"
      className="mx-3 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">The assistant wants to change your files</p>
          <p className="mt-0.5 break-words text-muted-foreground">
            <code className="rounded bg-muted px-1 py-0.5 font-mono">{req.tool}</code>{" "}
            {req.summary}
          </p>
          {sessionAutoApprove && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              Session auto-approve is on for writes (deletes still need a click).
            </p>
          )}
        </div>
      </div>
      {req.image && (
        <div className="mt-2 flex justify-center overflow-hidden rounded-md border bg-white p-2">
          <img
            src={req.image}
            alt="Figure preview"
            className="max-h-64 max-w-full object-contain"
          />
        </div>
      )}
      {req.diff && (
        <div className="mt-2 overflow-hidden rounded-md border bg-background">
          <div className="max-h-72 overflow-auto text-[12px]">
            <InlineDiffPreview
              path={req.diff.path}
              oldText={req.diff.oldText}
              newText={req.diff.newText}
            />
          </div>
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Reject"
          data-testid="tool-confirm-reject"
          onClick={onReject}
        >
          <X className="size-3.5" /> Reject
        </Button>
        {canSession && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Always allow writes"
            data-testid="tool-confirm-approve-session"
            onClick={onApproveSession}
          >
            <Check className="size-3.5" /> Always allow writes
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          aria-label="Approve"
          data-testid="tool-confirm-approve"
          onClick={onApprove}
        >
          <Check className="size-3.5" /> Approve
        </Button>
      </div>
    </div>
  );
}
