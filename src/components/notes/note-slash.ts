import { mathNodeJSON } from "@oleafly/wysiwyg";
import { type Editor, Extension } from "@tiptap/core";
import { type EditorState, type Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  Asterisk,
  Globe,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Megaphone,
  Minus,
  Paperclip,
  Quote,
  SquareCode,
  SquareFunction,
  Table,
} from "lucide-react";
import { i18n } from "@/i18n";
import type { BlockGroupId } from "./block-templates";
import { blockGroups, caretAfterDrawnBlock } from "./block-views";
import { attachFile, canAttach } from "./note-image-drop";
import { askBookmark, canAskBookmark } from "./note-link-choice";
import { type SuggestRange, type SuggestState, sendSuggestMeta, suggestionKey, suggestOptionId, suggestPlugin } from "./note-suggest-plugin";

export type SlashGroup = "basic" | BlockGroupId;

export interface SlashRange {
  from: number;
  to: number;
}

export interface SlashItem {
  id: string;
  label: string;
  group: SlashGroup;
  icon: LucideIcon;
  keywords: readonly string[];
  available: (editor: Editor) => boolean;
  run: (editor: Editor, range: SlashRange) => boolean;
}

export interface SlashState {
  active: boolean;
  from: number;
  to: number;
  query: string;
  index: number;
  dismissed: number | null;
}

const MAX_QUERY = 32;
const QUERY = /^\/([^\s/][^/]*)?$/u;
const ALLOWED_PARENTS = new Set(["doc", "blockquote", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "callout"]);
const BLOCK_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  csv: ["table", "data", "spreadsheet", "excel", "tsv"],
  chart: ["graph", "bar", "line", "pie", "scatter", "histogram"],
  plot: ["function", "graph", "curve", "math"],
  latex: ["math", "equation", "formula", "chemistry"],
  typst: ["math", "equation"],
  mermaid: ["diagram", "flowchart", "graph"],
  d2: ["diagram", "flowchart", "architecture", "graph"],
  tikz: ["latex", "diagram", "drawing", "figure", "pgf"],
  circuitikz: ["circuit", "electronics", "schematic", "latex", "diagram"],
  svg: ["vector", "drawing", "image"],
  html: ["web", "page", "widget", "interactive"],
  jsx: ["component", "app", "interactive", "artifact"],
  smiles: ["chemistry", "molecule", "structure", "compound"],
  molecule: ["protein", "3d", "structure", "chemistry", "crystal"],
  sequence: ["dna", "rna", "protein", "gene", "genome"],
};
const INACTIVE: SlashState = { active: false, from: 0, to: 0, query: "", index: 0, dismissed: null };

export const noteSlashKey = new PluginKey<SuggestState<SuggestRange>>("noteSlash");
const visibleItems = new WeakMap<EditorState, SlashItem[]>();
let menuCount = 0;

interface SlashPluginSpec {
  slashMenuId: string;
}

export function slashMatch(state: EditorState): { from: number; to: number; query: string } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph") return null;
  for (let depth = $from.depth - 1; depth >= 0; depth -= 1) {
    if (!ALLOWED_PARENTS.has($from.node(depth).type.name)) return null;
  }
  const text = parent.textContent;
  if (text.length > MAX_QUERY + 1 || $from.parentOffset !== text.length || parent.childCount > 1) return null;
  const match = QUERY.exec(text);
  if (!match) return null;
  const from = $from.start();
  return { from, to: from + text.length, query: match[1] ?? "" };
}

function commandAvailable(editor: Editor, name: string): boolean {
  return typeof (editor.commands as unknown as Record<string, unknown>)[name] === "function";
}

function chain(editor: Editor, range: SlashRange) {
  return editor.chain().focus().deleteRange(range);
}

function basicItems(): SlashItem[] {
  const always = () => true;
  const headings: [1 | 2 | 3 | 4 | 5 | 6, LucideIcon][] = [
    [1, Heading1],
    [2, Heading2],
    [3, Heading3],
    [4, Heading4],
    [5, Heading5],
    [6, Heading6],
  ];
  return [
    ...headings.map(
      ([level, icon]): SlashItem => ({
        id: `heading${level}`,
        label: i18n.t(($) => $.notes.blocks.slash.heading, { level }),
        group: "basic",
        icon,
        keywords: ["heading", "title", `h${level}`],
        available: always,
        run: (editor, range) => chain(editor, range).setNode("heading", { level }).run(),
      }),
    ),
    {
      id: "bulletList",
      label: i18n.t(($) => $.notes.blocks.slash.bulletList),
      group: "basic",
      icon: List,
      keywords: ["bullet", "list", "ul"],
      available: always,
      run: (editor, range) => chain(editor, range).toggleBulletList().run(),
    },
    {
      id: "orderedList",
      label: i18n.t(($) => $.notes.blocks.slash.numberedList),
      group: "basic",
      icon: ListOrdered,
      keywords: ["numbered", "ordered", "list", "ol"],
      available: always,
      run: (editor, range) => chain(editor, range).toggleOrderedList().run(),
    },
    {
      id: "taskList",
      label: i18n.t(($) => $.notes.blocks.slash.taskList),
      group: "basic",
      icon: ListChecks,
      keywords: ["task", "todo", "checkbox", "list"],
      available: (editor) => commandAvailable(editor, "toggleTaskList") && editor.can().toggleTaskList(),
      run: (editor, range) => chain(editor, range).toggleTaskList().run(),
    },
    {
      id: "quote",
      label: i18n.t(($) => $.notes.blocks.slash.quote),
      group: "basic",
      icon: Quote,
      keywords: ["quote", "blockquote"],
      available: always,
      run: (editor, range) => chain(editor, range).toggleBlockquote().run(),
    },
    {
      id: "callout",
      label: i18n.t(($) => $.notes.blocks.slash.callout),
      group: "basic",
      icon: Megaphone,
      keywords: ["callout", "note", "admonition", "tip", "warning"],
      available: always,
      run: (editor, range) => chain(editor, range).toggleBlockquote().insertContent("[!note] ").run(),
    },
    {
      id: "table",
      label: i18n.t(($) => $.notes.blocks.slash.table),
      group: "basic",
      icon: Table,
      keywords: ["table", "grid"],
      available: (editor) => commandAvailable(editor, "insertTable"),
      run: (editor, range) => chain(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: "code",
      label: i18n.t(($) => $.notes.blocks.slash.code),
      group: "basic",
      icon: SquareCode,
      keywords: ["code", "snippet", "pre"],
      available: always,
      run: (editor, range) => chain(editor, range).setCodeBlock().run(),
    },
    {
      id: "math",
      label: i18n.t(($) => $.notes.blocks.slash.math),
      group: "basic",
      icon: SquareFunction,
      keywords: ["math", "equation", "formula", "latex"],
      available: always,
      run: (editor, range) => {
        const node = mathNodeJSON("$$x^2$$");
        return node ? chain(editor, range).insertContent(node).run() : false;
      },
    },
    {
      id: "divider",
      label: i18n.t(($) => $.notes.blocks.slash.divider),
      group: "basic",
      icon: Minus,
      keywords: ["divider", "rule", "line", "hr", "separator"],
      available: (editor) => commandAvailable(editor, "setHorizontalRule"),
      run: (editor, range) => chain(editor, range).setHorizontalRule().run(),
    },
    {
      id: "footnote",
      label: i18n.t(($) => $.notes.blocks.slash.footnote),
      group: "basic",
      icon: Asterisk,
      keywords: ["footnote", "note", "reference"],
      available: (editor) => commandAvailable(editor, "insertFootnoteReference"),
      run: (editor, range) => chain(editor, range).insertFootnoteReference().run(),
    },
    {
      id: "bookmark",
      label: i18n.t(($) => $.notes.blocks.bookmark.label),
      group: "basic",
      icon: Globe,
      keywords: ["bookmark", "link", "url", "web", "card", "preview"],
      available: canAskBookmark,
      run: (editor, range) => chain(editor, range).run() && askBookmark(editor),
    },
    {
      id: "attach",
      label: i18n.t(($) => $.notes.toolbar.attach),
      group: "basic",
      icon: Paperclip,
      keywords: ["attach", "file", "image", "upload", "csv", "excel", "notebook", "molecule"],
      available: canAttach,
      run: (editor, range) => {
        if (!chain(editor, range).run()) return false;
        void attachFile(editor, "file");
        return true;
      },
    },
  ];
}

function blockItems(): SlashItem[] {
  return blockGroups().flatMap(({ id, kinds }) =>
    kinds.map(
      (kind): SlashItem => ({
        id: `block:${kind.name}`,
        label: kind.label(),
        group: id,
        icon: kind.icon,
        keywords: [kind.name, ...(kind.aliases ?? []), ...(BLOCK_KEYWORDS[kind.name] ?? [])],
        available: () => true,
        run: (editor, range) => {
          const template = kind.template?.();
          if (!template) return false;
          return chain(editor, range)
            .insertContent({
              type: "codeBlock",
              attrs: { language: template.info },
              content: [{ type: "text", text: template.source }],
            })
            .command(caretAfterDrawnBlock)
            .run();
        },
      }),
    ),
  );
}

export function slashItems(editor: Editor): SlashItem[] {
  return [...basicItems(), ...blockItems()].filter((item) => item.available(editor));
}

function slashRank(label: string, haystack: readonly string[], first: string): number {
  if (label.startsWith(first)) return 0;
  return haystack.some((text) => text.startsWith(first)) ? 1 : 2;
}

export function filterSlashItems(items: readonly SlashItem[], query: string): SlashItem[] {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [...items];
  const scored = items
    .map((item, order) => {
      const label = item.label.toLowerCase();
      const haystack = [label, ...item.keywords.map((keyword) => keyword.toLowerCase())];
      if (!words.every((word) => haystack.some((text) => text.includes(word)))) return null;
      return { item, rank: slashRank(label, haystack, words[0]), order };
    })
    .filter((entry): entry is { item: SlashItem; rank: number; order: number } => entry !== null);
  scored.sort((left, right) => left.rank - right.rank || left.order - right.order);
  return scored.map(({ item }) => item);
}

export function slashState(state: EditorState): SlashState {
  const plugin = noteSlashKey.getState(state);
  const suggest = plugin?.suggest;
  if (!suggest) return plugin?.dismissed == null ? INACTIVE : { ...INACTIVE, dismissed: plugin.dismissed };
  return { active: true, from: suggest.from, to: suggest.to, query: suggest.query, index: suggest.index, dismissed: null };
}

export function visibleSlashItems(editor: Editor): SlashItem[] {
  const { state } = editor;
  let items = visibleItems.get(state);
  if (!items) {
    const slash = slashState(state);
    items = slash.active ? filterSlashItems(slashItems(editor), slash.query) : [];
    visibleItems.set(state, items);
  }
  return items;
}

export function moveSlash(view: EditorView, index: number): void {
  sendSuggestMeta(view, noteSlashKey, { index });
}

export function dismissSlash(view: EditorView): void {
  sendSuggestMeta(view, noteSlashKey, { dismiss: true });
}

export function chooseSlash(editor: Editor, index: number): boolean {
  const state = slashState(editor.state);
  const item = visibleSlashItems(editor)[index];
  if (!item) return false;
  return item.run(editor, { from: state.from, to: state.to });
}

export function slashMenuId(state: EditorState): string {
  const plugin = noteSlashKey.get(state);
  return plugin ? (plugin.spec as unknown as SlashPluginSpec).slashMenuId : "note-slash-menu";
}

export function slashOptionId(menuId: string, index: number): string {
  return suggestOptionId(menuId, index);
}

function slashOptions(editor: Editor, state: EditorState): { index: number; count: number } | null {
  const slash = slashState(state);
  if (!slash.active) return null;
  const count = visibleSlashItems(editor).length;
  return { index: Math.min(slash.index, Math.max(0, count - 1)), count };
}

export function slashPlugin(editor: Editor): Plugin<SuggestState<SuggestRange>> {
  const menuId = `note-slash-menu-${++menuCount}`;
  const spec: SlashPluginSpec = { slashMenuId: menuId };
  return suggestPlugin<SuggestRange>({
    key: noteSlashKey,
    menuId,
    spec,
    trigger: slashMatch,
    options: (state) => slashOptions(editor, state),
    handleKeyDown: (view, event) => {
      const options = slashOptions(editor, view.state);
      return suggestionKey(
        event,
        options && {
          ...options,
          close: () => dismissSlash(view),
          highlight: (next) => moveSlash(view, next),
          choose: () => chooseSlash(editor, options.index),
        },
      );
    },
  });
}

export const NoteSlash = Extension.create({
  name: "noteSlash",
  priority: 1000,
  addProseMirrorPlugins() {
    return [slashPlugin(this.editor)];
  },
});
