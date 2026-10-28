// @vitest-environment jsdom

import { syntaxTree } from "@codemirror/language";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installEnglishEditorMessages } from "../../../test-messages";
import { loadTypstParser } from "../../../typst";
import type { TypstFormField } from "../../../typst-forms";
import { typstFormsGolden } from "../../../typst-forms-test-support";
import { hashBefore } from "../syntax";
import { typstState } from "../test-support";
import type { CommitResult } from "./commit";
import { FormFields, shortSummary, steppedNumber } from "./FormFields";
import { type FieldEdit, readFormCall } from "./model";

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installEnglishEditorMessages();
  await loadTypstParser();
});

function modelOf(doc: string, fn: string) {
  const state = typstState(doc);
  let found: ReturnType<typeof readFormCall> = null;
  const definition = typstFormsGolden().forms.find((form) => form.function === fn);
  syntaxTree(state).iterate({
    enter(ref) {
      const hash = ref.name === "FuncCall" ? hashBefore(ref.node) : null;
      if (hash && definition && !found) found = readFormCall(state.doc, hash, ref.node, definition);
    },
  });
  if (!found) throw new Error("no model");
  return found;
}

function renderFields(doc: string, fn: string, options: { readOnly?: boolean; result?: CommitResult } = {}) {
  const onCommit = vi.fn(async (_field: number, _edit: FieldEdit): Promise<CommitResult> => options.result ?? { ok: true });
  const onReveal = vi.fn();
  render(<FormFields model={modelOf(doc, fn)} readOnly={options.readOnly ?? false} onCommit={onCommit} onReveal={onReveal} onHistory={vi.fn()} />);
  return { onCommit, onReveal };
}

describe("form field controls", () => {
  it("commits a text draft on Enter and reverts it on Escape", async () => {
    const { onCommit } = renderFields('#info-box(title: "a")[b]', "info-box");
    const heading = screen.getByLabelText("Heading") as HTMLInputElement;
    fireEvent.change(heading, { target: { value: "draft" } });
    fireEvent.keyDown(heading, { key: "Escape" });
    expect(heading.value).toBe("a");
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(heading, { target: { value: "new" } });
    await act(async () => {
      fireEvent.keyDown(heading, { key: "Enter" });
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0, { set: { type: "text", value: "new" } });
  });

  it("commits multi-line content on Mod-Enter or blur, not on Enter", async () => {
    const { onCommit } = renderFields('#info-box(title: "a")[b]', "info-box");
    const text = screen.getByLabelText("Text") as HTMLTextAreaElement;
    expect(text.tagName).toBe("TEXTAREA");
    fireEvent.change(text, { target: { value: "one\ntwo" } });
    fireEvent.keyDown(text, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(text, { key: "Enter", ctrlKey: true });
    });
    expect(onCommit).toHaveBeenCalledWith(2, { set: { type: "content", value: "one\ntwo" } });
  });

  it("leaves an unchanged draft alone on blur", async () => {
    const { onCommit } = renderFields('#info-box(title: "a")[b]', "info-box");
    const heading = screen.getByLabelText("Heading");
    fireEvent.change(heading, { target: { value: "a" } });
    await act(async () => {
      fireEvent.blur(heading);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("checks numbers before committing them", async () => {
    const { onCommit } = renderFields('#sign-off(name: "D")', "sign-off");
    const revision = screen.getByLabelText("Revision") as HTMLInputElement;
    expect(revision.type).toBe("text");
    expect(revision.inputMode).toBe("numeric");
    fireEvent.change(revision, { target: { value: "0" } });
    await act(async () => {
      fireEvent.blur(revision);
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("1");
    fireEvent.change(revision, { target: { value: "5" } });
    await act(async () => {
      fireEvent.blur(revision);
    });
    expect(onCommit).toHaveBeenCalledWith(1, { set: { type: "number", value: 5 } });
  });

  it("commits a choice at once and clears it with Not set", async () => {
    const { onCommit } = renderFields('#info-box(title: "a", tone: "risk")[b]', "info-box");
    const tone = screen.getByLabelText("Tone") as HTMLSelectElement;
    expect(Array.from(tone.options).map((option) => option.textContent)).toEqual(["Not set (default: Note)", "Note", "Risk", "neutral"]);
    await act(async () => {
      fireEvent.change(tone, { target: { value: "note" } });
    });
    expect(onCommit).toHaveBeenLastCalledWith(1, { set: { type: "choice", value: "note" } });
    await act(async () => {
      fireEvent.change(tone, { target: { value: "" } });
    });
    expect(onCommit).toHaveBeenLastCalledWith(1, { clear: true });
  });

  it("toggles a switch at once and offers to clear a set value", async () => {
    const { onCommit } = renderFields('#sign-off(name: "D", final: true)', "sign-off");
    const final = screen.getByRole("switch") as HTMLInputElement;
    expect(final.checked).toBe(true);
    await act(async () => {
      fireEvent.click(final);
    });
    expect(onCommit).toHaveBeenLastCalledWith(2, { set: { type: "toggle", value: false } });
    await act(async () => {
      fireEvent.click(screen.getAllByText("Clear")[0]);
    });
    expect(onCommit).toHaveBeenLastCalledWith(2, { clear: true });
  });

  it("shows read-only values with their source and a way to them", () => {
    const { onReveal } = renderFields("#info-box(title: data.title)[b]", "info-box");
    expect(screen.getByText("data.title")).toBeTruthy();
    fireEvent.click(screen.getByText("Edit in source"));
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("marks a missing required field and shows defaults", () => {
    renderFields("#info-box[b]", "info-box");
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
  });

  it("keeps the draft and explains a refused commit", async () => {
    const { onReveal } = renderFields('#info-box(title: "a")[b]', "info-box", { result: { ok: false, reason: "refused" } });
    const heading = screen.getByLabelText("Heading") as HTMLInputElement;
    fireEvent.change(heading, { target: { value: "kept" } });
    await act(async () => {
      fireEvent.keyDown(heading, { key: "Enter" });
    });
    expect(heading.value).toBe("kept");
    fireEvent.click(screen.getByText("Add in source"));
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("disables every control in a read-only document", () => {
    renderFields('#info-box(title: "a")[b]', "info-box", { readOnly: true });
    for (const label of ["Heading", "Tone", "Text"]) expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
  });

  it("shortens long summaries", () => {
    expect(shortSummary("a".repeat(50))).toBe(`${"a".repeat(39)}…`);
    expect(shortSummary("  two\n lines ")).toBe("two lines");
    expect(shortSummary("   ")).toBeNull();
    expect(shortSummary(null)).toBeNull();
  });
});

function renderDefinition(doc: string, fn: string, change: (field: TypstFormField) => TypstFormField) {
  const golden = typstFormsGolden().forms.find((form) => form.function === fn);
  if (!golden) throw new Error("no form");
  const definition = { ...golden, fields: golden.fields.map(change) };
  const state = typstState(doc);
  let model: ReturnType<typeof readFormCall> = null;
  syntaxTree(state).iterate({
    enter(ref) {
      const hash = ref.name === "FuncCall" ? hashBefore(ref.node) : null;
      if (hash && !model) model = readFormCall(state.doc, hash, ref.node, definition);
    },
  });
  if (!model) throw new Error("no model");
  const onCommit = vi.fn(async (): Promise<CommitResult> => ({ ok: true }));
  render(<FormFields model={model} readOnly={false} onCommit={onCommit} onReveal={vi.fn()} onHistory={vi.fn()} />);
  return { onCommit };
}

describe("form field keys and focus", () => {
  it("leaves Enter and Escape to an IME that is composing", async () => {
    const { onCommit } = renderFields('#info-box(title: "a")[b]', "info-box");
    const heading = screen.getByLabelText("Heading") as HTMLInputElement;
    fireEvent.change(heading, { target: { value: "結果" } });
    await act(async () => {
      fireEvent.keyDown(heading, { key: "Enter", isComposing: true });
      fireEvent.keyDown(heading, { key: "Enter", keyCode: 229 });
      fireEvent.keyDown(heading, { key: "Escape", keyCode: 229 });
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(heading.value).toBe("結果");
    await act(async () => {
      fireEvent.keyDown(heading, { key: "Enter" });
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0, { set: { type: "text", value: "結果" } });
  });

  it("reads typed number text itself, so bad input never clears the argument", async () => {
    const { onCommit } = renderFields('#sign-off(name: "D", revision: 3)', "sign-off");
    const revision = screen.getByLabelText("Revision") as HTMLInputElement;
    for (const typed of ["abc", "2,5", "3e"]) {
      fireEvent.change(revision, { target: { value: typed } });
      await act(async () => {
        fireEvent.blur(revision);
      });
      expect(revision.value).toBe(typed);
      expect(screen.getByRole("status").textContent).toBe("Enter a number.");
    }
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(revision, { target: { value: "" } });
    await act(async () => {
      fireEvent.blur(revision);
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(1, { clear: true });
  });

  it("steps a number with the arrow keys within its bounds", async () => {
    const { onCommit } = renderFields('#sign-off(name: "D", revision: 2)', "sign-off");
    const revision = screen.getByLabelText("Revision") as HTMLInputElement;
    fireEvent.keyDown(revision, { key: "ArrowUp" });
    expect(revision.value).toBe("3");
    fireEvent.keyDown(revision, { key: "ArrowDown" });
    fireEvent.keyDown(revision, { key: "ArrowDown" });
    fireEvent.keyDown(revision, { key: "ArrowDown" });
    expect(revision.value).toBe("1");
    await act(async () => {
      fireEvent.keyDown(revision, { key: "Enter" });
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(1, { set: { type: "number", value: 1 } });
  });

  it("undoes typing in the field, and anything else in the document", async () => {
    const onHistory = vi.fn();
    const execCommand = vi.fn(() => true);
    (document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;
    render(
      <FormFields
        model={modelOf('#info-box(title: "a", tone: "risk")[b]', "info-box")}
        readOnly={false}
        onCommit={vi.fn(async (): Promise<CommitResult> => ({ ok: true }))}
        onReveal={vi.fn()}
        onHistory={onHistory}
      />,
    );
    const heading = screen.getByLabelText("Heading") as HTMLInputElement;
    fireEvent.keyDown(heading, { key: "z", ctrlKey: true });
    expect(onHistory).toHaveBeenLastCalledWith("undo");
    fireEvent.change(heading, { target: { value: "typed" } });
    expect(heading.hasAttribute("data-ofl-form-draft")).toBe(true);
    fireEvent.keyDown(heading, { key: "z", metaKey: true });
    expect(execCommand).toHaveBeenLastCalledWith("undo");
    expect(onHistory).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByLabelText("Tone"), { key: "z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(screen.getByLabelText("Tone"), { key: "y", ctrlKey: true });
    expect(onHistory.mock.calls.map(([command]) => command)).toEqual(["undo", "redo", "redo"]);
  });

  it("offers Not set only where choosing it can remove the argument", () => {
    renderDefinition('#status-badge("review")', "status-badge", (field) => ({ ...field, required: false }));
    const status = screen.getByLabelText("Status") as HTMLSelectElement;
    expect(Array.from(status.options).map((option) => option.value)).not.toContain("");
  });

  it("moves focus to the field once Clear has removed its value", async () => {
    renderFields('#info-box(title: "a", tone: "risk")[b]', "info-box");
    await act(async () => {
      fireEvent.click(screen.getByText("Clear"));
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Tone"));
  });

  it("hides the reveal actions in a read-only document", () => {
    renderFields("#info-box(title: data.title)[b]", "info-box", { readOnly: true });
    expect(screen.queryByText("Edit in source")).toBeNull();
  });

  it("says when the document can't be edited", async () => {
    renderFields('#info-box(title: "a")[b]', "info-box", { result: { ok: false, reason: "readOnly" } });
    const heading = screen.getByLabelText("Heading") as HTMLInputElement;
    fireEvent.change(heading, { target: { value: "x" } });
    await act(async () => {
      fireEvent.keyDown(heading, { key: "Enter" });
    });
    expect(screen.getByRole("status").textContent).toBe("This document can't be edited right now.");
    expect(heading.value).toBe("x");
  });

  it("commits a draft once its field scrolls out of the editor", async () => {
    const scroller = document.createElement("div");
    scroller.className = "cm-scroller";
    document.body.appendChild(scroller);
    const onCommit = vi.fn(async (): Promise<CommitResult> => ({ ok: true }));
    render(
      <FormFields
        model={modelOf('#info-box(title: "a")[b]', "info-box")}
        readOnly={false}
        onCommit={onCommit}
        onReveal={vi.fn()}
        onHistory={vi.fn()}
      />,
      { container: scroller.appendChild(document.createElement("div")) },
    );
    const heading = screen.getByLabelText("Heading") as HTMLInputElement;
    heading.focus();
    fireEvent.change(heading, { target: { value: "kept" } });
    scroller.getBoundingClientRect = () => ({ top: 100, bottom: 400 }) as DOMRect;
    heading.getBoundingClientRect = () => ({ top: 150, bottom: 170 }) as DOMRect;
    fireEvent.scroll(window);
    expect(onCommit).not.toHaveBeenCalled();
    heading.getBoundingClientRect = () => ({ top: -900, bottom: -880 }) as DOMRect;
    await act(async () => {
      fireEvent.scroll(window);
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0, { set: { type: "text", value: "kept" } });
    scroller.remove();
  });
});

describe("summaries and steps", () => {
  it("cuts a long summary between characters, never inside one", () => {
    const emoji = shortSummary("😀".repeat(50));
    expect(emoji).toBe(`${"😀".repeat(39)}…`);
    expect(shortSummary("👩‍👩‍👧‍👦".repeat(40))).toBe("👩‍👩‍👧‍👦".repeat(40));
    expect(shortSummary(`${"a".repeat(38)}é😀 more`)).toBe(`${"a".repeat(38)}é…`);
  });

  it("steps from the default or the minimum when the field is empty", () => {
    const kind = { type: "number", integer: true, min: 1, max: 5, step: 2, default: null } as const;
    expect(steppedNumber(kind, "", 1)).toBe("1");
    expect(steppedNumber(kind, "4", 1)).toBe("5");
    expect(steppedNumber(kind, "x", 1)).toBeNull();
    expect(steppedNumber({ ...kind, integer: false, step: 0.1, min: null, max: null }, "0.2", 1)).toBe("0.3");
  });
});
