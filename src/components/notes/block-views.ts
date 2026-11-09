import { renderMathSource } from "@oleafly/editor/math-render";
import type { AnyExtension, Editor } from "@tiptap/core";
import { Node as TiptapNode } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { NotebookTabs, Network, SquareSigma } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { renderDiagram } from "@/components/ui/mermaid-diagram";
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
  noteBlockKinds,
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
    () => {
      if (live) blockMessage(preview, i18n.t(($) => $.notes.blocks.diagramError));
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

export function insertableBlocks(): NoteBlockKind[] {
  return noteBlockKinds().filter((kind) => kind.template);
}

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
      return [...(this.parent?.() ?? []), codeHighlightPlugin(this.name)];
    },
    addNodeView() {
      return ({ node, editor }) => {
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
        toggle.textContent = toggleLabel(false);
        toggle.setAttribute("aria-pressed", "false");
        toggle.addEventListener("mousedown", (event) => event.preventDefault());
        toggle.addEventListener("click", () => {
          const showingSource = dom.classList.toggle("note-drawn-source");
          toggle.textContent = toggleLabel(showingSource);
          toggle.setAttribute("aria-pressed", String(showingSource));
        });
        dom.append(label, toggle, preview, pre);
        const context: PaintContext = {
          readFile: noteFiles(editor),
          still: false,
          fence: fenceOf(language),
          noteId: noteIdOf(editor),
        };
        let painted = node.textContent;
        let wanted = painted;
        let timer: number | undefined;
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
          update(next) {
            if (next.type !== node.type || next.attrs.language !== language) return false;
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
