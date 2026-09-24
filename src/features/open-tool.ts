import type { ToolDefinition } from "@/lib/tool-catalog";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore, type HomePage } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { i18n } from "@/i18n";

const OVERLAY_PAGES: ReadonlySet<HomePage> = new Set(["generators", "symbols"]);

export async function openHomePage(page: HomePage): Promise<void> {
  const files = useFilesStore.getState();
  const home = useHomeViewStore.getState();
  if (!files.projectId || OVERLAY_PAGES.has(page)) {
    home.goTo(page);
    return;
  }

  home.queuePageAfterProjectClose(page);
  await files.closeProject();
  if (useFilesStore.getState().projectId) {
    useHomeViewStore.getState().clearQueuedPageAfterProjectClose();
  }
}

export function openToolsGallery(): Promise<void> {
  return openHomePage("tools");
}

type TypstMode = Extract<ToolDefinition["destination"], { kind: "typst-project" }>["mode"];

let typstStart: Promise<void> | null = null;

async function createTypstDocument(mode: TypstMode): Promise<void> {
  const previousProjectId = useFilesStore.getState().projectId;
  try {
    await useFilesStore
      .getState()
      .createTypstProject(i18n.t(($) => $.researchTools.tools.typstDefaultName));
  } catch (error) {
    void logError("open typst editor", error);
    toast.errorUnique(
      "typst-start-failed",
      i18n.t(($) => $.researchTools.tools.typstStartFailed),
    );
    return;
  }
  const projectId = useFilesStore.getState().projectId;
  if (!projectId || projectId === previousProjectId) return;
  useSettingsStore.getState().setViewMode(mode === "visual" ? "split" : "editor");
}

function startTypstDocument(mode: TypstMode): Promise<void> {
  if (!typstStart) {
    typstStart = createTypstDocument(mode).finally(() => {
      typstStart = null;
    });
  }
  return typstStart;
}

export async function openTool(tool: ToolDefinition): Promise<void> {
  switch (tool.destination.kind) {
    case "page":
      await openHomePage(tool.destination.page);
      return;
    case "converter":
      useHomeViewStore.setState({ activeConverter: tool.destination.converter });
      await openHomePage("converter");
      return;
    case "reference":
      useHomeViewStore.setState({ activeReferenceTool: tool.destination.tool });
      await openHomePage("reference");
      return;
    case "typst-project":
      await startTypstDocument(tool.destination.mode);
  }
}
