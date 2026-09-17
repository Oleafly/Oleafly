import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";
import {
  ALIGNMENT_ENVIRONMENTS,
  centeringCommandWithin,
  colorCommandSpan,
  commandName,
  sectioningLevelName,
  unstarredEnvironmentName,
} from "../latex-tree";
import { type TheoremInfo, visualAtomicField } from "./atomic-decorations";

const CHIP_COMMANDS: Record<string, string> = {
  Cite: "cite",
  Ref: "ref",
  Label: "label",
  Include: "include",
  Input: "input",
};

const PANEL_ENVIRONMENTS = new Set(["abstract", "figure", "table", "verbatim", "lstlisting"]);
const QUOTE_ENVIRONMENTS = new Set(["quote", "quotation", "quoting", "displayquote"]);
const CLASS_SAFE = /^[A-Za-z][\w-]*$/u;

function lineClasses(state: EditorState, extents: { from: number; to: number }, classes: string[]): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  const first = state.doc.lineAt(extents.from).number;
  const last = state.doc.lineAt(extents.to).number;
  for (let number = first; number <= last; number += 1) {
    ranges.push(Decoration.line({ class: classes.join(" ") }).range(state.doc.line(number).from));
  }
  return ranges;
}

function commandMarks(state: EditorState, node: SyntaxNodeRef): Range<Decoration>[] {
  const command: SyntaxNode | null = node.type.is("KnownCommand") ? node.node.firstChild : node.node;
  if (!command) return [];
  const chip = CHIP_COMMANDS[command.type.name];
  if (chip) {
    return node.to > node.from
      ? [Decoration.mark({ class: `ofl-visual-chip ofl-visual-chip-${chip}`, inclusive: true }).range(node.from, node.to)]
      : [];
  }
  const ctrlSeq = command.getChild("$CtrlSeq");
  const name = commandName(state, command)?.slice(1);
  if (!ctrlSeq || !name || !CLASS_SAFE.test(name)) return [];
  const from = ctrlSeq.to + 1;
  const to = node.to - 1;
  return to > from
    ? [Decoration.mark({ class: `ofl-visual-command-${name}`, inclusive: true }).range(from, to)]
    : [];
}

function headingMarks(state: EditorState, node: SyntaxNodeRef): Range<Decoration>[] {
  const level = sectioningLevelName(state, node.node);
  if (!level || !CLASS_SAFE.test(level) || node.to <= node.from) return [];
  return [Decoration.mark({ class: `ofl-visual-heading ofl-visual-command-${level}` }).range(node.from, node.to)];
}

function captionLineMarks(state: EditorState, node: SyntaxNodeRef): Range<Decoration>[] {
  if (!node.node.getChild("$Argument")) return [];
  const kind = node.type.is("Caption") ? "caption" : "label";
  return lineClasses(state, node, [`ofl-visual-${kind}-line`]);
}

function colorMarks(state: EditorState, node: SyntaxNodeRef): Range<Decoration>[] {
  const span = colorCommandSpan(state, node.node);
  if (!span) return [];
  const box = node.type.is("ColorBoxCommand");
  return [
    Decoration.mark({
      class: box ? "ofl-visual-colorbox" : "ofl-visual-textcolor",
      inclusive: true,
      attributes: { style: box ? `background-color: ${span.color}` : `color: ${span.color}` },
    }).range(span.from, span.to),
  ];
}

function environmentMarks(
  state: EditorState,
  node: SyntaxNodeRef,
  theorems: ReadonlyMap<string, TheoremInfo>,
): Range<Decoration>[] {
  const name = unstarredEnvironmentName(node.node, state);
  if (!name || !CLASS_SAFE.test(name)) return [];
  if (PANEL_ENVIRONMENTS.has(name)) {
    const classes = [`ofl-visual-environment-${name}`, "ofl-visual-environment-line"];
    if (centeringCommandWithin(node)) classes.push("ofl-visual-environment-centered");
    return lineClasses(state, node, classes);
  }
  if (QUOTE_ENVIRONMENTS.has(name)) {
    return lineClasses(state, node, [
      `ofl-visual-environment-${name}`,
      "ofl-visual-environment-quote-block",
      "ofl-visual-environment-line",
    ]);
  }
  if (ALIGNMENT_ENVIRONMENTS.has(name)) {
    return lineClasses(state, node, [`ofl-visual-environment-${name}`, "ofl-visual-environment-line"]);
  }
  const theorem = theorems.get(name);
  if (!theorem || !CLASS_SAFE.test(theorem.style)) return [];
  const styleClass = `ofl-visual-environment-theorem-${theorem.style}`;
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  const ranges: Range<Decoration>[] = [
    Decoration.line({ class: `${styleClass} ofl-visual-environment-first-line` }).range(first.from),
  ];
  for (let number = first.number + 1; number < last.number; number += 1) {
    ranges.push(Decoration.line({ class: `${styleClass} ofl-visual-environment-line` }).range(state.doc.line(number).from));
  }
  if (last.number > first.number) {
    ranges.push(Decoration.line({ class: `${styleClass} ofl-visual-environment-last-line` }).range(last.from));
  }
  return ranges;
}

export function buildMarkDecorations(view: EditorView, tree: Tree): DecorationSet {
  const { state } = view;
  const theorems = state.field(visualAtomicField, false)?.theorems ?? new Map<string, TheoremInfo>();
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.type.is("KnownCommand") || node.type.is("UnknownCommand")) ranges.push(...commandMarks(state, node));
        else if (node.type.is("SectioningCommand")) ranges.push(...headingMarks(state, node));
        else if (node.type.is("Caption") || node.type.is("Label")) ranges.push(...captionLineMarks(state, node));
        else if (node.type.is("TextColorCommand") || node.type.is("ColorBoxCommand")) ranges.push(...colorMarks(state, node));
        else if (node.type.is("$Environment")) ranges.push(...environmentMarks(state, node, theorems));
      },
    });
  }
  return Decoration.set(ranges, true);
}

class MarkDecorationPlugin {
  decorations: DecorationSet;
  private tree: Tree;

  constructor(private readonly view: EditorView) {
    this.tree = syntaxTree(view.state);
    this.decorations = buildMarkDecorations(view, this.tree);
  }

  update(update: ViewUpdate): void {
    const tree = syntaxTree(update.state);
    const stillParsing = tree.type === this.tree.type && tree.length < update.view.viewport.to;
    if (stillParsing) {
      this.decorations = this.decorations.map(update.changes);
      return;
    }
    if (tree !== this.tree || update.viewportChanged) {
      this.tree = tree;
      this.decorations = buildMarkDecorations(this.view, tree);
    }
  }
}

export const markDecorations = ViewPlugin.fromClass(MarkDecorationPlugin, {
  decorations: (plugin) => plugin.decorations,
});
