import { bibKeysFromSources } from "@oleafly/editor";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

export function retainedProjectSnapshot(): ProjectIntelligenceSnapshot | null {
  const intelligence = useIndexStore.getState().intelligenceState;
  return intelligence.identity?.projectId === useFilesStore.getState().projectId ? intelligence.data : null;
}

export function projectBibKeys(): string[] {
  const bibs = Object.entries(useFilesStore.getState().files)
    .filter(([path]) => path.endsWith(".bib"))
    .map(([, state]) => state.content);
  const retained = retainedProjectSnapshot()?.bibliography.entries.map((entry) => entry.key) ?? [];
  return [...new Set([...bibKeysFromSources(bibs), ...retained])];
}
