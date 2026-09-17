import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Markdown } from "tiptap-markdown";
import type { AnyExtension } from "@tiptap/core";
import { ColorBox, TextColor } from "./color";
import { Figure, FigureCaption } from "./figure";
import { Footnote } from "./footnote";
import { LatexHeadingAttributes } from "./heading";
import { MathDisplay, MathInline } from "./math/nodes";
import type { WysiwygExtensionOptions } from "./options";
import { RawBlock } from "./raw-block";
import { RawInline } from "./raw-inline";
import { LatexTableAttributes, TableCaption, TableFloat } from "./table-float";
import { Theorem } from "./theorem";

export function createWysiwygExtensions(options: WysiwygExtensionOptions = {}): AnyExtension[] {
  const renderMath = options.renderMath ?? null;
  return [
    StarterKit.configure({
      codeBlock: false,
      horizontalRule: false,
    }),
    LatexHeadingAttributes,
    Image.configure({ inline: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    LatexTableAttributes,
    Markdown,
    RawBlock,
    RawInline,
    MathInline.configure({ renderMath }),
    MathDisplay.configure({ renderMath }),
    Footnote,
    Theorem,
    TextColor,
    ColorBox,
    FigureCaption,
    Figure.configure({ resolveAssetUrl: options.resolveAssetUrl ?? null }),
    TableCaption,
    TableFloat,
  ];
}

export const WYSIWYG_EXTENSIONS: AnyExtension[] = createWysiwygExtensions();
