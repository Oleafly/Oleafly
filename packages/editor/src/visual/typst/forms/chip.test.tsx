// @vitest-environment jsdom

import { history } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { remoteChange } from "../../../collaboration";
import { installEnglishEditorMessages } from "../../../test-messages";
import { loadTypstParser, typstLanguage } from "../../../typst";
import { staticTypstForms } from "../../../typst-forms";
import { typstFormsGolden } from "../../../typst-forms-test-support";
import { parsedView } from "../../test-document";
import { typstVisualMode } from "../index";
import { placementFor } from "./chip";

const ACME = '#import "@local/acme-report:0.1.0": *\n';
const DOC = `${ACME}The plan is #status-badge("review") for now, and #info-box[b] is inline too.`;

let view: EditorView | null = null;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installEnglishEditorMessages();
  await loadTypstParser();
  if (!globalThis.Range.prototype.getClientRects) {
    Object.defineProperty(globalThis.Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  }
});

afterEach(async () => {
  await act(async () => {
    view?.destroy();
  });
  view = null;
  document.body.replaceChildren();
});

async function mount(doc = DOC): Promise<EditorView> {
  const editor = await act(async () =>
    parsedView(
      new EditorView({
        state: EditorState.create({
          doc,
          selection: EditorSelection.cursor(0),
          extensions: [
            history(),
            typstLanguage(),
            typstVisualMode({ resolveImage: async () => null, typstForms: staticTypstForms(typstFormsGolden()) }, "report.typ"),
          ],
        }),
        parent: document.body,
      }),
    ),
  );
  await act(async () => {
    editor.dispatch({});
  });
  view = editor;
  return editor;
}

function chips(editor: EditorView): HTMLButtonElement[] {
  return Array.from(editor.dom.querySelectorAll<HTMLButtonElement>(".ofl-visual-form-chip-button"));
}

function popover(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[data-ofl-visual-form-popover] .ofl-visual-form-popover");
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("form chips", () => {
  it("labels the chip with the form and its summary", async () => {
    const editor = await mount();
    expect(chips(editor).map((chip) => chip.textContent)).toEqual(["Status: In review", "Info box"]);
  });

  it("opens the form in a popover and writes a choice back", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.click(chips(editor)[0]);
    });
    const panel = popover();
    expect(panel).not.toBeNull();
    expect(panel?.closest("[data-ofl-visual-form-popover]")?.className).toContain(editor.themeClasses.split(" ")[0]);
    const select = panel!.querySelector("select")!;
    await act(async () => {
      fireEvent.change(select, { target: { value: "approved" } });
    });
    await settle();
    expect(editor.state.doc.toString()).toBe(DOC.replace('"review"', '"approved"'));
    expect(chips(editor)[0].textContent).toBe("Status: Approved");
    expect(popover()).not.toBeNull();
  });

  it("closes on Escape and on a mousedown outside", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.click(chips(editor)[0]);
    });
    await act(async () => {
      fireEvent.keyDown(popover()!, { key: "Escape" });
    });
    expect(popover()).toBeNull();
    await act(async () => {
      fireEvent.click(chips(editor)[0]);
    });
    expect(popover()).not.toBeNull();
    await act(async () => {
      fireEvent.mouseDown(document.body);
    });
    expect(popover()).toBeNull();
  });

  it("commits a pending draft when a mousedown outside closes it", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.click(chips(editor)[1]);
    });
    const heading = popover()!.querySelector("input")!;
    heading.focus();
    await act(async () => {
      fireEvent.change(heading, { target: { value: "From the chip" } });
    });
    await act(async () => {
      fireEvent.mouseDown(document.body);
    });
    await settle();
    expect(popover()).toBeNull();
    expect(editor.state.doc.toString()).toContain('#info-box(title: "From the chip")[b]');
  });

  it("keeps its popover across rebuilds and drops it when the call goes away", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.click(chips(editor)[0]);
    });
    const panel = popover();
    await act(async () => {
      editor.dispatch({ changes: { from: ACME.length, insert: "Now " }, annotations: remoteChange.of(true) });
      parsedView(editor);
    });
    expect(popover()).toBe(panel);
    const start = editor.state.doc.toString().indexOf("#status-badge");
    await act(async () => {
      editor.dispatch({ changes: { from: start, to: start + '#status-badge("review")'.length }, annotations: remoteChange.of(true) });
      parsedView(editor);
    });
    await settle();
    expect(popover()).toBeNull();
  });
});

describe("the chip's popover", () => {
  it("opens below the chip, above it when there is more room there, and inside the window", () => {
    const viewport = { width: 800, height: 600 };
    const panel = { width: 420, height: 200 };
    expect(placementFor({ top: 100, bottom: 118, left: 50 }, panel, viewport)).toEqual({ top: 124, left: 50, maxHeight: 420 });
    expect(placementFor({ top: 500, bottom: 518, left: 700 }, panel, viewport)).toEqual({ top: 294, left: 374, maxHeight: 420 });
    expect(placementFor({ top: 100, bottom: 118, left: 50 }, { width: 420, height: 300 }, { width: 300, height: 200 }).top).toBe(6);
  });

  it("focuses the first field rather than Edit in source", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.click(chips(editor)[1]);
    });
    expect(document.activeElement).toBe(popover()!.querySelector(".ofl-visual-form-fields input"));
  });

  it("keeps Tab and Shift-Tab inside the popover", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.click(chips(editor)[1]);
    });
    const controls = Array.from(popover()!.querySelectorAll<HTMLElement>("input, select, textarea, button"));
    const last = controls[controls.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(controls[0]);
    fireEvent.keyDown(controls[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("stays open with the draft and its message when the draft can't be written", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.click(chips(editor)[1]);
    });
    const text = popover()!.querySelector("textarea")!;
    text.focus();
    await act(async () => {
      fireEvent.change(text, { target: { value: "Costs reached $5 million" } });
    });
    await act(async () => {
      fireEvent.mouseDown(document.body);
    });
    await settle();
    await settle();
    expect(popover()).not.toBeNull();
    expect(popover()!.querySelector("textarea")!.value).toBe("Costs reached $5 million");
    expect(popover()!.querySelector("output")?.textContent).toContain("Typst can't read this text");
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it("closes on Escape even after focus has left it", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.click(chips(editor)[0]);
    });
    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    await act(async () => {
      fireEvent.keyDown(outside, { key: "Escape" });
    });
    expect(popover()).toBeNull();
  });

  it("is named by what the chip shows, and marked as part of the form", async () => {
    const editor = await mount();
    expect(chips(editor)[0].getAttribute("aria-label")).toBe("Edit Status: In review");
    await act(async () => {
      fireEvent.click(chips(editor)[0]);
    });
    expect(popover()!.closest("[data-ofl-visual-form]")).not.toBeNull();
  });

  it("undoes in the document from a popover button the fields don't own", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.click(chips(editor)[0]);
    });
    await act(async () => {
      fireEvent.change(popover()!.querySelector("select")!, { target: { value: "approved" } });
    });
    await settle();
    expect(editor.state.doc.toString()).toBe(DOC.replace('"review"', '"approved"'));
    const reveal = popover()!.querySelector<HTMLButtonElement>(".ofl-visual-form-reveal")!;
    reveal.focus();
    await act(async () => {
      fireEvent.keyDown(reveal, { key: "z", metaKey: true });
    });
    expect(editor.state.doc.toString()).toBe(DOC);
  });
});
