// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { visualModeActive } from "./index";
import { latexFromClipboard, pasteHtml } from "./paste-html";

let mounted: EditorView | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
});

interface ClipboardShape {
  html?: string;
  text?: string;
  files?: number;
  extraTypes?: string[];
}

function clipboard(shape: ClipboardShape): DataTransfer {
  const types = [...(shape.extraTypes ?? [])];
  if (shape.html !== undefined) types.push("text/html");
  if (shape.text !== undefined) types.push("text/plain");
  return {
    types,
    files: { length: shape.files ?? 0 },
    getData: (type: string) =>
      type === "text/html" ? (shape.html ?? "") : (shape.text ?? ""),
  } as unknown as DataTransfer;
}

function pasteEvent(shape: ClipboardShape): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboard(shape) });
  return event;
}

function mount(visual: boolean, doc = ""): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  mounted = new EditorView({
    state: EditorState.create({
      doc,
      extensions: visual ? [pasteHtml, visualModeActive.of(true)] : [pasteHtml],
    }),
    parent,
  });
  return mounted;
}

describe("latexFromClipboard", () => {
  it("converts a formatted fragment to LaTeX", () => {
    expect(
      latexFromClipboard(
        clipboard({ html: "<p>Hello <b>bold</b> world</p>", text: "Hello bold world" }),
      ),
    ).toBe(String.raw`Hello \textbf{bold} world`);
  });

  it("leaves unformatted content to the default paste handler", () => {
    expect(latexFromClipboard(clipboard({ html: "<p>plain</p>", text: "plain" }))).toBeNull();
  });

  it("leaves a clipboard without HTML alone", () => {
    expect(latexFromClipboard(clipboard({ text: "plain" }))).toBeNull();
  });

  it("leaves an image paste alone", () => {
    expect(
      latexFromClipboard(clipboard({ html: "<p><img src='x'></p>", text: "", files: 1 })),
    ).toBeNull();
  });

  it("ignores clipboards carrying editor metadata", () => {
    expect(
      latexFromClipboard(
        clipboard({
          html: "<p>Hello <b>bold</b></p>",
          text: "Hello bold",
          extraTypes: ["vscode-editor-data"],
        }),
      ),
    ).toBeNull();
  });

  it("converts a table into a tabular", () => {
    const latex = latexFromClipboard(
      clipboard({
        html: "<table><tr><th>A</th><td>1</td></tr></table>",
        text: "A\t1",
      }),
    );
    expect(latex).toContain(String.raw`\begin{tabular}`);
    expect(latex).toContain(String.raw`\textbf{A} & 1 \\`);
  });
});

describe("pasteHtml", () => {
  it("inserts the converted LaTeX in Visual mode", () => {
    const view = mount(true);
    const event = pasteEvent({ html: "<p>Hello <b>bold</b></p>", text: "Hello bold" });
    view.contentDOM.dispatchEvent(event);

    expect(view.state.doc.toString()).toBe(String.raw`Hello \textbf{bold}`);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the paste to the host outside Visual mode", () => {
    const view = mount(false);
    view.contentDOM.dispatchEvent(
      pasteEvent({ html: "<p>Hello <b>bold</b></p>", text: "Hello bold" }),
    );

    expect(view.state.doc.toString()).toBe("Hello bold");
  });

  it("does not claim a plain-text paste", () => {
    const view = mount(true);
    view.contentDOM.dispatchEvent(pasteEvent({ html: "<p>plain</p>", text: "plain" }));

    expect(view.state.doc.toString()).toBe("plain");
  });

  it("does not claim an image paste", () => {
    const view = mount(true);
    view.contentDOM.dispatchEvent(
      pasteEvent({ html: "<p><img src='x'></p>", text: "caption", files: 1 }),
    );

    expect(view.state.doc.toString()).toBe("caption");
  });

  it("replaces the selection with the converted LaTeX", () => {
    const view = mount(true, "keep this");
    view.dispatch({ selection: { anchor: 5, head: 9 } });
    view.contentDOM.dispatchEvent(
      pasteEvent({ html: "<p><i>that</i></p>", text: "that" }),
    );

    expect(view.state.doc.toString()).toBe(String.raw`keep \textit{that}`);
  });
});
