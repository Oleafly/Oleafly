import type { Editor } from "@tiptap/react";

let editor: Editor | null = null;
let visible = false;
let setVisibility: ((visible: boolean) => void) | null = null;
let flushPendingEdits: (() => void) | null = null;
let projectNavigation: {
  goToDefinition: () => boolean;
  findReferences: () => boolean;
} | null = null;
let projectIntelligenceCurrent = false;
const projectIntelligenceListeners = new Set<() => void>();

export function setWysiwygEditor(e: Editor | null) {
  editor = e;
}

export function getWysiwygEditor(): Editor | null {
  return editor;
}

export function setWysiwygVisible(v: boolean) {
  visible = v;
}

export function isWysiwygActive(): boolean {
  return visible && editor != null;
}

export function setWysiwygVisibilityController(
  controller: ((visible: boolean) => void) | null,
) {
  setVisibility = controller;
}

export function setWysiwygFlushController(controller: (() => void) | null) {
  flushPendingEdits = controller;
}

export function flushWysiwygPendingEdits() {
  flushPendingEdits?.();
}

/**
 * Navigation targets source offsets, so cross-file definition/reference jumps
 * reveal the source editor before selecting the exact range.
 */
export function revealSourceEditor() {
  setVisibility?.(false);
}

export function setWysiwygProjectNavigation(
  navigation: typeof projectNavigation,
) {
  projectNavigation = navigation;
}

export function goToWysiwygDefinition(): boolean {
  return projectNavigation?.goToDefinition() ?? false;
}

export function findWysiwygReferences(): boolean {
  return projectNavigation?.findReferences() ?? false;
}

export function setWysiwygProjectIntelligenceCurrent(current: boolean) {
  if (projectIntelligenceCurrent === current) return;
  projectIntelligenceCurrent = current;
  for (const listener of projectIntelligenceListeners) listener();
}

export function getWysiwygProjectIntelligenceCurrent(): boolean {
  return projectIntelligenceCurrent;
}

export function subscribeWysiwygProjectIntelligence(
  listener: () => void,
): () => void {
  projectIntelligenceListeners.add(listener);
  return () => projectIntelligenceListeners.delete(listener);
}
