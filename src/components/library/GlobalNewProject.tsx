import { useEffect, useState } from "react";
import { NewProjectDialog } from "@/components/library/NewProjectDialog";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { listTemplates, type TemplateInfo } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { logError } from "@/lib/log";
import { useTourStore } from "@/store/tours";
import { finishHomeTourAfterProjectCreation } from "@/lib/tours/coordinator";

// Mounted at the app root so it can be opened from anywhere (Library, the
// omnibar's `/create`, the command palette), not just the Library screen.
export function GlobalNewProject() {
  const open = useSettingsStore((s) => s.newProjectOpen);
  const setOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const createFromTemplate = useFilesStore((s) => s.createFromTemplate);
  const homeTourActive = useTourStore((state) => state.activeTourId === "home");
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open && templates.length === 0) {
      void listTemplates()
        .then(setTemplates)
        .catch((e) => void logError("load templates", e));
    }
  }, [open, templates.length]);

  const create = async (rawName: string, templateId: string, color: string) => {
    setCreating(true);
    try {
      // Creation stages the template (and any fonts) and opens the project.
      await createFromTemplate(rawName.trim() || "Untitled", templateId, color);
      setOpen(false);
      const tours = useTourStore.getState();
      finishHomeTourAfterProjectCreation(tours);
      let attempts = 0;
      const chainWorkspace = () => {
        attempts += 1;
        const state = useTourStore.getState();
        if (
          useFilesStore.getState().projectId &&
          document.querySelector('[data-tour="project-toolbar"]')
        ) {
          state.start("workspace");
          return;
        }
        if (attempts < 120) requestAnimationFrame(chainWorkspace);
      };
      requestAnimationFrame(chainWorkspace);
    } catch (e) {
      notifyError("create project", e, "Couldn't create the project.");
      useTourStore.getState().stop();
      setOpen(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <NewProjectDialog
      open={open}
      templates={templates}
      busy={creating}
      allowEnterSubmit={!homeTourActive}
      allowClose={!homeTourActive}
      onClose={() => {
        if (!homeTourActive) setOpen(false);
      }}
      onCreate={(n, t, c) => {
        void create(n, t, c);
      }}
    />
  );
}
