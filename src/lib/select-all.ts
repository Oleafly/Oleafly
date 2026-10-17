import { selectAll } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

const SELECT_ALL_SCOPE = "[data-select-all-scope]";

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const SELECTABLE = `.select-text, .select-all, .cm-editor, ${SELECT_ALL_SCOPE}, ${EDITABLE}`;
const SELECTION_ACTORS = [
  "button",
  "a",
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[aria-haspopup]:not([aria-haspopup="false"])',
].join(", ");

const selectAllOwners = new WeakMap<Element, () => void>();

export function ownSelectAll(host: Element, selectAllInHost: () => void): () => void {
  selectAllOwners.set(host, selectAllInHost);
  return () => {
    if (selectAllOwners.get(host) === selectAllInHost) selectAllOwners.delete(host);
  };
}

function ownerOf(target: Element): (() => void) | undefined {
  for (let node: Element | null = target; node; node = node.parentElement) {
    const owner = selectAllOwners.get(node);
    if (owner) return owner;
  }
  return undefined;
}

function elementOf(node: Node | null | undefined): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function isEditable(element: Element | null): boolean {
  return element?.closest(EDITABLE) != null || (element != null && ownerOf(element) !== undefined);
}

function ownsItsSelection(node: Node | null): boolean {
  const element = elementOf(node);
  return isEditable(element) || element?.closest(".cm-editor") != null;
}

export function selectWholeDocument(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.classList.contains("cm-content")) {
    const view = EditorView.findFromDOM(target);
    if (view?.contentDOM !== target) return;
    event.preventDefault();
    selectAll(view);
    return;
  }
  if (target.tagName !== "TEXTAREA") return;
  const owner = ownerOf(target);
  if (!owner) return;
  event.preventDefault();
  owner();
}

function scopeOf(element: Element | null | undefined): Element | null {
  if (!element?.isConnected) return null;
  return element.closest(SELECT_ALL_SCOPE);
}

function pointedScope(documentObject: Document, active: Element | null, pointed: Element | undefined): Element | null {
  const scope = scopeOf(pointed);
  if (!scope || !active || active === documentObject.body || active === documentObject.documentElement) return scope;
  return active.contains(scope) ? scope : null;
}

function selectInScope(event: Event, documentObject: Document, pointed: Element | undefined): void {
  if (event.defaultPrevented) return;
  if (isEditable(elementOf(event.target as Node | null))) return;
  const active = documentObject.activeElement;
  if (isEditable(active)) return;
  event.preventDefault();
  const scope = scopeOf(active) ?? pointedScope(documentObject, active, pointed);
  if (scope) documentObject.getSelection()?.selectAllChildren(scope);
}

function onScrollbar(target: Element, event: MouseEvent): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const { clientWidth, clientHeight } = target;
  if (clientWidth === 0 || clientHeight === 0) return false;
  return (
    (target.scrollHeight > clientHeight && event.offsetX >= clientWidth) ||
    (target.scrollWidth > clientWidth && event.offsetY >= clientHeight)
  );
}

function clearStraySelection(event: MouseEvent, target: Element, documentObject: Document): void {
  if (event.button !== 0 || event.shiftKey || event.ctrlKey) return;
  const selection = documentObject.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  if (target.closest(SELECTABLE) || target.closest(SELECTION_ACTORS)) return;
  if (isEditable(documentObject.activeElement)) return;
  if (ownsItsSelection(selection.anchorNode) || ownsItsSelection(selection.focusNode)) return;
  if (onScrollbar(target, event)) return;
  selection.removeAllRanges();
}

export function installSelectAllRouting(documentObject: Document = document): () => void {
  let pointerTask = false;
  let release = 0;
  let lastPointed: WeakRef<Element> | undefined;
  const markPointerTask = () => {
    pointerTask = true;
    window.clearTimeout(release);
    release = window.setTimeout(() => {
      pointerTask = false;
    });
  };
  const onPointerDown = (event: Event) => {
    markPointerTask();
    const target = event.target;
    if (!(target instanceof Element)) return;
    lastPointed = new WeakRef(target);
    clearStraySelection(event as MouseEvent, target, documentObject);
  };
  const onSelectStart = (event: Event) => {
    if (pointerTask) return;
    selectWholeDocument(event);
    selectInScope(event, documentObject, lastPointed?.deref());
  };
  documentObject.addEventListener("pointerdown", onPointerDown, true);
  documentObject.addEventListener("mousedown", markPointerTask, true);
  documentObject.addEventListener("selectstart", onSelectStart, true);
  return () => {
    window.clearTimeout(release);
    documentObject.removeEventListener("pointerdown", onPointerDown, true);
    documentObject.removeEventListener("mousedown", markPointerTask, true);
    documentObject.removeEventListener("selectstart", onSelectStart, true);
  };
}
