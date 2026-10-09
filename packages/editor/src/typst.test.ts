import { toggleBlockComment, toggleComment } from "@codemirror/commands";
import { ensureSyntaxTree, getIndentation, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadTypstParser, typstLanguage } from "./typst";

beforeAll(async () => {
  await loadTypstParser();
});

function parsed(text: string): EditorState {
  const state = EditorState.create({ doc: text, extensions: [typstLanguage()] });
  ensureSyntaxTree(state, state.doc.length, 5_000);
  return state.update({}).state;
}

function highlighted(text: string): { from: number; to: number; classes: string }[] {
  const spans: { from: number; to: number; classes: string }[] = [];
  highlightTree(syntaxTree(parsed(text)), classHighlighter, (from, to, classes) =>
    spans.push({ from, to, classes }),
  );
  return spans;
}

function classesOf(text: string, token: string): string[] {
  return highlighted(text)
    .filter((span) => text.slice(span.from, span.to).includes(token))
    .map((span) => span.classes);
}

function tokenText(text: string, name: string): string[] {
  const found: string[] = [];
  syntaxTree(parsed(text)).iterate({
    enter(node) {
      if (node.name === name) found.push(text.slice(node.from, node.to));
    },
  });
  return found;
}

describe("Typst highlighting", () => {
  it("closes inline raw content on the same line", () => {
    expect(classesOf("`code` @reference", "@reference")).toContain("tok-labelName");
  });

  it("does not highlight equals operators away from a line start as headings", () => {
    const text = "#let same = left == right";
    expect(highlighted(text).some((span) => span.classes.includes("tok-heading"))).toBe(false);
  });

  it("colors a hash like the expression it introduces", () => {
    const text = '#set text(lang: "cs")\n#figure(x)\n#value';
    expect(classesOf(text, "#")).toEqual(["tok-keyword", "tok-variableName", "tok-variableName"]);
    expect(classesOf(text, "set")).toEqual(["tok-keyword"]);
    expect(classesOf(text, "figure")).toEqual(["tok-variableName"]);
    expect(classesOf(text, "lang")).toContain("tok-propertyName");
    expect(classesOf(text, '"cs"')).toContain("tok-string");
  });

  it("leaves bools and numbers inside prose words unstyled", () => {
    const text = "A true story about 3 cats, none of them auto-pilots.";
    expect(highlighted(text)).toEqual([]);
    expect(classesOf("#(true, 3pt, none)", "true")).toContain("tok-bool");
    expect(classesOf("#(true, 3pt, none)", "3pt")).toContain("tok-number");
  });

  it("marks strong and emphasized markup", () => {
    const text = "*strong words* and _emphasis_";
    expect(classesOf(text, "strong words")).toEqual(["tok-strong"]);
    expect(classesOf(text, "emphasis")).toEqual(["tok-emphasis"]);
  });

  it("highlights display math across lines", () => {
    const text = "$\n  a + b\n  = c\n$";
    expect(classesOf(text, "a + b\n  = c")).toEqual(["tok-string"]);
  });

  it("marks term list markers and terms", () => {
    const text = "/ Ligature: two letters joined";
    expect(tokenText(text, "TermMarker")).toEqual(["/"]);
    expect(classesOf(text, "Ligature")).toContain("tok-strong");
    expect(classesOf(text, "two letters joined")).toEqual([]);
  });

  it("highlights keywords inside code blocks that have no hash", () => {
    const text = "#{\n  let x = 1\n  if x > 0 { x } else { none }\n  for i in range(3) { }\n}";
    for (const keyword of ["let", "if", "else", "for", "in"]) {
      expect(classesOf(text, keyword)).toContain("tok-keyword");
    }
  });
});

describe("Typst highlighting outside ASCII", () => {
  it("highlights whole Unicode identifiers and references", () => {
    const text = "#výsledek(1) #परिणाम @úvod @obr-výsledky @2020x @obr.1.";
    expect(tokenText(text, "Ident")).toEqual(["výsledek", "परिणाम"]);
    expect(tokenText(text, "RefMarker")).toEqual(["@úvod", "@obr-výsledky", "@2020x", "@obr.1"]);
  });

  it("keeps keywords and bools whole-word under Unicode", () => {
    expect(tokenText("#letčas trueá", "Let")).toEqual([]);
    expect(tokenText("#letčas trueá", "Bool")).toEqual([]);
    expect(tokenText("#letčas trueá", "Ident")).toEqual(["letčas"]);
  });

  it("marks list items only at the start of a line", () => {
    expect(tokenText("#f(1) a - b 1) c", "ListMarker")).toEqual([]);
    expect(tokenText("  - item\n2. item", "ListMarker")).toEqual(["-"]);
    expect(tokenText("  - item\n2. item", "EnumMarker")).toEqual(["2."]);
  });

  it("treats URLs as links and escapes as literal characters", () => {
    const text = "Viz https://typst.app/docs a pak text. \\$ \\@x // note";
    expect(tokenText(text, "Link")).toEqual(["https://typst.app/docs"]);
    expect(tokenText(text, "LineComment")).toEqual(["// note"]);
    expect(tokenText(text, "Equation")).toEqual([]);
    expect(tokenText(text, "Escape")).toEqual(["\\$", "\\@"]);
  });

  it("ends numbers before a minus, and rejects an unclosed Unicode escape like Typst", () => {
    expect(tokenText("#(1-2) #(10pt-2pt)", "Int")).toEqual(["1", "2"]);
    expect(tokenText("#(1-2) #(10pt-2pt)", "Numeric")).toEqual(["10pt", "2pt"]);
    const text = "A \\u{41 slovo \\u{1F600} konec";
    expect(tokenText(text, "Escape")).toEqual(["\\u{1F600}"]);
    expect(tokenText(text, "⚠")).toEqual(["\\u{41"]);
  });
});

describe("Typst indentation", () => {
  const indentAt = (text: string, marker = "|") => {
    const pos = text.indexOf(marker);
    const state = parsed(text.replace(marker, ""));
    return getIndentation(state, pos);
  };

  it("indents inside argument lists, code blocks and content blocks", () => {
    expect(indentAt("#figure(\n|\n)")).toBe(2);
    expect(indentAt("#{\n  let x = 1\n|\n}")).toBe(2);
    expect(indentAt("#block[\n|\n]")).toBe(2);
  });

  it("keeps the current indentation in top-level markup", () => {
    expect(indentAt("- item\n  continued|")).toBeNull();
  });

  it("dedents a closing delimiter typed on its own line", () => {
    expect(indentAt("#figure(\n  caption: [x],\n|)")).toBe(0);
  });
});

describe("Typst comments", () => {
  const run = (
    command: (target: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean,
    doc: string,
    anchor: number,
    head: number,
  ) => {
    let state = EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [typstLanguage()],
    });
    const handled = command({ state, dispatch: (tr) => { state = tr.state; } });
    return { handled, text: state.doc.toString() };
  };

  it("toggles a line comment with //", () => {
    const added = run(toggleComment, "= Title\nBody text", 9, 9);
    expect(added).toEqual({ handled: true, text: "= Title\n// Body text" });
    const removed = run(toggleComment, added.text, 12, 12);
    expect(removed.text).toBe("= Title\nBody text");
  });

  it("toggles a block comment with /* and */", () => {
    const added = run(toggleBlockComment, "Some words here", 5, 10);
    expect(added).toEqual({ handled: true, text: "Some /* words */ here" });
  });
});

describe("Typst parser loading", () => {
  it("keeps comment tokens before the parser loads and reparses once it has", async () => {
    vi.resetModules();
    const fresh = await import("./typst");
    const state = EditorState.create({
      doc: "= Title\n#let x = 1",
      extensions: [fresh.typstLanguage()],
    });
    expect(state.languageDataAt("commentTokens", 3)).toEqual([
      { line: "//", block: { open: "/*", close: "*/" } },
    ]);
    expect(syntaxTree(state).type.name).toBe("PendingSource");
    await fresh.loadTypstParser();
    const tree = ensureSyntaxTree(state, state.doc.length, 5_000);
    expect(tree?.topNode.firstChild?.name).toBe("Heading");
  });
});
