import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";
import {
  ALIGNMENT_ENVIRONMENTS,
  centeringCommandWithin,
  commandName,
  environmentArguments,
  environmentHasClosedName,
  isListEnvironmentName,
  lineHoldsOnlyNode,
  type ListEnvironmentName,
  listItemsOf,
  mathContainerOf,
  mathSourceOf,
  nodeText,
  shortArgumentText,
  theoremDeclaration,
  unstarredEnvironmentName,
} from "../latex-tree";
import { editorMessage } from "../messages";
import { visualPortsFacet } from "./facets";
import { selectDecoratedArgument } from "./select-argument";
import {
  type Extents,
  extendBackwardsOverEmptyLines,
  extendForwardsOverEmptyLines,
  hasMouseDownEffect,
  mouseDownEffect,
  selectionIntersects,
} from "./selection";
import { skipPreambleCursor } from "./skip-preamble";
import { createTabularDecoration } from "./table/decoration";
import type { VisualPorts } from "./types";
import { BeginWidget } from "./widgets/begin";
import { BeginTheoremWidget } from "./widgets/begin-theorem";
import { BraceWidget } from "./widgets/brace";
import { createCharacterWidget } from "./widgets/character";
import { DescriptionItemWidget } from "./widgets/description-item";
import { DividerWidget } from "./widgets/divider";
import { EndWidget } from "./widgets/end";
import { EndDocumentWidget } from "./widgets/end-document";
import { EnvironmentLineWidget } from "./widgets/environment-line";
import { FootnoteWidget, type NoteKind } from "./widgets/footnote";
import { type Frame, FrameWidget } from "./widgets/frame";
import { createGraphicsDecoration } from "./widgets/graphics";
import { IconBraceWidget } from "./widgets/icon-brace";
import { IndicatorWidget } from "./widgets/indicator";
import { ItemWidget } from "./widgets/item";
import { LatexLogoWidget } from "./widgets/latex-logo";
import { MakeTitleWidget } from "./widgets/maketitle";
import { MathWidget } from "./widgets/math";
import { BibItemWidget } from "./widgets/bibitem";
import { ruleWidgetFor } from "./widgets/rule";
import { type Preamble, PreambleWidget } from "./widgets/preamble";
import { createSpaceWidget } from "./widgets/space";
import { TexLogoWidget } from "./widgets/tex-logo";
import { TildeWidget } from "./widgets/tilde";

export interface TheoremInfo {
  label: string;
  style: string;
}

export interface VisualAtomicState {
  decorations: DecorationSet;
  preamble: Preamble;
  theorems: ReadonlyMap<string, TheoremInfo>;
  tree: Tree;
  mousedown: boolean;
}

export interface AtomicDecorationResult {
  decorations: DecorationSet;
  preamble: Preamble;
  theorems: ReadonlyMap<string, TheoremInfo>;
}

const PANEL_ENVIRONMENTS = new Set([
  "figure",
  "table",
  "verbatim",
  "lstlisting",
  "quote",
  "quotation",
  "quoting",
  "displayquote",
]);

const TITLE_BLOCK_COMMANDS = new Set(["Title", "Author", "Date", "Affil", "Affiliation"]);
const IGNORED_BEFORE_MAKETITLE = new Set(["NewLine", "Whitespace", "BlankLine", "Comment"]);
const SILENT_COMMANDS: ReadonlySet<string> = new Set(
  [
    "vspace", "hspace", "noindent", "indent", "par", "selectfont", "newpage", "clearpage", "cleardoublepage",
    "pagebreak", "nopagebreak", "linenumbers", "nolinenumbers", "smallskip", "medskip", "bigskip", "newblock",
    "centering", "raggedright", "raggedleft", "fontsize", "bfseries", "itshape", "mdseries", "upshape", "scshape",
    "slshape", "rmfamily", "sffamily", "ttfamily", "normalfont", "normalsize", "small", "footnotesize", "scriptsize",
    "tiny", "large", "Large", "LARGE", "huge", "Huge", "hfill", "vfill", "sloppy", "frenchspacing", "onecolumn",
    "twocolumn", "thispagestyle", "pagestyle", "markboth", "markright", "IEEEpeerreviewmaketitle",
    "IEEEoverridecommandlockouts", "IEEEpubidadjcol", "IEEEpubid",
  ].map((name) => `\\${name}`),
);
const RULE_COMMANDS: ReadonlySet<string> = new Set(["\\rule", "\\hrule", "\\hrulefill"]);
const BLANK = /^\s*$/u;

interface ListFrame {
  environment: ListEnvironmentName | "thebibliography";
  ordinal: number;
}

interface EnvironmentEdges {
  begin: SyntaxNode;
  end: SyntaxNode;
  beginRange: Extents;
  endRange: Extents;
}

interface BraceOptions {
  start: number;
  decorateEmpty?: boolean;
  end?: WidgetType;
  brackets?: boolean;
}

type NodeHandler = (node: SyntaxNodeRef) => boolean | undefined;

function defaultTheorems(): Map<string, TheoremInfo> {
  return new Map([
    ["theorem", { label: editorMessage("visual.theorem.theorem"), style: "plain" }],
    ["lemma", { label: editorMessage("visual.theorem.lemma"), style: "plain" }],
    ["corollary", { label: editorMessage("visual.theorem.corollary"), style: "plain" }],
    ["proof", { label: editorMessage("visual.theorem.proof"), style: "proof" }],
  ]);
}

function replaceBlock(range: Extents, widget?: WidgetType): Range<Decoration> {
  return Decoration.replace({ widget, block: true }).range(range.from, range.to);
}

function replaceInline(from: number, to: number, widget?: WidgetType): Range<Decoration> {
  return Decoration.replace({ widget }).range(from, to);
}

function argumentBraces(
  startWidget: WidgetType,
  argument: SyntaxNode | null | undefined,
  options: BraceOptions,
): Range<Decoration>[] {
  if (!argument) return [];
  const open = argument.getChild(options.brackets ? "OpenBracket" : "OpenBrace");
  const close = argument.getChild(options.brackets ? "CloseBracket" : "CloseBrace");
  if (!open || !close || open.to <= options.start) return [];
  if (!options.decorateEmpty && argument.to - argument.from <= 2) return [];
  return [
    replaceInline(options.start, open.to, startWidget),
    replaceInline(close.from, close.to, options.end),
  ];
}

function maketitleOpensDocument(maketitle: SyntaxNode): boolean {
  const command = maketitle.parent?.parent ?? null;
  const environment = command?.parent?.parent?.parent ?? null;
  if (!command?.type.is("Command") || !environment?.type.is("DocumentEnvironment")) return false;
  for (let sibling = command.prevSibling; sibling; sibling = sibling.prevSibling) {
    if (IGNORED_BEFORE_MAKETITLE.has(sibling.type.name)) continue;
    const inner = sibling.type.is("Command") ? sibling.firstChild?.firstChild : null;
    if (!inner || !TITLE_BLOCK_COMMANDS.has(inner.type.name)) return false;
  }
  return true;
}

class AtomicDecorationBuilder {
  readonly decorations: Range<Decoration>[] = [];
  readonly preamble: Preamble = { from: 0, to: 0, authors: [] };
  readonly theorems = defaultTheorems();
  private theoremStyle = "plain";
  private readonly lists: ListFrame[] = [];
  private documentSeen = false;
  private readonly ports: VisualPorts | null;
  private readonly handlers: ReadonlyMap<string, NodeHandler>;

  constructor(private readonly state: EditorState) {
    this.ports = state.facet(visualPortsFacet);
    this.handlers = new Map<string, NodeHandler>([
      ["VerbCommand", (node) => this.enterVerb(node)],
      ["Cite", (node) => this.enterCite(node)],
      ["Ref", (node) => this.enterRef(node)],
      ["Label", (node) => this.enterLabel(node)],
      ["Include", (node) => this.enterFileLink(node, "IncludeArgument")],
      ["Input", (node) => this.enterFileLink(node, "InputArgument")],
      ["HrefCommand", (node) => this.enterHref(node)],
      ["UrlCommand", (node) => this.enterUrl(node)],
      ["Tilde", (node) => this.enterTilde(node)],
      ["LineBreak", (node) => this.enterLineBreak(node)],
      ["Caption", (node) => this.enterCaption(node)],
      ["IncludeGraphics", (node) => this.enterGraphics(node)],
      ["IncludeSvg", (node) => this.enterGraphics(node)],
      ["Maketitle", (node) => this.enterMaketitle(node)],
      ["NewTheoremCommand", (node) => this.enterNewTheorem(node)],
      ["TheoremStyleCommand", (node) => this.enterTheoremStyle(node)],
      ["TextColorCommand", (node) => this.enterColorCommand(node)],
      ["ColorBoxCommand", (node) => this.enterColorCommand(node)],
      ["FootnoteCommand", (node) => this.enterNote(node, "footnote")],
      ["EndnoteCommand", (node) => this.enterNote(node, "endnote")],
    ]);
  }

  build(tree: Tree): AtomicDecorationResult {
    tree.iterate({ enter: (node) => this.enter(node) });
    this.decoratePreamble();
    return {
      decorations: Decoration.set(this.decorations, true),
      preamble: this.preamble,
      theorems: this.theorems,
    };
  }

  private get currentList(): ListFrame | undefined {
    return this.lists[this.lists.length - 1];
  }

  private enter(node: SyntaxNodeRef): boolean | undefined {
    this.trackPreamble(node);
    const { type } = node;
    if (type.is("$Environment")) return this.enterEnvironment(node);
    if (type.is("BeginEnv")) return this.enterBegin(node);
    if (type.is("EndEnv")) return this.enterEnd(node);
    if (type.is("SectioningCommand")) return this.enterSectioning(node);
    if (type.is("Math")) return this.enterMath(node);
    if (type.is("Item")) return this.enterItem(node);
    if (type.is("UnknownCommand")) return this.enterUnknownCommand(node);
    if (type.is("$ToggleTextFormattingCommand")) return this.enterToggleFormatting(node);
    if (type.is("$OtherTextFormattingCommand")) return this.enterOtherFormatting(node);
    return this.handlers.get(type.name)?.(node);
  }

  private shouldDecorate(extents: Extents): boolean {
    return this.state.readOnly || !selectionIntersects(this.state.selection, extents);
  }

  private shouldDecorateLines(extents: Extents): boolean {
    const { doc } = this.state;
    return this.shouldDecorate({ from: doc.lineAt(extents.from).from, to: doc.lineAt(extents.to).to });
  }

  private blockRange(node: Extents): Extents {
    const { doc } = this.state;
    const startLine = doc.lineAt(node.from);
    const endLine = doc.lineAt(node.to);
    return {
      from: BLANK.test(doc.sliceString(startLine.from, node.from)) ? startLine.from : node.from,
      to: BLANK.test(doc.sliceString(node.to, endLine.to)) ? endLine.to : node.to,
    };
  }

  private push(...ranges: Range<Decoration>[]): void {
    this.decorations.push(...ranges);
  }

  private trackPreamble(node: SyntaxNodeRef): void {
    const { type } = node;
    if (type.is("DocumentEnvironment")) {
      if (this.documentSeen) return;
      this.documentSeen = true;
      this.preamble.to = node.node.getChild("Content")?.from ?? node.from;
      return;
    }
    if (type.is("Maketitle")) {
      if (maketitleOpensDocument(node.node)) this.preamble.to = node.from;
      return;
    }
    if (type.is("Title") || type.is("Author")) {
      const argument = node.node.getChild("TextArgument");
      if (!argument) return;
      const entry = { node: argument, content: nodeText(this.state, argument) };
      if (type.is("Title")) this.preamble.title = entry;
      else this.preamble.authors.push(entry);
      this.preamble.to = node.to;
      return;
    }
    if ((type.is("Affil") || type.is("Affiliation")) && node.node.getChild("TextArgument")) {
      this.preamble.to = node.to;
    }
  }

  private environmentEdges(node: SyntaxNodeRef): EnvironmentEdges | null {
    const begin = node.node.getChild("BeginEnv");
    const end = node.node.getChild("EndEnv");
    if (!begin || !end || !environmentHasClosedName(begin) || !environmentHasClosedName(end)) return null;
    const { doc } = this.state;
    const beginLine = doc.lineAt(begin.from);
    const endLine = doc.lineAt(end.from);
    if (beginLine.number >= endLine.number) return null;
    const beginRange = { from: beginLine.from, to: extendForwardsOverEmptyLines(doc, beginLine) };
    const endRange = {
      from: Math.max(extendBackwardsOverEmptyLines(doc, endLine), beginRange.to + 1),
      to: endLine.to,
    };
    return endRange.from > endRange.to ? null : { begin, end, beginRange, endRange };
  }

  private enterEnvironment(node: SyntaxNodeRef): boolean | undefined {
    const name = unstarredEnvironmentName(node.node, this.state);
    if (name && PANEL_ENVIRONMENTS.has(name)) {
      this.hidePanelEdges(node, name);
      return undefined;
    }
    if (name && (ALIGNMENT_ENVIRONMENTS.has(name) || name === "thebibliography")) {
      this.hideEnvironmentEdges(node);
      return undefined;
    }
    if (node.type.is("ListEnvironment")) {
      this.hideListEdges(node);
      return undefined;
    }
    if (node.type.is("TabularEnvironment") && this.shouldDecorate(node)) {
      const table = createTabularDecoration(node, this.state);
      if (table.length > 0) {
        this.push(...table);
        return false;
      }
    }
    return undefined;
  }

  private hidePanelEdges(node: SyntaxNodeRef, name: string): void {
    const edges = this.environmentEdges(node);
    if (!edges || !this.shouldDecorate({ from: edges.beginRange.from, to: edges.endRange.to })) return;
    this.push(
      replaceBlock(edges.beginRange, new EnvironmentLineWidget(name, "begin")),
      replaceBlock(edges.endRange, new EnvironmentLineWidget(name, "end")),
    );
    const centering = centeringCommandWithin(node);
    if (!centering) return;
    const { doc } = this.state;
    const line = doc.lineAt(centering.from);
    if (!lineHoldsOnlyNode(line, centering)) return;
    const from = Math.max(extendBackwardsOverEmptyLines(doc, line), edges.beginRange.to + 1);
    const to = Math.min(extendForwardsOverEmptyLines(doc, line), edges.endRange.from - 1);
    if (from <= to) this.push(replaceBlock({ from, to }));
  }

  private hideEnvironmentEdges(node: SyntaxNodeRef): void {
    const edges = this.environmentEdges(node);
    if (!edges) return;
    const { selection, doc } = this.state;
    if (selectionIntersects(selection, edges.beginRange) || selectionIntersects(selection, edges.endRange)) return;
    if (lineHoldsOnlyNode(doc.lineAt(edges.begin.from), edges.begin)) this.push(replaceBlock(edges.beginRange));
    if (lineHoldsOnlyNode(doc.lineAt(edges.end.from), edges.end)) this.push(replaceBlock(edges.endRange));
  }

  private hideListEdges(node: SyntaxNodeRef): void {
    if (listItemsOf(node.node).length === 0) return;
    this.hideEnvironmentEdges(node);
  }

  private enterBegin(node: SyntaxNodeRef): undefined {
    const name = unstarredEnvironmentName(node.node, this.state);
    if (!name) return undefined;
    if (isListEnvironmentName(name) || name === "thebibliography") {
      this.lists.push({ environment: name, ordinal: 0 });
      return undefined;
    }
    const range = this.blockRange(node);
    if (name === "abstract") {
      if (this.shouldDecorate(range)) {
        this.push(replaceBlock(range, new BeginWidget(name, editorMessage("visual.abstract"))));
      }
      return undefined;
    }
    if (name === "frame") {
      this.decorateFrame(node);
      return undefined;
    }
    const theorem = this.theorems.get(name);
    if (theorem && this.shouldDecorate(range)) {
      const title = node.node.getChild("OptionalArgument")?.getChild("ShortOptionalArg") ?? null;
      const titleText = title ? nodeText(this.state, title) : "";
      this.push(replaceBlock(range, new BeginTheoremWidget(name, theorem.label, title, titleText)));
    }
    return undefined;
  }

  private decorateFrame(node: SyntaxNodeRef): void {
    const environment = node.node.parent;
    if (!environment?.type.is("$Environment")) return;
    const [titleArgument, subtitleArgument] = environmentArguments(environment);
    const titleBody = titleArgument?.getChild("LongArg");
    if (!titleArgument || !titleBody) return;
    const frame: Frame = {
      title: { node: titleArgument, content: nodeText(this.state, titleBody) },
    };
    let to = titleArgument.to;
    const subtitleBody = subtitleArgument?.getChild("LongArg");
    if (subtitleArgument && subtitleBody) {
      to = subtitleArgument.to;
      frame.subtitle = { node: subtitleArgument, content: nodeText(this.state, subtitleBody) };
    }
    const range = this.blockRange({ from: node.from, to });
    if (this.shouldDecorate(range)) this.push(replaceBlock(range, new FrameWidget(frame)));
  }

  private enterEnd(node: SyntaxNodeRef): undefined {
    const name = unstarredEnvironmentName(node.node, this.state);
    if (!name) return undefined;
    if (isListEnvironmentName(name) || name === "thebibliography") {
      if (this.currentList?.environment === name) this.lists.pop();
      return undefined;
    }
    const range = this.blockRange(node);
    if (!this.shouldDecorate(range)) return undefined;
    if (name === "document") this.push(replaceBlock(range, new EndDocumentWidget()));
    else if (name === "frame") this.push(replaceBlock(range, new DividerWidget()));
    else if (name === "abstract" || this.theorems.has(name)) this.push(replaceBlock(range, new EndWidget()));
    return undefined;
  }

  private enterSectioning(node: SyntaxNodeRef): undefined {
    const command = node.node;
    const ctrlSeq = command.getChild("$CtrlSeq");
    const argument = command.getChild("SectioningArgument");
    const open = argument?.getChild("OpenBrace");
    const close = argument?.getChild("CloseBrace");
    const title = argument?.getChild("LongArg");
    if (!ctrlSeq || !open || !close || !title) return undefined;
    if (!nodeText(this.state, title).trim()) return undefined;
    const { selection } = this.state;
    const showBraces =
      selectionIntersects(selection, ctrlSeq) ||
      selectionIntersects(selection, open) ||
      selectionIntersects(selection, close);
    this.push(
      replaceInline(node.from, title.from, new BraceWidget(showBraces ? "{" : "")),
      replaceInline(close.from, close.to, new BraceWidget(showBraces ? "}" : "")),
    );
    return undefined;
  }

  private enterMath(node: SyntaxNodeRef): false {
    const container = mathContainerOf(node.node);
    if (!container) return false;
    const visible = container.type.is("$Environment")
      ? this.shouldDecorateLines(container)
      : this.shouldDecorate(container);
    if (!visible) return false;
    const math = mathSourceOf(this.state, node, container);
    if (!math) return false;
    const range = math.display ? this.blockRange(container) : container;
    this.push(
      Decoration.replace({ widget: new MathWidget(math.source, math.display), block: math.display }).range(
        range.from,
        range.to,
      ),
    );
    return false;
  }

  private enterItem(node: SyntaxNodeRef): boolean | undefined {
    const list = this.currentList;
    if (!list || list.environment === "thebibliography") return undefined;
    list.ordinal += 1;
    const { doc } = this.state;
    const line = doc.lineAt(node.from);
    const from = BLANK.test(doc.sliceString(line.from, node.from)) ? line.from : node.from;
    if (list.environment !== "description") {
      this.push(replaceInline(from, node.to, new ItemWidget(list.environment, list.ordinal, this.lists.length)));
      return false;
    }
    const argument = node.node.getChild("OptionalArgument");
    const to = argument ? argument.from : node.to;
    const onlySpaceAfter = !argument && BLANK.test(doc.sliceString(node.to, line.to));
    if (!onlySpaceAfter && to > from) this.push(replaceInline(from, to, new DescriptionItemWidget(this.lists.length)));
    if (argument) {
      const reveal = !this.shouldDecorate(argument);
      this.push(
        ...argumentBraces(new BraceWidget(reveal ? "[" : ""), argument, {
          start: argument.from,
          end: new BraceWidget(reveal ? "]" : ""),
          brackets: true,
        }),
      );
    }
    return undefined;
  }

  private enterBibItem(node: SyntaxNodeRef): boolean | undefined {
    const list = this.currentList;
    if (list?.environment !== "thebibliography") return undefined;
    list.ordinal += 1;
    if (!this.shouldDecorate(node)) return undefined;
    const optional = node.node.getChild("OptionalArgument");
    const label = optional ? nodeText(this.state, optional).replace(/^\[|\]$/gu, "") : String(list.ordinal);
    const { doc } = this.state;
    const line = doc.lineAt(node.from);
    const from = BLANK.test(doc.sliceString(line.from, node.from)) ? line.from : node.from;
    this.push(replaceInline(from, node.to, new BibItemWidget(label)));
    return false;
  }

  private silentRangeEnd(node: SyntaxNodeRef): number {
    const after = this.state.doc.sliceString(node.to, node.to + 64);
    const star = /^\*(?:\{[^{}\n]*\})?/u.exec(after);
    return star ? node.to + star[0].length : node.to;
  }

  private enterUnknownCommand(node: SyntaxNodeRef): boolean | undefined {
    const name = commandName(this.state, node.node);
    if (!name) return undefined;
    if (name === "\\bibitem") return this.enterBibItem(node);
    if (!this.shouldDecorate(node)) return undefined;
    if (SILENT_COMMANDS.has(name)) {
      this.push(replaceInline(node.from, this.silentRangeEnd(node), new BraceWidget()));
      return false;
    }
    if (RULE_COMMANDS.has(name)) {
      const args = node.node.getChildren("TextArgument").map((argument) => nodeText(this.state, argument));
      this.push(replaceInline(node.from, node.to, ruleWidgetFor(name, args)));
      return false;
    }
    if (name === "\\keywords") {
      const argument = node.node.getChild("TextArgument");
      this.push(
        ...argumentBraces(new BraceWidget(editorMessage("visual.keywordsLabel")), argument, { start: node.from }),
      );
      return false;
    }
    const widget =
      name === "\\LaTeX"
        ? new LatexLogoWidget()
        : name === "\\TeX"
          ? new TexLogoWidget()
          : (createCharacterWidget(name) ?? createSpaceWidget(name));
    if (!widget) return undefined;
    this.push(replaceInline(node.from, node.to, widget));
    return false;
  }

  private enterToggleFormatting(node: SyntaxNodeRef): undefined {
    const argument = node.node.getChild("TextArgument");
    const body = argument?.getChild("LongArg");
    const showBraces = !this.shouldDecorate(node) || !body || body.from === body.to;
    this.push(
      ...argumentBraces(new BraceWidget(showBraces ? "{" : ""), argument, {
        start: node.from,
        decorateEmpty: true,
        end: new BraceWidget(showBraces ? "}" : ""),
      }),
    );
    return undefined;
  }

  private enterOtherFormatting(node: SyntaxNodeRef): undefined {
    if (!this.shouldDecorate(node)) return undefined;
    this.push(...argumentBraces(new BraceWidget(), node.node.getChild("TextArgument"), { start: node.from }));
    return undefined;
  }

  private enterVerb(node: SyntaxNodeRef): false {
    if (!this.shouldDecorate(node)) return false;
    const content = node.node.getChild("VerbContent");
    if (content && content.to - content.from > 2) {
      this.push(replaceInline(node.from, content.from + 1), replaceInline(node.to - 1, node.to));
    }
    return false;
  }

  private enterCite(node: SyntaxNodeRef): false {
    if (!this.shouldDecorate(node)) return false;
    const argument = node.node.getChild("BibKeyArgument")?.getChild("ShortTextArgument");
    const icon = new IconBraceWidget("book", "", editorMessage("visual.citation"));
    this.push(...argumentBraces(icon, argument, { start: node.from }));
    return false;
  }

  private enterRef(node: SyntaxNodeRef): false {
    const argument = node.node.getChild("RefArgument")?.getChild("ShortTextArgument");
    const showBraces = !this.shouldDecorate(node) || !argument;
    const icon = new IconBraceWidget("tag", showBraces ? "{" : "", editorMessage("visual.reference"));
    this.push(
      ...argumentBraces(icon, argument, {
        start: node.from,
        decorateEmpty: true,
        end: new BraceWidget(showBraces ? "}" : ""),
      }),
    );
    return false;
  }

  private enterLabel(node: SyntaxNodeRef): false {
    if (!this.shouldDecorate(node)) return false;
    const argument = node.node.getChild("LabelArgument")?.getChild("ShortTextArgument");
    const icon = new IconBraceWidget("tag", "", editorMessage("visual.label"));
    this.push(...argumentBraces(icon, argument, { start: node.from }));
    return false;
  }

  private literalBraces(
    node: SyntaxNodeRef,
    argument: SyntaxNode | null | undefined,
    startWidget: WidgetType,
    endWidget?: WidgetType,
  ): void {
    if (!argument || argument.to - argument.from <= 2) return;
    const text = nodeText(this.state, argument);
    if (!text.startsWith("{") || !text.endsWith("}") || text.includes("\n")) return;
    this.push(
      replaceInline(node.from, argument.from + 1, startWidget),
      replaceInline(argument.to - 1, argument.to, endWidget),
    );
  }

  private enterFileLink(node: SyntaxNodeRef, argumentType: string): false {
    if (!this.shouldDecorate(node)) return false;
    const argument = node.node.getChild(argumentType)?.getChild("FilePathArgument");
    this.literalBraces(node, argument, new IconBraceWidget("link", "", editorMessage("visual.includedFile")), new BraceWidget());
    return false;
  }

  private enterHref(node: SyntaxNodeRef): undefined {
    const url = node.node.getChild("UrlArgument")?.getChild("LiteralArgContent");
    const argument = node.node.getChild("ShortTextArgument");
    const content = argument?.getChild("ShortArg");
    if (!url || !argument || !content || nodeText(this.state, url).includes("\n")) return undefined;
    const showBraces = !this.shouldDecorate(node) || content.from === content.to;
    this.push(
      ...argumentBraces(new BraceWidget(showBraces ? "{" : ""), argument, {
        start: node.from,
        decorateEmpty: true,
        end: new BraceWidget(showBraces ? "}" : ""),
      }),
    );
    return undefined;
  }

  private enterUrl(node: SyntaxNodeRef): undefined {
    const argument = node.node.getChild("UrlArgument");
    const showBraces = !this.shouldDecorate(node);
    this.literalBraces(node, argument, new BraceWidget(showBraces ? "{" : ""), new BraceWidget(showBraces ? "}" : ""));
    return undefined;
  }

  private enterTilde(node: SyntaxNodeRef): undefined {
    if (this.shouldDecorate(node)) this.push(replaceInline(node.from, node.to, new TildeWidget()));
    return undefined;
  }

  private enterLineBreak(node: SyntaxNodeRef): false {
    const optional = node.node.getChild("OptionalArgument");
    if (!optional || this.shouldDecorate(optional)) {
      this.push(replaceInline(node.from, node.to, new IndicatorWidget("↩")));
    }
    return false;
  }

  private enterCaption(node: SyntaxNodeRef): undefined {
    if (!this.shouldDecorate(node)) return undefined;
    this.push(...argumentBraces(new BraceWidget(), node.node.getChild("TextArgument"), { start: node.from }));
    return undefined;
  }

  private enterGraphics(node: SyntaxNodeRef): boolean | undefined {
    if (!this.shouldDecorate(node)) return undefined;
    const ranges = createGraphicsDecoration(node, this.state, this.ports);
    if (ranges.length === 0) return undefined;
    this.push(...ranges);
    return false;
  }

  private enterMaketitle(node: SyntaxNodeRef): boolean | undefined {
    if (!this.shouldDecorate(node)) return undefined;
    const { doc } = this.state;
    const line = doc.lineAt(node.from);
    const from = Math.max(extendBackwardsOverEmptyLines(doc, line), this.preamble.to);
    const to = doc.lineAt(node.to).to;
    if (this.shouldDecorate({ from, to })) this.push(replaceBlock({ from, to }, new MakeTitleWidget(this.preamble)));
    return false;
  }

  private enterNewTheorem(node: SyntaxNodeRef): undefined {
    const declared = theoremDeclaration(this.state, node.node);
    if (declared) this.theorems.set(declared.environment, { label: declared.label, style: this.theoremStyle });
    return undefined;
  }

  private enterTheoremStyle(node: SyntaxNodeRef): undefined {
    const style = shortArgumentText(this.state, node.node);
    if (style) this.theoremStyle = style;
    return undefined;
  }

  private enterColorCommand(node: SyntaxNodeRef): undefined {
    if (!this.shouldDecorate(node)) return undefined;
    const color = node.node.getChild("ShortTextArgument");
    const content = node.node.getChild("TextArgument");
    if (color && content) this.push(...argumentBraces(new BraceWidget(), content, { start: node.from }));
    return undefined;
  }

  private enterNote(node: SyntaxNodeRef, kind: NoteKind): boolean | undefined {
    const argument = node.node.getChild("TextArgument");
    if (!argument) return undefined;
    if (this.state.readOnly && selectionIntersects(this.state.selection, node)) {
      this.push(
        ...argumentBraces(new BraceWidget(), argument, { start: node.from }),
        Decoration.mark({ class: "ofl-visual-footnote ofl-visual-footnote-view" }).range(argument.from, argument.to),
      );
      return undefined;
    }
    if (!this.shouldDecorate(node)) return undefined;
    this.push(replaceInline(node.from, node.to, new FootnoteWidget(kind)));
    return false;
  }

  private decoratePreamble(): void {
    if (this.preamble.to <= 0) return;
    const { doc, selection } = this.state;
    const lastLine = doc.lineAt(this.preamble.to).number;
    for (let number = 1; number <= lastLine; number += 1) {
      const line = doc.line(number);
      const classes = ["ofl-visual-preamble-line"];
      if (number === 1) classes.push("ofl-visual-environment-first-line");
      if (number === lastLine) classes.push("ofl-visual-environment-last-line");
      this.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
    }
    if (selectionIntersects(selection, this.preamble)) {
      this.push(Decoration.widget({ widget: new PreambleWidget(true), block: true, side: -1 }).range(0));
    } else {
      this.push(replaceBlock({ from: 0, to: this.preamble.to }, new PreambleWidget(false)));
    }
  }
}

export function buildAtomicDecorations(state: EditorState, tree: Tree): AtomicDecorationResult {
  return new AtomicDecorationBuilder(state).build(tree);
}

export const visualAtomicField = StateField.define<VisualAtomicState>({
  create(state) {
    const tree = syntaxTree(state);
    return { ...buildAtomicDecorations(state, tree), tree, mousedown: false };
  },
  update(value, tr) {
    let mousedown = value.mousedown;
    for (const effect of tr.effects) {
      if (effect.is(mouseDownEffect)) mousedown = effect.value;
    }
    const tree = syntaxTree(tr.state);
    const stillParsing = tree.length < tr.state.doc.length && tree.type === value.tree.type;
    const rebuild =
      !stillParsing && !mousedown && (tree !== value.tree || tr.selection !== undefined || hasMouseDownEffect(tr));
    if (rebuild) return { ...buildAtomicDecorations(tr.state, tree), tree, mousedown };
    const decorations = tr.docChanged ? value.decorations.map(tr.changes) : value.decorations;
    if (decorations === value.decorations && mousedown === value.mousedown) return value;
    return { ...value, decorations, mousedown };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.from(field, (value) => () => value.decorations),
    skipPreambleCursor(field),
    selectDecoratedArgument(field),
  ],
});

export const atomicDecorations: Extension = visualAtomicField;
