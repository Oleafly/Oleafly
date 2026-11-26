import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { type BodyNode, parseBody, renderBody } from "@oleafly/snippets";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type FieldTokenKind = "field" | "mirror" | "variable";

export interface FieldToken {
  from: number;
  to: number;
  label: string;
  kind: FieldTokenKind;
}

const DIGITS = /\d+/y;
const NAME = /[A-Z_][A-Z0-9_]*/y;
const CAPTURE = /\[\[(\d+)\]\]/y;
const TONES = { field: "primaryGhost", mirror: "muted", variable: "info" } as const;
const LABEL_LIMIT = 40;
const PLAIN_ENV = {
  selection: "",
  clipboard: "",
  now: new Date(0),
  fileName: null,
  projectName: null,
  lineComment: "",
  captures: [],
  indent: "",
  indentUnit: "  ",
};

function closingBrace(text: string, start: number): number {
  let depth = 1;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function placeholderText(nodes: BodyNode[]): string {
  const text = renderBody(nodes, PLAIN_ENV).text.replace(/\s+/gu, " ").trim();
  return text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text;
}

function describe(node: BodyNode, seen: Set<number>): { label: string; kind: FieldTokenKind } | null {
  switch (node.kind) {
    case "field": {
      const kind = seen.has(node.index) && node.placeholder.length === 0 ? "mirror" : "field";
      seen.add(node.index);
      const text = placeholderText(node.placeholder);
      return { label: text ? `${node.index} · ${text}` : String(node.index), kind };
    }
    case "choice":
      seen.add(node.index);
      return { label: `${node.index} · ${node.options.join(" ")}`, kind: "field" };
    case "project":
      seen.add(node.index);
      return { label: `${node.index} · ${node.field}`, kind: "field" };
    case "mirror":
      return { label: `${node.index} · ${node.helper ?? node.regex?.format ?? ""}`.replace(/ · $/u, ""), kind: "mirror" };
    case "variable":
      return { label: node.name, kind: "variable" };
    default:
      return null;
  }
}

function tokenEnd(text: string, at: number): number {
  const next = text[at + 1];
  if (next === "{") {
    const close = closingBrace(text, at + 2);
    return close < 0 ? -1 : close + 1;
  }
  const pattern = /\d/u.test(next ?? "") ? DIGITS : NAME;
  pattern.lastIndex = at + 1;
  return pattern.exec(text) ? pattern.lastIndex : -1;
}

export function fieldTokens(text: string): FieldToken[] {
  const tokens: FieldToken[] = [];
  const seen = new Set<number>();
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") {
      CAPTURE.lastIndex = index;
      const capture = CAPTURE.exec(text);
      if (capture) {
        tokens.push({ from: index, to: CAPTURE.lastIndex, label: `[[${capture[1]}]]`, kind: "variable" });
        index = CAPTURE.lastIndex;
        continue;
      }
    }
    const end = char === "$" ? tokenEnd(text, index) : -1;
    if (end < 0) {
      index += 1;
      continue;
    }
    const parsed = parseBody(text.slice(index, end));
    const described = parsed.errors.length === 0 && parsed.nodes.length === 1 ? describe(parsed.nodes[0], seen) : null;
    if (described) tokens.push({ from: index, to: end, ...described });
    index = end;
  }
  return tokens;
}

class ChipWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly kind: FieldTokenKind,
  ) {
    super();
  }

  eq(other: ChipWidget): boolean {
    return other.label === this.label && other.kind === this.kind;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = cn(badgeVariants({ variant: TONES[this.kind], size: "sm" }), "mx-px align-baseline font-mono");
    chip.dataset.snippetChip = this.kind;
    chip.textContent = this.label;
    return chip;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function decorationsFor(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const token of fieldTokens(state.doc.toString())) {
    builder.add(token.from, token.to, Decoration.replace({ widget: new ChipWidget(token.label, token.kind) }));
  }
  return builder.finish();
}

const chips = StateField.define<DecorationSet>({
  create: decorationsFor,
  update: (decorations, transaction) => (transaction.docChanged ? decorationsFor(transaction.state) : decorations),
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
});

export function snippetFieldChips(): Extension {
  return chips;
}
