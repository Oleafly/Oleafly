import { describe, it, expect, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  openInlineEdit,
  openInlineEditWithInstruction,
  resolveTargetRange,
  toggleInlineEdit,
} from "./openSession";
import { useInlineEditStore } from "@/store/inlineEdit";

describe("resolveTargetRange", () => {
  it("uses the selection when there is one", () => {
    const state = EditorState.create({ doc: "hello world", selection: { anchor: 0, head: 5 } });
    expect(resolveTargetRange(state)).toEqual({ from: 0, to: 5, original: "hello" });
  });

  it("falls back to the current line when the selection is empty", () => {
    const state = EditorState.create({ doc: "line one\nline two", selection: { anchor: 2, head: 2 } });
    const r = resolveTargetRange(state);
    expect(r.original).toBe("line one");
    expect(r).toMatchObject({ from: 0, to: 8 });
  });

  it("normalizes a backwards selection (head before anchor)", () => {
    const state = EditorState.create({ doc: "hello world", selection: { anchor: 5, head: 0 } });
    expect(resolveTargetRange(state)).toEqual({ from: 0, to: 5, original: "hello" });
  });
});

describe("toggleInlineEdit", () => {
  beforeEach(() => useInlineEditStore.getState().reset());

  it("opens a session when none is active", () => {
    const state = EditorState.create({ doc: "hello", selection: { anchor: 0, head: 5 } });
    toggleInlineEdit({ state } as EditorView);
    expect(useInlineEditStore.getState().session).toMatchObject({ from: 0, to: 5, original: "hello" });
  });

  it("closes the session when one is already open (toggle off)", () => {
    useInlineEditStore.getState().open({ from: 0, to: 1, original: "x" });
    toggleInlineEdit({} as EditorView);
    expect(useInlineEditStore.getState().session).toBeNull();
  });
});

function editorAt(doc: string, anchor: number, head = anchor, readOnly = false) {
  return {
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: EditorState.readOnly.of(readOnly),
    }),
  } as EditorView;
}

describe("openInlineEdit", () => {
  beforeEach(() => useInlineEditStore.getState().reset());

  it("refuses a read-only editor, a blank line and a second session", () => {
    openInlineEdit(editorAt("hello", 0, 5, true));
    expect(useInlineEditStore.getState().session).toBeNull();

    openInlineEdit(editorAt("   \nnext", 1));
    expect(useInlineEditStore.getState().session).toBeNull();

    openInlineEdit(editorAt("first", 0, 5));
    openInlineEdit(editorAt("second", 0, 6));
    expect(useInlineEditStore.getState().session).toMatchObject({ original: "first", autoRun: false });
  });
});

describe("openInlineEditWithInstruction", () => {
  beforeEach(() => useInlineEditStore.getState().reset());

  it("opens a session that runs the chosen instruction straight away", () => {
    expect(openInlineEditWithInstruction(editorAt("hello world", 0, 5), "Shorten")).toBe(true);
    expect(useInlineEditStore.getState().session).toMatchObject({
      from: 0,
      to: 5,
      original: "hello",
      instruction: "Shorten",
      autoRun: true,
      phase: "prompting",
    });
  });

  it("declines read-only editors, blank targets and a session already in flight", () => {
    expect(openInlineEditWithInstruction(editorAt("hello", 0, 5, true), "Shorten")).toBe(false);
    expect(openInlineEditWithInstruction(editorAt("  ", 1), "Shorten")).toBe(false);
    expect(useInlineEditStore.getState().session).toBeNull();
    useInlineEditStore.getState().open({ from: 0, to: 1, original: "x" });
    expect(openInlineEditWithInstruction(editorAt("hello", 0, 5), "Shorten")).toBe(false);
    expect(useInlineEditStore.getState().session?.original).toBe("x");
  });
});
