import { combineTransactionSteps, getChangedRanges } from "@tiptap/core";
import { Link, type LinkOptions } from "@tiptap/extension-link";
import type { Mark, MarkType, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { isUrlWithScheme, markdownLinkDestination, readableLinkHref } from "../link-destination";
import type { LinkHrefLocalizer, LinkHrefOpener } from "../options";

const ESCAPED_QUOTE = String.raw`\"`;

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

interface AutolinkState {
  inAutolink?: boolean;
}

function isPlainUrl(link: Mark, parent: ProseMirrorNode, index: number): boolean {
  const href = String(link.attrs.href ?? "");
  if (link.attrs.title || !URL_SCHEME.test(href)) return false;
  const content = parent.child(index);
  if (!content.isText || content.text !== href || content.marks.at(-1) !== link) return false;
  return index === parent.childCount - 1 || !link.isInSet(parent.child(index + 1).marks);
}

function localizedHrefs(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
  type: MarkType,
  localize: LinkHrefLocalizer,
): Transaction | null {
  let tr: Transaction | null = null;
  for (const { newRange } of getChangedRanges(combineTransactionSteps(oldState.doc, [...transactions]))) {
    newState.doc.nodesBetween(newRange.from, newRange.to, (node, pos) => {
      const mark = node.isText ? type.isInSet(node.marks) : undefined;
      if (!mark) return;
      const href = localize(String(mark.attrs.href ?? ""));
      if (href === null || href === mark.attrs.href) return;
      tr ??= newState.tr;
      tr.addMark(pos, pos + node.nodeSize, type.create({ ...mark.attrs, href }));
    });
  }
  return tr;
}

export interface MarkdownLinkOptions {
  localizeHref: LinkHrefLocalizer | null;
  openHref: LinkHrefOpener | null;
}

/** The link under a click, if the editor shows one there. */
function clickedHref(root: HTMLElement, event: MouseEvent): string | null {
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  return anchor && root.contains(anchor) ? anchor.getAttribute("href") : null;
}

export const MarkdownLink = Link.extend<LinkOptions & MarkdownLinkOptions>({
  addOptions() {
    return {
      ...(this.parent?.() as LinkOptions),
      // Tiptap opens a clicked link with window.open, which the app's webview
      // ignores. Links to websites still open through the shell plugin's
      // handler for `target="_blank"`; links to project files open with
      // Mod+click below.
      openOnClick: false,
      localizeHref: null,
      openHref: null,
    };
  },

  renderHTML(props) {
    const rendered = this.parent?.(props) as [string, Record<string, unknown>, 0];
    const [tag, attributes, hole] = rendered;
    if (isUrlWithScheme(typeof attributes.href === "string" ? attributes.href : "")) return rendered;
    // A relative href resolves against the app's own address. With
    // `target="_blank"` the shell plugin opened that address in the system
    // browser on Windows (`http://tauri.localhost/...`), a page that does not
    // exist.
    const { target: _target, rel: _rel, ...local } = attributes;
    return [tag, local, hole];
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: {
          open(state: AutolinkState, mark: Mark, parent: ProseMirrorNode, index: number) {
            state.inAutolink = isPlainUrl(mark, parent, index);
            return state.inAutolink ? "<" : "[";
          },
          close(state: AutolinkState, mark: Mark) {
            const autolink = state.inAutolink;
            state.inAutolink = undefined;
            if (autolink) return ">";
            const quoted = String(mark.attrs.title ?? "").replaceAll('"', ESCAPED_QUOTE);
            const title = mark.attrs.title ? ` "${quoted}"` : "";
            return `](${markdownLinkDestination(readableLinkHref(String(mark.attrs.href ?? "")))}${title})`;
          },
          mightHaveLeadingWhitespace: true,
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];
    const localize = this.options.localizeHref;
    const open = this.options.openHref;
    if (localize) {
      plugins.push(
        new Plugin({
          key: new PluginKey("linkDestination"),
          appendTransaction: (transactions, oldState, newState) =>
            transactions.some((transaction) => transaction.docChanged)
              ? localizedHrefs(transactions, oldState, newState, this.type, localize)
              : null,
        }),
      );
    }
    if (open) {
      plugins.push(
        new Plugin({
          key: new PluginKey("openProjectLink"),
          props: {
            handleClick: (view, _pos, event) => {
              if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
              const href = clickedHref(view.dom, event);
              if (href === null || isUrlWithScheme(href) || !open(href)) return false;
              event.preventDefault();
              return true;
            },
          },
        }),
      );
    }
    return plugins;
  },
});
