import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { commandName, mathContainerOf, mathSourceOf } from "../latex-tree";
import { characterSubstitution } from "./widgets/character";
import { paintMath } from "./widgets/math";
import { spaceWidthFor } from "./widgets/space";

interface Markup {
  tag: keyof HTMLElementTagNameMap;
  className?: string;
}

const FORMATTING_MARKUP: Record<string, Markup> = {
  TextBoldCommand: { tag: "b" },
  TextItalicCommand: { tag: "i" },
  TextSmallCapsCommand: { tag: "span", className: "ofl-visual-command-textsc" },
  TextTeletypeCommand: { tag: "span", className: "ofl-visual-command-texttt" },
  TextSansSerifCommand: { tag: "span", className: "ofl-visual-command-textsf" },
  TextSuperscriptCommand: { tag: "sup" },
  TextSubscriptCommand: { tag: "sub" },
  EmphasisCommand: { tag: "em" },
  UnderlineCommand: { tag: "span", className: "ofl-visual-command-underline" },
  StrikeOutCommand: { tag: "span", className: "ofl-visual-command-sout" },
};

const NAMED_MARKUP: Record<string, Markup> = {
  "\\and": { tag: "span", className: "ofl-visual-command-and" },
  "\\And": { tag: "span", className: "ofl-visual-command-and" },
  "\\AND": { tag: "span", className: "ofl-visual-command-and" },
  "\\IEEEauthorblockN": { tag: "div", className: "ofl-visual-author-name" },
  "\\IEEEauthorblockA": { tag: "div", className: "ofl-visual-author-affiliation" },
  "\\IEEEauthorrefmark": { tag: "sup" },
};

const IGNORED_COMMANDS = new Set(["\\corref", "\\fnref", "\\thanks", "\\footnote"]);

function unknownCommandName(node: SyntaxNode, state: EditorState): string | null {
  return node.type.is("UnknownCommand") ? commandName(state, node) : null;
}

function markupFor(node: SyntaxNode, state: EditorState): Markup | undefined {
  const formatting = FORMATTING_MARKUP[node.type.name];
  if (formatting) return formatting;
  const name = unknownCommandName(node, state);
  return name ? NAMED_MARKUP[name] : undefined;
}

function argumentBody(command: SyntaxNode): SyntaxNode | null {
  return command.getChild("TextArgument")?.getChild("LongArg") ?? null;
}

function sameNode(ref: SyntaxNodeRef, node: SyntaxNode): boolean {
  return ref.from === node.from && ref.to === node.to && ref.type === node.type;
}

export function typesetNodeInto(node: SyntaxNode, element: HTMLElement, state: EditorState): HTMLElement {
  const root = node.getChild("LongArg") ?? node;
  const stack: HTMLElement[] = [element];
  const top = () => stack[stack.length - 1];
  let from = root.from;

  const flushTo = (pos: number) => {
    if (from < pos) {
      top().append(document.createTextNode(state.sliceDoc(from, pos)));
      from = pos;
    }
  };

  const openMarkup = (markup: Markup, command: SyntaxNode) => {
    const wrapper = document.createElement(markup.tag);
    if (markup.className) wrapper.className = markup.className;
    stack.push(wrapper);
    from = argumentBody(command)?.from ?? command.to;
  };

  const closeMarkup = (command: SyntaxNode) => {
    const body = argumentBody(command);
    if (body) flushTo(body.to);
    const wrapper = stack.pop();
    if (wrapper) top().append(wrapper);
    from = Math.max(from, command.to);
  };

  const replaceWith = (child: SyntaxNode, content: Node) => {
    top().append(content);
    from = child.to;
  };

  root.cursor().iterate(
    (ref) => {
      if (sameNode(ref, root)) return undefined;
      const child = ref.node;
      if (child.from < from) return undefined;
      flushTo(child.from);
      const markup = markupFor(child, state);
      if (markup) {
        openMarkup(markup, child);
        return undefined;
      }
      const name = unknownCommandName(child, state);
      if (name) {
        if (IGNORED_COMMANDS.has(name)) {
          from = child.to;
          return false;
        }
        const symbol = characterSubstitution(name);
        if (symbol !== undefined) {
          replaceWith(child, document.createTextNode(symbol));
          return false;
        }
        const width = spaceWidthFor(name);
        if (width !== undefined) {
          const space = document.createElement("span");
          space.className = "ofl-visual-space";
          space.style.width = width;
          replaceWith(child, space);
          return false;
        }
      }
      if (ref.type.is("LineBreak")) {
        replaceWith(child, document.createElement("br"));
        return false;
      }
      if (ref.type.is("$MathContainer")) {
        const math = child.getChild("Math") ?? child.getChild("InlineMath")?.getChild("Math");
        const container = math ? mathContainerOf(math) : null;
        const source = math && container ? mathSourceOf(state, math, container) : null;
        if (source) {
          const holder = document.createElement("span");
          holder.className = "ofl-visual-math ofl-visual-math-inline";
          paintMath(holder, source.source, source.display);
          replaceWith(child, holder);
          return false;
        }
      }
      return undefined;
    },
    (ref) => {
      if (sameNode(ref, root)) return;
      if (markupFor(ref.node, state)) closeMarkup(ref.node);
    },
  );

  flushTo(root.to);
  return element;
}
