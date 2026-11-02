import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { createEmitter } from "@/lib/emitter";

export interface VisualFigureOptions {
  path: string;
  width: string | null;
  placement?: string | null;
  centering: boolean;
  caption: string | null;
  label: string | null;
}

export interface WysiwygInsertions {
  insertLatex(view: EditorView, source: string, block: boolean, theoremEnvironments: readonly string[]): void;
}

let insertions: WysiwygInsertions | null = null;

let editor: Editor | null = null;
let loaded: { editor: Editor; path: string } | null = null;
const documentChanged = createEmitter();
let visible = false;
let setVisibility: ((visible: boolean) => void) | null = null;
let flushPendingEdits: (() => void) | null = null;
let projectSessionGeneration = 0;
let projectNavigation: {
  goToDefinition: () => boolean;
  findReferences: () => boolean;
} | null = null;
let projectIntelligenceCurrent = false;
const projectIntelligenceChanged = createEmitter();

export interface WysiwygDocumentContext {
  theoremEnvironments: readonly string[];
  booktabs: boolean;
}

const EMPTY_DOCUMENT_CONTEXT: WysiwygDocumentContext = {
  theoremEnvironments: [],
  booktabs: false,
};
let documentContext: WysiwygDocumentContext = EMPTY_DOCUMENT_CONTEXT;

export function setWysiwygEditor(e: Editor | null) {
  editor = e;
}

export function setWysiwygDocumentContext(context: WysiwygDocumentContext | null) {
  documentContext = context ?? EMPTY_DOCUMENT_CONTEXT;
}

export function getWysiwygDocumentContext(): WysiwygDocumentContext {
  return documentContext;
}

export function getWysiwygEditor(): Editor | null {
  return editor;
}

/** Records the file whose text a Visual editor holds, once it has loaded it. */
export function setWysiwygDocument(owner: Editor, path: string | null) {
  if (loaded?.editor === owner && loaded.path === path) return;
  loaded = path === null ? null : { editor: owner, path };
  documentChanged.emit();
}

/** Resolves with the Visual editor once it holds `path`, or null if aborted. */
export function waitForWysiwygDocument(path: string, signal: AbortSignal): Promise<Editor | null> {
  const ready = () => (editor && loaded?.editor === editor && loaded.path === path ? editor : null);
  const now = ready();
  if (now || signal.aborted) return Promise.resolve(now);
  return new Promise((resolve) => {
    const finish = (found: Editor | null) => {
      unsubscribe();
      signal.removeEventListener("abort", abort);
      resolve(found);
    };
    const abort = () => finish(null);
    const unsubscribe = documentChanged.subscribe(() => {
      const found = ready();
      if (found) finish(found);
    });
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function setWysiwygInsertions(value: WysiwygInsertions | null) {
  insertions = value;
}

export function getWysiwygInsertions(): WysiwygInsertions | null {
  return insertions;
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

export function invalidateWysiwygProjectSession() {
  flushPendingEdits = null;
  projectSessionGeneration++;
}

export function getWysiwygProjectSessionGeneration(): number {
  return projectSessionGeneration;
}

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
  projectIntelligenceChanged.emit();
}

export function getWysiwygProjectIntelligenceCurrent(): boolean {
  return projectIntelligenceCurrent;
}

export const subscribeWysiwygProjectIntelligence = projectIntelligenceChanged.subscribe;
