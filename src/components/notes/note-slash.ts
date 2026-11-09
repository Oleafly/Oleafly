import { mathNodeJSON } from "@oleafly/wysiwyg";
import { type Editor, Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Megaphone,
  Minus,
  Quote,
  SquareCode,
  SquareFunction,
  Table,
} from "lucide-react";
import { i18n } from "@/i18n";
import type { BlockGroupId } from "./block-templates";
import { blockGroups } from "./block-views";
import { suggestionKey, suggestOptionId } from "./note-suggest-plugin";

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
  svg: ["vector", "drawing", "image"],
  html: ["web", "page", "widget", "interactive"],
  jsx: ["component", "app", "interactive", "artifact"],
  smiles: ["chemistry", "molecule", "structure", "compound"],
  molecule: ["protein", "3d", "structure", "chemistry", "crystal"],
  sequence: ["dna", "rna", "protein", "gene", "genome"],
};
const INACTIVE: SlashState = { active: false, from: 0, to: 0, query: "", index: 0, dismissed: null };

export const noteSlashKey = new PluginKey<SlashState>("noteSlash");
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
  const headings: [1 | 2 | 3, LucideIcon][] = [
    [1, Heading1],
    [2, Heading2],
    [3, Heading3],
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
            .run();
        },
      }),
    ),
  );
}

export function slashItems(editor: Editor): SlashItem[] {
  return [...basicItems(), ...blockItems()].filter((item) => item.available(editor));
}

export function filterSlashItems(items: readonly SlashItem[], query: string): SlashItem[] {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [...items];
  const scored = items
    .map((item, order) => {
      const label = item.label.toLowerCase();
      const haystack = [label, ...item.keywords.map((keyword) => keyword.toLowerCase())];
      if (!words.every((word) => haystack.some((text) => text.includes(word)))) return null;
      const first = words[0];
      const rank = label.startsWith(first) ? 0 : haystack.some((text) => text.startsWith(first)) ? 1 : 2;
      return { item, rank, order };
    })
    .filter((entry): entry is { item: SlashItem; rank: number; order: number } => entry !== null);
  return scored.sort((left, right) => left.rank - right.rank || left.order - right.order).map(({ item }) => item);
}

export function slashState(state: EditorState): SlashState {
  return noteSlashKey.getState(state) ?? INACTIVE;
}

export function visibleSlashItems(editor: Editor, state: SlashState = slashState(editor.state)): SlashItem[] {
  return state.active ? filterSlashItems(slashItems(editor), state.query) : [];
}

type SlashMeta = { type: "move"; index: number } | { type: "dismiss" };

export function moveSlash(view: EditorView, index: number): void {
  view.dispatch(view.state.tr.setMeta(noteSlashKey, { type: "move", index } satisfies SlashMeta));
}

export function dismissSlash(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(noteSlashKey, { type: "dismiss" } satisfies SlashMeta));
}

export function chooseSlash(editor: Editor, index: number): boolean {
  const state = slashState(editor.state);
  const item = visibleSlashItems(editor, state)[index];
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

export function slashPlugin(editor: Editor): Plugin<SlashState> {
  const spec: SlashPluginSpec = { slashMenuId: `note-slash-menu-${++menuCount}` };
  return new Plugin<SlashState>({
    ...spec,
    key: noteSlashKey,
    state: {
      init: () => INACTIVE,
      apply: (transaction, previous, _old, state) => {
        const meta = transaction.getMeta(noteSlashKey) as SlashMeta | undefined;
        const match = slashMatch(state);
        if (!match) return INACTIVE;
        if (meta?.type === "dismiss") return { ...INACTIVE, dismissed: match.from };
        if (previous.dismissed === match.from) return { ...INACTIVE, dismissed: match.from };
        const sameQuery = previous.active && previous.from === match.from && previous.query === match.query;
        const index = meta?.type === "move" ? meta.index : sameQuery ? previous.index : 0;
        return { active: true, ...match, index, dismissed: null };
      },
    },
    props: {
      handleKeyDown: (view, event) => {
        const state = slashState(view.state);
        if (!state.active) return false;
        const items = visibleSlashItems(editor, state);
        const index = Math.min(state.index, Math.max(0, items.length - 1));
        return suggestionKey(event, {
          count: items.length,
          index,
          close: () => dismissSlash(view),
          highlight: (next) => moveSlash(view, next),
          choose: () => chooseSlash(editor, index),
        });
      },
      attributes: (state): Record<string, string> => {
        const slash = slashState(state);
        if (!slash.active) return {};
        const menuId = spec.slashMenuId;
        const count = visibleSlashItems(editor, slash).length;
        const attributes: Record<string, string> = { "aria-controls": menuId, "aria-expanded": "true" };
        if (count > 0) attributes["aria-activedescendant"] = slashOptionId(menuId, Math.min(slash.index, count - 1));
        return attributes;
      },
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
