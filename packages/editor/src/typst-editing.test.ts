// @vitest-environment jsdom

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
import { defineLanguageFacet, indentUnit, Language } from "@codemirror/language";
import { NodeSet, NodeType, Parser, Tree, type Input, type PartialParse } from "@lezer/common";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { typstLanguage } from "./typst";
import {
  typstContextAt,
  typstContextInText,
  typstEditing,
  type TypstEditingOptions,
} from "./typst-editing";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

function split(markedDoc: string): { doc: string; cursors: number[]; anchors: number[] } {
  const cursors: number[] = [];
  const anchors: number[] = [];
  let doc = "";
  for (const character of markedDoc) {
    if (character === "|") cursors.push(doc.length);
    else if (character === "^") anchors.push(doc.length);
    else doc += character;
  }
  return { doc, cursors, anchors };
}

function editor(
  markedDoc: string,
  options: Partial<TypstEditingOptions> = {},
): EditorView {
  const { doc, cursors, anchors } = split(markedDoc);
  if (cursors.length === 0) throw new Error("missing | cursor marker");
  const ranges = cursors.map((head, index) =>
    anchors[index] === undefined
      ? EditorSelection.cursor(head)
      : EditorSelection.range(anchors[index], head),
  );
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(ranges),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        history(),
        indentUnit.of("  "),
        typstLanguage(),
        closeBrackets(),
        typstEditing({ math: options.math ?? true, wrap: options.wrap ?? true }),
        keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap]),
      ],
    }),
  });
  views.push(view);
  return view;
}

function marked(view: EditorView): string {
  const ranges = [...view.state.selection.ranges].sort((a, b) => a.head - b.head);
  let out = "";
  let last = 0;
  for (const range of ranges) {
    if (!range.empty) {
      out += `${view.state.sliceDoc(last, range.from)}^${view.state.sliceDoc(range.from, range.to)}|`;
      last = range.to;
      continue;
    }
    out += `${view.state.sliceDoc(last, range.head)}|`;
    last = range.head;
  }
  return out + view.state.sliceDoc(last);
}

function type(view: EditorView, text: string): void {
  for (const character of text) {
    const { from, to } = view.state.selection.main;
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) =>
        handler(view, from, to, character, () =>
          view.state.update({ changes: { from, to, insert: character } }),
        ),
      );
    if (!handled) {
      view.dispatch({
        ...view.state.replaceSelection(character),
        userEvent: "input.type",
      });
    }
  }
}

function press(view: EditorView, key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

function typed(markedDoc: string, text: string, options?: Partial<TypstEditingOptions>): string {
  const view = editor(markedDoc, options);
  type(view, text);
  return marked(view);
}

function pressed(markedDoc: string, key: string, shiftKey = false): string {
  const view = editor(markedDoc);
  press(view, key, shiftKey);
  return marked(view);
}

function contextOf(markedDoc: string): string {
  const { doc, cursors } = split(markedDoc);
  return typstContextAt(EditorState.create({ doc }), cursors[0]);
}

describe("typstContextAt", () => {
  it.each([
    ["Hello |world", "markup"],
    ["$x|$", "math"],
    ["$x$ |", "markup"],
    ["|$x$", "markup"],
    ["#let x = |", "code"],
    ["#let x = 1\nText |", "markup"],
    ["#foo(|", "code"],
    ["#foo(a)[b|]", "markup"],
    ["#foo(a)[b] |", "markup"],
    ["#foo.bar(|)", "code"],
    ["#name. Next |", "markup"],
    ['#image("pa|")', "string"],
    ['#image("path") |', "markup"],
    ["`co|de`", "raw"],
    ["```\nco|de\n```", "raw"],
    ["```\ncode\n``` |", "markup"],
    ["// comm|", "comment"],
    ["/* a | */ b", "comment"],
    ["/* a */ b|", "markup"],
    ["https://exa|mple.com", "markup"],
    ["#{ let x = 1; [content |] }", "markup"],
    ["#{ x |}", "code"],
    ["$ #f(|) $", "code"],
    ['$ "te|xt" $', "string"],
    ["\\$ |", "markup"],
    ["<label> |", "markup"],
    ["#set text(\n  size: |", "code"],
    ["#show heading: it => {\n  |\n}", "code"],
    ["#if x [\n  - item|\n]", "markup"],
    ["#(1 + |)", "code"],
    ["#[content |]", "markup"],
  ])("classifies %j as %s", (doc, expected) => {
    expect(contextOf(doc)).toBe(expected);
  });

  it("scans from a bounded window in a very long document", () => {
    const filler = "Plain words in a paragraph.\n".repeat(4_000);
    const doc = `${filler}$x`;
    expect(typstContextInText(doc, doc.length)).toBe("math");
    expect(typstContextAt(EditorState.create({ doc }), doc.length)).toBe("math");
  });
});

describe("typstContextAt with a typst-syntax tree", () => {
  const names = [
    "Source",
    "Markup",
    "Equation",
    "Dollar",
    "Math",
    "Text",
    "LineComment",
    "Raw",
    "Str",
    "Code",
  ];
  const types = names.map((name, id) => NodeType.define({ id, name, top: id === 0 }));
  const [source, markup, equation, dollar, math, text] = types;

  class FixedParser extends Parser {
    readonly nodeSet = new NodeSet(types);

    constructor(private readonly tree: Tree) {
      super();
    }

    createParse(input: Input): PartialParse {
      const tree = this.tree;
      return {
        advance: () => tree,
        parsedPos: input.length,
        stopAt: () => {},
        stoppedAt: null,
      };
    }
  }

  function stateWithTree(doc: string, tree: Tree): EditorState {
    const fixed = new Language(defineLanguageFacet(), new FixedParser(tree), [], "typst-test");
    return EditorState.create({ doc, extensions: [fixed] });
  }

  it("falls back to the text scan when the node set lacks Typst names", () => {
    const partial = new NodeSet(types.slice(0, 6));
    class PartialParser extends FixedParser {
      override readonly nodeSet = partial;
    }
    const leaf = new Tree(equation, [], [], 3);
    const state = EditorState.create({
      doc: "abc",
      extensions: [
        new Language(defineLanguageFacet(), new PartialParser(leaf), [], "partial-test"),
      ],
    });
    expect(typstContextAt(state, 1)).toBe("markup");
  });

  it("reads the context from the tree instead of the text", () => {
    const leaf = (type: NodeType, length: number) => new Tree(type, [], [], length);
    const tree = new Tree(
      source,
      [
        new Tree(
          markup,
          [
            new Tree(equation, [leaf(dollar, 1), leaf(math, 1), leaf(dollar, 1)], [0, 1, 2], 3),
            leaf(text, 2),
          ],
          [0, 3],
          5,
        ),
      ],
      [0],
      5,
    );
    const state = stateWithTree("abcde", tree);
    expect(typstContextAt(state, 1)).toBe("math");
    expect(typstContextAt(state, 0)).toBe("markup");
    expect(typstContextAt(state, 4)).toBe("markup");
  });
});

describe("Typst dollar pairing", () => {
  it("pairs a dollar in markup and steps over the tracked closer", () => {
    expect(typed("|", "$")).toBe("$|$");
    expect(typed("|", "$x$")).toBe("$x$|");
    expect(typed("See |", "$$")).toBe("See $$|");
  });

  it("steps over an untracked closer from inside math", () => {
    expect(typed("$x|$", "$")).toBe("$x$|");
  });

  it("promotes an empty pair to display math on space", () => {
    expect(typed("|", "$ ")).toBe("$ | $");
    expect(typed("|", "$ x")).toBe("$ x| $");
    expect(typed("|", "$ x$")).toBe("$ x $|");
  });

  it("leaves a space alone inside a filled pair", () => {
    expect(typed("|", "$a b")).toBe("$a b|$");
  });

  it("does not pair next to a word, after an escape, or outside markup", () => {
    expect(typed("US|", "$")).toBe("US$|");
    expect(typed("|5", "$")).toBe("$|5");
    expect(typed("\\|", "$")).toBe("\\$|");
    expect(typed("#let x = |", "$")).toBe("#let x = $|");
    expect(typed('#image("|")', "$")).toBe('#image("$|")');
    expect(typed("`|`", "$")).toBe("`$|`");
    expect(typed("// |", "$")).toBe("// $|");
  });

  it("wraps a selection in markup", () => {
    expect(typed("^x+y|", "$")).toBe("$^x+y|$");
  });

  it("types a plain dollar when math pairing is off", () => {
    expect(typed("|", "$", { math: false })).toBe("$|");
  });

  it("deletes an empty pair and demotes an empty display pair with Backspace", () => {
    expect(pressed("$|$", "Backspace")).toBe("|");
    expect(pressed("$ | $", "Backspace")).toBe("$|$");
    expect(pressed("$x|$", "Backspace")).toBe("$|$");
  });
});

describe("Typst selection wrapping", () => {
  it.each([
    ["*", "*^word|*"],
    ["_", "_^word|_"],
    ["`", "`^word|`"],
  ])("wraps the selection in %s", (character, expected) => {
    expect(typed("^word|", character)).toBe(expected);
  });

  it("replaces the selection outside markup", () => {
    expect(typed("#let ^x| = 1", "*")).toBe("#let *| = 1");
    expect(typed("$^x|$", "_")).toBe("$_|$");
  });

  it("types the character when nothing is selected or wrapping is off", () => {
    expect(typed("a|", "*")).toBe("a*|");
    expect(typed("^word|", "*", { wrap: false })).toBe("*|");
  });

  it("wraps every selection", () => {
    const view = editor("^one| and ^two|");
    type(view, "_");
    expect(marked(view)).toBe("_^one|_ and _^two|_");
  });
});

describe("Typst list continuation on Enter", () => {
  it.each([
    ["- foo|", "- foo\n- |"],
    ["  + bar|", "  + bar\n  + |"],
    ["3. baz|", "3. baz\n4. |"],
    ["9. nine|", "9. nine\n10. |"],
    ["/ Term: desc|", "/ Term: desc\n/ |"],
    ["- foo| bar", "- foo\n- |bar"],
    ["- |foo", "- \n- |foo"],
  ])("continues %j", (doc, expected) => {
    expect(pressed(doc, "Enter")).toBe(expected);
  });

  it("removes the marker of an empty item", () => {
    expect(pressed("- one\n- |", "Enter")).toBe("- one\n|");
    expect(pressed("- one\n  - |", "Enter")).toBe("- one\n|");
    expect(pressed("1. |", "Enter")).toBe("|");
  });

  it("leaves Enter alone outside markup list items", () => {
    expect(pressed("plain|", "Enter")).toBe("plain\n|");
    expect(pressed("#{\n- x|\n}", "Enter")).not.toContain("- x\n- ");
    expect(pressed("```\n- a|\n```", "Enter")).not.toContain("- a\n- ");
    expect(pressed("$\n- a|\n$", "Enter")).not.toContain("- a\n- ");
    expect(pressed("-| foo", "Enter")).toBe("-\n|foo");
  });

  it("continues every caret", () => {
    const view = editor("- a|\n- b|");
    press(view, "Enter");
    expect(marked(view)).toBe("- a\n- |\n- b\n- |");
  });

  it("continues the item text on Shift-Enter without a marker", () => {
    expect(pressed("- foo|", "Enter", true)).toBe("- foo\n  |");
    expect(pressed("10. foo|", "Enter", true)).toBe("10. foo\n    |");
  });
});

describe("Typst list Backspace", () => {
  it("removes a marker right before the caret", () => {
    expect(pressed("- |", "Backspace")).toBe("  |");
    expect(pressed("  + |foo", "Backspace")).toBe("    |foo");
    expect(pressed("12. |", "Backspace")).toBe("    |");
  });

  it("leaves ordinary deletions alone", () => {
    expect(pressed("-|", "Backspace")).toBe("|");
    expect(pressed("- a|", "Backspace")).toBe("- |");
    expect(pressed("#{\n- |", "Backspace")).toBe("#{\n-|");
  });
});

describe("Typst list indentation", () => {
  it("nests an item under its sibling's text", () => {
    expect(pressed("- a\n- b|", "Tab")).toBe("- a\n  - b|");
    expect(pressed("10. a\n11. b|", "Tab")).toBe("10. a\n    11. b|");
    expect(pressed("- a\n  - b\n  - c|", "Tab")).toBe("- a\n  - b\n    - c|");
  });

  it("joins an existing deeper level", () => {
    expect(pressed("- a\n    - b\n- c|", "Tab")).toBe("- a\n    - b\n    - c|");
  });

  it("indents a first item by one unit", () => {
    expect(pressed("- a|", "Tab")).toBe("  - a|");
  });

  it("outdents to the parent item", () => {
    expect(pressed("- a\n  - b|", "Tab", true)).toBe("- a\n- b|");
    expect(pressed("1. a\n   - b\n      - c|", "Tab", true)).toBe("1. a\n   - b\n   - c|");
  });

  it("indents every selected item line", () => {
    const view = editor("- a\n- ^b\n- c|");
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("- a\n  - b\n  - c");
  });

  it("falls back to ordinary indentation outside list items", () => {
    expect(pressed("plain|", "Tab")).toBe("  plain|");
    expect(pressed("- a|", "Tab", true)).toBe("- a|");
  });
});
