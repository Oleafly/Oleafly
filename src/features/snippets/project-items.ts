import type { ProjectFieldKind } from "@oleafly/snippets";
import { getEditorView } from "@/components/editor/cm/controller";
import { isLatexGraphicsPath } from "@/lib/image-mime";
import { currentSourceProjectIntelligence } from "@/lib/project-intelligence/current";
import { projectBibKeys, retainedProjectSnapshot } from "@/lib/project-intelligence/retained";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";

export interface ProjectItem {
  label: string;
  detail?: string;
}

function projectSnapshot(editorText: string | undefined): ProjectIntelligenceSnapshot | null {
  const text = editorText ?? getEditorView()?.state.doc.toString();
  const current = text === undefined ? null : currentSourceProjectIntelligence(text);
  return current?.snapshot ?? retainedProjectSnapshot();
}

function labels(editorText: string | undefined): ProjectItem[] {
  const items = new Map<string, ProjectItem>();
  for (const definition of projectSnapshot(editorText)?.definitions ?? []) {
    if ((definition.kind === "label" || definition.kind === "anchor") && !items.has(definition.name)) {
      items.set(definition.name, { label: definition.name, detail: definition.location.file });
    }
  }
  return [...items.values()];
}

function treeFiles(accepts: (path: string) => boolean): ProjectItem[] {
  return useFilesStore
    .getState()
    .tree.filter((entry) => !entry.is_dir && accepts(entry.path))
    .map((entry) => ({ label: entry.path }));
}

export function projectItems(kind: ProjectFieldKind, editorText?: string): readonly ProjectItem[] {
  switch (kind) {
    case "label":
    case "ref":
      return labels(editorText);
    case "cite":
      return projectBibKeys().map((key) => ({ label: key }));
    case "image":
      return treeFiles(isLatexGraphicsPath);
    case "file":
      return treeFiles(() => true);
  }
}
