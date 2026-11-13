import { Workflow } from "lucide-react";
import { i18n } from "@/i18n";
import { paintedColorToHex, readCssVariable } from "@/lib/css-color";
import { cachedD2, d2Problems, renderD2 } from "./d2-render";
import { clipError, nativeRenderError } from "./native-render";
import { blockMessage, currentTheme, type Dispose, element, type NoteBlockKind, paintAsync, paintBlockCard } from "./note-blocks";
import { svgDataUrl } from "./svg-block";

export const D2_TEMPLATE = `direction: right
idea: Idea
draft: Draft
paper: Paper {shape: page}
idea -> draft: write
draft -> paper: revise`;

export function d2Error(error: unknown): string {
  const [first] = d2Problems(error);
  if (!first) return nativeRenderError(error);
  const { line, message } = first;
  return clipError(line === null ? message : i18n.t(($) => $.notes.blocks.d2.line, { line, message }));
}

function draw(preview: HTMLElement, svg: string): void {
  const image = element("img", "note-d2 block h-auto max-w-full");
  image.draggable = false;
  image.alt = i18n.t(($) => $.notes.blocks.d2.alt);
  image.src = svgDataUrl(svg);
  preview.replaceChildren(image);
}

function canvasColor(): string | null {
  const background = readCssVariable("--background");
  return background ? paintedColorToHex(background) : null;
}

function paintD2(preview: HTMLElement, source: string): Dispose | undefined {
  const text = source.trim();
  if (!text) {
    blockMessage(preview, i18n.t(($) => $.notes.blocks.d2.empty));
    return undefined;
  }
  const theme = currentTheme();
  const background = canvasColor();
  const cached = cachedD2(text, theme, background);
  if (cached) {
    draw(preview, cached);
    return undefined;
  }
  return paintAsync(preview, {
    loading: preview.querySelector("img.note-d2") ? undefined : i18n.t(($) => $.notes.blocks.d2.loading),
    load: () => renderD2(text, theme, background),
    show: (svg) => {
      draw(preview, svg);
      return undefined;
    },
    error: (error) => i18n.t(($) => $.notes.blocks.d2.error, { error: d2Error(error) }),
  });
}

function paintD2Still(preview: HTMLElement, source: string): undefined {
  const cached = cachedD2(source.trim(), currentTheme(), canvasColor());
  if (cached) draw(preview, cached);
  else paintBlockCard(preview, "D2", source);
  return undefined;
}

export const d2Block: NoteBlockKind = {
  name: "d2",
  label: () => "D2",
  icon: Workflow,
  paint: (preview, source) => paintD2(preview, source),
  still: (preview, source) => paintD2Still(preview, source),
  template: () => ({ info: "d2", source: D2_TEMPLATE }),
};
