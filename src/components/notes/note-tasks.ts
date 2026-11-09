import { InputRule, mergeAttributes, Node, type Editor, type KeyboardShortcutCommand } from "@tiptap/core";
import type { Node as ProseMirrorNode, NodeType, ResolvedPos } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { i18n } from "@/i18n";
import { onceFor, type MarkdownIt, type MdCoreState, type MdToken } from "./note-markdown-it";
import { watchEditable } from "./note-editable";

export interface TaskAttrs {
  task: boolean;
  checked: boolean;
}

const TASK_MARK = /^\[([ xX])\](?:[ \t]+|$)/u;
const TYPED_TASK = /^\[([ xX]?)\]\s$/u;

interface ListState {
  write(text: string): void;
  renderContent(node: ProseMirrorNode): void;
  renderList(node: ProseMirrorNode, delim: string, firstDelim: (index: number) => string): void;
}

function directItems(tokens: readonly MdToken[], open: number): number[] {
  const level = tokens[open].level;
  const items: number[] = [];
  for (let index = open + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "bullet_list_close" && token.level === level) break;
    if (token.type === "list_item_open" && token.level === level + 1) items.push(index);
  }
  return items;
}

function taskMarkOf(tokens: readonly MdToken[], item: number): RegExpExecArray | null {
  const paragraph = tokens[item + 1];
  const inline = tokens[item + 2];
  if (paragraph?.type !== "paragraph_open" || inline?.type !== "inline") return null;
  return TASK_MARK.exec(inline.content);
}

export function markTaskLists(state: MdCoreState): void {
  const { tokens } = state;
  tokens.forEach((token, open) => {
    if (token.type !== "bullet_list_open") return;
    const items = directItems(tokens, open);
    const marks = items.map((item) => taskMarkOf(tokens, item));
    if (!marks.some(Boolean)) return;
    token.attrSet("data-type", "taskList");
    items.forEach((item, index) => {
      tokens[item].attrSet("data-type", "taskItem");
      const mark = marks[index];
      if (!mark) {
        tokens[item].attrSet("data-task", "false");
        return;
      }
      tokens[item].attrSet("data-checked", mark[1] === " " ? "false" : "true");
      const inline = tokens[item + 2];
      inline.content = inline.content.slice(mark[0].length);
    });
  });
}

function setupTasks(md: MarkdownIt): void {
  onceFor(md, "note_task_lists", () => {
    md.core.ruler.after("block", "note_task_lists", (state) => {
      markTaskLists(state);
      return true;
    });
  });
}


function isEmptyItem(node: ProseMirrorNode): boolean {
  return node.childCount === 1 && node.firstChild?.content.size === 0;
}

export function taskMarker(attrs: TaskAttrs, empty: boolean): string {
  if (!attrs.task) return "";
  const box = attrs.checked ? "[x]" : "[ ]";
  return empty ? box : `${box} `;
}

export function toggledTask(attrs: TaskAttrs): TaskAttrs {
  return attrs.task ? { task: true, checked: !attrs.checked } : { task: true, checked: false };
}

function itemDepth($pos: ResolvedPos, name: string): number {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === name) return depth;
  }
  return -1;
}

export function toggleTaskAt(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from } = state.selection;
  const depth = itemDepth($from, "taskItem");
  if (depth < 0) return false;
  const item = $from.node(depth);
  dispatch?.(state.tr.setNodeMarkup($from.before(depth), undefined, { ...item.attrs, ...toggledTask(item.attrs as TaskAttrs) }));
  return true;
}

function startOfFirstChild($from: ResolvedPos, state: EditorState, name: string): number {
  const { selection } = state;
  if (!selection.empty || $from.parentOffset !== 0) return -1;
  const depth = $from.depth - 1;
  if (depth < 1 || $from.node(depth).type.name !== name || $from.index(depth) !== 0) return -1;
  return depth;
}

export function clearTaskAtStart(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from } = state.selection;
  const depth = startOfFirstChild($from, state, "taskItem");
  if (depth < 0) return false;
  const item = $from.node(depth);
  if (!item.attrs.task) return false;
  dispatch?.(state.tr.setNodeMarkup($from.before(depth), undefined, { ...item.attrs, task: false, checked: false }));
  return true;
}

interface TaskTypes {
  list: NodeType;
  item: NodeType;
}

function bulletItemDepth($from: ResolvedPos): number {
  const depth = $from.depth - 1;
  if (depth < 2 || $from.node(depth).type.name !== "listItem" || $from.index(depth) !== 0) return -1;
  return $from.node(depth - 1).type.name === "bulletList" ? depth : -1;
}

function convertBulletList(tr: Transaction, depth: number, cursor: number, checked: boolean, types: TaskTypes): void {
  const $from = tr.doc.resolve(cursor);
  const list = $from.node(depth - 1);
  const at = $from.index(depth - 1);
  const items: ProseMirrorNode[] = [];
  list.forEach((child, _offset, index) => {
    items.push(types.item.create({ task: index === at, checked: index === at && checked }, child.content));
  });
  const start = $from.before(depth - 1);
  tr.replaceWith(start, start + list.nodeSize, types.list.create({ tight: list.attrs.tight ?? true }, items));
  tr.setSelection(TextSelection.create(tr.doc, cursor));
}

export function applyTypedTask(state: Pick<EditorState, "doc" | "schema" | "tr">, range: { from: number; to: number }, checked: boolean): boolean {
  const types: TaskTypes = { list: state.schema.nodes.taskList, item: state.schema.nodes.taskItem };
  const $from = state.doc.resolve(range.from);
  if ($from.parent.type.name !== "paragraph" || $from.parentOffset !== 0) return false;
  const parent = $from.depth > 1 ? $from.node($from.depth - 1) : null;
  const tr = state.tr;
  if (parent?.type === types.item) {
    if (parent.attrs.task || $from.index($from.depth - 1) !== 0) return false;
    tr.delete(range.from, range.to);
    tr.setNodeMarkup($from.before($from.depth - 1), undefined, { ...parent.attrs, task: true, checked });
    return true;
  }
  const bullet = bulletItemDepth($from);
  if (bullet > 0) {
    tr.delete(range.from, range.to);
    convertBulletList(tr, bullet, range.from, checked, types);
    return true;
  }
  if ($from.depth > 1 && parent?.type.name === "listItem") return false;
  tr.delete(range.from, range.to);
  const block = tr.doc.resolve(range.from).blockRange();
  if (!block) return false;
  tr.wrap(block, [{ type: types.list, attrs: { tight: true } }, { type: types.item, attrs: { task: true, checked } }]);
  return true;
}

export function taskInputRule(): InputRule {
  return new InputRule({
    find: TYPED_TASK,
    handler: ({ state, range, match }) => (applyTypedTask(state, range, match[1].toLowerCase() === "x") ? undefined : null),
  });
}

function boxLabel(node: ProseMirrorNode): string {
  const text = node.textContent.trim();
  return text
    ? i18n.t(($) => $.notes.kb.tasks.label, { text })
    : i18n.t(($) => $.notes.kb.tasks.empty);
}

export function taskItemView(node: ProseMirrorNode, editor: Editor, getPos: () => number | undefined) {
  const dom = document.createElement("li");
  dom.className = "note-task";
  const handle = document.createElement("span");
  handle.className = "note-task-handle";
  handle.contentEditable = "false";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "note-task-box";
  handle.append(box);
  const content = document.createElement("div");
  content.className = "note-task-content";
  dom.append(handle, content);
  let current = node;
  const paint = (next: ProseMirrorNode) => {
    current = next;
    const attrs = next.attrs as TaskAttrs;
    dom.dataset.checked = attrs.task ? String(attrs.checked) : "none";
    box.checked = attrs.task && attrs.checked;
    box.disabled = !editor.isEditable;
    handle.hidden = !attrs.task;
    box.setAttribute("aria-label", boxLabel(next));
  };
  paint(node);
  const stopWatching = watchEditable(editor, () => paint(current));
  box.addEventListener("mousedown", (event) => event.preventDefault());
  box.addEventListener("change", () => {
    const position = getPos();
    if (!editor.isEditable || position === undefined) {
      box.checked = current.attrs.checked === true;
      return;
    }
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, checked: box.checked }));
  });
  return {
    dom,
    contentDOM: content,
    update(next: ProseMirrorNode) {
      if (next.type !== current.type) return false;
      paint(next);
      return true;
    },
    ignoreMutation(mutation: MutationRecord | { type: "selection"; target: globalThis.Node }) {
      return mutation.type !== "selection" && handle.contains(mutation.target);
    },
    stopEvent(event: Event) {
      return event.target instanceof globalThis.Node && handle.contains(event.target);
    },
    destroy() {
      stopWatching();
    },
  };
}

export interface TaskNodeOptions {
  views: boolean;
}

export const NoteTaskList = Node.create({
  name: "taskList",
  group: "block list",
  content: "taskItem+",

  addAttributes() {
    return {
      tight: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-tight") === "true" || !element.querySelector("p"),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.tight ? { "data-tight": "true" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'ul[data-type="taskList"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["ul", mergeAttributes(HTMLAttributes, { "data-type": "taskList", class: "note-tasks" }), 0];
  },

  addCommands() {
    return {
      toggleTaskList:
        () =>
        ({ commands }) =>
          commands.toggleList(this.name, "taskItem"),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: ListState, node: ProseMirrorNode) {
          state.renderList(node, "  ", () => "- ");
        },
        parse: { setup: setupTasks },
      },
    };
  },
});

export const NoteTaskItem = Node.create<TaskNodeOptions>({
  name: "taskItem",
  content: "paragraph block*",
  defining: true,

  addOptions() {
    return { views: false };
  },

  addAttributes() {
    return {
      task: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-task") !== "false",
        renderHTML: (attributes: Record<string, unknown>) => (attributes.task ? {} : { "data-task": "false" }),
      },
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-checked") === "true",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-checked": attributes.checked ? "true" : "false" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'li[data-type="taskItem"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["li", mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: ListState, node: ProseMirrorNode) {
          const marker = taskMarker(node.attrs as TaskAttrs, isEmptyItem(node));
          if (marker) state.write(marker);
          state.renderContent(node);
        },
        parse: {},
      },
    };
  },

  addInputRules() {
    return this.options.views ? [taskInputRule()] : [];
  },

  addKeyboardShortcuts(): Record<string, KeyboardShortcutCommand> {
    if (!this.options.views) return {};
    return {
      Enter: () => {
        const { $from } = this.editor.state.selection;
        const depth = itemDepth($from, this.name);
        if (depth < 0) return false;
        const task = $from.node(depth).attrs.task === true;
        return this.editor.commands.splitListItem(this.name, { task, checked: false });
      },
      Backspace: () => clearTaskAtStart(this.editor.state, (tr) => this.editor.view.dispatch(tr)),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
      "Mod-Enter": () => toggleTaskAt(this.editor.state, (tr) => this.editor.view.dispatch(tr)),
    };
  },

  addNodeView() {
    if (!this.options.views) return null;
    return ({ node, editor, getPos }) => taskItemView(node, editor, getPos);
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteTaskList: {
      toggleTaskList: () => ReturnType;
    };
  }
}
