import { lazy, Suspense, useMemo, useState } from "react";
import { BarChart3, History, Plus, Settings2 } from "lucide-react";
import { AssistantFloatButton } from "@/components/ai/AssistantShellHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { acpDisconnect, acpError, acpStart } from "@/lib/acp";
import { isDelegatedSession, useAcpSessionsStore } from "@/store/acp-sessions";
import { useSettingsStore } from "@/store/settings";

const UsageReportDialog = lazy(() =>
  import("@/components/usage/UsageReport").then((module) => ({
    default: module.UsageReportDialog,
  })),
);

export function openCliAgentSettings() {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("ai");
  settings.setSettingsScrollTarget("ai-agents");
  settings.setSettingsOpen(true);
}

const ACTION_CLASS = "size-7 text-muted-foreground hover:text-foreground";

function AcpWorkspaceActions({ projectId }: { projectId: string }) {
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const allSessions = useAcpSessionsStore((state) => state.sessions);
  const activeId = useAcpSessionsStore((state) => state.activeByProject[projectId] ?? null);
  const agentId = useAcpSessionsStore((state) => state.composers[projectId]?.agentId ?? null);
  const setError = useAcpSessionsStore((state) => state.setError);
  const [busy, setBusy] = useState(false);
  const session = activeId ? allSessions[activeId] : undefined;
  const running = session?.status === "running" || session?.status === "cancelling";
  const installed = catalog.some((agent) => agent.definition.id === agentId && agent.installed);
  const sessions = useMemo(
    () =>
      Object.values(allSessions)
        .filter((value) => value.projectId === projectId && !isDelegatedSession(value))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [allSessions, projectId],
  );

  const perform = async (action: () => Promise<void>) => {
    setError(projectId, null);
    setBusy(true);
    try {
      await action();
    } catch (value) {
      setError(projectId, acpError(value));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    void perform(async () => {
      if (!agentId) return;
      const current = useAcpSessionsStore.getState();
      const openId = current.activeByProject[projectId];
      const open = openId ? current.sessions[openId] : undefined;
      if (openId && open && ["ready", "auth_required"].includes(open.status)) {
        await acpDisconnect(projectId, openId);
      }
      const snapshot = await acpStart(projectId, agentId);
      useAcpSessionsStore.getState().setSnapshot(snapshot);
      useAcpSessionsStore.getState().setActive(projectId, snapshot.session.id);
    });

  const openSaved = (selectedId: string) => {
    if (selectedId === activeId) return;
    void perform(async () => {
      if (activeId && session?.status === "ready") await acpDisconnect(projectId, activeId);
      await useAcpSessionsStore.getState().open(projectId, selectedId);
    });
  };

  return (
    <>
      <Tooltip label="New conversation">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="New conversation"
          data-testid="acp-new-conversation"
          className={ACTION_CLASS}
          disabled={busy || running || !installed}
          onClick={start}
        >
          <Plus className="size-4" />
        </Button>
      </Tooltip>
      <DropdownMenu>
        <Tooltip label="Saved conversations">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Saved conversations"
              data-testid="acp-history-picker"
              className={ACTION_CLASS}
              disabled={busy || running || sessions.length === 0}
            >
              <History className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="z-[100] max-h-72 w-72 overflow-y-auto">
          <DropdownMenuLabel>Saved conversations</DropdownMenuLabel>
          {sessions.map((value) => (
            <DropdownMenuItem
              key={value.id}
              data-value={value.id}
              data-current={value.id === activeId ? "true" : undefined}
              onSelect={() => openSaved(value.id)}
            >
              <span className="min-w-0 flex-1 truncate">
                {value.title || "Untitled conversation"} · {value.agentId}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function AssistantShellAcpActions({ projectId }: { projectId?: string | null }) {
  return (
    <>
      {projectId ? <AcpWorkspaceActions projectId={projectId} /> : null}
      <Tooltip label="Agent setup">
        <Button
          variant="ghost"
          size="icon"
          className={ACTION_CLASS}
          aria-label="Agent setup"
          onClick={openCliAgentSettings}
        >
          <Settings2 className="size-4" />
        </Button>
      </Tooltip>
      <Suspense fallback={null}>
        <Tooltip label="Usage report">
          <UsageReportDialog
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className={ACTION_CLASS}
                aria-label="Usage report"
              >
                <BarChart3 className="size-4" />
              </Button>
            }
          />
        </Tooltip>
      </Suspense>
      <AssistantFloatButton />
    </>
  );
}
