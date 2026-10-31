import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical, Settings2 } from "lucide-react";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScrollMemory } from "@/hooks/use-scroll-memory";
import { useSidebarViewMemory } from "@/hooks/use-sidebar-view-memory";
import { readSidebarView } from "@/store/sidebar-view-state";
import { ResearchRootsPanel } from "@/components/research/workspace/ResearchRootsPanel";
import { ResearchTasksPanel, type ResearchTaskAgentOption } from "@/components/research/tasks/ResearchTasksPanel";
import { knownProviderConfig, loadProviderConfig, subscribeProviderConfig, deriveProviderState } from "@/components/ai/provider-config";
import { useAgentTargets } from "@/components/ai/use-agent-targets";
import { configuredModelGroups } from "@/lib/ai-model-groups";
import type { ResearchTask } from "@/lib/research-tasks";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useAssistantRuntimeStore } from "@/store/assistant-runtime";
import { useFilesStore } from "@/store/files";
import { useResearchTasksStore } from "@/store/research-tasks";
import { useSettingsStore } from "@/store/settings";
import { i18n } from "@/i18n";

export function ResearchWorkspacePanel() {
  const { t } = useTranslation(["common", "researchTools"]);
  const projectId = useFilesStore((state) => state.projectId);
  const [tab, setTab] = useState<"tasks" | "folders">(
    () => readSidebarView(projectId, "researchWorkspace")?.tab ?? "tasks",
  );
  useSidebarViewMemory(projectId, "researchWorkspace", { tab });
  const previousProjectId = useRef(projectId);
  useEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    setTab((current) => readSidebarView(projectId, "researchWorkspace")?.tab ?? current);
  }, [projectId]);
  const taskDetailOpen = useResearchTasksStore((state) => state.detailOpen);
  useEffect(() => {
    if (taskDetailOpen) setTab("tasks");
  }, [taskDetailOpen]);
  const foldersRef = useRef<HTMLDivElement>(null);
  useScrollMemory({ scrollRef: foldersRef, projectId, slot: "research.folders" });
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
    return configuredModelGroups(
      { keys: state.keysMap, customProviders: state.customProviders, providerModels: state.providerModelsMap },
      { keep: { providerId: state.provider, modelId: state.model } },
    );
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
    useResearchTasksStore.getState().setDetailOpen(false);
    useAssistantRuntimeStore.getState().setRuntime("acp");
    useAcpSessionsStore.getState().setActive(projectId, task.nativeSessionId);
    void useAcpSessionsStore.getState().open(projectId, task.nativeSessionId).catch(() => {});
    useSettingsStore.getState().setAssistantOpen(true);
  }, [projectId]);
  const openSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("research");
    settings.setSettingsOpen(true);
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-tour="research-workspace" data-testid="research-workspace-panel">
      <SidebarPanelHeader
        icon={FlaskConical}
        title={t(($) => $.researchTools.workspace.title)}
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t(($) => $.researchTools.workspace.openSettings)}
          onClick={openSettings}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </SidebarPanelHeader>
      {configError && <output className="block px-3 pt-2 text-xs text-destructive">{configError}</output>}
      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next === "folders" ? "folders" : "tasks")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList fill className="mx-3 mt-2 shrink-0">
          <TabsTrigger value="tasks" data-tour="research-tasks" className="px-2">
            <span className="truncate">{t(($) => $.researchTools.workspace.tabTasks)}</span>
          </TabsTrigger>
          <TabsTrigger value="folders" data-tour="research-folders" className="px-2">
            <span className="truncate">{t(($) => $.researchTools.workspace.tabFolders)}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tasks" className="min-h-0 flex-1 overflow-auto">
          <ResearchTasksPanel projectId={projectId} agents={agents} customProviders={config?.ai_custom_providers} onOpenSession={openSession} />
        </TabsContent>
        <TabsContent value="folders" ref={foldersRef} className="min-h-0 flex-1 overflow-auto">
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
