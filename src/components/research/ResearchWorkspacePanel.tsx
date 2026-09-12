import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical, Settings2 } from "lucide-react";
import { BetaBadge } from "@/components/ui/beta-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResearchRootsPanel } from "@/components/research/workspace/ResearchRootsPanel";
import { ResearchTasksPanel, type ResearchTaskAgentOption } from "@/components/research/tasks/ResearchTasksPanel";
import { knownProviderConfig, loadProviderConfig, subscribeProviderConfig, deriveProviderState } from "@/components/ai/provider-config";
import { useAgentTargets } from "@/components/ai/use-agent-targets";
import { mergeCustomProviders } from "@/lib/ai-providers";
import { enabledModels } from "@/lib/ai-model-state";
import type { ResearchTask } from "@/lib/research-tasks";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useAssistantRuntimeStore } from "@/store/assistant-runtime";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { i18n } from "@/i18n";

export function ResearchWorkspacePanel() {
  const { t } = useTranslation(["common", "researchTools"]);
  const projectId = useFilesStore((state) => state.projectId);
  const [config, setConfig] = useState(knownProviderConfig);
  const [configError, setConfigError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const unsubscribe = subscribeProviderConfig((next) => {
      if (current) { setConfig(next); setConfigError(null); }
    });
    void loadProviderConfig().then((next) => {
      if (current) { setConfig(next); setConfigError(null); }
    }).catch(() => {
      if (current) setConfigError(i18n.t(($) => $.researchTools.workspace.configError));
    });
    return () => { current = false; unsubscribe(); };
  }, []);
  const groups = useMemo(() => {
    if (!config) return [];
    const state = deriveProviderState(config);
    return mergeCustomProviders(state.customProviders)
      .filter((provider) => Boolean(state.keysMap[provider.id]?.trim()) || state.customProviders.some((custom) => custom.id === provider.id && custom.keyOptional))
      .map((provider) => {
        const models = state.providerModelsMap[provider.id];
        const available = models ? enabledModels(models).map((model) => ({ id: model.id, name: model.name })) : [...provider.models];
        if (provider.id === state.provider && state.model && !available.some((model) => model.id === state.model)) available.push({ id: state.model, name: state.model });
        return { id: provider.id, name: provider.name, models: available };
      });
  }, [config]);
  const targets = useAgentTargets(projectId, groups);
  const agents = useMemo<ResearchTaskAgentOption[]>(() => targets.map((target) => ({
    runtimeId: target.runtime === "built-in" ? "builtin" : "acp",
    agentId: target.agentId ?? target.providerId ?? "",
    modelId: target.modelId ?? "",
    label: target.label,
    agentName: target.runtime === "built-in"
      ? groups.find((group) => group.id === target.providerId)?.name
      : target.label,
    modelLabel: target.detail,
    available: !target.taskUnavailableReason,
    unavailableReason: target.taskUnavailableReason ?? undefined,
  })), [groups, targets]);
  const openSession = useCallback((task: ResearchTask) => {
    if (!projectId || task.runtimeId !== "acp" || !task.nativeSessionId) return;
    useAssistantRuntimeStore.getState().setRuntime("acp");
    useAcpSessionsStore.getState().setActive(projectId, task.nativeSessionId);
    void useAcpSessionsStore.getState().open(projectId, task.nativeSessionId).catch(() => {});
    useSettingsStore.getState().setAssistantOpen(true);
  }, [projectId]);
  const openSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("ai");
    settings.setSettingsOpen(true);
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-tour="research-workspace" data-testid="research-workspace-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <FlaskConical className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{t(($) => $.researchTools.workspace.title)}</h2>
        <BetaBadge />
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t(($) => $.researchTools.workspace.configureAgents)}
          onClick={openSettings}
        >
          <Settings2 className="size-4" />
        </Button>
      </div>
      {configError && <output className="block px-3 pt-2 text-xs text-destructive">{configError}</output>}
      <Tabs defaultValue="tasks" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-2 grid shrink-0 grid-cols-2">
          <TabsTrigger value="tasks" data-tour="research-tasks">
            {t(($) => $.researchTools.workspace.tabTasks)}
          </TabsTrigger>
          <TabsTrigger value="folders" data-tour="research-folders">
            {t(($) => $.researchTools.workspace.tabFolders)}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tasks" className="min-h-0 flex-1 overflow-auto">
          <ResearchTasksPanel projectId={projectId} agents={agents} onOpenSession={openSession} />
        </TabsContent>
        <TabsContent value="folders" className="min-h-0 flex-1 overflow-auto">
          {projectId ? (
            <ResearchRootsPanel key={projectId} projectId={projectId} />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              {t(($) => $.researchTools.workspace.noProject)}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
