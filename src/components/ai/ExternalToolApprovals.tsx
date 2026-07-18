import { useMcpApprovalStore } from "@/store/mcp-approvals";
import { AI_GRADIENT, AI_PROMPT_SURFACE } from "@/components/ai/AiChrome";
import { ToolConfirm, isAutoApprovable } from "@/components/ai/ToolConfirm";
import { cn } from "@/lib/utils";

// Reuses the ToolConfirm card from the in-app chat so approval semantics
// and the diff preview stay identical for MCP (external agent) requests.
export function ExternalToolApprovals() {
  const queue = useMcpApprovalStore((s) => s.queue);
  const sessionAutoApprove = useMcpApprovalStore((s) => s.sessionAutoApprove);
  const decide = useMcpApprovalStore((s) => s.decide);
  const approveSession = useMcpApprovalStore((s) => s.approveSession);
  const head = queue[0];
  if (!head) return null;
  return (
    <div
      data-testid="mcp-approval-panel"
      className={cn(
        "fixed bottom-4 right-4 z-50 w-[420px] max-w-[calc(100vw-2rem)] rounded-xl bg-gradient-to-br p-0.5 shadow-2xl shadow-[#9B72CB]/25",
        AI_GRADIENT,
      )}
    >
      <div
        className={cn(
          AI_PROMPT_SURFACE,
          "overflow-hidden rounded-[10px] backdrop-blur-sm",
        )}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <p className="text-xs font-medium text-foreground">External agent request (MCP)</p>
          {queue.length > 1 && (
            <span className="text-[11px] text-muted-foreground">{queue.length - 1} more waiting</span>
          )}
        </div>
        <div className="p-2 pt-2">
          <ToolConfirm
            embedded
            req={head.req}
            onApprove={() => decide(head.id, true)}
            onReject={() => decide(head.id, false)}
            onApproveSession={
              isAutoApprovable(head.req.tool) ? () => approveSession(head.id) : undefined
            }
            sessionAutoApprove={sessionAutoApprove}
          />
        </div>
      </div>
    </div>
  );
}
