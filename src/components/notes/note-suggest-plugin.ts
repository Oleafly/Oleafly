import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, type PluginKey } from "@tiptap/pm/state";
import { type Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { isImeEnter } from "@/components/ai/composer/ime";
import { redecorateTextblocks } from "./touched-textblocks";

export interface SuggestRange {
  from: number;
  to: number;
  query: string;
  index: number;
}

export interface SuggestState<R extends SuggestRange> {
  decorations: DecorationSet;
  suggest: R | null;
  dismissed: number | null;
}

export interface SuggestMeta {
  index?: number;
  dismiss?: boolean;
  refresh?: boolean;
}

export type BlockDecorator = (block: ProseMirrorNode, pos: number) => Decoration[];

export interface SuggestOptions {
  index: number;
  count: number;
}

export interface SuggestPluginConfig<R extends SuggestRange> {
  key: PluginKey<SuggestState<R>>;
  menuId: string;
  spec: object;
  decorator: () => BlockDecorator;
  trigger: (state: EditorState) => Omit<R, "index"> | null;
  options: (state: EditorState) => SuggestOptions | null;
  handleKeyDown: (view: EditorView, event: KeyboardEvent) => boolean;
  click: (view: EditorView, event: MouseEvent) => boolean;
  subscribe?: (listener: () => void) => () => void;
}

export interface SuggestKeys {
  count: number;
  index: number;
  close: () => void;
  highlight: (index: number) => void;
  choose: (event: KeyboardEvent) => boolean;
}

export function suggestOptionId(menuId: string, index: number): string {
  return `${menuId}-option-${index}`;
}

export function sendSuggestMeta<R extends SuggestRange>(view: EditorView, key: PluginKey<SuggestState<R>>, meta: SuggestMeta): void {
  view.dispatch(view.state.tr.setMeta(key, meta));
}

export function suggestionKey(event: KeyboardEvent, keys: SuggestKeys | null): boolean {
  if (!keys || isImeEnter(event)) return false;
  if (event.key === "Escape") {
    event.stopPropagation();
    keys.close();
    return true;
  }
  if (keys.count === 0 || event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.stopPropagation();
    keys.highlight((keys.index + (event.key === "ArrowDown" ? 1 : -1) + keys.count) % keys.count);
    return true;
  }
  if (event.key !== "Tab" && event.key !== "Enter") return false;
  const chosen = keys.choose(event);
  if (chosen) event.stopPropagation();
  return chosen;
}

function buildDecorations(doc: ProseMirrorNode, decorate: BlockDecorator): DecorationSet {
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    found.push(...decorate(node, pos));
    return false;
  });
  return DecorationSet.create(doc, found);
}

export function suggestPlugin<R extends SuggestRange>(config: SuggestPluginConfig<R>): Plugin<SuggestState<R>> {
  const { key } = config;
  return new Plugin<SuggestState<R>>({
    ...config.spec,
    key,
    state: {
      init: (_config, state) => ({ decorations: buildDecorations(state.doc, config.decorator()), suggest: null, dismissed: null }),
      apply: (tr, previous, _old, state) => {
        const meta = tr.getMeta(key) as SuggestMeta | undefined;
        if (!meta && !tr.docChanged && !tr.selectionSet) return previous;
        let decorations = previous.decorations;
        if (meta?.refresh) decorations = buildDecorations(tr.doc, config.decorator());
        else if (tr.docChanged) {
          const decorate = config.decorator();
          decorations = redecorateTextblocks(previous.decorations, tr, decorate) ?? buildDecorations(tr.doc, decorate);
        }
        const trigger = config.trigger(state);
        const mapped = previous.dismissed === null ? null : tr.mapping.map(previous.dismissed);
        let dismissed = meta?.dismiss ? (trigger?.from ?? null) : mapped;
        if (!trigger || trigger.from !== dismissed) dismissed = null;
        if (!trigger || dismissed !== null) return { decorations, suggest: null, dismissed };
        const kept = previous.suggest?.from === trigger.from && previous.suggest.query === trigger.query ? previous.suggest.index : 0;
        return { decorations, suggest: { ...trigger, index: meta?.index ?? kept } as R, dismissed };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations ?? DecorationSet.empty,
      handleKeyDown: config.handleKeyDown,
      handleDOMEvents: {
        click: config.click,
      },
      attributes: (state): Record<string, string> => {
        const options = config.options(state);
        if (!options) return {};
        const attributes: Record<string, string> = { "aria-controls": config.menuId, "aria-expanded": "true" };
        if (options.count > 0) attributes["aria-activedescendant"] = suggestOptionId(config.menuId, options.index);
        return attributes;
      },
    },
    view: (view) => {
      let live = true;
      const stop = config.subscribe?.(() => {
        if (live) sendSuggestMeta(view, key, { refresh: true });
      });
      return {
        destroy: () => {
          live = false;
          stop?.();
        },
      };
    },
  });
}
