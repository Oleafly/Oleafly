import { SquareRadical } from "lucide-react";
import { i18n } from "@/i18n";
import { notesRenderTypst } from "@/lib/tauri";
import { nativeRenderError, nativeRenderer } from "./native-render";
import type { NoteBlockKind } from "./note-blocks";

const typst = nativeRenderer({
  label: "Typst",
  className: "note-typst",
  render: notesRenderTypst,
  alt: () => i18n.t(($) => $.notes.blocks.typst.alt),
  empty: () => i18n.t(($) => $.notes.blocks.typst.empty),
  rendering: () => i18n.t(($) => $.notes.blocks.typst.rendering),
  desktopOnly: () => i18n.t(($) => $.notes.blocks.typst.desktopOnly),
  error: (error) => i18n.t(($) => $.notes.blocks.typst.error, { error: nativeRenderError(error) }),
});

export const paintTypst = typst.paint;
export const paintTypstStill = typst.still;
export const resetTypstCacheForTest = typst.reset;
export const typstSvg = (source: string): Promise<string> => typst.svg(source);

export const TYPST_TEMPLATE = "$ integral_0^infinity e^(-x^2) dif x = sqrt(pi) / 2 $";

export const typstBlock: NoteBlockKind = {
  name: "typst",
  label: () => "Typst",
  icon: SquareRadical,
  paint: (preview, source) => paintTypst(preview, source),
  still: (preview, source) => paintTypstStill(preview, source),
  template: () => ({ info: "{=typst}", source: TYPST_TEMPLATE }),
};
