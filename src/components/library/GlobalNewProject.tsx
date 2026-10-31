import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { warmChoiceArt } from "@/components/library/choice-art";
import { NewProjectDialog } from "@/components/library/NewProjectDialog";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { closeAfterCrash } from "@/lib/close-after-crash";
import { listTemplates, type TemplateInfo } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { logError } from "@/lib/log";
import { useTourStore } from "@/store/tours";
import { clearTemplateRequest, useTemplateRequestStore } from "@/store/template-request";
import { finishHomeTourAfterProjectCreation } from "@/lib/tours/coordinator";

function closeNewProject() {
  useTourStore.getState().stop();
  useSettingsStore.getState().setNewProjectOpen(false);
  clearTemplateRequest();
}

const onNewProjectCrash = () => closeAfterCrash(closeNewProject);

export function GlobalNewProject() {
  const open = useSettingsStore((s) => s.newProjectOpen);
  return (
    <ErrorBoundary fallback={null} resetKey={open} onError={onNewProjectCrash}>
      <NewProjectFlow />
    </ErrorBoundary>
  );
}

function NewProjectFlow() {
  const { t } = useTranslation(["library"]);
  const open = useSettingsStore((s) => s.newProjectOpen);
  const setOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const createFromTemplate = useFilesStore((s) => s.createFromTemplate);
  const homeTourActive = useTourStore((state) => state.activeTourId === "home");
  const requestedTemplateId = useTemplateRequestStore((s) => s.requestedTemplateId);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    warmChoiceArt();
  }, []);

  useEffect(() => {
    if (open && templates.length === 0) {
      void listTemplates()
        .then(setTemplates)
        .catch((e) => void logError("load templates", e));
    }
  }, [open, templates.length]);

  useEffect(() => {
    if (!requestedTemplateId) return;
    void listTemplates()
      .then(setTemplates)
      .catch((e) => void logError("load templates", e));
  }, [requestedTemplateId]);

  useEffect(() => {
    if (!open) clearTemplateRequest();
  }, [open]);

  const create = async (rawName: string, templateId: string, color: string) => {
    setCreating(true);
    try {
      await createFromTemplate(
        rawName.trim() || t(($) => $.library.newProject.untitled),
        templateId,
        color,
      );
      setOpen(false);
      const tours = useTourStore.getState();
      finishHomeTourAfterProjectCreation(tours);
      let observer: MutationObserver | null = null;
      const timeout = window.setTimeout(() => observer?.disconnect(), 30_000);
      const chainWorkspace = () => {
        const state = useTourStore.getState();
        if (state.activeTourId === "workspace") {
          window.clearTimeout(timeout);
          observer?.disconnect();
          return;
        }
        const toolbar = document.querySelector<HTMLElement>(
          '[data-tour="project-toolbar"]',
        );
        if (
          useFilesStore.getState().projectId &&
          toolbar &&
          toolbar.getClientRects().length > 0 &&
          state.start("workspace")
        ) {
          window.clearTimeout(timeout);
          observer?.disconnect();
        }
      };
      observer = new MutationObserver(chainWorkspace);
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-tour", "hidden", "style"],
        childList: true,
        subtree: true,
      });
      chainWorkspace();
    } catch (e) {
      notifyError("create project", e, t(($) => $.library.newProject.createFailed));
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
      initialTemplateId={requestedTemplateId}
      onClose={() => {
        if (!homeTourActive) setOpen(false);
      }}
      onCreate={(n, t, c) => {
        void create(n, t, c);
      }}
      onTemplatesChanged={() => {
        void listTemplates()
          .then(setTemplates)
          .catch((e) => void logError("load templates", e));
      }}
    />
  );
}
