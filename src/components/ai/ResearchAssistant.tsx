import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ChatCore } from "@/components/ai/ChatCore";
import { AssistantShellAcpActions } from "@/components/ai/AssistantShellAcpActions";
import {
  AssistantShellHeader,
  AssistantShellProvider,
} from "@/components/ai/AssistantShellHeader";
import { RuntimeSwitch } from "@/components/ai/RuntimeSwitch";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { selectActiveRuntime, useAssistantRuntimeStore } from "@/store/assistant-runtime";
import { useFilesStore } from "@/store/files";

const AcpWorkspaceAssistant = lazy(() =>
  import("@/components/ai/acp/AcpWorkspaceAssistant").then((module) => ({
    default: module.AcpWorkspaceAssistant,
  })),
);

const runtimeSwitch = <RuntimeSwitch />;

export function ResearchAssistant() {
  const { t } = useTranslation(["common", "ai"]);
  const runtime = useAssistantRuntimeStore(selectActiveRuntime);
  const projectId = useFilesStore((state) => state.projectId);

  return (
    <AssistantShellProvider leading={runtimeSwitch}>
      <div className="flex h-full min-h-0 flex-col bg-sidebar" data-testid="research-assistant">
        {runtime === "acp" && (
          <AssistantShellHeader
            data-testid="acp-assistant-header"
            leading={runtimeSwitch}
            actions={<AssistantShellAcpActions projectId={projectId} />}
          />
        )}
        <div className="min-h-0 flex-1">
          <ErrorBoundary surface="research assistant">
            {runtime === "built-in" ? (
              <ChatCore />
            ) : projectId ? (
              <Suspense
                fallback={
                  <p className="p-4 text-sm text-muted-foreground">
                    {t(($) => $.ai.shell.loadingAgents)}
                  </p>
                }
              >
                <AcpWorkspaceAssistant projectId={projectId} />
              </Suspense>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                {t(($) => $.ai.shell.openProjectForCli)}
              </p>
            )}
          </ErrorBoundary>
        </div>
      </div>
    </AssistantShellProvider>
  );
}
