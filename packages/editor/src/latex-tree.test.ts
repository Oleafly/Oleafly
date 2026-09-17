import { foldable, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  ancestorAt,
  colorCommandSpan,
  environmentName,
  latexTreeLanguage,
  latexTreeSupport,
  listItemsOf,
  mathContainerOf,
  mathSourceOf,
  theoremDeclaration,
  unstarredEnvironmentName,
} from "./latex-tree";
import { LIST_DOCUMENT, parsedState, positionOf, SAMPLE_DOCUMENT } from "./visual/test-document";

function createState(doc: string): EditorState {
  const state = parsedState(EditorState.create({ doc, extensions: [latexTreeSupport()] }));
  expect(syntaxTree(state)).toHaveLength(doc.length);
  return state;
}

function nodeNames(state: EditorState): Set<string> {
  const names = new Set<string>();
  syntaxTree(state).iterate({
    enter(node) {
      names.add(node.name);
    },
  });
  return names;
}

describe("latexTreeLanguage", () => {
  it("parses the sample document into the node types the visual mode keys on", () => {
    const names = nodeNames(createState(SAMPLE_DOCUMENT));
    for (const expected of [
      "DocumentClass",
      "UsePackage",
      "NewTheoremCommand",
      "DocumentEnvironment",
      "Part",
      "Chapter",
      "Section",
      "SectioningCommand",
      "SectioningArgument",
      "DollarMath",
      "InlineMath",
      "Math",
      "FootnoteCommand",
      "EquationEnvironment",
      "Environment",
      "TextColorCommand",
      "ColorBoxCommand",
      "TableEnvironment",
      "Centering",
      "TabularEnvironment",
      "TabularContent",
      "HorizontalLine",
      "LineBreak",
      "Caption",
      "Label",
      "EndEnv",
    ]) {
      expect(names.has(expected), expected).toBe(true);
    }
  });

  it("derives the node groups from the type names", () => {
    const types = latexTreeLanguage.parser.nodeSet.types;
    const byName = (name: string) => {
      const type = types.find((candidate) => candidate.name === name);
      if (!type) throw new Error(`no node type ${name}`);
      return type;
    };
    expect(byName("SectionCtrlSeq").is("$CtrlSeq")).toBe(true);
    expect(byName("SectionCtrlSeq").is("$SectioningCtrlSeq")).toBe(true);
    expect(byName("LineBreakCtrlSym").is("$CtrlSym")).toBe(true);
    expect(byName("ListEnvName").is("$EnvName")).toBe(true);
    expect(byName("TextBoldCommand").is("$Command")).toBe(true);
    expect(byName("TextBoldCommand").is("$ToggleTextFormattingCommand")).toBe(true);
    expect(byName("EmphasisCommand").is("$OtherTextFormattingCommand")).toBe(true);
    expect(byName("SectioningArgument").is("$TextArgument")).toBe(true);
    expect(byName("OptionalArgument").is("$Argument")).toBe(true);
    expect(byName("OpenBrace").is("$Brace")).toBe(true);
    expect(byName("TableEnvironment").is("$Environment")).toBe(true);
    expect(byName("Section").is("$Section")).toBe(true);
    expect(byName("DollarMath").is("$MathContainer")).toBe(true);
  });

  it("folds environments to their content and sections without the trailing newline", () => {
    const state = createState(SAMPLE_DOCUMENT);
    const sectionLine = state.doc.lineAt(positionOf(SAMPLE_DOCUMENT, "\\section"));
    const section = foldable(state, sectionLine.from, sectionLine.to);
    expect(section).not.toBeNull();
    expect(section?.from).toBe(sectionLine.to);
    expect(state.sliceDoc(section?.to).startsWith("\n\\end{document}")).toBe(true);

    const tableLine = state.doc.lineAt(positionOf(SAMPLE_DOCUMENT, "\\begin{table}"));
    const table = foldable(state, tableLine.from, tableLine.to);
    expect(table?.from).toBe(tableLine.to);
    expect(state.sliceDoc(table?.to).startsWith("\\end{table}")).toBe(true);
  });
});

describe("tree helpers", () => {
  it("reads environment names from the environment or either edge", () => {
    const state = createState(SAMPLE_DOCUMENT);
    const lemma = ancestorAt(state, positionOf(SAMPLE_DOCUMENT, "Every widget"), "$Environment");
    expect(lemma).not.toBeNull();
    expect(environmentName(lemma, state)).toBe("lemma");
    expect(unstarredEnvironmentName(lemma?.getChild("EndEnv"), state)).toBe("lemma");
    const starred = createState("\\begin{align*}\na\n\\end{align*}\n");
    const align = ancestorAt(starred, 16, "$Environment");
    expect(environmentName(align, starred)).toBe("align*");
    expect(unstarredEnvironmentName(align, starred)).toBe("align");
  });

  it("extracts theorem declarations and colour arguments", () => {
    const state = createState(SAMPLE_DOCUMENT);
    const declaration = ancestorAt(state, positionOf(SAMPLE_DOCUMENT, "{lemma}"), "NewTheoremCommand");
    expect(declaration && theoremDeclaration(state, declaration)).toEqual({ environment: "lemma", label: "Lemma" });
    const color = ancestorAt(state, positionOf(SAMPLE_DOCUMENT, "Red text"), "TextColorCommand");
    const span = color && colorCommandSpan(state, color);
    expect(span?.color).toBe("#ff0000");
    expect(span && state.sliceDoc(span.from, span.to)).toBe("Red text");
  });

  it("describes inline math, display math and equation environments", () => {
    const state = createState(SAMPLE_DOCUMENT);
    const inline = syntaxTree(state).resolveInner(positionOf(SAMPLE_DOCUMENT, "mc^2"), 1);
    const inlineMath = ancestorAt(state, inline.from, "Math");
    const inlineContainer = inlineMath && mathContainerOf(inlineMath);
    expect(inlineContainer?.type.name).toBe("DollarMath");
    expect(inlineMath && inlineContainer && mathSourceOf(state, inlineMath, inlineContainer)).toEqual({
      source: "E = mc^2",
      display: false,
    });

    const equationMath = ancestorAt(state, positionOf(SAMPLE_DOCUMENT, "\\int_0^1") + 1, "Math");
    const equation = equationMath && mathContainerOf(equationMath);
    expect(equation?.type.name).toBe("EquationEnvironment");
    const source = equationMath && equation && mathSourceOf(state, equationMath, equation);
    expect(source?.display).toBe(true);
    expect(source?.source.startsWith("\\begin{equation}")).toBe(true);
  });

  it("lists the items of a list without descending into nested lists", () => {
    const state = createState(LIST_DOCUMENT);
    const list = ancestorAt(state, positionOf(LIST_DOCUMENT, "First"), "ListEnvironment");
    expect(list && listItemsOf(list).length).toBe(2);
  });
});
