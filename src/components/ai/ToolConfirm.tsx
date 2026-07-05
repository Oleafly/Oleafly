import { ShieldAlert, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ToolApprovalRequest } from "@/lib/ai-tools";

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
}: {
  req: ToolApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm AI edit"
      className="mx-3 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">The assistant wants to change your files</p>
          <p className="mt-0.5 break-words text-muted-foreground">
            <code className="rounded bg-muted px-1 py-0.5 font-mono">{req.tool}</code>
            {" — "}
            {req.summary}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onReject}>
          <X className="size-3.5" /> Reject
        </Button>
        <Button size="sm" onClick={onApprove}>
          <Check className="size-3.5" /> Approve
        </Button>
      </div>
    </div>
  );
}
