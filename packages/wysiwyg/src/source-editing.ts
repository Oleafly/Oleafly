import type { NodeType } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export const OPEN_SOURCE_EDITOR_EVENT = "oleafly-open-source-editor";

export type SourceInput = HTMLInputElement | HTMLTextAreaElement;

export interface SourceEditorOptions {
  multiline: boolean;
  className: string;
  label: string;
  placeholder?: string;
  read: () => string;
  mount: (input: SourceInput) => void;
  commit: (value: string) => void;
  focusAfter: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  onInput?: (value: string) => void;
}

export interface SourceEditor {
  open(): void;
  close(): void;
  readonly editing: boolean;
}

export function updateNodeAttribute(
  view: EditorView,
  getPos: () => number | undefined,
  type: NodeType,
  attribute: string,
  value: unknown,
): boolean {
  const position = getPos();
  if (typeof position !== "number") return false;
  const liveNode = view.state.doc.nodeAt(position);
  if (!liveNode || liveNode.type !== type) return false;
  if (liveNode.attrs[attribute] === value) return false;
  view.dispatch(
    view.state.tr.setNodeMarkup(position, undefined, {
      ...liveNode.attrs,
      [attribute]: value,
    }),
  );
  return true;
}

export interface AtomNodeViewChrome {
  selectNode(): void;
  deselectNode(): void;
  stopEvent(event: Event): boolean;
  ignoreMutation(mutation: { target: Node }): boolean;
}

export function atomNodeViewChrome(dom: HTMLElement, interactiveSelector: string): AtomNodeViewChrome {
  return {
    selectNode() {
      dom.classList.add("ProseMirror-selectednode");
    },
    deselectNode() {
      dom.classList.remove("ProseMirror-selectednode");
    },
    stopEvent(event) {
      return event.target instanceof Element && !!event.target.closest(interactiveSelector);
    },
    ignoreMutation(mutation) {
      return dom.contains(mutation.target);
    },
  };
}

export function openSelectedSourceEditor(view: EditorView, typeName: string): boolean {
  const selection = view.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== typeName) return false;
  const dom = view.nodeDOM(selection.from);
  if (!(dom instanceof HTMLElement)) return false;
  dom.dispatchEvent(new CustomEvent(OPEN_SOURCE_EDITOR_EVENT));
  return true;
}

function textareaRows(value: string): number {
  return Math.min(Math.max(value.split(/\r?\n/u).length, 1), 8);
}

function createInput(options: SourceEditorOptions): SourceInput {
  const input = options.multiline ? document.createElement("textarea") : document.createElement("input");
  input.className = options.className;
  input.value = options.read();
  input.spellcheck = false;
  input.setAttribute("aria-label", options.label);
  if (options.placeholder) input.placeholder = options.placeholder;
  if (input instanceof HTMLTextAreaElement) input.rows = textareaRows(input.value);
  return input;
}

export function createSourceEditor(options: SourceEditorOptions): SourceEditor {
  let input: SourceInput | null = null;
  let composing = false;

  const close = () => {
    if (!input) return;
    const current = input;
    input = null;
    current.remove();
    options.onClose?.();
  };

  const finish = (value: string | null) => {
    if (value !== null) options.commit(value);
    close();
    options.focusAfter();
  };

  const onKeyDown = (event: KeyboardEvent, element: SourceInput) => {
    if (composing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish(null);
      return;
    }
    const submits = event.key === "Enter" && (!options.multiline || event.metaKey || event.ctrlKey);
    if (!submits) return;
    event.preventDefault();
    finish(element.value);
  };

  const open = () => {
    if (input) return;
    const element = createInput(options);
    const host: HTMLElement = element;
    host.addEventListener("compositionstart", () => {
      composing = true;
    });
    host.addEventListener("compositionend", () => {
      composing = false;
    });
    host.addEventListener("input", () => options.onInput?.(element.value));
    host.addEventListener("keydown", (event) => onKeyDown(event, element));
    host.addEventListener("blur", () => {
      if (input !== element) return;
      options.commit(element.value);
      close();
    });
    input = element;
    options.onOpen?.();
    options.mount(element);
    element.focus({ preventScroll: true });
    element.select();
  };

  return {
    open,
    close,
    get editing() {
      return input !== null;
    },
  };
}
