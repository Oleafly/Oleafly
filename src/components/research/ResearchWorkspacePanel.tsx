import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResearchRootsPanel } from "@/components/research/workspace/ResearchRootsPanel";
import { ResearchTasksPanel, type ResearchTaskAgentOption } from "@/components/research/tasks/ResearchTasksPanel";
import { knownProviderConfig, loadProviderConfig, subscribeProviderConfig, deriveProviderState } from "@/components/ai/provider-config";
import { useAgentTargets } from "@/components/ai/use-agent-targets";
import { mergeCustomProviders } from "@/lib/ai-providers";
import { enabledModels } from "@/lib/ai-model-state";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export function ResearchWorkspacePanel() {
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
    }).catch(() => { if (current) setConfigError("Assistant settings could not be loaded."); });
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
  const agents: ResearchTaskAgentOption[] = targets.map((target) => ({
    runtimeId: target.runtime === "built-in" ? "builtin" : "acp",
    agentId: target.agentId ?? target.providerId ?? "",
    modelId: target.modelId ?? "",
    label: target.label,
    modelLabel: target.detail,
    available: !target.taskUnavailableReason,
    unavailableReason: target.taskUnavailableReason ?? undefined,
  }));
  const openSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("ai");
    settings.setSettingsOpen(true);
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="research-workspace-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <FlaskConical className="size-4 text-muted-foreground" />
        <h2 className="flex-1 text-sm font-medium">Research workspace</h2>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Configure research agents" onClick={openSettings}><Settings2 className="size-4" /></Button>
      </div>
      {configError && <p role="status" className="px-3 pt-2 text-xs text-destructive">{configError}</p>}
      <Tabs defaultValue="tasks" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-2 grid shrink-0 grid-cols-2">
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="folders">Linked folders</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks" className="min-h-0 flex-1 overflow-auto">
          <ResearchTasksPanel projectId={projectId} agents={agents} />
        </TabsContent>
        <TabsContent value="folders" className="min-h-0 flex-1 overflow-auto">
          {projectId ? <ResearchRootsPanel key={projectId} projectId={projectId} /> : <p className="p-4 text-sm text-muted-foreground">Open a project to link its research folders.</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
