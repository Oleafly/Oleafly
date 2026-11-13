import { CircuitBoard, DraftingCompass, type LucideIcon } from "lucide-react";
import { RenderCache } from "@/components/ui/render-cache";
import { i18n } from "@/i18n";
import { AppError, decodeAppError } from "@/lib/app-error";
import { notesRenderTikz } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { type NativeRenderer, nativeRenderError, nativeRenderer } from "./native-render";
import { inSharedNote, type NoteBlockKind } from "./note-blocks";
import { blockLine, type TikzDocument, type TikzKind, tikzDocument } from "./tikz-source";

const TIKZ_LINE = "notes.tikz_line";
const TIKZ_PREAMBLE_LINE = "notes.tikz_preamble_line";
const DOCUMENT_ENTRIES = 64;
const DOCUMENT_CHARS = 4_000_000;
const LABELS: Readonly<Record<TikzKind, string>> = { tikz: "TikZ", circuitikz: "CircuiTikZ" };
const ICONS: Readonly<Record<TikzKind, LucideIcon>> = { tikz: DraftingCompass, circuitikz: CircuitBoard };

export const TIKZ_TEMPLATE = String.raw`\usetikzlibrary{arrows.meta, positioning}
\begin{tikzpicture}[node distance=1.6cm, every node/.style={draw, rounded corners, minimum height=8mm}]
  \node (data) {Data};
  \node[right=of data] (model) {Model};
  \node[right=of model] (result) {Result};
  \draw[-Stealth] (data) -- (model);
  \draw[-Stealth] (model) -- (result);
\end{tikzpicture}`;

export const CIRCUITIKZ_TEMPLATE = String.raw`\begin{circuitikz}
  \draw (0,0) to[sV, l=$V_\mathrm{in}$] (0,3)
    to[R, l=$R$] (3,3)
    to[C, l=$C$, v^=$V_\mathrm{out}$] (3,0) -- (0,0);
\end{circuitikz}`;

const TEMPLATES: Readonly<Record<TikzKind, string>> = { tikz: TIKZ_TEMPLATE, circuitikz: CIRCUITIKZ_TEMPLATE };

const documents = new RenderCache<TikzDocument>(DOCUMENT_ENTRIES, DOCUMENT_CHARS);

export function tikzPreamble(): string {
  return useSettingsStore.getState().notesTikzPreamble;
}

function documentFor(source: string, kind: TikzKind): TikzDocument {
  const document = tikzDocument(source, kind, tikzPreamble());
  documents.set(document.text, document, document.text.length);
  return document;
}

export function tikzRenderError(error: unknown, document: TikzDocument): unknown {
  const coded = decodeAppError(error);
  if (coded?.code !== TIKZ_LINE) return error;
  const origin = blockLine(document, Number(coded.params.line));
  if (origin === null) return coded.params.message ?? error;
  return new AppError(origin.shared ? TIKZ_PREAMBLE_LINE : TIKZ_LINE, { ...coded.params, line: String(origin.line) }, coded.detail);
}

async function renderDocument(text: string): Promise<string> {
  try {
    return await notesRenderTikz(text);
  } catch (error) {
    throw tikzRenderError(error, documents.get(text) ?? { text, lines: [] });
  }
}

function tikzRenderer(kind: TikzKind): NativeRenderer {
  const block = LABELS[kind];
  return nativeRenderer({
    label: block,
    className: "note-tikz",
    key: (text) => documentFor(text, kind).text,
    render: renderDocument,
    confirm: {
      needed: inSharedNote,
      message: () => i18n.t(($) => $.notes.blocks.tikz.sharedNotice),
      action: () => i18n.t(($) => $.notes.blocks.tikz.draw),
    },
    alt: () => (kind === "tikz" ? i18n.t(($) => $.notes.blocks.tikz.alt) : i18n.t(($) => $.notes.blocks.tikz.circuitAlt)),
    empty: () => i18n.t(($) => $.notes.blocks.tikz.empty, { block }),
    rendering: () => i18n.t(($) => $.notes.blocks.typst.rendering),
    desktopOnly: () => i18n.t(($) => $.notes.blocks.tikz.desktopOnly, { block }),
    error: (error) => i18n.t(($) => $.notes.blocks.tikz.error, { error: nativeRenderError(error) }),
  });
}

export const TIKZ_RENDERERS: Readonly<Record<TikzKind, NativeRenderer>> = {
  tikz: tikzRenderer("tikz"),
  circuitikz: tikzRenderer("circuitikz"),
};

function tikzBlock(kind: TikzKind): NoteBlockKind {
  const renderer = TIKZ_RENDERERS[kind];
  return {
    name: kind,
    label: () => LABELS[kind],
    icon: ICONS[kind],
    paint: (preview, source, context) => {
      let dispose = renderer.paint(preview, source, context);
      const stop = useSettingsStore.subscribe((state, previous) => {
        if (state.notesTikzPreamble === previous.notesTikzPreamble) return;
        dispose?.();
        dispose = renderer.paint(preview, source, context);
      });
      return () => {
        stop();
        dispose?.();
      };
    },
    still: (preview, source) => renderer.still(preview, source),
    template: () => ({ info: kind, source: TEMPLATES[kind] }),
  };
}

export const tikzBlocks: readonly NoteBlockKind[] = [tikzBlock("tikz"), tikzBlock("circuitikz")];
