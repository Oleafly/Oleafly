import { create } from "zustand";
import type { TemplateLink } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

const LINK_ID = /^[\w-]{1,128}$/;

export interface PendingTemplateLink extends TemplateLink {
  readonly serial: number;
}

interface TemplateLinkState {
  pending: PendingTemplateLink | null;
  serial: number;
}

export const useTemplateLinkStore = create<TemplateLinkState>(() => ({
  pending: null,
  serial: 0,
}));

export function isTemplateLink(value: unknown): value is TemplateLink {
  if (typeof value !== "object" || value === null) return false;
  const { packId, templateId } = value as Record<string, unknown>;
  return (
    typeof packId === "string" &&
    typeof templateId === "string" &&
    LINK_ID.test(packId) &&
    LINK_ID.test(templateId)
  );
}

export function openTemplateLink(value: unknown): void {
  if (!isTemplateLink(value)) return;
  const { packId, templateId } = value;
  useTemplateLinkStore.setState((current) => {
    const serial = current.serial + 1;
    return { serial, pending: { packId, templateId, serial } };
  });
  const settings = useSettingsStore.getState();
  settings.setNewProjectOpen(false);
  settings.openSettingsAt("downloads");
}

export function takeTemplateLink(): PendingTemplateLink | null {
  const { pending } = useTemplateLinkStore.getState();
  if (pending) useTemplateLinkStore.setState({ pending: null });
  return pending;
}
