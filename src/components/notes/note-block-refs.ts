import { blockIdOf } from "@oleafly/wysiwyg";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface BlockRefs {
  setCounts: (counts: ReadonlyMap<string, number>, label: (count: number) => string) => void;
  onOpen: (listener: (blockId: string) => void) => () => void;
  extension: Extension;
}

const refsKey = new PluginKey<DecorationSet>("noteBlockRefs");
const NO_COUNTS: ReadonlyMap<string, number> = new Map();

function chipAt(node: ProseMirrorNode, pos: number): number {
  if (node.isTextblock) return pos + node.nodeSize - 1;
  if (node.type.name === "listItem" || node.type.name === "taskItem") {
    const first = node.firstChild;
    if (first?.isTextblock) return pos + 1 + first.nodeSize - 1;
  }
  return pos + node.nodeSize;
}

function chip(id: string, count: number, label: string, open: (id: string) => void): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-block-refs";
  button.contentEditable = "false";
  button.dataset.blockRefs = id;
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
  button.textContent = String(count);
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    open(id);
  });
  return button;
}

function decorate(doc: ProseMirrorNode, counts: ReadonlyMap<string, number>, label: (count: number) => string, open: (id: string) => void): DecorationSet {
  if (counts.size === 0) return DecorationSet.empty;
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    const id = blockIdOf(node);
    const count = id ? counts.get(id) : undefined;
    if (id && count) {
      found.push(
        Decoration.widget(chipAt(node, pos), () => chip(id, count, label(count), open), {
          side: 1,
          key: `${id}:${count}`,
          ignoreSelection: true,
          stopEvent: () => true,
        }),
      );
    }
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, found);
}

export function createBlockRefs(): BlockRefs {
  let counts = NO_COUNTS;
  let label = (count: number) => String(count);
  const views = new Set<() => void>();
  const openers = new Set<(blockId: string) => void>();
  const open = (id: string) => {
    for (const listener of openers) listener(id);
  };
  const plugin = () =>
    new Plugin<DecorationSet>({
      key: refsKey,
      state: {
        init: (_config, state) => decorate(state.doc, counts, label, open),
        apply: (tr, set) => (tr.docChanged || tr.getMeta(refsKey) ? decorate(tr.doc, counts, label, open) : set),
      },
      props: {
        decorations: (state) => refsKey.getState(state),
      },
      view: (view) => {
        const refresh = () => {
          if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(refsKey, true).setMeta("addToHistory", false));
        };
        views.add(refresh);
        return { destroy: () => views.delete(refresh) };
      },
    });
  return {
    setCounts: (next, nextLabel) => {
      label = nextLabel;
      if (next.size === 0 && counts.size === 0) return;
      counts = next;
      for (const refresh of views) refresh();
    },
    onOpen: (listener) => {
      openers.add(listener);
      return () => {
        openers.delete(listener);
      };
    },
    extension: Extension.create({ name: "noteBlockRefs", addProseMirrorPlugins: () => [plugin()] }),
  };
}
