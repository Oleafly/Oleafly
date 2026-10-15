// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useCommentsRail } from "@/components/collab/comments-rail";
import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const controller = vi.hoisted(() => ({ getEditorView: vi.fn<() => unknown>(() => null) }));

vi.mock("@/components/editor/cm/controller", () => controller);
vi.mock("@/components/editor/cm/inline-ai/openSession", () => ({ openInlineEditWithInstruction: vi.fn(() => true) }));
vi.mock("@/features/assistant-handoff", () => ({ handoffToAssistant: vi.fn() }));

import { SelectionActionMenu } from "./SelectionActionMenu";

function editorView() {
  return {
    hasFocus: true,
    state: EditorState.create({ doc: "A selected phrase.", selection: EditorSelection.single(2, 10) }),
    coordsAtPos: () => ({ top: 120, left: 40, bottom: 136, right: 90 }),
  };
}

function showMenu() {
  render(<SelectionActionMenu />);
  act(() => {
    window.dispatchEvent(new Event("mouseup"));
  });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  controller.getEditorView.mockReturnValue(editorView());
  useFilesStore.setState({ projectId: "paper", activePath: "intro.tex" });
  useSettingsStore.setState({ railTab: "files", showTree: true, liveCollaboration: true });
  useCommentsRail.setState({ visible: true, canCompose: true, request: null });
});

afterEach(() => {
  useCommentsRail.setState({ visible: false, canCompose: false, request: null });
  useSettingsStore.setState({ liveCollaboration: false });
});

describe("Comment in the selection menu", () => {
  it("sits beside Ask AI and starts a comment on the selection", () => {
    showMenu();
    expect(screen.getByRole("button", { name: en.selectionActions.askAi })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enCollab.comments.add }));
    expect(useCommentsRail.getState().request).toEqual({ path: "intro.tex", from: 2, to: 10, quote: "selected" });
    expect(useSettingsStore.getState().railTab).toBe("comments");
    expect(screen.queryByRole("button", { name: enCollab.comments.add })).not.toBeInTheDocument();
  });

  it("is left out while live collaboration is off, even when the comment state allows it", () => {
    useSettingsStore.setState({ liveCollaboration: false });
    showMenu();
    expect(screen.getByRole("button", { name: en.selectionActions.askAi })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enCollab.comments.add })).not.toBeInTheDocument();
  });

  it("is left out while the person cannot comment", () => {
    useCommentsRail.setState({ canCompose: false });
    showMenu();
    expect(screen.getByRole("button", { name: en.selectionActions.askAi })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enCollab.comments.add })).not.toBeInTheDocument();
  });
});
