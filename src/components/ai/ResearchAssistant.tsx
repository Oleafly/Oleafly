import { lazy, Suspense } from "react";
import { BarChart3, Settings2 } from "lucide-react";
import { ChatCore } from "@/components/ai/ChatCore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { useAssistantRuntimeStore } from "@/store/assistant-runtime";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { cn } from "@/lib/utils";

const AcpWorkspaceAssistant = lazy(() =>
  import("@/components/ai/acp/AcpWorkspaceAssistant").then((module) => ({
    default: module.AcpWorkspaceAssistant,
  })),
);

const UsageReportDialog = lazy(() =>
  import("@/components/usage/UsageReport").then((module) => ({
    default: module.UsageReportDialog,
  })),
);

export function ResearchAssistant() {
  const runtime = useAssistantRuntimeStore((state) => state.runtime);
  const setRuntime = useAssistantRuntimeStore((state) => state.setRuntime);
  const projectId = useFilesStore((state) => state.projectId);
  const openAgentSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("ai");
    settings.setSettingsScrollTarget("ai-agents");
    settings.setSettingsOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar" data-testid="research-assistant">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2 pl-[4.5rem]">
        <fieldset className="flex min-w-0 items-center rounded-md bg-muted p-0.5" aria-label="Assistant runtime">
          {([
            ["built-in", "Oleafly"],
            ["acp", "CLI agents"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={runtime === value}
              onClick={() => setRuntime(value)}
              className={cn("whitespace-nowrap rounded px-2 py-1 text-xs transition-colors", runtime === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <div className="ml-auto flex items-center gap-0.5">
          <Suspense fallback={null}>
            <UsageReportDialog trigger={<Button variant="ghost" size="icon" className="size-7" aria-label="Usage report"><BarChart3 className="size-4" /></Button>} />
          </Suspense>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Configure CLI agents" onClick={openAgentSettings}>
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ErrorBoundary surface="research assistant">
          {runtime === "built-in" ? <ChatCore /> : projectId ? (
            <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading agents…</p>}>
              <AcpWorkspaceAssistant projectId={projectId} />
            </Suspense>
          ) : (
            <p className="p-5 text-sm text-muted-foreground">Open a project to work with a CLI agent.</p>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
