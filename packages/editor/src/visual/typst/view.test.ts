// @vitest-environment jsdom

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installEnglishEditorMessages } from "../../test-messages";
import { loadTypstParser, typstLanguage } from "../../typst";
import { typstEditing } from "../../typst-editing";
import { parsedView, untilParsed } from "../test-document";
import { typstVisualMode } from "./index";
import { leaveTypstHeading } from "./keymap";
import { typstFromClipboard } from "./paste-html";
import { NO_PORTS } from "./test-support";

let view: EditorView | null = null;

beforeAll(async () => {
  installEnglishEditorMessages();
  await loadTypstParser();
  if (!globalThis.Range.prototype.getClientRects) {
    Object.defineProperty(globalThis.Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  }
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function mount(doc: string, cursor = doc.length, visual = true): EditorView {
  view = parsedView(
    new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(cursor),
        extensions: [
          typstLanguage(),
          typstEditing({ math: true, wrap: true }),
          visual ? typstVisualMode(NO_PORTS) : [],
        ],
      }),
      parent: document.body,
    }),
  );
  view.dispatch({});
  return view;
}

function pressEnter(editor: EditorView): void {
  const event = new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true });
  if (!runScopeHandlers(editor, event, "editor")) {
    editor.dispatch(editor.state.replaceSelection("\n"));
  }
}

function clipboard(html: string, text: string): DataTransfer {
  return {
    types: ["text/html", "text/plain"],
    files: { length: 0 },
    getData: (type: string) => (type === "text/html" ? html : text),
  } as unknown as DataTransfer;
}

describe("the Typst visual surface", () => {
  it("reveals the content once the Typst tree is ready and renders the constructs", async () => {
    const doc = '#set page(paper: "a4")\n\n= Results\nA *bold* claim#footnote[Source.] and $x$.\n';
    const editor = mount(doc, doc.length);
    await untilParsed(editor);
    expect(editor.dom.querySelector(".ofl-visual-preamble-widget")?.textContent).toContain("Show document settings");
    expect(editor.dom.querySelector(".ofl-visual-heading")?.textContent).toBe("Results");
    expect(editor.dom.querySelector(".ofl-visual-typst-heading-1")?.textContent).toBe("Results");
    expect(editor.dom.querySelector(".ofl-visual-footnote")).not.toBeNull();
    expect(editor.dom.querySelector(".ofl-visual-typst-strong")?.textContent).toBe("bold");
  });

  it("shows the heading marker when the cursor moves onto the heading", () => {
    const doc = "= Widgets\nBody text.";
    const editor = mount(doc, doc.length);
    expect(editor.dom.querySelector(".ofl-visual-typst-heading-1")?.textContent).toBe("Widgets");
    editor.dispatch({ selection: { anchor: 5 } });
    expect(editor.dom.querySelector(".ofl-visual-typst-heading-1")?.textContent).toBe("= Widgets");
  });

  it("keeps edits made in visual mode exact in the source", () => {
    const doc = "= Widgets\nBody *bold* text.";
    const editor = mount(doc, doc.length);
    editor.dispatch({ changes: { from: doc.indexOf("bold"), to: doc.indexOf("bold") + 4, insert: "strong" } });
    expect(editor.state.doc.toString()).toBe("= Widgets\nBody *strong* text.");
  });
});

describe("Typst visual editing keys", () => {
  it("leaves a heading on Enter at its end, past its label", () => {
    const doc = "= Title <intro>\nBody.";
    const editor = mount(doc, doc.indexOf(" <intro>"));
    expect(leaveTypstHeading(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("= Title <intro>\n\nBody.");
    expect(editor.state.selection.main.head).toBe("= Title <intro>\n".length);
  });

  it("does not split a heading from the middle", () => {
    const editor = mount("= Long title\nBody.", 4);
    expect(leaveTypstHeading(editor)).toBe(false);
  });

  it("continues a list on Enter and leaves it from an empty item", () => {
    const doc = "- first\n- second";
    const editor = mount(doc, doc.length);
    pressEnter(editor);
    expect(editor.state.doc.toString()).toBe("- first\n- second\n- ");
    pressEnter(editor);
    expect(editor.state.doc.toString()).not.toContain("\n- \n");
    expect(editor.state.doc.toString().startsWith("- first\n- second\n")).toBe(true);
  });

  it("continues a numbered list", () => {
    const doc = "+ one";
    const editor = mount(doc, doc.length);
    pressEnter(editor);
    expect(editor.state.doc.toString()).toBe("+ one\n+ ");
  });
});

describe("pasting HTML into visual Typst", () => {
  it("converts formatted HTML and leaves plain text to the default paste", () => {
    expect(typstFromClipboard(clipboard("<p>Hello <b>bold</b></p>", "Hello bold"))).toBe("Hello *bold*");
    expect(typstFromClipboard(clipboard("<p>plain</p>", "plain"))).toBeNull();
  });

  it("inserts the converted Typst on paste", () => {
    const editor = mount("Start ", 6);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboard("<p><i>it</i> <u>u</u></p>", "it u") });
    editor.contentDOM.dispatchEvent(event);
    expect(editor.state.doc.toString()).toBe("Start _it_ #underline[u]");
  });

  it("does not convert outside visual mode", () => {
    const editor = mount("Start ", 6, false);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboard("<p><i>it</i></p>", "it") });
    editor.contentDOM.dispatchEvent(event);
    expect(editor.state.doc.toString()).toBe("Start it");
  });
});
