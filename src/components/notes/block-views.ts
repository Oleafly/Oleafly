import { renderMathSource } from "@oleafly/editor/math-render";
import type { AnyExtension, CommandProps, Editor } from "@tiptap/core";
import { Node as TiptapNode } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";
import { NotebookTabs, Network, SquareSigma } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { renderDiagram } from "@/components/ui/mermaid-diagram";
import { isMermaidRemoteContentError } from "@/components/ui/mermaid-remote";
import { i18n } from "@/i18n";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { BLOCK_GROUPS, type BlockGroupId, NEW_BLOCKS } from "./block-templates";
import { chartBlock } from "./chart-block";
import { codeHighlightPlugin, codeLanguage } from "./code-highlight";
import { htmlBlock } from "./html-block";
import { moleculeBlock } from "./molecule-block";
import {
  blockMessage,
  currentTheme,
  type NoteBlockKind,
  type NoteFile,
  noteBlock,
  noteBlockName,
  type PaintContext,
  paintBlockCard,
  registerNoteBlock,
} from "./note-blocks";
import { imageSource } from "./note-path";
import {
  heldRemoteImage,
  type MountedNotice,
  mountRemoteImageNotice,
  type RemoteImage,
  remoteImageAllowed,
  subscribeRemoteImages,
} from "./note-remote-images";
import { NOTEBOOK_INFO, NotebookTooLargeError, notebookText, parseNotebookBlock } from "./notebook-block";
import type { NotebookMount } from "./NotebookView";
import { plotBlock } from "./plot-block";
import { reactBlock } from "./react-block";
import { sequenceBlock } from "./sequence-block";
import { smilesBlock } from "./smiles-block";
import { svgBlock } from "./svg-block";
import { tableBlock } from "./table-block";
import { typstBlock } from "./typst-block";

export { imageSource } from "./note-path";

export const BLOCK_REPAINT_MS = 300;
const COPIED_MS = 1500;
const CHEMISTRY = /\\(?:ce|pu)\b/u;
let chemistry: Promise<unknown> | null = null;

export function loadChemistry(): Promise<unknown> {
  chemistry ??= import("katex/contrib/mhchem").catch(() => null);
  return chemistry;
}

void loadChemistry();

function paintMermaid(preview: HTMLElement, source: string): () => void {
  let live = true;
  renderDiagram(source, currentTheme()).then(
    (svg) => {
      if (live) preview.replaceChildren(svg.cloneNode(true));
    },
    (error: unknown) => {
      if (!live) return;
      const remote = isMermaidRemoteContentError(error);
      blockMessage(preview, remote ? i18n.t(($) => $.core.mermaid.remoteBlocked) : i18n.t(($) => $.notes.blocks.diagramError));
    },
  );
  return () => {
    live = false;
  };
}

function drawLatex(preview: HTMLElement, source: string): void {
  const result = renderMathSource(source, true);
  if (result.status === "ready") preview.innerHTML = result.html;
  else blockMessage(preview, i18n.t(($) => $.notes.blocks.noPreview));
}

function paintLatex(preview: HTMLElement, source: string): (() => void) | undefined {
  if (!CHEMISTRY.test(source)) {
    drawLatex(preview, source);
    return undefined;
  }
  let live = true;
  void loadChemistry().then(() => {
    if (live) drawLatex(preview, source);
  });
  return () => {
    live = false;
  };
}

function paintNotebook(preview: HTMLElement, source: string, context: PaintContext): () => void {
  const parsed = parseNotebookBlock(source);
  if (!parsed.ok) {
    blockMessage(
      preview,
      parsed.problem === "path" ? i18n.t(($) => $.notes.notebook.badPath) : i18n.t(($) => $.notes.notebook.badCells),
    );
    return () => {};
  }
  const { path, cells, hideCode } = parsed.block;
  const readFile = context.readFile;
  if (!readFile) {
    blockMessage(preview, i18n.t(($) => $.notes.notebook.missing, { path }));
    return () => {};
  }
  let live = true;
  let mounted: NotebookMount | null = null;
  blockMessage(preview, i18n.t(($) => $.notes.notebook.loading));
  readFile(path)
    .then(async (url) => {
      if (!live) return;
      if (url === null) {
        blockMessage(preview, i18n.t(($) => $.notes.notebook.missing, { path }));
        return;
      }
      const text = notebookText(url);
      if (text === null) throw new Error("The notebook could not be read.");
      const { mountNotebook } = await import("./NotebookView");
      if (!live) return;
      const host = document.createElement("div");
      host.className = "note-notebook";
      preview.replaceChildren(host);
      mounted = mountNotebook(host);
      mounted.render({ text, cells, hideCode });
    })
    .catch((error: unknown) => {
      if (!live) return;
      blockMessage(
        preview,
        error instanceof NotebookTooLargeError
          ? i18n.t(($) => $.notes.notebook.tooLarge)
          : i18n.t(($) => $.notes.notebook.unreadable, { path }),
      );
    });
  return () => {
    live = false;
    mounted?.unmount();
  };
}

const latexBlock: NoteBlockKind = {
  name: "latex",
  label: () => "LaTeX",
  icon: SquareSigma,
  paint: (preview, source) => paintLatex(preview, source),
  template: () => NEW_BLOCKS.latex,
};

const mermaidBlock: NoteBlockKind = {
  name: "mermaid",
  label: () => "Mermaid",
  icon: Network,
  paint: (preview, source) => paintMermaid(preview, source),
  template: () => NEW_BLOCKS.mermaid,
};

const notebookBlock: NoteBlockKind = {
  name: NOTEBOOK_INFO,
  label: () => i18n.t(($) => $.notes.notebook.label),
  icon: NotebookTabs,
  paint: paintNotebook,
  still: "card",
  interactive: true,
};

export const BUILT_IN_BLOCKS: readonly NoteBlockKind[] = [
  chartBlock,
  plotBlock,
  tableBlock,
  latexBlock,
  typstBlock,
  mermaidBlock,
  svgBlock,
  htmlBlock,
  reactBlock,
  smilesBlock,
  moleculeBlock,
  sequenceBlock,
  notebookBlock,
];

for (const kind of BUILT_IN_BLOCKS) registerNoteBlock(kind);

export interface InsertGroup {
  id: BlockGroupId;
  kinds: NoteBlockKind[];
}

export function blockGroups(): InsertGroup[] {
  return BLOCK_GROUPS.map(({ id, kinds }) => ({
    id,
    kinds: kinds.map((name) => noteBlock(name)).filter((kind): kind is NoteBlockKind => Boolean(kind?.template)),
  })).filter((group) => group.kinds.length > 0);
}

const NOTE_FILES = "readNoteFile";
const NOTE_ID = "noteId";

function imageStorage(editor: Editor): Record<string, unknown> | undefined {
  return (editor.storage as unknown as Record<string, Record<string, unknown> | undefined>).image;
}

function noteFiles(editor: Editor): NoteFile | undefined {
  const read = imageStorage(editor)?.[NOTE_FILES];
  return typeof read === "function" ? (read as NoteFile) : undefined;
}

function noteIdOf(editor: Editor): string | undefined {
  const id = imageStorage(editor)?.[NOTE_ID];
  return typeof id === "string" ? id : undefined;
}

export function blockLabel(kind: string): string {
  return noteBlock(kind)?.label() ?? kind;
}

export function paintStillBlock(kind: string, preview: HTMLElement, source: string): () => void {
  const block = noteBlock(kind);
  if (!block) return () => {};
  if (block.still === "card") {
    paintBlockCard(preview, block.label(), source);
    return () => {};
  }
  const paint = block.still ?? block.paint;
  return paint(preview, source, { still: true, fence: kind }) ?? (() => {});
}

export function blockKindOf(info: string): string | undefined {
  return noteBlockName(info);
}

export const EDITING_CLASS = "note-drawn-editing";
export const SOURCE_CLASS = "note-drawn-source";
const EDITING_SPEC = { drawnEditing: true };
const editingKey = new PluginKey<DecorationSet>("noteDrawnEditing");

function isDrawnBlock(node: ProseMirrorNode): boolean {
  return node.type.name === "codeBlock" && blockKindOf(String(node.attrs.language ?? "")) !== undefined;
}

function caretInside(decorations: readonly Decoration[]): boolean {
  return decorations.some((decoration) => decoration.spec === EDITING_SPEC);
}

function drawnBlockAt(state: Pick<EditorState, "selection">): { from: number; to: number } | null {
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to) || $from.depth === 0 || !isDrawnBlock($from.parent)) return null;
  const from = $from.before();
  return { from, to: from + $from.parent.nodeSize };
}

function editingDecorations(state: EditorState, previous: DecorationSet | null): DecorationSet {
  const block = drawnBlockAt(state);
  if (!block) return DecorationSet.empty;
  const [current] = previous?.find() ?? [];
  if (previous && current?.from === block.from && current.to === block.to) return previous;
  return DecorationSet.create(state.doc, [Decoration.node(block.from, block.to, { class: EDITING_CLASS }, EDITING_SPEC)]);
}

function changedAround(tr: Transaction, position: number): boolean {
  let at = position;
  for (const map of [...tr.mapping.maps].reverse()) {
    let touched = false;
    map.forEach((_oldStart, _oldEnd, start, end) => {
      touched ||= start <= at && at <= end;
    });
    if (touched) return true;
    at = map.invert().map(at);
  }
  return false;
}

function placesCaret(tr: Transaction, old: EditorState): boolean {
  if (tr.getMeta("addToHistory") === false || tr.getMeta(editingKey) === true) return false;
  if (!tr.selection.eq(old.selection.map(tr.doc, tr.mapping))) return true;
  return tr.docChanged && changedAround(tr, tr.selection.head);
}

function drawnEditingPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: editingKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, value, old, state) => {
        if (!tr.docChanged && !tr.selectionSet) return value;
        if (value === DecorationSet.empty && !placesCaret(tr, old)) return value;
        return editingDecorations(state, tr.docChanged ? null : value);
      },
    },
    props: {
      decorations: (state) => editingKey.getState(state),
    },
  });
}

function caretAfter(tr: Transaction, after: number, reuse: (next: ProseMirrorNode) => boolean): boolean {
  const $after = tr.doc.resolve(after);
  const next = $after.nodeAfter;
  if (!next || !reuse(next)) {
    const paragraph = tr.doc.type.schema.nodes.paragraph;
    if (!paragraph || !$after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) return false;
    tr.insert(after, paragraph.create());
  }
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  return true;
}

function isEmptyParagraph(node: ProseMirrorNode): boolean {
  return node.type.name === "paragraph" && node.content.size === 0;
}

function isPlainTextblock(node: ProseMirrorNode): boolean {
  return node.isTextblock && !isDrawnBlock(node);
}

export function caretAfterDrawnBlock({ tr, dispatch }: Pick<CommandProps, "tr" | "dispatch">): boolean {
  const { $head } = tr.selection;
  if ($head.depth === 0 || !isDrawnBlock($head.parent) || !dispatch) return true;
  if (caretAfter(tr, $head.after(), isEmptyParagraph)) tr.scrollIntoView();
  return true;
}

function fenceOf(info: string): string {
  return info.trim().replace(/^\{=(.+)\}$/u, "$1").trim().toLowerCase();
}

function toggleLabel(showingSource: boolean): string {
  return showingSource
    ? i18n.t(($) => $.notes.blocks.preview)
    : i18n.t(($) => $.notes.blocks.source);
}

function copyButton(current: () => ProseMirrorNode): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = cn(buttonVariants({ variant: "ghost", size: "xs" }), "note-code-copy");
  button.contentEditable = "false";
  button.tabIndex = 0;
  let timer = 0;
  const show = (text: string, label: string) => {
    button.textContent = text;
    button.setAttribute("aria-label", label);
  };
  const reset = () => show(i18n.t(($) => $.notes.blocks.code.copy), i18n.t(($) => $.notes.blocks.code.copyLabel));
  const flash = (text: string) => {
    show(text, text);
    window.clearTimeout(timer);
    timer = window.setTimeout(reset, COPIED_MS);
  };
  reset();
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    writeClipboardText(current().textContent).then(
      () => flash(i18n.t(($) => $.notes.blocks.code.copied)),
      () => flash(i18n.t(($) => $.notes.blocks.code.copyFailed)),
    );
  });
  return button;
}

function plainCodeView(node: ProseMirrorNode, language: string): NodeView {
  const dom = document.createElement("div");
  dom.className = "note-code";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  pre.append(code);
  let current = node;
  const copy = copyButton(() => current);
  dom.append(copy, pre);
  const highlighted = codeLanguage(language);
  if (highlighted) {
    dom.classList.add("note-code-lang");
    dom.dataset.language = highlighted;
    code.className = `language-${highlighted}`;
  }
  return {
    dom,
    contentDOM: code,
    update(next: ProseMirrorNode) {
      if (next.type !== node.type || next.attrs.language !== language) return false;
      current = next;
      return true;
    },
    ignoreMutation: (mutation) => !code.contains(mutation.target),
    stopEvent: (event) => event.target instanceof Node && copy.contains(event.target),
  };
}

export function withBlockViews(extension: AnyExtension): AnyExtension {
  if (!(extension instanceof TiptapNode) || extension.name !== "codeBlock") return extension;
  return extension.extend({
    addProseMirrorPlugins() {
      return [...(this.parent?.() ?? []), codeHighlightPlugin(this.name), drawnEditingPlugin()];
    },
    addNodeView() {
      return ({ node, editor, getPos, decorations }) => {
        const language = String(node.attrs.language ?? "");
        const name = blockKindOf(language);
        const kind = name ? noteBlock(name) : undefined;
        if (!name || !kind) return plainCodeView(node, language);
        const dom = document.createElement("div");
        dom.className = "note-code note-drawn";
        dom.dataset.block = name;
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        pre.append(code);
        const preview = document.createElement("div");
        preview.className = "note-drawn-preview";
        preview.contentEditable = "false";
        const label = document.createElement("span");
        label.className = "note-drawn-label";
        label.contentEditable = "false";
        label.textContent = kind.label();
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = cn(buttonVariants({ variant: "ghost", size: "xs" }), "note-drawn-toggle");
        toggle.contentEditable = "false";
        let editing = caretInside(decorations);
        const syncToggle = () => {
          const showingSource = editing || dom.classList.contains(SOURCE_CLASS);
          const text = toggleLabel(showingSource);
          if (toggle.textContent !== text) toggle.textContent = text;
          if (toggle.getAttribute("aria-pressed") !== String(showingSource)) toggle.setAttribute("aria-pressed", String(showingSource));
        };
        const ownNode = (): { position: number; current: ProseMirrorNode } | null => {
          const position = getPos();
          if (position === undefined || !editor.isEditable) return null;
          const current = editor.state.doc.nodeAt(position);
          return current?.type === node.type ? { position, current } : null;
        };
        const showSource = () => {
          dom.classList.add(SOURCE_CLASS);
          const own = ownNode();
          if (!own) return;
          const end = own.position + 1 + own.current.content.size;
          editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)).scrollIntoView());
          editor.view.focus();
        };
        const showPreview = () => {
          dom.classList.remove(SOURCE_CLASS);
          const own = editing ? ownNode() : null;
          if (!own) return;
          const tr = editor.state.tr;
          if (caretAfter(tr, own.position + own.current.nodeSize, isPlainTextblock)) editor.view.dispatch(tr);
        };
        syncToggle();
        toggle.addEventListener("mousedown", (event) => event.preventDefault());
        toggle.addEventListener("click", () => {
          if (editing || dom.classList.contains(SOURCE_CLASS)) showPreview();
          else showSource();
          syncToggle();
        });
        dom.append(label, toggle, preview, pre);
        let painted = node.textContent;
        let wanted = painted;
        let timer: number | undefined;
        const rewrite = (change: (source: string) => string) => {
          const position = getPos();
          if (position === undefined || !editor.isEditable) return;
          const current = editor.state.doc.nodeAt(position);
          if (current?.type !== node.type || current.attrs.language !== node.attrs.language) return;
          const before = current.textContent;
          const next = change(before);
          if (next === before) return;
          if (before === painted) painted = next;
          editor.view.dispatch(
            editor.state.tr.insertText(next, position + 1, position + 1 + current.content.size).setMeta(editingKey, true),
          );
        };
        const context: PaintContext = {
          readFile: noteFiles(editor),
          still: false,
          fence: fenceOf(language),
          noteId: noteIdOf(editor),
          rewrite,
        };
        let dispose = kind.paint(preview, painted, context);
        const repaint = () => {
          timer = undefined;
          if (wanted === painted) return;
          painted = wanted;
          dispose?.();
          dispose = kind.paint(preview, painted, context);
        };
        return {
          dom,
          contentDOM: code,
          update(next, nextDecorations) {
            if (next.type !== node.type || next.attrs.language !== language) return false;
            editing = caretInside(nextDecorations);
            syncToggle();
            wanted = next.textContent;
            window.clearTimeout(timer);
            timer = wanted === painted ? undefined : window.setTimeout(repaint, BLOCK_REPAINT_MS);
            return true;
          },
          destroy() {
            window.clearTimeout(timer);
            dispose?.();
          },
          ignoreMutation: (mutation) => !code.contains(mutation.target),
          ...(kind.interactive ? { stopEvent: (event: Event) => preview.contains(event.target as Node) } : {}),
        };
      };
    },
  });
}

export function withImageView(
  extension: AnyExtension,
  resolve: (path: string) => Promise<string | null>,
  noteId?: string,
): AnyExtension {
  if (!(extension instanceof TiptapNode) || extension.name !== "image") return extension;
  return extension.extend({
    addStorage() {
      return { ...this.parent?.(), [NOTE_FILES]: resolve, [NOTE_ID]: noteId };
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("figure");
        dom.className = "note-image";
        const image = document.createElement("img");
        image.draggable = false;
        const missing = document.createElement("p");
        missing.className = "note-drawn-empty";
        missing.contentEditable = "false";
        dom.append(image, missing);
        let current: string | null = null;
        let generation = 0;
        let held: MountedNotice | null = null;
        let stopWatching: (() => void) | null = null;
        const release = () => {
          held?.destroy();
          held = null;
          stopWatching?.();
          stopWatching = null;
        };
        const showMissing = (src: string) => {
          image.hidden = true;
          image.removeAttribute("src");
          missing.hidden = false;
          missing.textContent = i18n.t(($) => $.notes.blocks.imageMissing, { path: src });
        };
        const show = (url: string) => {
          image.src = url;
          image.hidden = false;
          missing.hidden = true;
        };
        const hold = (remote: RemoteImage) => {
          image.hidden = true;
          image.removeAttribute("src");
          missing.hidden = true;
          held = mountRemoteImageNotice(remote, image.alt, () => {
            release();
            show(remote.url);
          });
          dom.append(held.dom);
          stopWatching = subscribeRemoteImages(() => {
            if (!remoteImageAllowed(remote.url)) return;
            release();
            show(remote.url);
          });
        };
        const paint = (src: string, alt: string) => {
          image.alt = alt;
          if (src === current) return;
          current = src;
          release();
          const request = ++generation;
          const source = imageSource(src);
          if (!source) {
            showMissing(src);
            return;
          }
          if ("url" in source) {
            const remote = heldRemoteImage(source.url);
            if (remote) hold(remote);
            else show(source.url);
            return;
          }
          image.hidden = true;
          missing.hidden = true;
          resolve(source.path).then(
            (url) => {
              if (request !== generation) return;
              if (url) show(url);
              else showMissing(src);
            },
            () => {
              if (request === generation) showMissing(src);
            },
          );
        };
        paint(String(node.attrs.src ?? ""), String(node.attrs.alt ?? ""));
        return {
          dom,
          update(next) {
            if (next.type !== node.type) return false;
            paint(String(next.attrs.src ?? ""), String(next.attrs.alt ?? ""));
            return true;
          },
          stopEvent: (event) => event.target instanceof Node && held !== null && held.dom.contains(event.target),
          destroy() {
            generation += 1;
            release();
          },
        };
      };
    },
  });
}
