import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { approvalsList, approvalsSet } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

// Editor for the per-project decisions saved from the tool-approval prompt
// ("Always in this project"). Removing a rule makes that tool prompt again.
export function ProjectApprovals() {
  const { t } = useTranslation(["settings"]);
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
      <div className="text-sm font-medium">{t(($) => $.settings.ai.approvals.project.title)}</div>
      <div className="mb-2 text-xs text-muted-foreground">
        {t(($) => $.settings.ai.approvals.project.description, {
          name: projectName || t(($) => $.settings.ai.approvals.project.thisProject),
        })}
      </div>
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.ai.approvals.project.empty)}
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
                {decision === "allow"
                  ? t(($) => $.settings.ai.approvals.project.allowed)
                  : t(($) => $.settings.ai.approvals.project.denied)}
              </span>
              <button
                type="button"
                aria-label={t(($) => $.settings.ai.approvals.project.removeRule, { tool })}
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
