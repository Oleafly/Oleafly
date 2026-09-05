import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ResearchTask, ResearchTaskEdit } from "@/lib/research-tasks";
import type { ResearchTaskAgentOption } from "./ResearchTasksPanel";

export interface ResearchTaskStarter {
  id: string;
  label: string;
  title: string;
  prompt: string;
  skillIds: string[];
}

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
  onCreate: (input: ResearchTaskEdit & { projectId: string }) => Promise<void>;
  onSave: (taskId: string, input: ResearchTaskEdit) => Promise<void>;
}

function selectedAgentKey(agent: Pick<ResearchTaskAgentOption, "runtimeId" | "agentId" | "modelId">): string {
  return `${agent.runtimeId}\u0000${agent.agentId}\u0000${agent.modelId}`;
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
  onCreate,
  onSave,
}: TaskComposerProps) {
  const firstAvailable = useMemo(
    () => agents.find((agent) => agent.available !== false) ?? agents[0],
    [agents],
  );
  const [title, setTitle] = useState(editingTask?.title ?? "");
  const [prompt, setPrompt] = useState(editingTask?.prompt ?? "");
  const [agentKey, setAgentKey] = useState(() => editingTask
    ? selectedAgentKey(editingTask)
    : firstAvailable ? selectedAgentKey(firstAvailable) : "");
  const [skillIds, setSkillIds] = useState<string[]>(editingTask?.skillIds ?? []);
  const [dependencyIds, setDependencyIds] = useState<string[]>(editingTask?.dependencyIds ?? []);

  useEffect(() => {
    if (firstAvailable) setAgentKey((current) => current || selectedAgentKey(firstAvailable));
  }, [firstAvailable]);

  const chooseStarter = (starterId: string) => {
    const starter = RESEARCH_TASK_STARTERS.find((candidate) => candidate.id === starterId);
    if (!starter) return;
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
    if (editingTask) await onSave(editingTask.id, input);
    else await onCreate({ projectId, ...input });
  };

  const selectableDependencies = tasks.filter(
    (task) => task.id !== editingTask?.id && task.status !== "cancelled",
  );
  const chosenAgent = agents.find((candidate) => selectedAgentKey(candidate) === agentKey);
  const canSubmit =
    Boolean(title.trim()) &&
    Boolean(prompt.trim()) &&
    Boolean(chosenAgent) &&
    chosenAgent?.available !== false &&
    !busy;

  return (
    <section
      aria-labelledby="research-task-composer-title"
      className="space-y-4 rounded-lg border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="research-task-composer-title" className="text-sm font-semibold">
            {editingTask ? "Edit queued task" : "New research task"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Work stays in a separate workspace until you review and apply it.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {!editingTask ? (
        <div className="space-y-1.5">
          <label htmlFor="research-task-starter" className="text-xs font-medium">
            Start from
          </label>
          <select
            id="research-task-starter"
            disabled={busy}
            defaultValue=""
            onChange={(event) => chooseStarter(event.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">A blank task</option>
            {RESEARCH_TASK_STARTERS.map((starter) => (
              <option key={starter.id} value={starter.id}>
                {starter.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="space-y-1.5">
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

      <div className="space-y-1.5">
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

      <div className="space-y-1.5">
        <label htmlFor="research-task-agent" className="text-xs font-medium">
          Agent and model
        </label>
        <select
          id="research-task-agent"
          disabled={busy}
          value={agentKey}
          onChange={(event) => setAgentKey(event.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {agents.length === 0 ? <option value="">No agents available</option> : null}
          {agents.length > 0 && !chosenAgent ? <option value={agentKey} disabled>Choose an agent and model</option> : null}
          {agents.map((agent) => (
            <option
              key={selectedAgentKey(agent)}
              value={selectedAgentKey(agent)}
              disabled={agent.available === false}
            >
              {agent.label}
              {agent.modelLabel ? ` · ${agent.modelLabel}` : ""}
              {agent.available === false ? " (unavailable)" : ""}
            </option>
          ))}
        </select>
        {chosenAgent?.available === false && chosenAgent.unavailableReason ? (
          <p className="text-xs text-destructive">{chosenAgent.unavailableReason}</p>
        ) : null}
      </div>

      {selectableDependencies.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">Wait for these tasks</legend>
          <div className="max-h-32 space-y-2 overflow-auto rounded-md border p-2">
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

      <div className="flex justify-end">
        <Button disabled={!canSubmit} onClick={() => void submit().catch(() => {})}>
          {busy ? "Saving..." : editingTask ? "Save task" : "Create task"}
        </Button>
      </div>
    </section>
  );
}
