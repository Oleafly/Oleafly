import { selectAll } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

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

export function installSelectAllRouting(documentObject: Document = document): () => void {
  let pointerTask = false;
  let release = 0;
  const onPointer = () => {
    pointerTask = true;
    window.clearTimeout(release);
    release = window.setTimeout(() => {
      pointerTask = false;
    });
  };
  const onSelectStart = (event: Event) => {
    if (!pointerTask) selectWholeDocument(event);
  };
  documentObject.addEventListener("pointerdown", onPointer, true);
  documentObject.addEventListener("mousedown", onPointer, true);
  documentObject.addEventListener("selectstart", onSelectStart, true);
  return () => {
    window.clearTimeout(release);
    documentObject.removeEventListener("pointerdown", onPointer, true);
    documentObject.removeEventListener("mousedown", onPointer, true);
    documentObject.removeEventListener("selectstart", onSelectStart, true);
  };
}
