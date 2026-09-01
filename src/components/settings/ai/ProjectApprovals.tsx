import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { approvalsList, approvalsSet } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

// Editor for the per-project decisions saved from the tool-approval prompt
// ("Always in this project"). Removing a rule makes that tool prompt again.
export function ProjectApprovals() {
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const client = useQueryClient();
  const decisions = useQuery({
    queryKey: ["project-approvals", projectId],
    queryFn: () => approvalsList(projectId ?? ""),
    enabled: !!projectId,
    staleTime: 0,
    meta: { silent: true },
  });
  const remove = useMutation({
    mutationFn: (tool: string) => approvalsSet(projectId ?? "", tool, null),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["project-approvals", projectId] }),
  });

  if (!projectId) return null;
  const rules = Object.entries(decisions.data ?? {});

  return (
    <div
      id="ai-project-approvals"
      className="rounded-lg border bg-card p-3"
      data-testid="project-approvals"
    >
      <div className="text-sm font-medium">Tool approvals</div>
      <div className="mb-2 text-xs text-muted-foreground">
        Saved rules for {projectName || "this project"}. They apply when the approval mode is
        Custom. Remove a rule to use the standard risk policy for that tool.
      </div>
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No saved rules yet. Use "Always in this project" on an approval prompt to add one.
        </p>
      ) : (
        <ul className="space-y-1">
          {rules.map(([tool, decision]) => (
            <li
              key={tool}
              className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs"
            >
              <code className="font-mono">{tool}</code>
              <span
                className={
                  decision === "allow"
                    ? "rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                    : "rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
                }
              >
                {decision === "allow" ? "Always allowed" : "Always denied"}
              </span>
              <button
                type="button"
                aria-label={`Remove rule for ${tool}`}
                onClick={() => remove.mutate(tool)}
                className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
