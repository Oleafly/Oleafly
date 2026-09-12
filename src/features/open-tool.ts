import type { ToolDefinition } from "@/lib/tool-catalog";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore, type HomePage } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

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

export async function openTool(tool: ToolDefinition): Promise<void> {
  switch (tool.destination.kind) {
    case "page":
      await openHomePage(tool.destination.page);
      return;
    case "converter":
      useHomeViewStore.setState({ activeConverter: tool.destination.converter });
      await openHomePage("converter");
      return;
    case "typst-project":
      try {
        await useFilesStore.getState().createTypstProject("Untitled Typst document");
        // Opening the new project restores its persisted layout. Apply the
        // tool's requested mode afterwards so project initialization cannot
        // silently replace it with the default split view.
        useSettingsStore
          .getState()
          .setViewMode(tool.destination.mode === "visual" ? "split" : "editor");
      } catch (error) {
        void logError("open typst editor", error);
        toast.error("Oleafly couldn't start the Typst document.");
      }
  }
}
