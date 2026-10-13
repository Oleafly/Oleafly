import { create } from "zustand";
import { useSettingsStore } from "@/store/settings";

interface TemplateRequestState {
  requestedTemplateId: string | null;
}

export const useTemplateRequestStore = create<TemplateRequestState>(() => ({
  requestedTemplateId: null,
}));

export function openTemplateInNewProject(templateId: string): void {
  const settings = useSettingsStore.getState();
  settings.setSettingsOpen(false);
  settings.setNewProjectOpen(true);
  useTemplateRequestStore.setState({ requestedTemplateId: templateId });
}

export function clearTemplateRequest(): void {
  if (useTemplateRequestStore.getState().requestedTemplateId !== null) {
    useTemplateRequestStore.setState({ requestedTemplateId: null });
  }
}
