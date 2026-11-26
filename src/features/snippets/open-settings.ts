import { create } from "zustand";
import { useSettingsStore } from "@/store/settings";

interface SnippetSettingsRequest {
  recordId: string | null;
}

export const useSnippetSettingsRequest = create<SnippetSettingsRequest>(() => ({ recordId: null }));

export function openSnippetSettings(recordId: string | null = null): void {
  useSnippetSettingsRequest.setState({ recordId });
  useSettingsStore.getState().openSettingsAt("snippets");
}
