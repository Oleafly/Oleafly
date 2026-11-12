import { renderMathSource } from "@oleafly/editor/math-render";
import { IMAGE_WIDTH_RANGE, imageWidthPercent } from "@oleafly/wysiwyg";
import { isTauri } from "@tauri-apps/api/core";
import { type AnyExtension, type CommandProps, type Editor, Node as TiptapNode } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";
import { AudioLines, Check, Copy, Info, NotebookTabs, Network, Play, SquareArrowOutUpRight, SquareSigma } from "lucide-react";
import { BLOCK_ACTIONS, BLOCK_FRAME, BLOCK_LABEL, BLOCK_MESSAGE, BLOCK_ROOT } from "@/components/ui/block-frame";
import { buttonVariants } from "@/components/ui/button";
import { COPIED_FEEDBACK_MS, COPY_BUTTON_CLASS } from "@/components/ui/copyable-block";
import { INFO_HINT_CLASS } from "@/components/ui/info-hint";
import { renderDiagram } from "@/components/ui/mermaid-diagram";
import { isMermaidRemoteContentError } from "@/components/ui/mermaid-remote";
import { whenNearViewport } from "@/hooks/use-near-viewport";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { writeClipboardText } from "@/lib/clipboard";
import { logError } from "@/lib/log";
import {
  heldRemoteImage,
  type RemoteImage,
  remoteImage,
  remoteImageAllowed,
  subscribeRemoteImages,
} from "@/lib/remote-image";
import { basename } from "@/lib/path-utils";
import { noteLinkPreview, noteVideoFrameOrigin } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { blockSyntax } from "./block-guide";
import { BLOCK_GROUPS, type BlockGroupId, NEW_BLOCKS } from "./block-templates";
import { bookmarkBlock } from "./bookmark-block";
import { chartBlock } from "./chart-block";
import { codeHighlightPlugin, codeLanguage } from "./code-highlight";
import { d2Block } from "./d2-block";
import { htmlBlock } from "./html-block";
import { moleculeBlock } from "./molecule-block";
import {
  blockMessage,
  currentTheme,
  type Dispose,
  element,
  iconSvg,
  type NoteBlockKind,
  type NoteFile,
  noteBlock,
  noteBlockName,
  type PaintContext,
  paintAsync,
  paintBlockCard,
  registerNoteBlock,
} from "./note-blocks";
import {
  assetFragment,
  imageSource,
  noteMediaKind,
  notePath,
  playsInNote,
  VIDEO_PROVIDER_NAMES,
  type VideoEmbed,
  videoEmbed,
  videoFramePage,
} from "./note-path";
import { type MountedNotice, mountRemoteImageNotice } from "./note-remote-images";
import { NOTEBOOK_INFO, NotebookTooLargeError, notebookText, parseNotebookBlock } from "./notebook-block";
import type { NotesData } from "./notes-data";
import { plotBlock } from "./plot-block";
import { reactBlock } from "./react-block";
import { sequenceBlock } from "./sequence-block";
import { smilesBlock } from "./smiles-block";
import { svgBlock } from "./svg-block";
import { tableBlock } from "./table-block";
import { tikzBlocks } from "./tikz-block";
import { typstBlock } from "./typst-block";
import { videoLogo } from "./video-logo";

export const BLOCK_REPAINT_MS = 300;
const CHEMISTRY = /\\(?:ce|pu)\b/u;
let chemistry: Promise<unknown> | null = null;

export function loadChemistry(): Promise<unknown> {
  chemistry ??= import("katex/contrib/mhchem").catch(() => null);
  return chemistry;
}

void loadChemistry();

function paintMermaid(preview: HTMLElement, source: string): Dispose {
  return paintAsync(preview, {
    load: () => renderDiagram(source, currentTheme()),
    show: (svg) => {
      preview.replaceChildren(svg.cloneNode(true));
      return undefined;
    },
    error: (error) =>
      isMermaidRemoteContentError(error) ? i18n.t(($) => $.core.mermaid.remoteBlocked) : i18n.t(($) => $.notes.blocks.diagramError),
  });
}

function drawLatex(preview: HTMLElement, source: string): void {
  const result = renderMathSource(source, true);
  if (result.status === "ready") preview.innerHTML = result.html;
  else blockMessage(preview, i18n.t(($) => $.notes.blocks.noPreview));
}

function paintLatex(preview: HTMLElement, source: string): Dispose | undefined {
  if (!CHEMISTRY.test(source)) {
    drawLatex(preview, source);
    return undefined;
  }
  return paintAsync(preview, {
    load: loadChemistry,
    show: () => {
      drawLatex(preview, source);
      return undefined;
    },
    error: () => i18n.t(($) => $.notes.blocks.noPreview),
  });
}

function paintNotebook(preview: HTMLElement, source: string, context: PaintContext): Dispose {
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
  return paintAsync(preview, {
    loading: i18n.t(($) => $.notes.notebook.loading),
    load: async () => {
      const url = await readFile(path);
      if (url === null) return null;
      const text = notebookText(url);
      if (text === null) throw new Error("The notebook could not be read.");
      return { text, view: await import("./NotebookView") };
    },
    show: (loaded) => {
      if (!loaded) {
        blockMessage(preview, i18n.t(($) => $.notes.notebook.missing, { path }));
        return undefined;
      }
      const host = element("div", "note-notebook w-full min-w-0");
      preview.replaceChildren(host);
      const mounted = loaded.view.mountNotebook(host);
      mounted.render({ text: loaded.text, cells, hideCode });
      return () => mounted.unmount();
    },
    error: (error) =>
      error instanceof NotebookTooLargeError
        ? i18n.t(($) => $.notes.notebook.tooLarge)
        : i18n.t(($) => $.notes.notebook.unreadable, { path }),
  });
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
  d2Block,
  ...tikzBlocks,
  svgBlock,
  htmlBlock,
  reactBlock,
  smilesBlock,
  moleculeBlock,
  sequenceBlock,
  notebookBlock,
  bookmarkBlock,
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

export const EDITING_CLASS = "note-drawn-editing";
export const SOURCE_CLASS = "note-drawn-source";
const EDITING_SPEC = { drawnEditing: true };
const editingKey = new PluginKey<DecorationSet>("noteDrawnEditing");

function isDrawnBlock(node: ProseMirrorNode): boolean {
  return node.type.name === "codeBlock" && noteBlockName(String(node.attrs.language ?? "")) !== undefined;
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
  if ($head.depth > 0 && isDrawnBlock($head.parent) && dispatch && caretAfter(tr, $head.after(), isEmptyParagraph)) tr.scrollIntoView();
  return true;
}

function naturalWidthStyle(image: HTMLImageElement): string {
  return image.naturalWidth ? `${image.naturalWidth}px` : "";
}

function fenceOf(info: string): string {
  return info.trim().replace(/^\{=(.+)\}$/u, "$1").trim().toLowerCase();
}

function copyButton(read: () => string): HTMLButtonElement {
  const button = element("button", `note-code-copy select-none ${COPY_BUTTON_CLASS}`);
  button.type = "button";
  const idle = iconSvg(Copy, "size-3.5");
  const done = iconSvg(Check, "size-3.5 text-emerald-500");
  let timer = 0;
  const show = (icon: SVGElement, label: string) => {
    button.replaceChildren(icon);
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
  };
  const reset = () => show(idle, i18n.t(($) => $.notes.blocks.code.copyLabel));
  const flash = (icon: SVGElement, label: string) => {
    show(icon, label);
    window.clearTimeout(timer);
    timer = window.setTimeout(reset, COPIED_FEEDBACK_MS);
  };
  reset();
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    writeClipboardText(read()).then(
      () => flash(done, i18n.t(($) => $.notes.blocks.code.copied)),
      () => flash(idle, i18n.t(($) => $.notes.blocks.code.copyFailed)),
    );
  });
  return button;
}

function syntaxHelp(block: string, syntax: string): HTMLButtonElement {
  const button = element("button", cn(INFO_HINT_CLASS, "pointer-events-auto ml-1 size-4 cursor-help align-middle"));
  button.type = "button";
  button.setAttribute("aria-label", i18n.t(($) => $.notes.blocks.syntax.help, { block }));
  button.dataset.tooltip = syntax;
  button.append(iconSvg(Info, "size-3"));
  button.addEventListener("mousedown", (event) => event.preventDefault());
  return button;
}

function actionSlot(...buttons: HTMLElement[]): HTMLElement {
  const actions = element("div", `${BLOCK_ACTIONS} select-none`);
  actions.contentEditable = "false";
  actions.append(...buttons);
  return actions;
}

function inside(container: HTMLElement, event: Event): boolean {
  return event.target instanceof Node && container.contains(event.target);
}

function plainCodeView(node: ProseMirrorNode, language: string): NodeView {
  const dom = element("div", `note-code code-tokens ${BLOCK_ROOT}`);
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  pre.append(code);
  let current = node;
  const actions = actionSlot(copyButton(() => current.textContent));
  dom.append(actions, pre);
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
    stopEvent: (event) => inside(actions, event),
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
        const name = noteBlockName(language);
        const kind = name ? noteBlock(name) : undefined;
        if (!name || !kind) return plainCodeView(node, language);
        const dom = element("div", `note-code note-drawn code-tokens ${BLOCK_FRAME}`);
        dom.dataset.block = name;
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        pre.append(code);
        const preview = element("div", "note-drawn-preview");
        preview.contentEditable = "false";
        const label = element("span", `note-drawn-label ${BLOCK_LABEL}`, kind.label());
        label.contentEditable = "false";
        const syntax = blockSyntax(name);
        const help = syntax ? syntaxHelp(kind.label(), syntax) : null;
        if (help) label.append(help);
        const toggle = element("button", cn(buttonVariants({ variant: "ghost", size: "xs" }), "note-drawn-toggle select-none"));
        toggle.type = "button";
        let current = node;
        const copy = copyButton(() => current.textContent);
        const actions = actionSlot(copy, toggle);
        let editing = caretInside(decorations);
        const syncToggle = () => {
          const showingSource = editing || dom.classList.contains(SOURCE_CLASS);
          const text = showingSource ? i18n.t(($) => $.notes.blocks.preview) : i18n.t(($) => $.notes.blocks.source);
          if (toggle.textContent !== text) toggle.textContent = text;
          if (toggle.getAttribute("aria-pressed") !== String(showingSource)) toggle.setAttribute("aria-pressed", String(showingSource));
          copy.hidden = !showingSource;
          if (help) help.hidden = !showingSource;
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
        dom.append(label, actions, preview, pre);
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
        let dispose: Dispose | undefined;
        let shown = false;
        const stopWaiting = whenNearViewport(dom, () => {
          shown = true;
          dispose = kind.paint(preview, painted, context);
        });
        const repaint = () => {
          timer = undefined;
          if (wanted === painted) return;
          painted = wanted;
          if (!shown) return;
          dispose?.();
          dispose = kind.paint(preview, painted, context);
        };
        return {
          dom,
          contentDOM: code,
          update(next, nextDecorations) {
            if (next.type !== node.type || next.attrs.language !== language) return false;
            current = next;
            editing = caretInside(nextDecorations);
            syncToggle();
            wanted = next.textContent;
            window.clearTimeout(timer);
            timer = wanted === painted ? undefined : window.setTimeout(repaint, BLOCK_REPAINT_MS);
            return true;
          },
          destroy() {
            window.clearTimeout(timer);
            stopWaiting();
            dispose?.();
          },
          ignoreMutation: (mutation) => !code.contains(mutation.target),
          stopEvent: (event: Event) =>
            inside(actions, event) || inside(label, event) || (kind.interactive === true && inside(preview, event)),
        };
      };
    },
  });
}

const NOTE_FILE_TOAST = "note-file-open";
const MEDIA_CAPTION = "mt-1.5 flex min-w-0 items-center justify-between gap-3 text-[0.8125rem] text-muted-foreground";
const MEDIA_ACTION = cn(buttonVariants({ variant: "link", size: "xs" }), "h-auto shrink-0 px-0");
const WATCH_ACTION = cn(
  buttonVariants({ variant: "link", size: "xs" }),
  "h-auto shrink-0 gap-1 px-1.5 py-0.5 text-[0.8125rem] text-white hover:bg-white/15 focus-visible:bg-white/20 [&_svg]:size-3.5",
);
const MEDIA_CONTROLS = "a, button, audio, video, iframe";
const FRAME_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/u;

type Resolve = (path: string) => Promise<string | null>;

export interface NoteAssetActions {
  open?: (path: string) => void;
  reveal?: (path: string) => void;
}

type AssetActions = () => NoteAssetActions;

const noAssetActions: AssetActions = () => ({});

export function noteAssetActions(data: Pick<NotesData, "openAsset" | "revealAsset">, noteId: string): NoteAssetActions {
  const run = (act: ((id: string, path: string) => Promise<void>) | undefined) =>
    act &&
    ((path: string) => {
      act(noteId, path).catch((error: unknown) => {
        void logError("open a note file", error);
        toast.errorUnique(NOTE_FILE_TOAST, i18n.t(($) => $.notes.blocks.media.openFailed, { error: describeError(error) }));
      });
    });
  return { open: run(data.openAsset?.bind(data)), reveal: run(data.revealAsset?.bind(data)) };
}

function onControl(dom: HTMLElement, event: Event): boolean {
  const hit = event.target instanceof Element ? event.target.closest(MEDIA_CONTROLS) : null;
  return hit !== null && dom.contains(hit);
}

function actionButton(label: string, run: () => void): HTMLButtonElement {
  const button = element("button", MEDIA_ACTION, label);
  button.type = "button";
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", run);
  return button;
}

function mediaCaption(...parts: Node[]): HTMLElement {
  const caption = element("figcaption", MEDIA_CAPTION);
  caption.contentEditable = "false";
  caption.append(...parts);
  return caption;
}

function revokeBlob(url: string | null): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function mediaName(src: string): string {
  const source = imageSource(src);
  const path = source && "path" in source ? assetFragment(source.path).file : src;
  return basename(path) || src;
}

function mediaView(node: ProseMirrorNode, kind: "audio" | "video", resolve: Resolve, assets: AssetActions): NodeView {
  const src = String(node.attrs.src ?? "");
  const path = notePath(src);
  const name = mediaName(src);
  const dom = element("figure", "note-media");
  dom.dataset.media = kind;
  dom.contentEditable = "false";
  const play = element(
    "button",
    cn(buttonVariants({ variant: "outline" }), "note-media-play h-auto max-w-full", kind === "audio" ? "justify-start px-3 py-2" : "p-0"),
  );
  play.type = "button";
  play.setAttribute("aria-label", i18n.t(($) => $.notes.blocks.media.play, { name }));
  play.append(iconSvg(kind === "video" ? Play : AudioLines, "size-4 shrink-0"));
  if (kind === "audio") play.append(element("span", "min-w-0 truncate", name));
  const problem = element("p", cn(BLOCK_MESSAGE, "flex flex-wrap items-center gap-x-2"));
  problem.hidden = true;
  dom.append(play);
  if (kind === "video") dom.append(mediaCaption(element("span", "min-w-0 truncate", name)));
  dom.append(problem);
  let url: string | null = null;
  let player: HTMLMediaElement | null = null;
  let destroyed = false;
  const say = (text: string, offerFolder: boolean) => {
    problem.replaceChildren(element("span", "", text));
    if (offerFolder && path !== null && assets().reveal) {
      problem.append(actionButton(i18n.t(($) => $.core.export.showInFolder), () => assets().reveal?.(path)));
    }
    problem.hidden = false;
  };
  const cantPlay = () => {
    if (destroyed || !player) return;
    player.remove();
    player = null;
    revokeBlob(url);
    url = null;
    say(i18n.t(($) => $.notes.blocks.media.cantPlay, { name }), true);
  };
  const load = async () => {
    play.disabled = true;
    problem.hidden = true;
    let unreadable = false;
    const found =
      path === null
        ? null
        : await resolve(path).catch(() => {
            unreadable = true;
            return null;
          });
    if (destroyed) {
      revokeBlob(found);
      return;
    }
    if (!found) {
      play.disabled = false;
      say(
        unreadable ? i18n.t(($) => $.notes.blocks.media.unreadable, { name }) : i18n.t(($) => $.notes.blocks.media.missing, { path: src }),
        unreadable,
      );
      return;
    }
    url = found;
    const media = document.createElement(kind);
    media.controls = true;
    media.className = "note-media-player";
    media.setAttribute("aria-label", name);
    media.addEventListener("error", cantPlay);
    media.src = found;
    player = media;
    play.replaceWith(media);
    media.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotSupportedError") cantPlay();
    });
  };
  play.addEventListener("click", () => void load());
  return {
    dom,
    update: (next) => next.type === node.type && String(next.attrs.src ?? "") === src,
    stopEvent: (event) => onControl(dom, event),
    ignoreMutation: () => true,
    destroy() {
      destroyed = true;
      player?.pause();
      revokeBlob(url);
    },
  };
}

async function embedPicture(embed: VideoEmbed): Promise<{ image: string | null; title: string | null }> {
  if (embed.thumbnail) return { image: embed.thumbnail, title: null };
  const preview = await Promise.resolve(embed.page)
    .then(noteLinkPreview)
    .catch(() => null);
  return { image: preview?.image?.startsWith("https:") ? preview.image : null, title: preview?.title?.trim() || null };
}

async function embedFrame(embed: VideoEmbed): Promise<string | null> {
  const origin = await Promise.resolve()
    .then(noteVideoFrameOrigin)
    .catch(() => null);
  if (origin && FRAME_ORIGIN.test(origin)) return videoFramePage(embed, origin);
  if (isTauri()) return null;
  return `${embed.frame}${embed.frame.includes("?") ? "&" : "?"}autoplay=1`;
}

function embedView(node: ProseMirrorNode, embed: VideoEmbed): NodeView {
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const site = VIDEO_PROVIDER_NAMES[embed.provider];
  const dom = element("figure", "note-media");
  dom.dataset.media = "embed";
  dom.dataset.provider = embed.provider;
  dom.contentEditable = "false";
  const play = element("button", cn(buttonVariants({ variant: "outline" }), "note-media-play note-media-poster h-auto p-0 [&_svg]:size-6"));
  play.type = "button";
  play.setAttribute("aria-label", i18n.t(($) => $.notes.blocks.media.embed, { site }));
  const badge = element("span", "note-media-badge");
  badge.append(iconSvg(Play, "size-6"));
  play.append(badge);
  const title = element("span", "min-w-0 truncate font-medium", alt);
  title.hidden = !alt;
  const brand = element("span", "flex min-w-0 items-center gap-2");
  brand.append(videoLogo(embed.provider, "size-5 shrink-0"), title);
  const watch = element("a", WATCH_ACTION, i18n.t(($) => $.notes.blocks.media.watch));
  watch.append(iconSvg(SquareArrowOutUpRight, ""));
  watch.setAttribute("aria-label", i18n.t(($) => $.notes.blocks.media.watchOn, { site }));
  watch.href = embed.page;
  watch.target = "_blank";
  watch.rel = "noopener noreferrer";
  const bar = element("figcaption", "note-media-bar");
  bar.append(brand, watch);
  const failed = element("p", BLOCK_MESSAGE, i18n.t(($) => $.notes.blocks.media.embedFailed, { site }));
  failed.hidden = true;
  dom.append(play, bar, failed);
  const allowedBy = embed.thumbnail ?? embed.page;
  let live = true;
  let frame: HTMLIFrameElement | null = null;
  let stopWatching = () => {};
  let held: MountedNotice | null = null;
  const release = () => {
    held?.destroy();
    held = null;
  };
  const hold = () => {
    const remote = remoteImage(allowedBy);
    if (held || frame || !remote) return;
    held = mountRemoteImageNotice(remote, alt || site, () => showPicture());
    dom.append(held.dom);
  };
  const showPicture = () => {
    if (!remoteImageAllowed(allowedBy)) {
      hold();
      return;
    }
    release();
    stopWatching();
    void embedPicture(embed).then((picture) => {
      if (!live || frame) return;
      if (picture.title && !alt) {
        title.textContent = picture.title;
        title.hidden = false;
      }
      if (!picture.image) return;
      const poster = element("img", "note-media-thumb");
      poster.src = picture.image;
      poster.alt = "";
      poster.draggable = false;
      poster.addEventListener("error", () => poster.remove());
      play.prepend(poster);
    });
  };
  const stopWaiting = whenNearViewport(dom, () => {
    if (!live) return;
    stopWatching = subscribeRemoteImages(showPicture);
    showPicture();
  });
  play.addEventListener("click", () => {
    if (play.disabled) return;
    play.disabled = true;
    failed.hidden = true;
    void embedFrame(embed).then((address) => {
      if (!live) return;
      if (!address) {
        play.disabled = false;
        failed.hidden = false;
        return;
      }
      frame = document.createElement("iframe");
      frame.className = "note-media-frame";
      frame.src = address;
      frame.title = i18n.t(($) => $.notes.blocks.media.embedTitle, { site });
      frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      play.replaceWith(frame);
      bar.remove();
      release();
      stopWatching();
      stopWaiting();
    });
  });
  return {
    dom,
    update: (next) => next.type === node.type && String(next.attrs.src ?? "") === src && String(next.attrs.alt ?? "") === alt,
    stopEvent: (event) => onControl(dom, event),
    ignoreMutation: () => true,
    destroy() {
      live = false;
      release();
      stopWatching();
      stopWaiting();
    },
  };
}

export function withImageView(
  extension: AnyExtension,
  resolve: Resolve,
  noteId?: string,
  assets: AssetActions = noAssetActions,
): AnyExtension {
  if (!(extension instanceof TiptapNode) || extension.name !== "image") return extension;
  return extension.extend({
    addStorage() {
      return { ...this.parent?.(), [NOTE_FILES]: resolve, [NOTE_ID]: noteId };
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        const embed = videoEmbed(String(node.attrs.src ?? ""));
        if (embed) return embedView(node, embed);
        const media = noteMediaKind(String(node.attrs.src ?? ""));
        if (media === "audio" || media === "video") return mediaView(node, media, resolve, assets);
        const dom = element("figure", "note-image");
        const frame = element("span", "note-image-frame");
        const image = document.createElement("img");
        image.draggable = false;
        const handle = element("span", "note-image-handle");
        handle.contentEditable = "false";
        handle.setAttribute("aria-hidden", "true");
        frame.append(image, handle);
        const missing = element("p", BLOCK_MESSAGE);
        missing.contentEditable = "false";
        const caption = mediaCaption();
        caption.hidden = true;
        dom.append(frame, caption, missing);
        let width = imageWidthPercent(node.attrs.widthPercent);
        let drag: { pointer: number; from: number; start: number; column: number; width: number | null } | null = null;
        const sized = (next: number | null) => {
          frame.style.width = next === null ? naturalWidthStyle(image) : `${next}%`;
          frame.toggleAttribute("data-sized", next !== null);
        };
        image.addEventListener("load", () => {
          if (!drag) sized(width);
        });
        const shown = (visible: boolean) => {
          image.hidden = !visible;
          frame.hidden = !visible;
        };
        const commit = (next: number | null) => {
          const position = typeof getPos === "function" ? getPos() : undefined;
          const current = position === undefined ? null : editor.state.doc.nodeAt(position);
          if (position === undefined || current?.type.name !== "image") return;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, widthPercent: next }));
        };
        handle.addEventListener("pointerdown", (event) => {
          if (!editor.isEditable || event.button !== 0) return;
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);
          const start = frame.getBoundingClientRect().width;
          drag = { pointer: event.pointerId, from: event.clientX, start, column: dom.clientWidth || start || 1, width };
        });
        handle.addEventListener("pointermove", (event) => {
          if (drag?.pointer !== event.pointerId) return;
          const percent = Math.round(((drag.start + event.clientX - drag.from) / drag.column) * 100);
          drag.width = Math.min(IMAGE_WIDTH_RANGE.max, Math.max(IMAGE_WIDTH_RANGE.min, percent));
          sized(drag.width);
        });
        handle.addEventListener("pointerup", (event) => {
          if (drag?.pointer !== event.pointerId) return;
          const next = drag.width;
          drag = null;
          if (next !== width) commit(next);
        });
        handle.addEventListener("pointercancel", () => {
          drag = null;
          sized(width);
        });
        handle.addEventListener("dblclick", (event) => {
          event.preventDefault();
          if (editor.isEditable) commit(null);
        });
        sized(width);
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
          shown(false);
          image.removeAttribute("src");
          missing.hidden = false;
          missing.textContent =
            noteMediaKind(src) === "pdf"
              ? i18n.t(($) => $.notes.blocks.media.missing, { path: src })
              : i18n.t(($) => $.notes.blocks.imageMissing, { path: src });
        };
        const show = (url: string) => {
          image.src = url;
          shown(true);
          missing.hidden = true;
        };
        const hold = (remote: RemoteImage) => {
          shown(false);
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
          const page = noteMediaKind(src) === "pdf" ? (assetFragment(src).page ?? 1) : null;
          caption.hidden = page === null;
          caption.replaceChildren();
          const file = notePath(src);
          if (page !== null && file !== null) {
            caption.append(element("span", "min-w-0 truncate", i18n.t(($) => $.notes.blocks.media.pdfPage, { name: mediaName(src), page })));
            const { open, reveal } = assets();
            if (open) caption.append(actionButton(i18n.t(($) => $.notes.blocks.media.openPdf), () => assets().open?.(file)));
            else if (reveal) caption.append(actionButton(i18n.t(($) => $.core.export.showInFolder), () => assets().reveal?.(file)));
          }
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
          shown(false);
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
            if (next.type !== node.type || playsInNote(String(next.attrs.src ?? ""))) return false;
            paint(String(next.attrs.src ?? ""), String(next.attrs.alt ?? ""));
            width = imageWidthPercent(next.attrs.widthPercent);
            if (!drag) sized(width);
            return true;
          },
          stopEvent: (event) =>
            (event.target instanceof Node && (handle.contains(event.target) || held?.dom.contains(event.target) === true)) ||
            onControl(caption, event),
          destroy() {
            generation += 1;
            release();
          },
        };
      };
    },
  });
}
