// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autocompletion,
  completionKeymap,
  selectedCompletion,
  startCompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  closeEnvironmentAtCursor,
  continueListOnEnter,
  deleteItemMarkupBackward,
  escapeSnippetText,
  latexListKeymap,
  latexStructureKeymap,
  surroundSelectionWithEnvironment,
} from "./latex-structure-commands";
import { setEditorDocumentPath } from "./controller";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

/** Build an EditorState from a doc with a `|` cursor marker. */
function stateAt(docWithCursor: string): EditorState {
  const cursor = docWithCursor.indexOf("|");
  if (cursor < 0) throw new Error("missing | cursor marker");
  const doc = docWithCursor.slice(0, cursor) + docWithCursor.slice(cursor + 1);
  return EditorState.create({ doc, selection: EditorSelection.single(cursor) });
}

function applied(state: EditorState, spec: NonNullable<ReturnType<typeof continueListOnEnter>>) {
  const next = state.update(spec).state;
  return { doc: next.doc.toString(), head: next.selection.main.head };
}

beforeEach(() => {
  // Commands are gated to LaTeX documents via the controller's document path.
  setEditorDocumentPath("/project/main.tex");
});

afterEach(() => {
  setEditorDocumentPath(null);
});

describe("continueListOnEnter", () => {
  const continues: {
    name: string;
    doc: string;
    insert: string;
  }[] = [
    {
      name: "itemize item preserving indent",
      doc: "\\begin{itemize}\n  \\item first|",
      insert: "\n  \\item ",
    },
    {
      name: "enumerate item",
      doc: "\\begin{enumerate}\n  \\item one|",
      insert: "\n  \\item ",
    },
    {
      name: "starred itemize",
      doc: "\\begin{itemize*}\n  \\item first|",
      insert: "\n  \\item ",
    },
    {
      name: "nested list adopts the innermost (current-line) indent",
      doc: "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n    \\item inner|",
      insert: "\n    \\item ",
    },
  ];

  it.each(continues)("continues: $name", ({ doc, insert }) => {
    const state = stateAt(doc);
    const spec = continueListOnEnter(state);
    expect(spec).not.toBeNull();
    const cursor = doc.indexOf("|");
    const result = applied(state, spec!);
    // The fixture holds exactly one caret marker; splice it out explicitly.
    expect(result.doc).toBe(
      doc.slice(0, cursor) + insert + doc.slice(cursor + 1),
    );
    expect(result.head).toBe(cursor + insert.length);
  });

  it("continues a description item with an empty label", () => {
    const doc = "\\begin{description}\n  \\item[term] definition|";
    const state = stateAt(doc);
    const cursor = doc.indexOf("|");
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe(
      "\\begin{description}\n  \\item[term] definition\n  \\item[] ",
    );
    expect(result.head).toBe(cursor + "\n  \\item[".length);
  });

  it("continues a description item whose body holds a bracket group", () => {
    const doc = "\\begin{description}\n  \\item[term] [reference] body|";
    const state = stateAt(doc);
    const cursor = doc.indexOf("|");
    const spec = continueListOnEnter(state);
    expect(spec).not.toBeNull();
    const result = applied(state, spec!);
    expect(result.doc).toBe(
      "\\begin{description}\n  \\item[term] [reference] body\n  \\item[] ",
    );
    expect(result.head).toBe(cursor + "\n  \\item[".length);
  });

  it("continues a description item whose label follows a space", () => {
    const doc = "\\begin{description}\n  \\item [term] body|";
    const state = stateAt(doc);
    const cursor = doc.indexOf("|");
    const spec = continueListOnEnter(state);
    expect(spec).not.toBeNull();
    const result = applied(state, spec!);
    expect(result.doc).toBe(
      "\\begin{description}\n  \\item [term] body\n  \\item[] ",
    );
    expect(result.head).toBe(cursor + "\n  \\item[".length);
  });

  it("splits a line mid-item and carries the tail to the new item", () => {
    const state = stateAt("\\begin{itemize}\n  \\item first|second");
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe(
      "\\begin{itemize}\n  \\item first\n  \\item second",
    );
  });

  it("indents a wrapped continuation line without a new marker", () => {
    const doc = "\\begin{itemize}\n  \\item first\n  wrapped tail|";
    const state = stateAt(doc);
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe(`${doc.replace("|", "")}\n  `);
    expect(result.head).toBe(result.doc.length);
  });

  it("moves an empty nested item out to the enclosing list", () => {
    const state = stateAt(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n" +
        "    \\item inner\n    \\item |\n  \\end{enumerate}\n\\end{itemize}",
    );
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n" +
        "    \\item inner\n  \\end{enumerate}\n  \\item \n\\end{itemize}",
    );
    expect(result.doc.slice(0, result.head)).toBe(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n" +
        "    \\item inner\n  \\end{enumerate}\n  \\item ",
    );
  });

  it("moves an empty nested item out across blank lines to the enclosing list", () => {
    const state = stateAt(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n" +
        "    \\item inner\n    \\item |\n\n  \\end{enumerate}\n\\end{itemize}",
    );
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n" +
        "    \\item inner\n\n  \\end{enumerate}\n  \\item \n\\end{itemize}",
    );
    expect(result.doc.slice(0, result.head)).toBe(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n" +
        "    \\item inner\n\n  \\end{enumerate}\n  \\item ",
    );
  });

  it("clears an empty nested item when content separates it from the inner end", () => {
    const state = stateAt(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n" +
        "    \\item inner\n    \\item |\n    trailing text\n" +
        "  \\end{enumerate}\n\\end{itemize}",
    );
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n" +
        "    \\item inner\n    \n    trailing text\n" +
        "  \\end{enumerate}\n\\end{itemize}",
    );
    expect(result.doc.slice(0, result.head)).toBe(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n" +
        "    \\item inner\n    ",
    );
  });

  it("clears an empty nested item when an over-long line separates it from the inner end", () => {
    const separator = `${" ".repeat(2050)}\\item still inner`;
    expect(separator.length).toBeGreaterThan(2 * 1024);
    const head =
      "\\begin{itemize}\n  \\item outer\n  \\begin{itemize}\n    \\item inner\n";
    const tail = `\n${separator}\n  \\end{itemize}\n\\end{itemize}`;
    const state = stateAt(`${head}    \\item |${tail}`);
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe(`${head}    ${tail}`);
    expect(result.doc.slice(0, result.head)).toBe(`${head}    `);
  });

  it("clears an empty nested item that has no closing line to step over", () => {
    const state = stateAt(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n    \\item |",
    );
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe(
      "\\begin{itemize}\n  \\item outer\n  \\begin{enumerate}\n    ",
    );
    expect(result.head).toBe(result.doc.length);
  });

  it("exits the list on an empty \\item line", () => {
    const state = stateAt("\\begin{itemize}\n  \\item a\n  \\item |");
    const spec = continueListOnEnter(state);
    expect(spec).not.toBeNull();
    const result = applied(state, spec!);
    // The empty item line is cleared and replaced with a plain newline.
    expect(result.doc).toBe("\\begin{itemize}\n  \\item a\n\n");
    expect(result.head).toBe(result.doc.length);
  });

  it("exits on an empty \\item line with no trailing space", () => {
    const state = stateAt("\\begin{itemize}\n  \\item|");
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe("\\begin{itemize}\n\n");
  });

  const nulls: { name: string; doc: string }[] = [
    { name: "item line without an enclosing list", doc: "  \\item lonely|" },
    {
      name: "list already closed above",
      doc: "\\begin{itemize}\n  \\item a\n\\end{itemize}\n\\item stray|",
    },
    { name: "line without \\item", doc: "\\begin{itemize}\n  plain text|" },
    { name: "\\item-prefixed command word", doc: "\\begin{itemize}\n  \\itemsep text|" },
    { name: "cursor at line start", doc: "\\begin{itemize}\n|  \\item first" },
    { name: "cursor inside the marker", doc: "\\begin{itemize}\n  \\it|em text" },
    {
      name: "cursor inside a description label",
      doc: "\\begin{description}\n  \\item[la|bel] text",
    },
    {
      name: "cursor inside an unfinished description label",
      doc: "\\begin{description}\n  \\item[la|",
    },
    {
      name: "cursor inside an unfinished label with text after it",
      doc: "\\begin{description}\n  \\item[label| text",
    },
    {
      name: "cursor between the marker and an unfinished label",
      doc: "\\begin{description}\n  \\item |[label",
    },
    {
      name: "the item line is inside verbatim",
      doc:
        "\\begin{itemize}\n  \\item a\n  \\begin{verbatim}\n" +
        "  \\item literal|\n  \\end{verbatim}\n\\end{itemize}",
    },
    {
      name: "the item line is inside lstlisting",
      doc:
        "\\begin{itemize}\n  \\item a\n  \\begin{lstlisting}\n" +
        "  \\item literal|\n  \\end{lstlisting}\n\\end{itemize}",
    },
    {
      name: "the item line is commented out",
      doc: "\\begin{itemize}\n  % \\item a|",
    },
  ];

  it.each(nulls)("returns null: $name", ({ doc }) => {
    expect(continueListOnEnter(stateAt(doc))).toBeNull();
  });

  it("continues an item line that is longer than the line window", () => {
    const body = "word ".repeat(700);
    expect(body.length).toBeGreaterThan(2 * 1024);
    const state = stateAt(`\\begin{itemize}\n  \\item ${body}|`);
    const result = applied(state, continueListOnEnter(state)!);
    expect(result.doc).toBe(
      `\\begin{itemize}\n  \\item ${body}\n  \\item `,
    );
    expect(result.head).toBe(result.doc.length);
  });

  it("continues every cursor of a multi-cursor selection at once", () => {
    const doc = "\\begin{itemize}\n  \\item a\n  \\item b";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create(
        [
          EditorSelection.cursor(doc.indexOf("\\item a") + "\\item a".length),
          EditorSelection.cursor(doc.length),
        ],
        0,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    const next = state.update(continueListOnEnter(state)!).state;
    expect(next.doc.toString()).toBe(
      "\\begin{itemize}\n  \\item a\n  \\item \n  \\item b\n  \\item ",
    );
  });

  it("returns null for a non-empty selection", () => {
    const doc = "\\begin{itemize}\n  \\item a";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(doc.length - 1, doc.length),
    });
    expect(continueListOnEnter(state)).toBeNull();
  });

  it("returns null when a cursor of a multi-cursor selection does not qualify", () => {
    const doc = "\\begin{itemize}\n  \\item a\n  \\item b";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create(
        [
          EditorSelection.cursor(doc.indexOf("\n") + 1),
          EditorSelection.cursor(doc.length),
        ],
        0,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    expect(continueListOnEnter(state)).toBeNull();
  });

  it("returns null for non-LaTeX documents", () => {
    setEditorDocumentPath("/project/notes.md");
    expect(
      continueListOnEnter(stateAt("\\begin{itemize}\n  \\item first|")),
    ).toBeNull();
  });
});

describe("closeEnvironmentAtCursor", () => {
  it("closes the only open environment on a new indented line", () => {
    const state = stateAt("\\begin{theorem}\n  Some text|");
    const result = applied(state, closeEnvironmentAtCursor(state)!);
    expect(result.doc).toBe("\\begin{theorem}\n  Some text\n\\end{theorem}");
    expect(result.head).toBe(result.doc.length);
  });

  it("closes the innermost environment of a nested pair", () => {
    const state = stateAt("\\begin{a}\n  \\begin{b}\n    x|");
    const result = applied(state, closeEnvironmentAtCursor(state)!);
    // Indent adopted from \begin{b}'s line.
    expect(result.doc).toBe("\\begin{a}\n  \\begin{b}\n    x\n  \\end{b}");
  });

  it("keeps the starred environment name", () => {
    const state = stateAt("\\begin{align*}\n  x = y|");
    const result = applied(state, closeEnvironmentAtCursor(state)!);
    expect(result.doc).toBe("\\begin{align*}\n  x = y\n\\end{align*}");
  });

  it("skips environments that are already balanced", () => {
    const state = stateAt(
      "\\begin{outer}\n\\begin{inner}\nx\n\\end{inner}\ny|",
    );
    const result = applied(state, closeEnvironmentAtCursor(state)!);
    expect(result.doc).toBe(
      "\\begin{outer}\n\\begin{inner}\nx\n\\end{inner}\ny\n\\end{outer}",
    );
  });

  it("adopts the \\begin line's indent when the cursor line is empty", () => {
    const state = stateAt("  \\begin{quote}\n|");
    const result = applied(state, closeEnvironmentAtCursor(state)!);
    expect(result.doc).toBe("  \\begin{quote}\n  \\end{quote}");
  });

  it("returns null when everything is balanced", () => {
    expect(
      closeEnvironmentAtCursor(
        stateAt("\\begin{itemize}\n\\item a\n\\end{itemize}\n|"),
      ),
    ).toBeNull();
  });

  it("returns null when nothing is open", () => {
    expect(closeEnvironmentAtCursor(stateAt("plain text|"))).toBeNull();
  });

  it("returns null for non-LaTeX documents", () => {
    setEditorDocumentPath("/project/notes.typ");
    expect(closeEnvironmentAtCursor(stateAt("\\begin{theorem}\nx|"))).toBeNull();
  });
});

describe("surroundSelectionWithEnvironment", () => {
  let view: EditorView | null = null;

  function makeView(doc: string, anchor: number, head: number): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(anchor, head),
        // The real editor enables multiple selections; the mirrored snippet
        // fields rely on it to select both `env` names at once.
        extensions: [EditorState.allowMultipleSelections.of(true)],
      }),
    });
    return view;
  }

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it("wraps the selection and activates mirrored env-name fields", () => {
    const v = makeView("hello", 0, 5);
    expect(surroundSelectionWithEnvironment(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("\\begin{env}\nhello\n\\end{env}");
    // Both `env` occurrences belong to the same snippet field (mirrored).
    const ranges = v.state.selection.ranges;
    expect(ranges).toHaveLength(2);
    expect(ranges.map((r) => v.state.sliceDoc(r.from, r.to))).toEqual([
      "env",
      "env",
    ]);
  });

  it("escapes snippet field syntax inside the selection", () => {
    const v = makeView("a${1:x}b", 0, 8);
    expect(surroundSelectionWithEnvironment(v)).toBe(true);
    // The user text must survive verbatim, not become a snippet field.
    expect(v.state.doc.toString()).toBe("\\begin{env}\na${1:x}b\n\\end{env}");
  });

  it("inserts a template with an empty body for an empty selection", () => {
    const v = makeView("", 0, 0);
    expect(surroundSelectionWithEnvironment(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("\\begin{env}\n\n\\end{env}");
  });

  it("is a no-op for non-LaTeX documents", () => {
    setEditorDocumentPath("/project/readme.md");
    const v = makeView("hello", 0, 5);
    expect(surroundSelectionWithEnvironment(v)).toBe(false);
    expect(v.state.doc.toString()).toBe("hello");
  });
});

describe("escapeSnippetText", () => {
  it("escapes braces so field syntax round-trips as literal text", () => {
    expect(escapeSnippetText("a${1}b#{f}c}d")).toBe(
      "a$\\{1\\}b#\\{f\\}c\\}d",
    );
    expect(escapeSnippetText("no braces")).toBe("no braces");
  });
});

describe("keymaps", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it("binds Enter, Shift-Enter, Backspace, Mod-Alt-. and Mod-Alt-e", () => {
    expect(latexListKeymap.map((b) => b.key)).toEqual([
      "Enter",
      "Shift-Enter",
      "Backspace",
    ]);
    expect(latexStructureKeymap.map((b) => b.key)).toEqual([
      "Mod-Alt-.",
      "Mod-Alt-e",
    ]);
  });

  it("Enter binding returns false outside a list so default Enter proceeds", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "plain",
        selection: EditorSelection.single(5),
      }),
    });
    expect(latexListKeymap[0].run!(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("plain");
  });

  it("Shift-Enter inserts a plain newline instead of an item", () => {
    const doc = "\\begin{itemize}\n  \\item a";
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(doc.length),
      }),
    });
    expect(latexListKeymap[1].run!(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${doc}\n  `);
  });

  it("Backspace blanks the item marker before deleting it", () => {
    const doc = "\\begin{itemize}\n  \\item ";
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(doc.length),
      }),
    });
    expect(deleteItemMarkupBackward(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\begin{itemize}\n        ");
    expect(view.state.selection.main.head).toBe(doc.length);
    expect(deleteItemMarkupBackward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("\\begin{itemize}\n        ");
  });

  it("Backspace declines on a literal item line inside verbatim", () => {
    const doc =
      "\\begin{itemize}\n  \\item a\n  \\begin{verbatim}\n  \\item ";
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(doc.length),
      }),
    });
    expect(deleteItemMarkupBackward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("Backspace declines outside an item marker", () => {
    const doc = "\\begin{itemize}\n  \\item text";
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(doc.length),
      }),
    });
    expect(deleteItemMarkupBackward(view)).toBe(false);
  });

  it("leaves Enter and Backspace to vim outside insert mode", () => {
    const doc = "\\begin{itemize}\n  \\item a";
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(doc.length),
      }),
    });
    (view as unknown as { cm: unknown }).cm = {
      state: { vim: { insertMode: false } },
    };
    expect(latexListKeymap[0].run!(view)).toBe(false);
    expect(latexListKeymap[1].run!(view)).toBe(false);
    expect(deleteItemMarkupBackward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);

    (view as unknown as { cm: unknown }).cm = {
      state: { vim: { insertMode: true } },
    };
    expect(latexListKeymap[0].run!(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${doc}\n  \\item `);
  });

  function completionView(doc: string, interactionDelay: number): EditorView {
    const source: CompletionSource = (context) => ({
      from: context.pos,
      options: [{ label: "izzy" }],
      filter: false,
    });
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(doc.length),
        extensions: [
          autocompletion({
            override: [source],
            defaultKeymap: false,
            interactionDelay,
          }),
          keymap.of([
            ...completionKeymap,
            ...latexListKeymap,
            ...defaultKeymap,
          ]),
        ],
      }),
    });
    return view;
  }

  function pressKey(target: EditorView, key: string): boolean {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    target.contentDOM.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("lets a ready completion popup own Enter", async () => {
    const doc = "\\begin{itemize}\n  \\item a";
    const target = completionView(doc, 0);
    startCompletion(target);
    await vi.waitFor(() =>
      expect(selectedCompletion(target.state)).not.toBeNull(),
    );
    expect(pressKey(target, "Enter")).toBe(true);
    expect(target.state.doc.toString()).toBe(`${doc}izzy`);
  });

  it("continues the list when the popup declines Enter", async () => {
    const doc = "\\begin{itemize}\n  \\item a";
    const target = completionView(doc, 10_000);
    startCompletion(target);
    await vi.waitFor(() =>
      expect(selectedCompletion(target.state)).not.toBeNull(),
    );
    expect(pressKey(target, "Enter")).toBe(true);
    expect(target.state.doc.toString()).toBe(`${doc}\n  \\item `);
  });

  it("Enter binding dispatches the continuation inside a list", () => {
    const doc = "\\begin{itemize}\n  \\item a";
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(doc.length),
      }),
    });
    expect(latexListKeymap[0].run!(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${doc}\n  \\item `);
  });
});
