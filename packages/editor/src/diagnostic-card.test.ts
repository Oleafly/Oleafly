// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import {
  attachProofreadingCard,
  hasProofreadingCard,
  diagnosticCardGutter,
  diagnosticCardSource,
} from "./diagnostic-card";

// CodeMirror's delayed lint hover asks the DOM Range for layout rectangles.
// jsdom intentionally has no layout engine, so provide the smallest safe
// geometry shim for this behavior-only test and avoid an unhandled timer error.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

const DOC = "labels were unblinded here";
const FROM = DOC.indexOf("unblinded");
const TO = FROM + "unblinded".length;

function replaceAction(text: string) {
  return {
    name: text,
    apply: (target: EditorView, from: number, to: number) =>
      target.dispatch({ changes: { from, to, insert: text } }),
  };
}

function mount(diagnostics: Diagnostic[]) {
  const editor = new EditorView({
    state: EditorState.create({ doc: DOC }),
    parent: document.body,
  });
  editor.dispatch(setDiagnostics(editor.state, diagnostics));
  view = editor;
  return editor;
}

function spellingDiagnostic(
  suggestions: string[],
  ignores: { label: string; action: { name: string; apply: () => void } }[] = [],
): Diagnostic {
  return attachProofreadingCard(
    {
      from: FROM,
      to: TO,
      severity: "warning",
      message: "Possible misspelling",
      actions: [],
    },
    {
      word: "unblinded",
      suggestions: suggestions.map((text) => ({
        label: text,
        action: replaceAction(text),
      })),
      ignores,
    },
  );
}

function card(editor: EditorView, pos: number): HTMLElement | null {
  const tooltip = diagnosticCardSource(editor, pos);
  if (!tooltip) return null;
  return tooltip.create(editor).dom as HTMLElement;
}

describe("proofreading hover card", () => {
  it("offers the suggestions as rows and marks the best one", () => {
    const editor = mount([
      spellingDiagnostic(["unbounded", "unbranded", "unlined"]),
    ]);

    const dom = card(editor, FROM + 3)!;
    expect(dom).not.toBeNull();
    expect(dom.querySelector(".cm-proofread-header")?.textContent).toBe(
      "Did you mean unbounded?",
    );
    const rows = [...dom.querySelectorAll(".cm-proofread-suggestion")];
    expect(rows.map((row) => row.textContent)).toEqual([
      "unbounded",
      "unbranded",
      "unlined",
    ]);
    expect(rows[0].classList).toContain("cm-proofread-suggestion-top");
    expect(rows[1].classList).not.toContain("cm-proofread-suggestion-top");
  });

  it("applies a suggestion to the flagged range", () => {
    const editor = mount([spellingDiagnostic(["unbounded"])]);
    const dom = card(editor, FROM)!;

    const row = dom.querySelector<HTMLButtonElement>(
      ".cm-proofread-suggestion",
    )!;
    // Mousedown, not click: the editor reclaims focus on mouseup and would
    // close the card before a click could land.
    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(editor.state.doc.toString()).toBe("labels were unbounded here");
  });

  it("separates the ignore options into a footer", () => {
    const project = { name: "p", apply: vi.fn() };
    const everywhere = { name: "e", apply: vi.fn() };
    const editor = mount([
      spellingDiagnostic(["unbounded"], [
        { label: "Ignore", action: project },
        { label: "Ignore everywhere", action: everywhere },
      ]),
    ]);

    const dom = card(editor, FROM)!;
    const footer = dom.querySelector(".cm-proofread-footer")!;
    const entries = [...footer.querySelectorAll(".cm-proofread-ignore")];
    expect(entries.map((entry) => entry.textContent)).toEqual([
      "Ignore",
      "Ignore everywhere",
    ]);
    expect(footer.querySelectorAll(".cm-proofread-footer-divider")).toHaveLength(
      1,
    );

    entries[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(everywhere.apply).toHaveBeenCalledOnce();
    expect(project.apply).not.toHaveBeenCalled();
  });

  it("names the word when the checker has no suggestion", () => {
    const editor = mount([spellingDiagnostic([])]);
    const dom = card(editor, FROM)!;
    expect(dom.querySelector(".cm-proofread-header")?.textContent).toBe(
      "Not in dictionary: unblinded",
    );
    expect(dom.querySelector(".cm-proofread-suggestions")).toBeNull();
  });

  it("shows nothing away from a flagged range", () => {
    const editor = mount([spellingDiagnostic(["unbounded"])]);
    expect(diagnosticCardSource(editor, 0)).toBeNull();
    expect(diagnosticCardSource(editor, DOC.length)).toBeNull();
  });

  it("builds a card for a diagnostic that brought no card of its own", () => {
    const fix = { name: "Add alt text", apply: vi.fn() };
    const plain: Diagnostic = {
      from: FROM,
      to: TO,
      severity: "error",
      message: "Image without alt text",
      actions: [fix],
    };
    expect(hasProofreadingCard(plain)).toBe(false);
    const editor = mount([plain]);

    const dom = card(editor, FROM + 1)!;
    expect(dom).not.toBeNull();
    // The message is the header; no "Did you mean" framing without a word.
    expect(dom.querySelector(".cm-proofread-header")?.textContent).toBe(
      "Image without alt text",
    );
    expect(dom.querySelector(".cm-proofread-dot")?.className).toContain(
      "is-error",
    );
    // Quick fixes become rows, and none is marked as the best guess.
    const rows = [...dom.querySelectorAll(".cm-proofread-suggestion")];
    expect(rows.map((row) => row.textContent)).toEqual(["Add alt text"]);
    expect(rows[0].classList).not.toContain("cm-proofread-suggestion-top");

    rows[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(fix.apply).toHaveBeenCalledOnce();
  });

  it("shows a card with no rows when a diagnostic has no quick fix", () => {
    const editor = mount([
      {
        from: FROM,
        to: TO,
        severity: "warning",
        message: "Overfull hbox",
      },
    ]);

    const dom = card(editor, FROM)!;
    expect(dom.querySelector(".cm-proofread-header")?.textContent).toBe(
      "Overfull hbox",
    );
    expect(dom.querySelector(".cm-proofread-suggestions")).toBeNull();
    expect(dom.querySelector(".cm-proofread-footer")).toBeNull();
  });

  it("prefers the tightest diagnostic when ranges overlap", () => {
    const phrase = attachProofreadingCard(
      {
        from: 0,
        to: TO,
        severity: "warning",
        message: "phrase",
        actions: [],
      },
      {
        word: "labels were unblinded",
        suggestions: [{ label: "phrase fix", action: replaceAction("x") }],
        ignores: [],
      },
    );
    const editor = mount([phrase, spellingDiagnostic(["unbounded"])]);

    const dom = card(editor, FROM + 2)!;
    expect(dom.querySelector(".cm-proofread-suggestion")?.textContent).toBe(
      "unbounded",
    );
  });
});

describe("proofreading gutter card", () => {
  function mountWithGutter(diagnostics: Diagnostic[]) {
    const editor = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [lintGutter(), diagnosticCardGutter()],
      }),
      parent: document.body,
    });
    editor.dispatch(setDiagnostics(editor.state, diagnostics));
    view = editor;
    return editor;
  }

  function hoverMarker(editor: EditorView) {
    const marker = editor.dom.querySelector(".cm-lint-marker");
    if (!marker) throw new Error("no lint gutter marker rendered");
    marker.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    return marker;
  }

  afterEach(() => {
    document
      .querySelectorAll(".cm-proofread-card")
      .forEach((node) => node.remove());
  });

  it("shows the same card from the gutter marker", () => {
    const editor = mountWithGutter([spellingDiagnostic(["unbounded"])]);
    hoverMarker(editor);

    // Rendered into the body: inside the editor it would be clipped by the pane.
    const card = document.body.querySelector<HTMLElement>(
      ".cm-proofread-card-floating",
    );
    expect(card).not.toBeNull();
    expect(card!.parentElement).toBe(document.body);
    expect(card!.style.position).toBe("fixed");
    expect(card!.querySelector(".cm-proofread-header")?.textContent).toBe(
      "Did you mean unbounded?",
    );
  });

  it("applies a suggestion picked from the gutter card", () => {
    const editor = mountWithGutter([spellingDiagnostic(["unbounded"])]);
    hoverMarker(editor);

    document.body
      .querySelector<HTMLButtonElement>(".cm-proofread-suggestion")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(editor.state.doc.toString()).toBe("labels were unbounded here");
  });

  it("drops the card when the document changes under it", () => {
    const editor = mountWithGutter([spellingDiagnostic(["unbounded"])]);
    hoverMarker(editor);
    expect(document.body.querySelector(".cm-proofread-card")).not.toBeNull();

    editor.dispatch({ changes: { from: 0, insert: "x" } });
    expect(document.body.querySelector(".cm-proofread-card")).toBeNull();
  });

  it("shows the message card from the gutter for any diagnostic", () => {
    const editor = mountWithGutter([
      { from: FROM, to: TO, severity: "error", message: "compile error" },
    ]);
    hoverMarker(editor);
    expect(
      document.body.querySelector(".cm-proofread-header")?.textContent,
    ).toBe("compile error");
  });
});
