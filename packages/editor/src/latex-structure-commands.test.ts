// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  closeEnvironmentAtCursor,
  continueListOnEnter,
  escapeSnippetText,
  latexListKeymap,
  latexStructureKeymap,
  surroundSelectionWithEnvironment,
} from "./latex-structure-commands";
import { setEditorDocumentPath } from "./controller";

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
      name: "description item with [label]",
      doc: "\\begin{description}\n  \\item[term] definition|",
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
  ];

  it.each(nulls)("returns null: $name", ({ doc }) => {
    expect(continueListOnEnter(stateAt(doc))).toBeNull();
  });

  it("returns null for multiple cursors", () => {
    const doc = "\\begin{itemize}\n  \\item a\n  \\item b";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create(
        [EditorSelection.cursor(25), EditorSelection.cursor(doc.length)],
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

  it("binds Enter, Mod-Alt-. and Mod-Alt-e", () => {
    expect(latexListKeymap.map((b) => b.key)).toEqual(["Enter"]);
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
