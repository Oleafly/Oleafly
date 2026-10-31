// @vitest-environment jsdom

import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { remoteChange } from "../../../collaboration";
import { installEnglishEditorMessages } from "../../../test-messages";
import { loadTypstParser, typstLanguage } from "../../../typst";
import { staticTypstForms, type TypstFormCatalog } from "../../../typst-forms";
import { typstFormsGolden } from "../../../typst-forms-test-support";
import { parsedView } from "../../test-document";
import { typstVisualMode } from "../index";
import { history } from "@codemirror/commands";
import { stubRangeGeometry } from "../../../test-geometry";

const created = vi.hoisted(() => ({ count: 0, renders: 0 }));

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      created.count += 1;
      const root = actual.createRoot(...args);
      const render = root.render.bind(root);
      root.render = (node) => {
        created.renders += 1;
        render(node);
      };
      return root;
    },
  };
});

const ACME = '#import "@local/acme-report:0.1.0": *\n';
const DOC = `${ACME}Intro.

#info-box(title: "Key result", tone: "note")[Deliveries rose.]

#sign-off(name: "Dana", revision: 3)
Outro.`;

let view: EditorView | null = null;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installEnglishEditorMessages();
  await loadTypstParser();
  stubRangeGeometry();
});

afterEach(async () => {
  await act(async () => {
    view?.destroy();
  });
  view = null;
  document.body.replaceChildren();
});

async function mount(
  doc = DOC,
  options: { catalog?: TypstFormCatalog; readOnly?: boolean; extensions?: Extension[] } = {},
): Promise<EditorView> {
  const port = staticTypstForms(options.catalog ?? typstFormsGolden());
  const editor = await act(async () =>
    parsedView(
      new EditorView({
        state: EditorState.create({
          doc,
          selection: EditorSelection.cursor(0),
          extensions: [
            history(),
            typstLanguage(),
            typstVisualMode({ resolveImage: async () => null, typstForms: port }, "report.typ"),
            EditorState.readOnly.of(options.readOnly ?? false),
            ...(options.extensions ?? []),
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

function card(editor: EditorView, index = 0): HTMLElement {
  const found = editor.dom.querySelectorAll<HTMLElement>(".ofl-visual-form-card")[index];
  if (!found) throw new Error("no form card rendered");
  return found;
}

function input(root: HTMLElement, label: string): HTMLInputElement {
  const target = Array.from(root.querySelectorAll("label")).find((element) => element.textContent === label);
  const control = target ? root.querySelector<HTMLInputElement>(`#${CSS.escape(target.htmlFor)}`) : null;
  if (!control) throw new Error(`no control labelled ${label}`);
  return control;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the form card", () => {
  it("renders the definition's label, summary and field values", async () => {
    const editor = await mount();
    const box = card(editor);
    expect(box.querySelector(".ofl-visual-form-title")?.textContent).toBe("Info box");
    expect(box.querySelector(".ofl-visual-form-summary")?.textContent).toBe("Key result");
    expect(input(box, "Heading").value).toBe("Key result");
    expect(input(box, "Tone").value).toBe("note");
    expect(input(box, "Text").value).toBe("Deliveries rose.");
  });

  it("keeps one React root per card across rebuilds", async () => {
    const editor = await mount();
    const before = created.count;
    for (let round = 0; round < 20; round += 1) {
      await act(async () => {
        editor.dispatch({ selection: EditorSelection.cursor(round % 2 === 0 ? 1 : 2) });
      });
    }
    expect(created.count).toBe(before);
  });

  it("renders author text as text", async () => {
    const golden = typstFormsGolden();
    const hostile: TypstFormCatalog = {
      ...golden,
      forms: golden.forms.map((form) => (form.function === "info-box" ? { ...form, label: "<img src=x onerror=alert(1)>" } : form)),
    };
    const editor = await mount(DOC, { catalog: hostile });
    expect(card(editor).querySelector(".ofl-visual-form-title")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(editor.dom.querySelector("img")).toBeNull();
  });

  it("shows raw source when a definition breaks while rendering", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const golden = typstFormsGolden();
    const broken = {
      ...golden,
      forms: golden.forms.map((form) =>
        form.function === "info-box" ? { ...form, label: { not: "text" } } : form,
      ),
    } as unknown as TypstFormCatalog;
    const editor = await mount(DOC, { catalog: broken });
    expect(editor.dom.querySelector(".ofl-visual-form-error pre")?.textContent).toContain('#info-box(title: "Key result"');
    error.mockRestore();
  });

  it("shows raw source when reading the call fails, without breaking the editor's update", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const golden = typstFormsGolden();
    const broken = {
      ...golden,
      forms: golden.forms.map((form) =>
        form.function === "info-box"
          ? { ...form, fields: form.fields.map((field) => (field.label === "Tone" ? { ...field, kind: { type: "date" } } : field)) }
          : form,
      ),
    } as unknown as TypstFormCatalog;
    const editor = await mount(DOC, { catalog: broken });
    expect(card(editor).querySelector("pre.ofl-visual-form-source")?.textContent).toContain('#info-box(title: "Key result"');
    expect(card(editor, 1).querySelector(".ofl-visual-form-title")?.textContent).toBe("Sign-off");
    error.mockRestore();
  });

  it("selects the call when asked to edit it as source", async () => {
    const editor = await mount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(card(editor).querySelector(".ofl-visual-form-reveal")!);
    });
    const from = DOC.indexOf("#info-box");
    expect(editor.state.selection.main.from).toBe(from);
    expect(editor.state.selection.main.to).toBe(DOC.indexOf("[Deliveries rose.]") + "[Deliveries rose.]".length);
  });
});

describe("editing card fields", () => {
  it("commits a text field on Enter as one undo step", async () => {
    const editor = await mount();
    const heading = input(card(editor), "Heading");
    await act(async () => {
      fireEvent.focus(heading);
      fireEvent.change(heading, { target: { value: "New result" } });
      fireEvent.keyDown(heading, { key: "Enter" });
    });
    await settle();
    expect(editor.state.doc.toString()).toBe(DOC.replace('"Key result"', '"New result"'));
    await act(async () => {
      undo(editor);
    });
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it("keeps one React root across 20 commits", async () => {
    const editor = await mount();
    const before = created.count;
    for (let round = 0; round < 20; round += 1) {
      const heading = input(card(editor), "Heading");
      await act(async () => {
        fireEvent.change(heading, { target: { value: `Round ${round}` } });
        fireEvent.keyDown(heading, { key: "Enter" });
      });
      await settle();
    }
    expect(editor.state.doc.toString()).toContain('title: "Round 19"');
    expect(created.count).toBe(before);
  });

  it("commits once on a mousedown outside the form", async () => {
    const editor = await mount();
    const dispatch = vi.spyOn(editor, "dispatch");
    const heading = input(card(editor), "Heading");
    heading.focus();
    await act(async () => {
      fireEvent.change(heading, { target: { value: "Outside" } });
    });
    await act(async () => {
      fireEvent.mouseDown(editor.contentDOM);
      heading.blur();
    });
    await settle();
    const edits = dispatch.mock.calls.filter(([spec]) => (spec as { userEvent?: string }).userEvent === "input.form");
    expect(edits).toHaveLength(1);
    expect(editor.state.doc.toString()).toContain('title: "Outside"');
  });

  it("commits once when focus leaves, and Escape puts the value back", async () => {
    const editor = await mount();
    const dispatch = vi.spyOn(editor, "dispatch");
    const heading = input(card(editor), "Heading");
    await act(async () => {
      fireEvent.change(heading, { target: { value: "Draft" } });
      fireEvent.keyDown(heading, { key: "Escape" });
    });
    expect(input(card(editor), "Heading").value).toBe("Key result");
    await act(async () => {
      fireEvent.change(heading, { target: { value: "Blurred" } });
      fireEvent.blur(heading);
    });
    await settle();
    const edits = dispatch.mock.calls.filter(([spec]) => (spec as { userEvent?: string }).userEvent === "input.form");
    expect(edits).toHaveLength(1);
    expect(editor.state.doc.toString()).toContain('title: "Blurred"');
  });

  it("commits a choice and a toggle at once", async () => {
    const editor = await mount();
    await act(async () => {
      fireEvent.change(input(card(editor), "Tone"), { target: { value: "risk" } });
    });
    await settle();
    expect(editor.state.doc.toString()).toContain('tone: "risk"');
    await act(async () => {
      fireEvent.click(input(card(editor, 1), "Final version"));
    });
    await settle();
    expect(editor.state.doc.toString()).toContain('#sign-off(name: "Dana", revision: 3, final: true)');
  });

  it("keeps the focused field and its draft across a collaborator's edit", async () => {
    const editor = await mount();
    const heading = input(card(editor), "Heading");
    heading.focus();
    await act(async () => {
      fireEvent.change(heading, { target: { value: "Half typed" } });
    });
    await act(async () => {
      editor.dispatch({ changes: { from: ACME.length, insert: "Remote words. " }, annotations: remoteChange.of(true) });
      parsedView(editor);
    });
    const after = input(card(editor), "Heading");
    expect(after).toBe(heading);
    expect(document.activeElement).toBe(heading);
    expect(after.value).toBe("Half typed");
    await act(async () => {
      fireEvent.keyDown(after, { key: "Enter" });
    });
    await settle();
    expect(editor.state.doc.toString()).toContain('Remote words. Intro.\n\n#info-box(title: "Half typed"');
  });

  it("brings a draft back when a collaborator's half-typed argument hides the card for a while", async () => {
    const editor = await mount();
    const heading = input(card(editor), "Heading");
    heading.focus();
    await act(async () => {
      fireEvent.change(heading, { target: { value: "Half typed" } });
    });
    const at = editor.state.doc.toString().indexOf("[Deliveries");
    await act(async () => {
      editor.dispatch({ changes: { from: at - 1, insert: ", author:" }, annotations: remoteChange.of(true) });
      parsedView(editor);
    });
    await settle();
    expect(editor.dom.querySelectorAll(".ofl-visual-form-card")).toHaveLength(1);
    await act(async () => {
      editor.dispatch({ changes: { from: at - 1 + ", author:".length, insert: ' "B"' }, annotations: remoteChange.of(true) });
      parsedView(editor);
    });
    await settle();
    const restored = input(card(editor), "Heading");
    expect(restored).not.toBe(heading);
    expect(restored.value).toBe("Half typed");
    await act(async () => {
      fireEvent.keyDown(restored, { key: "Enter" });
    });
    await settle();
    expect(editor.state.doc.toString()).toContain('#info-box(title: "Half typed", tone: "note", author: "B")');
  });

  it.each([
    ["next to the call, so CodeMirror reuses the card", "\n\n#info-box", "\n\n#info-box", true],
    ["from further away, so CodeMirror draws a new card", "Intro.", "Intra.", false],
  ])("keeps a working draft when an outside rewrite starts %s", async (_case, start, replacement, reused) => {
    const editor = await mount();
    const heading = input(card(editor), "Heading");
    heading.focus();
    await act(async () => {
      fireEvent.change(heading, { target: { value: "Half typed" } });
    });
    const text = editor.state.doc.toString();
    const from = text.indexOf(start);
    const to = text.indexOf("revision: 3") + "revision: 3".length;
    const rewritten = text.slice(from, to).replace(start, replacement).replace("revision: 3", "revision: 4");
    await act(async () => {
      editor.dispatch({ changes: { from, to, insert: rewritten } });
      parsedView(editor);
    });
    await settle();
    const after = input(card(editor), "Heading");
    expect(after === heading).toBe(reused);
    expect(after.value).toBe("Half typed");
    await act(async () => {
      fireEvent.keyDown(after, { key: "Enter" });
    });
    await settle();
    expect(editor.state.doc.toString()).toContain('#info-box(title: "Half typed"');
    expect(editor.state.doc.toString()).toContain("revision: 4");
  });

  it("dispatches nothing when a card with a draft goes away", async () => {
    const editor = await mount();
    const heading = input(card(editor), "Heading");
    await act(async () => {
      fireEvent.change(heading, { target: { value: "Lost" } });
    });
    const start = DOC.indexOf("#info-box");
    await act(async () => {
      editor.dispatch({ changes: { from: start, to: DOC.indexOf("\n\n#sign-off") } });
      parsedView(editor);
      fireEvent.blur(heading);
    });
    await settle();
    expect(editor.state.doc.toString()).not.toContain("Lost");
  });

  it("disables the controls of a read-only document", async () => {
    const editor = await mount(DOC, { readOnly: true });
    expect(input(card(editor), "Heading").disabled).toBe(true);
    expect(input(card(editor), "Tone").disabled).toBe(true);
  });

  it("keeps keys typed in a field away from the vim keymap", async () => {
    const editor = await mount(DOC, { extensions: [vim()] });
    const heading = input(card(editor), "Heading");
    heading.focus();
    await act(async () => {
      fireEvent.keyDown(heading, { key: "x" });
      fireEvent.keyDown(heading, { key: "d" });
      fireEvent.keyDown(heading, { key: "d" });
    });
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it("keeps clicks inside a card from moving the editor selection", async () => {
    const editor = await mount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });
    });
    const transactions = vi.spyOn(editor, "dispatch");
    await act(async () => {
      fireEvent.mouseDown(input(card(editor), "Heading"), { button: 0 });
      fireEvent.mouseUp(input(card(editor), "Heading"), { button: 0 });
    });
    expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
    expect(transactions).not.toHaveBeenCalled();
  });
});

describe("form cards in the app", () => {
  it("labels the card as a group whose keys the app's shortcuts leave alone", async () => {
    const editor = await mount();
    const box = card(editor);
    expect(box.getAttribute("role")).toBe("group");
    expect(box.getAttribute("aria-label")).toBe("Info box");
    expect(box.hasAttribute("data-ofl-visual-form")).toBe(true);
  });

  it("keeps focus on a clicked switch or button, where WebKit would move it into the document", async () => {
    const editor = await mount();
    const signOff = card(editor, 1);
    const toggle = signOff.querySelector<HTMLInputElement>("[role='switch']")!;
    expect(fireEvent.mouseDown(toggle)).toBe(false);
    expect(document.activeElement).toBe(toggle);
    const clear = Array.from(signOff.querySelectorAll("button")).find((button) => button.textContent === "Clear")!;
    expect(fireEvent.mouseDown(clear)).toBe(false);
    expect(document.activeElement).toBe(clear);
    expect(fireEvent.mouseDown(signOff.querySelector(".ofl-visual-form-title")!)).toBe(false);
    expect(fireEvent.mouseDown(input(signOff, "Signed by"))).toBe(true);
  });

  it("doesn't redraw a card that typing above only moved, and still reveals its source", async () => {
    const editor = await mount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const before = created.renders;
    for (const letter of "Hello ") {
      await act(async () => {
        editor.dispatch({ changes: { from: ACME.length, insert: letter } });
      });
    }
    expect(created.renders).toBe(before);
    await act(async () => {
      fireEvent.click(card(editor).querySelector(".ofl-visual-form-reveal")!);
    });
    const text = editor.state.doc.toString();
    expect(editor.state.selection.main.from).toBe(text.indexOf("#info-box"));
    expect(editor.state.selection.main.to).toBe(text.indexOf("[Deliveries rose.]") + "[Deliveries rose.]".length);
  });

  it("undoes the last commit from inside the field", async () => {
    const editor = await mount();
    const heading = input(card(editor), "Heading");
    heading.focus();
    await act(async () => {
      fireEvent.change(heading, { target: { value: "New result" } });
      fireEvent.keyDown(heading, { key: "Enter" });
    });
    await settle();
    expect(editor.state.doc.toString()).toContain('"New result"');
    await act(async () => {
      fireEvent.keyDown(input(card(editor), "Heading"), { key: "z", ctrlKey: true });
    });
    expect(editor.state.doc.toString()).toBe(DOC);
    expect(input(card(editor), "Heading").value).toBe("Key result");
  });

  it("undoes from a card's own buttons too", async () => {
    const editor = await mount();
    const heading = input(card(editor), "Heading");
    await act(async () => {
      fireEvent.change(heading, { target: { value: "New result" } });
      fireEvent.keyDown(heading, { key: "Enter" });
    });
    await settle();
    const reveal = card(editor).querySelector<HTMLButtonElement>(".ofl-visual-form-reveal")!;
    reveal.focus();
    await act(async () => {
      fireEvent.keyDown(reveal, { key: "z", ctrlKey: true });
    });
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it("offers no way to the source in a read-only document", async () => {
    const editor = await mount(DOC, { readOnly: true });
    expect(card(editor).querySelector(".ofl-visual-form-reveal")).toBeNull();
  });
});
