import { useEffect, useMemo, useState } from "react";
import { Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import type { ResearchTask, ResearchTaskEdit } from "@/lib/research-tasks";
import { useResearchTasksStore, type ResearchTaskComposerDraft } from "@/store/research-tasks";
import type { ResearchTaskAgentOption } from "./ResearchTasksPanel";

export interface ResearchTaskStarter {
  id: string;
  label: string;
  title: string;
  prompt: string;
  skillIds: string[];
}

export const BLANK_STARTER_ID = "blank";

export const RESEARCH_TASK_STARTERS: ResearchTaskStarter[] = [
  {
    id: "literature-review",
    label: "Literature review",
    title: "Review the literature",
    prompt:
      "Find the most relevant work on this question. Summarize what each source contributes, record stable citation identifiers, and call out gaps or disagreements. Do not invent references.",
    skillIds: ["literature-review"],
  },
  {
    id: "evidence-audit",
    label: "Evidence audit",
    title: "Audit the evidence",
    prompt:
      "Check the manuscript's factual claims against its cited sources. List unsupported, overstated, or mismatched claims and suggest precise corrections.",
    skillIds: ["oleafly-verify-claims"],
  },
  {
    id: "analysis",
    label: "Analysis",
    title: "Run the analysis",
    prompt:
      "Inspect the available data and analysis files, run the requested analysis in the isolated workspace, and save the code and outputs needed to reproduce it. Do not change source data.",
    skillIds: ["statistical-analysis"],
  },
  {
    id: "manuscript-revision",
    label: "Manuscript revision",
    title: "Revise the manuscript",
    prompt:
      "Revise the manuscript for clarity and accuracy while preserving its claims, citations, structure, and author voice. Keep every change in the isolated workspace for review.",
    skillIds: ["scientific-writing"],
  },
  {
    id: "reviewer-response",
    label: "Response to reviewers",
    title: "Draft the reviewer response",
    prompt:
      "Draft a point-by-point response using the reviewer comments and manuscript. Separate proposed manuscript edits from the response letter, and flag requests that need an author decision.",
    skillIds: ["peer-review"],
  },
];

interface TaskComposerProps {
  projectId: string;
  agents: ResearchTaskAgentOption[];
  tasks: ResearchTask[];
  editingTask: ResearchTask | null;
  busy: boolean;
  onCancel: () => void;
  onDismiss?: () => void;
  onCreate: (input: ResearchTaskEdit & { projectId: string }) => Promise<void>;
  onSave: (taskId: string, input: ResearchTaskEdit) => Promise<void>;
}

function selectedAgentKey(agent: Pick<ResearchTaskAgentOption, "runtimeId" | "agentId" | "modelId">): string {
  return `${agent.runtimeId}\u0000${agent.agentId}\u0000${agent.modelId}`;
}

export function composerDraftKey(projectId: string, editingTaskId: string | null): string {
  return `${projectId}\u0000${editingTaskId ?? ""}`;
}

export function TaskComposer(props: TaskComposerProps) {
  return <TaskComposerDraft key={JSON.stringify([props.projectId, props.editingTask?.id ?? null])} {...props} />;
}

function TaskComposerDraft({
  projectId,
  agents,
  tasks,
  editingTask,
  busy,
  onCancel,
  onDismiss,
  onCreate,
  onSave,
}: TaskComposerProps) {
  const draftId = composerDraftKey(projectId, editingTask?.id ?? null);
  const saveDraft = useResearchTasksStore((state) => state.saveComposerDraft);
  const clearDraft = useResearchTasksStore((state) => state.clearComposerDraft);
  const firstAvailable = useMemo(
    () => agents.find((agent) => agent.available !== false) ?? agents[0],
    [agents],
  );
  const [restored] = useState<ResearchTaskComposerDraft | undefined>(
    () => useResearchTasksStore.getState().composerDrafts[draftId],
  );
  const [starterId, setStarterId] = useState(restored?.starterId ?? BLANK_STARTER_ID);
  const [title, setTitle] = useState(restored?.title ?? editingTask?.title ?? "");
  const [prompt, setPrompt] = useState(restored?.prompt ?? editingTask?.prompt ?? "");
  const [agentKey, setAgentKey] = useState(() => restored?.agentKey
    ?? (editingTask
      ? selectedAgentKey(editingTask)
      : firstAvailable ? selectedAgentKey(firstAvailable) : ""));
  const [skillIds, setSkillIds] = useState<string[]>(restored?.skillIds ?? editingTask?.skillIds ?? []);
  const [dependencyIds, setDependencyIds] = useState<string[]>(
    restored?.dependencyIds ?? editingTask?.dependencyIds ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (firstAvailable) setAgentKey((current) => current || selectedAgentKey(firstAvailable));
  }, [firstAvailable]);

  const chooseStarter = (nextStarterId: string) => {
    setStarterId(nextStarterId);
    const starter = RESEARCH_TASK_STARTERS.find((candidate) => candidate.id === nextStarterId);
    if (!starter) {
      setSkillIds([]);
      return;
    }
    setTitle(starter.title);
    setPrompt(starter.prompt);
    setSkillIds(starter.skillIds);
  };

  const submit = async () => {
    const agent = agents.find((candidate) => selectedAgentKey(candidate) === agentKey);
    if (busy || !agent || agent.available === false || !title.trim() || !prompt.trim()) return;
    const input: ResearchTaskEdit = {
      title: title.trim(),
      prompt: prompt.trim(),
      runtimeId: agent.runtimeId,
      agentId: agent.agentId,
      modelId: agent.modelId,
      skillIds,
      dependencyIds,
    };
    setError(null);
    try {
      if (editingTask) await onSave(editingTask.id, input);
      else await onCreate({ projectId, ...input });
      clearDraft(draftId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const dismiss = () => {
    if (busy) return;
    saveDraft(draftId, { starterId, title, prompt, agentKey, skillIds, dependencyIds });
    (onDismiss ?? onCancel)();
  };

  const cancel = () => {
    clearDraft(draftId);
    onCancel();
  };

  const selectableDependencies = tasks.filter(
    (task) =>
      task.id !== editingTask?.id &&
      task.status !== "cancelled" &&
      task.status !== "failed",
  );
  const chosenAgent = agents.find((candidate) => selectedAgentKey(candidate) === agentKey);
  const canSubmit =
    Boolean(title.trim()) &&
    Boolean(prompt.trim()) &&
    Boolean(chosenAgent) &&
    chosenAgent?.available !== false &&
    !busy;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        className="max-h-[88vh] max-w-2xl overflow-hidden"
        closeDisabled={busy}
        data-testid="research-task-composer"
      >
        <DialogHeader>
          <DialogTitle id="research-task-composer-title">
            {editingTask ? "Edit task" : "New research task"}
          </DialogTitle>
          <DialogDescription>
            Work stays in a separate workspace until you review and apply it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-4 overflow-auto pr-1">
          {!editingTask ? (
            <div className="grid gap-1.5">
              <label htmlFor="research-task-starter" className="text-xs font-medium">
                Start from
              </label>
              <Select value={starterId} disabled={busy} onValueChange={chooseStarter}>
                <SelectTrigger id="research-task-starter" aria-label="Start from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BLANK_STARTER_ID}>A blank task</SelectItem>
                  {RESEARCH_TASK_STARTERS.map((starter) => (
                    <SelectItem key={starter.id} value={starter.id}>
                      {starter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <label htmlFor="research-task-title" className="text-xs font-medium">
              Title
            </label>
            <Input
              id="research-task-title"
              disabled={busy}
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What should this task accomplish?"
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="research-task-prompt" className="text-xs font-medium">
              Instructions
            </label>
            <Textarea
              id="research-task-prompt"
              disabled={busy}
              value={prompt}
              maxLength={32_000}
              rows={7}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the work, the evidence to use, and what should be saved for review."
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="research-task-agent" className="text-xs font-medium">
              Agent and model
            </label>
            <Select
              value={agentKey}
              disabled={busy || agents.length === 0}
              onValueChange={setAgentKey}
            >
              <SelectTrigger
                id="research-task-agent"
                aria-label="Agent and model"
                className="[&>span]:flex [&>span]:min-w-0 [&>span]:flex-1"
              >
                <SelectValue
                  placeholder={agents.length === 0 ? "No agents available" : "Choose an agent and model"}
                >
                  {chosenAgent ? <AgentSummary agent={chosenAgent} compact /> : "Choose an agent and model"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem
                    key={selectedAgentKey(agent)}
                    value={selectedAgentKey(agent)}
                    disabled={agent.available === false}
                    data-label={agent.label}
                    data-agent-id={agent.agentId}
                    data-model-id={agent.modelId}
                    className="py-2"
                  >
                    <AgentSummary agent={agent} showReason />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {agents.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Configure an agent in assistant settings before creating a task.
              </p>
            ) : null}
            {chosenAgent?.available === false && chosenAgent.unavailableReason ? (
              <p className="text-xs text-destructive">{chosenAgent.unavailableReason}</p>
            ) : null}
          </div>

          {selectableDependencies.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="text-xs font-medium">Wait for these tasks</legend>
              <div className="max-h-32 space-y-2 overflow-auto rounded-md border bg-muted/20 p-2">
                {selectableDependencies.map((task) => {
                  const checked = dependencyIds.includes(task.id);
                  const checkboxId = `research-task-dependency-${task.id}`;
                  return (
                    <label
                      key={task.id}
                      htmlFor={checkboxId}
                      className="flex items-start gap-2 text-xs"
                    >
                      <Checkbox
                        id={checkboxId}
                        disabled={busy}
                        checked={checked}
                        onCheckedChange={(next) =>
                          setDependencyIds((current) =>
                            next === true
                              ? [...current, task.id]
                              : current.filter((id) => id !== task.id),
                          )
                        }
                      />
                      <span>
                        {task.title}
                        <span className="ml-1 text-muted-foreground">
                          ({task.status.replace("_", " ")})
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? "Saving..." : editingTask ? "Save task" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentSummary({
  agent,
  showReason = false,
  compact = false,
}: {
  agent: ResearchTaskAgentOption;
  showReason?: boolean;
  compact?: boolean;
}) {
  const detail = [agent.modelLabel, agent.available === false ? "Unavailable" : null]
    .filter(Boolean)
    .join(" · ");
  const icon = (
    <span className="flex size-5 shrink-0 items-center justify-center">
      {agent.runtimeId === "acp" ? (
        <Terminal className="size-4 text-muted-foreground" />
      ) : (
        <ProviderLogo providerId={agent.agentId} size={16} />
      )}
    </span>
  );
  if (compact) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-left">
        {icon}
        <span className="truncate text-sm">{agent.label}</span>
        {detail ? (
          <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2 text-left">
      {icon}
      <span className="min-w-0">
        <span className="block truncate text-sm">{agent.label}</span>
        {detail ? (
          <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
        ) : null}
        {showReason && agent.available === false && agent.unavailableReason ? (
          <span className="block truncate text-[11px] text-destructive">
            {agent.unavailableReason}
          </span>
        ) : null}
      </span>
    </span>
  );
}
