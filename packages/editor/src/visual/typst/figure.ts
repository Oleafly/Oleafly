import type { Range } from "@codemirror/state";
import { Decoration, type WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { Extents } from "../selection";
import { GraphicsWidget } from "../widgets/graphics";
import type { TypstDecorationBuilder } from "./field";
import {
  argumentNodes,
  calleeName,
  callArguments,
  contentBody,
  imagePath,
  isBlank,
  namedValue,
  positionalArguments,
  trailingContentBlocks,
} from "./syntax";
import { typstTableWidget } from "./table/decoration";

export interface FigureIsland {
  from: number;
  to: number;
  widget?: (block: boolean) => WidgetType;
  blockOnly?: boolean;
}

export interface TypstFigure {
  range: Extents;
  reveal: Extents;
  body: SyntaxNode | null;
  caption: Extents | null;
}

export function trailingLabel(builder: TypstDecorationBuilder, call: SyntaxNode): SyntaxNode | null {
  const next = call.nextSibling;
  if (next?.name !== "Label") return null;
  const gap = builder.state.sliceDoc(call.to, next.from);
  return /^[ \t]*$/u.test(gap) ? next : null;
}

export function figureParts(builder: TypstDecorationBuilder, hash: SyntaxNode, call: SyntaxNode): TypstFigure | null {
  const args = callArguments(call);
  if (!args) return null;
  const label = trailingLabel(builder, call);
  const trailing = trailingContentBlocks(args);
  const positional = positionalArguments(args).filter((node) => !trailing.includes(node));
  const body = positional[0] ?? trailing[0] ?? null;
  let caption: Extents | null = null;
  for (const node of argumentNodes(args)) {
    if (node.name !== "Named" || builder.state.sliceDoc(node.firstChild?.from ?? 0, node.firstChild?.to ?? 0) !== "caption") {
      continue;
    }
    const value = namedValue(node);
    caption = value?.name === "ContentBlock" ? contentBody(value) : null;
    if (!caption) return null;
  }
  return {
    range: { from: hash.from, to: call.to },
    reveal: { from: hash.from, to: label?.to ?? call.to },
    body,
    caption,
  };
}

function bodyIsland(builder: TypstDecorationBuilder, figure: TypstFigure): FigureIsland | null {
  const body = figure.body;
  if (!body) return null;
  if (body.name === "ContentBlock") {
    const inner = contentBody(body);
    return inner ? { from: inner.from, to: inner.to } : null;
  }
  if (body.name !== "FuncCall") return null;
  const name = calleeName(builder.state, body);
  const args = callArguments(body);
  if (!args) return null;
  if (name === "image") {
    const path = imagePath(builder.state, args);
    if (!path) return null;
    const ports = builder.ports;
    return {
      from: body.from,
      to: body.to,
      widget: (block) => new GraphicsWidget({ path, centered: true, block, range: figure.reveal, ports }),
    };
  }
  if (name === "table") {
    const widget = typstTableWidget(builder.state, body, figure.reveal);
    return widget ? { from: body.from, to: body.to, widget: () => widget, blockOnly: true } : null;
  }
  return null;
}

function insideTextIsland(builder: TypstDecorationBuilder, islands: readonly FigureIsland[]): boolean {
  return builder.state.selection.ranges.every((range) =>
    islands.some((island) => !island.widget && island.from <= range.from && range.to <= island.to),
  );
}

function intersects(island: FigureIsland, from: number, to: number): boolean {
  return island.from <= to && island.to >= from;
}

function ownsLines(builder: TypstDecorationBuilder, range: Extents, islands: readonly FigureIsland[], island: FigureIsland): boolean {
  const { doc } = builder.state;
  const first = doc.lineAt(island.from);
  const last = doc.lineAt(island.to);
  if (range.from > first.from && !isBlank(doc.sliceString(first.from, range.from))) return false;
  if (range.to < last.to && !isBlank(doc.sliceString(range.to, last.to))) return false;
  return !islands.some((other) => other !== island && intersects(other, first.from, last.to));
}

export function islandDecorations(
  builder: TypstDecorationBuilder,
  range: Extents,
  islands: readonly FigureIsland[],
): Range<Decoration>[] | null {
  const { doc } = builder.state;
  const ordered = [...islands].sort((a, b) => a.from - b.from);
  const decorations: Range<Decoration>[] = [];
  const consumed = new Set<number>();
  for (const island of ordered) {
    if (!island.widget) continue;
    if (ownsLines(builder, range, ordered, island)) {
      const first = doc.lineAt(island.from);
      const last = doc.lineAt(island.to);
      decorations.push(Decoration.replace({ widget: island.widget(true), block: true }).range(first.from, last.to));
      for (let number = first.number; number <= last.number; number += 1) consumed.add(number);
    } else if (island.blockOnly) {
      return null;
    } else {
      decorations.push(Decoration.replace({ widget: island.widget(false) }).range(island.from, island.to));
    }
  }
  const run: Extents = { from: -1, to: -1 };
  const flush = () => {
    if (run.from >= 0) decorations.push(Decoration.replace({ block: true }).range(run.from, run.to));
    run.from = -1;
  };
  const firstLine = doc.lineAt(range.from).number;
  const lastLine = doc.lineAt(range.to).number;
  for (let number = firstLine; number <= lastLine; number += 1) {
    if (consumed.has(number)) {
      flush();
      continue;
    }
    const line = doc.line(number);
    const from = Math.max(line.from, range.from);
    const to = Math.min(line.to, range.to);
    const outside = !isBlank(doc.sliceString(line.from, from)) || !isBlank(doc.sliceString(to, line.to));
    const here = ordered.filter((island) => intersects(island, from, to));
    if (!outside && here.length === 0) {
      if (run.from < 0) run.from = line.from;
      run.to = line.to;
      continue;
    }
    flush();
    let pos = from;
    for (const island of here) {
      if (island.from > pos) decorations.push(Decoration.replace({}).range(pos, island.from));
      pos = Math.max(pos, island.to);
    }
    if (to > pos) decorations.push(Decoration.replace({}).range(pos, to));
  }
  flush();
  return decorations;
}

export function figureDecorations(builder: TypstDecorationBuilder, hash: SyntaxNode, call: SyntaxNode): void {
  const figure = figureParts(builder, hash, call);
  if (!figure) return;
  const { doc } = builder.state;
  const first = doc.lineAt(figure.reveal.from).number;
  const last = doc.lineAt(figure.reveal.to).number;
  for (let number = first; number <= last; number += 1) {
    const classes = ["ofl-visual-typst-figure-line"];
    if (number === first) classes.push("ofl-visual-typst-figure-first-line");
    if (number === last) classes.push("ofl-visual-typst-figure-last-line");
    builder.push(Decoration.line({ class: classes.join(" ") }).range(doc.line(number).from));
  }
  const body = bodyIsland(builder, figure);
  if (!body) return;
  const islands: FigureIsland[] = [body];
  if (figure.caption) islands.push({ from: figure.caption.from, to: figure.caption.to });
  const touched = !builder.shouldDecorate(figure.reveal);
  if (touched && !insideTextIsland(builder, islands)) return;
  const decorations = islandDecorations(builder, figure.range, islands);
  if (decorations) builder.push(...decorations);
}
