import { isLinux } from "@/lib/utils";

const TEXT_FIELD = "input, textarea, select";
const RICH_EDITOR = '[contenteditable]:not([contenteditable="false"])';

function elementOf(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

export function carriesFiles(transfer: DataTransfer | null | undefined): boolean {
  return Array.from(transfer?.types ?? []).includes("Files");
}

export function carriesFilePaths(
  transfer: DataTransfer | null | undefined,
  linux: boolean = isLinux,
): boolean {
  return linux && Array.from(transfer?.types ?? []).includes("text/uri-list");
}

function handledByTarget(event: DragEvent): boolean {
  const element = elementOf(event.target);
  if (element?.closest(RICH_EDITOR)) return true;
  return element?.closest(TEXT_FIELD) != null && !carriesFiles(event.dataTransfer);
}

export function installExternalDropGuard(view: Window = window): () => void {
  const onDragEnterOrOver = (event: DragEvent) => {
    if (event.defaultPrevented || handledByTarget(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  };
  const onDrop = (event: DragEvent) => {
    if (event.defaultPrevented || handledByTarget(event)) return;
    event.preventDefault();
  };
  view.addEventListener("dragenter", onDragEnterOrOver);
  view.addEventListener("dragover", onDragEnterOrOver);
  view.addEventListener("drop", onDrop);
  return () => {
    view.removeEventListener("dragenter", onDragEnterOrOver);
    view.removeEventListener("dragover", onDragEnterOrOver);
    view.removeEventListener("drop", onDrop);
  };
}
