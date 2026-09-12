import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { i18n } from "@/i18n";
import { statusLabel } from "./task-status";
import type { ResearchTaskAgentOption } from "./ResearchTasksPanel";

export interface ResearchTaskStarter {
  id: string;
  label: () => string;
  title: () => string;
  prompt: string;
  skillIds: string[];
}

export const BLANK_STARTER_ID = "blank";

export const RESEARCH_TASK_STARTERS: ResearchTaskStarter[] = [
  {
    id: "literature-review",
    label: () => i18n.t(($) => $.researchTools.tasks.starter.literatureReview.label),
    title: () => i18n.t(($) => $.researchTools.tasks.starter.literatureReview.title),
    prompt:
      "Find the most relevant work on this question. Summarize what each source contributes, record stable citation identifiers, and call out gaps or disagreements. Do not invent references.",
    skillIds: ["literature-review"],
  },
  {
    id: "evidence-audit",
    label: () => i18n.t(($) => $.researchTools.tasks.starter.evidenceAudit.label),
    title: () => i18n.t(($) => $.researchTools.tasks.starter.evidenceAudit.title),
    prompt:
      "Check the manuscript's factual claims against its cited sources. List unsupported, overstated, or mismatched claims and suggest precise corrections.",
    skillIds: ["oleafly-verify-claims"],
  },
  {
    id: "analysis",
    label: () => i18n.t(($) => $.researchTools.tasks.starter.analysis.label),
    title: () => i18n.t(($) => $.researchTools.tasks.starter.analysis.title),
    prompt:
      "Inspect the available data and analysis files, run the requested analysis in the isolated workspace, and save the code and outputs needed to reproduce it. Do not change source data.",
    skillIds: ["statistical-analysis"],
  },
  {
    id: "manuscript-revision",
    label: () => i18n.t(($) => $.researchTools.tasks.starter.manuscriptRevision.label),
    title: () => i18n.t(($) => $.researchTools.tasks.starter.manuscriptRevision.title),
    prompt:
      "Revise the manuscript for clarity and accuracy while preserving its claims, citations, structure, and author voice. Keep every change in the isolated workspace for review.",
    skillIds: ["scientific-writing"],
  },
  {
    id: "reviewer-response",
    label: () => i18n.t(($) => $.researchTools.tasks.starter.reviewerResponse.label),
    title: () => i18n.t(($) => $.researchTools.tasks.starter.reviewerResponse.title),
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

function initialAgentKey(
  editingTask: ResearchTask | null,
  firstAvailable: ResearchTaskAgentOption | undefined,
): string {
  if (editingTask) return selectedAgentKey(editingTask);
  if (firstAvailable) return selectedAgentKey(firstAvailable);
  return "";
}

export function composerDraftKey(projectId: string, editingTaskId: string | null): string {
  return `${projectId}\u0000${editingTaskId ?? ""}`;
}

export function TaskComposer(props: Readonly<TaskComposerProps>) {
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
}: Readonly<TaskComposerProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
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
  const [agentKey, setAgentKey] = useState(() => restored?.agentKey ?? initialAgentKey(editingTask, firstAvailable));
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
    setTitle(starter.title());
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

  const submitLabel = () => {
    if (busy) return t(($) => $.researchTools.tasks.composer.saving);
    if (editingTask) return t(($) => $.researchTools.tasks.composer.saveTask);
    return t(($) => $.researchTools.tasks.composer.createTask);
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        className="max-h-[88vh] max-w-2xl overflow-hidden"
        closeDisabled={busy}
        data-testid="research-task-composer"
      >
        <DialogHeader>
          <DialogTitle id="research-task-composer-title">
            {editingTask
              ? t(($) => $.researchTools.tasks.composer.editTitle)
              : t(($) => $.researchTools.tasks.composer.newTitle)}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $.researchTools.tasks.composer.description)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-4 overflow-auto pr-1">
          {!editingTask ? (
            <div className="grid gap-1.5">
              <label htmlFor="research-task-starter" className="text-xs font-medium">
                {t(($) => $.researchTools.tasks.composer.starterLabel)}
              </label>
              <Select value={starterId} disabled={busy} onValueChange={chooseStarter}>
                <SelectTrigger
                  id="research-task-starter"
                  aria-label={t(($) => $.researchTools.tasks.composer.starterLabel)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BLANK_STARTER_ID}>
                    {t(($) => $.researchTools.tasks.composer.blankStarter)}
                  </SelectItem>
                  {RESEARCH_TASK_STARTERS.map((starter) => (
                    <SelectItem key={starter.id} value={starter.id}>
                      {starter.label()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <label htmlFor="research-task-title" className="text-xs font-medium">
              {t(($) => $.researchTools.tasks.composer.titleLabel)}
            </label>
            <Input
              id="research-task-title"
              disabled={busy}
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t(($) => $.researchTools.tasks.composer.titlePlaceholder)}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="research-task-prompt" className="text-xs font-medium">
              {t(($) => $.researchTools.tasks.composer.promptLabel)}
            </label>
            <Textarea
              id="research-task-prompt"
              disabled={busy}
              value={prompt}
              maxLength={32_000}
              rows={7}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t(($) => $.researchTools.tasks.composer.promptPlaceholder)}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="research-task-agent" className="text-xs font-medium">
              {t(($) => $.researchTools.tasks.composer.agentLabel)}
            </label>
            <Select
              value={agentKey}
              disabled={busy || agents.length === 0}
              onValueChange={setAgentKey}
            >
              <SelectTrigger
                id="research-task-agent"
                aria-label={t(($) => $.researchTools.tasks.composer.agentLabel)}
                className="[&>span]:flex [&>span]:min-w-0 [&>span]:flex-1"
              >
                <SelectValue
                  placeholder={
                    agents.length === 0
                      ? t(($) => $.researchTools.tasks.composer.noAgents)
                      : t(($) => $.researchTools.tasks.composer.chooseAgent)
                  }
                >
                  {chosenAgent ? (
                    <AgentSummary agent={chosenAgent} compact />
                  ) : (
                    t(($) => $.researchTools.tasks.composer.chooseAgent)
                  )}
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
                {t(($) => $.researchTools.tasks.composer.configureAgent)}
              </p>
            ) : null}
            {chosenAgent?.available === false && chosenAgent.unavailableReason ? (
              <p className="text-xs text-destructive">{chosenAgent.unavailableReason}</p>
            ) : null}
          </div>

          {selectableDependencies.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="text-xs font-medium">
                {t(($) => $.researchTools.tasks.composer.dependencies)}
              </legend>
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
                          {t(($) => $.researchTools.tasks.composer.dependencyStatus, {
                            status: statusLabel(task.status),
                          })}
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
            {t(($) => $.common.actions.cancel)}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {submitLabel()}
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
}: Readonly<{
  agent: ResearchTaskAgentOption;
  showReason?: boolean;
  compact?: boolean;
}>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const detail = [
    agent.modelLabel,
    agent.available === false ? t(($) => $.researchTools.tasks.composer.unavailable) : null,
  ]
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
