import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { highlightLanguageName, loadHighlightLanguage, type TokenSpan, tokenSpans } from "@/components/ui/code-highlighter";
import { touchedTextblocks } from "./touched-textblocks";

export const DEFER_HIGHLIGHT_CHARS = 4_000;
export const DEFER_HIGHLIGHT_MS = 250;

export function codeLanguage(info: string): string | undefined {
  return highlightLanguageName(info.trim().split(/\s+/u)[0] ?? "");
}

const nodeSpans = new WeakMap<ProseMirrorNode, { name: string; spans: TokenSpan[] }>();

export function blockSpans(node: ProseMirrorNode, name: string): TokenSpan[] | null {
  const cached = nodeSpans.get(node);
  if (cached?.name === name) return cached.spans;
  const spans = tokenSpans(name, node.textContent);
  if (spans !== null) nodeSpans.set(node, { name, spans });
  return spans;
}

export const codeHighlightKey = new PluginKey<DecorationSet>("noteCodeHighlight");

function blockDecorations(node: ProseMirrorNode, position: number, missing: Set<string>): Decoration[] {
  const name = codeLanguage(String(node.attrs.language ?? ""));
  if (!name) return [];
  const found = blockSpans(node, name);
  if (found === null) {
    missing.add(name);
    return [];
  }
  const start = position + 1;
  return found.map((span) => Decoration.inline(start + span.from, start + span.to, { class: span.classes }));
}

function decorate(doc: ProseMirrorNode, missing: Set<string>, typeName: string): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== typeName) return true;
    decorations.push(...blockDecorations(node, position, missing));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

function deferred(node: ProseMirrorNode): boolean {
  if (node.textContent.length <= DEFER_HIGHLIGHT_CHARS) return false;
  const name = codeLanguage(String(node.attrs.language ?? ""));
  return Boolean(name && nodeSpans.get(node)?.name !== name && tokenSpans(name, "") !== null);
}

interface Redecorated {
  set: DecorationSet;
  later: boolean;
}

function redecorate(previous: DecorationSet, tr: Transaction, missing: Set<string>, typeName: string): Redecorated {
  const blocks = touchedTextblocks(tr);
  if (!blocks) return { set: decorate(tr.doc, missing, typeName), later: false };
  let set = previous.map(tr.mapping, tr.doc);
  let later = false;
  for (const { node, pos } of blocks) {
    if (node.type.name !== typeName) continue;
    if (deferred(node)) {
      later = true;
      continue;
    }
    const end = pos + node.nodeSize;
    const stale = set.find(pos, end).filter((decoration) => decoration.from < end && decoration.to > pos);
    if (stale.length > 0) set = set.remove(stale);
    const fresh = blockDecorations(node, pos, missing);
    if (fresh.length > 0) set = set.add(tr.doc, fresh);
  }
  return { set, later };
}

export function codeHighlightPlugin(typeName = "codeBlock"): Plugin<DecorationSet> {
  let view: EditorView | null = null;
  let timer: number | undefined;
  const requested = new Set<string>();
  const refresh = () => {
    if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(codeHighlightKey, true));
  };
  const load = (missing: Set<string>) => {
    for (const name of missing) {
      if (requested.has(name)) continue;
      requested.add(name);
      void loadHighlightLanguage(name).then((language) => {
        if (language) refresh();
      });
    }
  };
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      refresh();
    }, DEFER_HIGHLIGHT_MS);
  };
  return new Plugin<DecorationSet>({
    key: codeHighlightKey,
    state: {
      init: (_, state) => {
        const missing = new Set<string>();
        const set = decorate(state.doc, missing, typeName);
        queueMicrotask(() => load(missing));
        return set;
      },
      apply: (transaction, previous) => {
        const missing = new Set<string>();
        let set = previous;
        if (transaction.getMeta(codeHighlightKey)) set = decorate(transaction.doc, missing, typeName);
        else if (transaction.docChanged) {
          const next = redecorate(previous, transaction, missing, typeName);
          set = next.set;
          if (next.later) queueMicrotask(later);
        }
        if (missing.size > 0) queueMicrotask(() => load(missing));
        return set;
      },
    },
    props: {
      decorations: (state) => codeHighlightKey.getState(state),
    },
    view: (editorView) => {
      view = editorView;
      return {
        destroy: () => {
          view = null;
          window.clearTimeout(timer);
        },
      };
    },
  });
}
