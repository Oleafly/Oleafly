// @vitest-environment jsdom

import { syntaxTree } from "@codemirror/language";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installEnglishEditorMessages } from "../../../test-messages";
import { loadTypstParser } from "../../../typst";
import { typstFormsGolden } from "../../../typst-forms-test-support";
import { hashBefore } from "../syntax";
import { typstState } from "../test-support";
import type { CommitResult } from "./commit";
import { FormFields, shortSummary } from "./FormFields";
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
  render(<FormFields model={modelOf(doc, fn)} readOnly={options.readOnly ?? false} onCommit={onCommit} onReveal={onReveal} />);
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
    expect(revision.type).toBe("number");
    expect(revision.min).toBe("1");
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
