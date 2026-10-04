// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { RawInline } from "./raw-inline";
import { isRawMathSource } from "./raw-presentation";

describe("RawInline math presentation", () => {
  it("recognizes supported math delimiters with a linear scanner", () => {
    expect(isRawMathSource("$x + y$")).toBe(true);
    expect(isRawMathSource("$$x + y$$")).toBe(true);
    expect(isRawMathSource("\\(x + y\\)")).toBe(true);
    expect(isRawMathSource("\\[x + y\\]")).toBe(true);
    expect(isRawMathSource("$x$ trailing")).toBe(false);
    expect(isRawMathSource("$x$y$")).toBe(false);
    expect(isRawMathSource(`$${"\\#".repeat(20_000)}$`)).toBe(true);
  });

  it("keeps the complete math expression visible and directly editable", () => {
    const source =
      "$\\frac{attention_{query}}{\\sqrt{dimension_{key}}}$";
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, RawInline],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "rawInline", attrs: { source } },
            ],
          },
        ],
      },
    });

    const raw = element.querySelector<HTMLElement>(
      '[data-type="raw-inline"]',
    );
    expect(raw?.dataset.rawInlineKind).toBe("math");
    expect(raw?.querySelector(".raw-inline-source")).toHaveTextContent(
      source,
    );
    expect(
      raw?.querySelector(".raw-inline-source"),
    ).not.toHaveAttribute("hidden");

    raw?.querySelector<HTMLButtonElement>(".raw-inline-edit")?.click();
    expect(
      raw?.querySelector<HTMLTextAreaElement>(".raw-inline-input")?.value,
    ).toBe(source);

    editor.destroy();
    element.remove();
  });
});

function mountInline(source: string, handleKeyDown: (view: unknown, event: KeyboardEvent) => boolean = () => false) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    editorProps: { handleKeyDown },
    extensions: [StarterKit, RawInline],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "rawInline", attrs: { source } },
          ],
        },
      ],
    },
  });
  const raw = element.querySelector<HTMLElement>('[data-type="raw-inline"]') as HTMLElement;
  const inlinePos = 5;
  return {
    editor,
    element,
    raw,
    inlinePos,
    code: () => raw.querySelector<HTMLElement>(".raw-inline-source") as HTMLElement,
    editButton: () => raw.querySelector<HTMLButtonElement>(".raw-inline-edit") as HTMLButtonElement,
    input: () => raw.querySelector<HTMLTextAreaElement>(".raw-inline-input"),
    source: () => editor.state.doc.nodeAt(inlinePos)?.attrs.source as string | undefined,
    setSource: (next: string) =>
      editor.view.dispatch(editor.state.tr.setNodeMarkup(inlinePos, undefined, { source: next })),
    teardown: () => {
      editor.destroy();
      element.remove();
    },
  };
}

function press(target: EventTarget, init: KeyboardEventInit) {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("RawInline node view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows a compact form of non-math source with an edit button", () => {
    const view = mountInline(String.raw`\cite{knuth84, lamport94}`);

    expect(view.code()).toHaveTextContent("@knuth84, @lamport94");
    expect(view.code()).not.toHaveAttribute("title");
    expect(view.raw.dataset.rawInlineKind).toBeUndefined();
    expect(view.raw).toHaveAttribute("aria-label", "inline.label");
    expect(view.editButton()).toHaveAttribute("aria-label", "inline.editLabel");
    expect(view.editButton()).toHaveAttribute("title", "inline.editTitle");
    view.teardown();
  });

  it("swaps the compact form for the exact source while editing", () => {
    const view = mountInline("$x^2$");

    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;

    expect(input.value).toBe("$x^2$");
    expect(input.rows).toBe(1);
    expect(input).toHaveAttribute("aria-label", "inline.inputLabel");
    expect(view.raw.dataset.rawInlineEditing).toBe("true");
    expect(view.raw.dataset.rawInlineKind).toBeUndefined();
    expect(view.code().hidden).toBe(true);
    expect(view.editButton().hidden).toBe(true);
    expect(document.activeElement).toBe(input);
    view.teardown();
  });

  it("caps the source box at six rows", () => {
    const view = mountInline(Array.from({ length: 9 }, (_, index) => `l${index}`).join("\n"));

    view.editButton().click();

    expect(view.input()?.rows).toBe(6);
    view.teardown();
  });

  it("opens only one source box when edit is pressed twice", () => {
    const view = mountInline(String.raw`\ref{fig:a}`);

    view.editButton().click();
    view.editButton().click();

    expect(view.raw.querySelectorAll(".raw-inline-input")).toHaveLength(1);
    view.teardown();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("commits with %o + Enter and shows the new source", (modifier) => {
    const view = mountInline(String.raw`\ref{fig:a}`);
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;

    input.value = "$y$";
    press(input, { key: "Enter", ...modifier });

    expect(view.source()).toBe("$y$");
    expect(view.input()).toBeNull();
    expect(view.raw.dataset.rawInlineEditing).toBeUndefined();
    expect(view.raw.dataset.rawInlineKind).toBe("math");
    expect(view.code()).toHaveTextContent("$y$");
    expect(view.code()).toHaveAttribute("title", "inline.mathTitle");
    expect(view.editButton().hidden).toBe(false);
    view.teardown();
  });

  it("discards the edit on Escape and keeps the math presentation", () => {
    const view = mountInline("$x$");
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;

    input.value = "discarded";
    press(input, { key: "Escape" });
    input.dispatchEvent(new FocusEvent("blur"));

    expect(view.source()).toBe("$x$");
    expect(view.input()).toBeNull();
    expect(view.raw.dataset.rawInlineKind).toBe("math");
    expect(view.code().hidden).toBe(false);
    view.teardown();
  });

  it("commits when the source box loses focus", () => {
    const view = mountInline("$x$");
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;

    input.value = String.raw`\label{eq:one}`;
    input.blur();

    expect(view.source()).toBe(String.raw`\label{eq:one}`);
    expect(view.code()).toHaveTextContent("#eq:one");
    expect(view.raw.dataset.rawInlineKind).toBeUndefined();
    view.teardown();
  });

  it("leaves the document untouched when the source did not change", () => {
    const view = mountInline("$x$");
    const docChanges = vi.fn();
    view.editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) docChanges();
    });
    view.editButton().click();

    press(view.input() as HTMLTextAreaElement, { key: "Enter", metaKey: true });

    expect(docChanges).not.toHaveBeenCalled();
    view.teardown();
  });

  it("ignores Escape and the commit chord while an input method is composing", () => {
    const view = mountInline("$x$");
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;
    input.value = "$z$";

    input.dispatchEvent(new CompositionEvent("compositionstart"));
    press(input, { key: "Escape" });
    press(input, { key: "Enter", ctrlKey: true });
    expect(view.input()).toBe(input);
    expect(view.source()).toBe("$x$");

    input.dispatchEvent(new CompositionEvent("compositionend"));
    press(input, { key: "Escape" });
    expect(view.input()).toBeNull();
    expect(view.source()).toBe("$x$");
    view.teardown();
  });

  it("follows source changes made elsewhere, but not while being edited", () => {
    const view = mountInline("$x$");

    view.setSource(String.raw`\ref{sec:intro}`);
    expect(view.code()).toHaveTextContent("§ sec:intro");
    expect(view.raw.dataset.rawInlineKind).toBeUndefined();

    view.editButton().click();
    view.setSource("$w$");
    expect(view.code()).toHaveTextContent("§ sec:intro");
    expect(view.input()?.value).toBe(String.raw`\ref{sec:intro}`);

    press(view.input() as HTMLTextAreaElement, { key: "Escape" });
    expect(view.code()).toHaveTextContent("$w$");
    view.teardown();
  });

  it("shows and clears the selected state", () => {
    const view = mountInline("$x$");

    view.editor.commands.setNodeSelection(view.inlinePos);
    expect(view.raw).toHaveClass("ProseMirror-selectednode");

    view.editor.commands.setTextSelection(2);
    expect(view.raw).not.toHaveClass("ProseMirror-selectednode");
    view.teardown();
  });

  it("keeps keystrokes in the source box and on the edit button away from the editor", () => {
    const handleKeyDown = vi.fn((_view: unknown, _event: KeyboardEvent) => false);
    const view = mountInline("$x$", handleKeyDown);
    const editButton = view.editButton();

    press(editButton, { key: "a" });
    editButton.click();
    press(view.input() as HTMLTextAreaElement, { key: "b" });
    expect(handleKeyDown).not.toHaveBeenCalled();

    press(view.code(), { key: "c" });
    press(view.code().firstChild as Node, { key: "d" });
    expect(handleKeyDown.mock.calls.map(([, event]) => event.key)).toEqual(["c", "d"]);
    view.teardown();
  });

  it("keeps its source box through the editor's DOM observation", async () => {
    const view = mountInline("$x$");
    view.editButton().click();
    const input = view.input();

    await Promise.resolve();

    expect(view.input()).toBe(input);
    expect(view.source()).toBe("$x$");
    view.teardown();
  });

  it("drops a pending edit whose node was deleted meanwhile", () => {
    const view = mountInline("$x$");
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;
    input.value = "orphaned";

    view.editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Replaced" }] }],
    });
    input.dispatchEvent(new FocusEvent("blur"));

    expect(view.editor.getText()).toBe("Replaced");
    expect(JSON.stringify(view.editor.getJSON())).not.toContain("orphaned");
    view.teardown();
  });

  it("stops listening to its edit button once destroyed", () => {
    const view = mountInline("$x$");
    const { raw } = view;
    const button = view.editButton();
    view.teardown();

    button.click();

    expect(raw.querySelector(".raw-inline-input")).toBeNull();
  });
});
