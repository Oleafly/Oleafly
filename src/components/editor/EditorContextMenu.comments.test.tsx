// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { useCommentsRail } from "@/components/collab/comments-rail";
import { loadNamespace } from "@/i18n";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { shortcut } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const TEXT = "Some words here.\n   \n";

const editor = vi.hoisted(() => ({
  view: null as unknown,
}));

const controller = vi.hoisted(() => ({
  getEditorView: () => editor.view,
  insertAtCursor: () => undefined,
  wrapSelection: () => undefined,
}));

vi.mock("./cm/controller", () => controller);
vi.mock("@/components/editor/cm/controller", () => controller);

import { EditorContextMenu } from "./EditorContextMenu";

function viewWith(anchor: number, head = anchor) {
  editor.view = {
    state: EditorState.create({ doc: TEXT, selection: EditorSelection.single(anchor, head) }),
    posAtCoords: () => null,
    dispatch: vi.fn(),
  };
}

function engineWithProfile(profile: string): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: profile },
  } as DocumentEngineDescriptor;
}

function openMenu(engine: DocumentEngineDescriptor, activePath = "chapters/intro.tex") {
  cleanup();
  useFilesStore.setState({ engine, engineLoaded: true, projectKind: "", activePath });
  render(
    <EditorContextMenu>
      <div data-testid="editor-surface" />
    </EditorContextMenu>,
  );
  fireEvent.contextMenu(screen.getByTestId("editor-surface").parentElement as HTMLElement, { clientX: 5, clientY: 5 });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  viewWith(5, 10);
  useCommentsRail.setState({ visible: true, canCompose: true, request: null });
  useSettingsStore.setState({ railTab: "files", showTree: true, liveCollaboration: true });
});

afterEach(() => {
  cleanup();
  useCommentsRail.setState({ visible: false, canCompose: false, request: null });
  useSettingsStore.setState({ liveCollaboration: false });
});

describe("Comment in the editor menu", () => {
  it.each([
    ["LaTeX", LATEX_ENGINE, "chapters/intro.tex"],
    ["Typst", engineWithProfile("typst"), "chapters/intro.typ"],
    ["Markdown", engineWithProfile("markdown"), "chapters/intro.md"],
  ])("starts a comment on the selection from the %s menu", (_name, engine, path) => {
    openMenu(engine, path);
    const item = screen.getByTestId("context-comment");
    expect(item).toHaveTextContent(enCollab.comments.add);
    expect(item).toHaveTextContent(shortcut("⌘⌥M"));
    fireEvent.click(item);
    expect(useCommentsRail.getState().request).toEqual({ path, from: 5, to: 10, quote: "words" });
    expect(useSettingsStore.getState().railTab).toBe("comments");
  });

  it("is missing while the person cannot comment", () => {
    useCommentsRail.setState({ canCompose: false });
    openMenu(LATEX_ENGINE);
    expect(screen.queryByTestId("context-comment")).not.toBeInTheDocument();
  });

  it("is missing while live collaboration is off, even when the comment state allows it", () => {
    useSettingsStore.setState({ liveCollaboration: false });
    openMenu(LATEX_ENGINE);
    expect(screen.queryByTestId("context-comment")).not.toBeInTheDocument();
  });

  it("is disabled when there is no text to comment on", () => {
    viewWith(18);
    openMenu(LATEX_ENGINE);
    expect(screen.getByTestId("context-comment")).toHaveAttribute("data-disabled");
  });
});
