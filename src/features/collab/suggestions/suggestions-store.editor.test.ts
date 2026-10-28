// @vitest-environment jsdom

import { act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorDocumentPath, setEditorView } from "@oleafly/editor";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { useCommentsRail } from "@/components/collab/comments-rail";
import { loadNamespace } from "@/i18n";
import type { CollabSuggestionList } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, BOB, CAROL_ID, fill, person, projectMember, shareInfo } from "../tests/fixtures";
import { SUGGESTED_AT, suggestion, suggestionList } from "../tests/suggestion-fixtures";
import { suggestionSpansIn } from "./editor-suggestions";

const mocks = vi.hoisted(() => ({
  collabSuggestionList: vi.fn(),
  collabSuggestionCounts: vi.fn(),
  installed: vi.fn(),
  scroll: vi.fn(),
  openFile: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabSuggestionList: mocks.collabSuggestionList,
  collabSuggestionCounts: mocks.collabSuggestionCounts,
}));

vi.mock("@oleafly/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/editor")>()),
  scrollEditorPositionLocally: mocks.scroll,
}));

vi.mock("@/lib/collab-live-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collab-live-bridge")>()),
  collabDocumentSession: () => null,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

vi.mock("@/components/editor/cm/suggestions-slot", () => ({
  setSuggestionsEditorExtension: (extension: unknown) => {
    mocks.installed(extension);
    return () => undefined;
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { infoUnique: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import {
  byPosition,
  hoverSuggestion,
  openSuggestionIn,
  pendingIn,
  selectSuggestion,
  startSuggestions,
  suggestionSelf,
  useSuggestions,
} from "./suggestions-store";

const copy = enCollab.suggestions;
const DOC = "The quick brown fox jumps.";
const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner")];
const RETRY_REVEAL = 120;

const QUICK = suggestion("s-quick");
const LAZY = suggestion("s-lazy", { kind: "delete", from: 16, to: 21, text: "lazy ", author: ALICE_ID });
const JUMPS = suggestion("s-jumps", { from: 20, to: 25, text: "jumps", verified: false });
const BROWN = suggestion("s-brown", { from: 10, to: 15, text: "brown", author: CAROL_ID });
const METHOD = suggestion("m1", { fileId: "file-methods", from: 2, to: 6, text: "e qu" });

let stop: (() => void) | null = null;
const views: EditorView[] = [];

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function start() {
  stop = startSuggestions();
  await settle();
}

async function mount(): Promise<EditorView> {
  const extension = mocks.installed.mock.calls.at(-1)?.[0] as Extension;
  const view = new EditorView({ state: EditorState.create({ doc: DOC, extensions: extension }), parent: document.body });
  views.push(view);
  act(() => {
    setEditorView(view);
    setEditorDocumentPath("intro.tex");
  });
  await settle();
  return view;
}

function mark(view: EditorView, id: string): HTMLElement {
  const found = view.contentDOM.querySelector<HTMLElement>(`[data-suggestion-id="${id}"]`);
  if (!found) throw new Error(`no mark for ${id}`);
  return found;
}

function listsBy(byPath: Record<string, CollabSuggestionList>) {
  mocks.collabSuggestionList.mockImplementation(async (_project: string, path: string) => byPath[path] ?? suggestionList([]));
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.resetAllMocks();
  listsBy({ "intro.tex": suggestionList([QUICK, LAZY]), "methods.tex": suggestionList([METHOD]) });
  mocks.collabSuggestionCounts.mockResolvedValue([]);
  mocks.openFile.mockResolvedValue(undefined);
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useFilesStore.setState({ projectId: "paper", activePath: "intro.tex", openFile: mocks.openFile });
  useCollabLiveStore.setState({
    projectId: "paper",
    share: shareInfo({ project_id: "paper", role: "editor", account_id: ALICE_ID }),
    role: "editor",
    status: { state: "online" },
    members: MEMBERS,
  });
});

afterEach(() => {
  stop?.();
  stop = null;
  for (const view of views.splice(0)) view.destroy();
  setEditorView(null);
  vi.useRealTimers();
  useSuggestions.setState({ projectId: null, path: null, suggestions: [], selectedId: null, hoveredId: null });
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
  useCommentsRail.setState({ visible: false, suggestions: false, unread: false, canCompose: false });
});

describe("suggestion helpers", () => {
  it("orders suggestions by where they start, then where they end, then by age", () => {
    const later = suggestion("later", { from: 4, to: 9, createdAt: SUGGESTED_AT + 2 });
    const earlier = suggestion("earlier", { from: 4, to: 9, createdAt: SUGGESTED_AT + 1 });
    const shorter = suggestion("shorter", { from: 4, to: 6 });
    const first = suggestion("first", { from: 1, to: 20 });
    expect(byPosition([later, earlier, shorter, first]).map((entry) => entry.id)).toEqual([
      "first",
      "shorter",
      "earlier",
      "later",
    ]);
  });

  it("counts what waits in one file, and nothing for a file it hasn't heard of", () => {
    expect(pendingIn({ counts: null }, "intro.tex")).toBe(0);
    expect(pendingIn({ counts: [{ path: "intro.tex", pending: 3 }] }, "intro.tex")).toBe(3);
    expect(pendingIn({ counts: [{ path: "intro.tex", pending: 3 }] }, "refs.tex")).toBe(0);
  });

  it("knows who the person is only while the project is shared", () => {
    expect(suggestionSelf()).toBe(ALICE_ID);
    useCollabLiveStore.setState({ share: null });
    expect(suggestionSelf()).toBeNull();
  });
});

describe("suggestions in the editor", () => {
  it("labels each suggestion with who made it, or says the author couldn't be verified", async () => {
    listsBy({ "intro.tex": suggestionList([QUICK, LAZY, JUMPS, BROWN]) });
    await start();
    const view = await mount();
    expect(mark(view, "s-quick").title).toBe(fill(copy.insertedBy, { name: "Bob Smith" }));
    expect(mark(view, "s-lazy").title).toBe(fill(copy.deletedBy, { name: "Alice Chen" }));
    expect(mark(view, "s-lazy").tagName).toBe("DEL");
    expect(mark(view, "s-jumps").title).toBe(copy.unverifiedLabel);
    expect(mark(view, "s-brown").title).toBe(fill(copy.insertedBy, { name: enCollab.toolbar.unknownPerson }));
    expect(suggestionSpansIn(view.state).find((span) => span.id === "s-lazy")).toMatchObject({ from: 16, to: 16 });
  });

  it("highlights the suggestion under the pointer and falls back to the selected one", async () => {
    await start();
    const view = await mount();
    act(() => selectSuggestion("s-lazy"));
    await settle();
    expect(mark(view, "s-lazy").classList).toContain("cm-suggestion-active");
    const focus = useSuggestions.getState().focus;
    act(() => {
      mark(view, "s-quick").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ hoveredId: "s-quick", focus: focus + 1 });
    expect(mark(view, "s-quick").classList).toContain("cm-suggestion-active");
    expect(mark(view, "s-lazy").classList).not.toContain("cm-suggestion-active");
    const hovered = useSuggestions.getState();
    act(() => hoverSuggestion("s-quick"));
    expect(useSuggestions.getState()).toBe(hovered);
    act(() => {
      view.contentDOM.dispatchEvent(new MouseEvent("mouseleave"));
    });
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ hoveredId: null, focus: focus + 1 });
    expect(mark(view, "s-lazy").classList).toContain("cm-suggestion-active");
  });

  it("selects a suggestion clicked in the editor without opening a hidden side panel", async () => {
    useSettingsStore.setState({ showTree: false, railTab: "files" });
    await start();
    const view = await mount();
    act(() => {
      mark(view, "s-quick").dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(useSuggestions.getState().selectedId).toBe("s-quick");
    expect(useSettingsStore.getState()).toMatchObject({ showTree: false, railTab: "files" });
  });

  it("scrolls the editor to a suggestion picked in the open file", async () => {
    await start();
    const view = await mount();
    act(() => openSuggestionIn("intro.tex", "s-lazy"));
    await settle();
    expect(useSuggestions.getState().selectedId).toBe("s-lazy");
    expect(mocks.scroll).toHaveBeenCalledWith(view, 16);
    expect(mocks.openFile).not.toHaveBeenCalled();
  });

  it("tries once more to reveal a suggestion when the editor wasn't showing its file yet", async () => {
    await start();
    const view = await mount();
    act(() => setEditorDocumentPath("methods.tex"));
    act(() => selectSuggestion("s-quick", { reveal: true }));
    await settle();
    expect(mocks.scroll).not.toHaveBeenCalled();
    act(() => setEditorDocumentPath("intro.tex"));
    await settle(RETRY_REVEAL);
    expect(mocks.scroll).toHaveBeenCalledTimes(1);
    expect(mocks.scroll).toHaveBeenCalledWith(view, 4);
  });

  it("reveals nothing without an editor or a loaded file", async () => {
    act(() => selectSuggestion("s-quick", { reveal: true }));
    await settle(RETRY_REVEAL);
    expect(useSuggestions.getState().selectedId).toBe("s-quick");
    const plain = new EditorView({ state: EditorState.create({ doc: DOC }), parent: document.body });
    views.push(plain);
    act(() => {
      setEditorView(plain);
      setEditorDocumentPath("intro.tex");
    });
    act(() => selectSuggestion("s-quick", { reveal: true }));
    await settle(RETRY_REVEAL);
    expect(mocks.scroll).not.toHaveBeenCalled();
    act(() => selectSuggestion(null, { reveal: true }));
    await settle(RETRY_REVEAL);
    expect(useSuggestions.getState().selectedId).toBeNull();
    expect(mocks.scroll).not.toHaveBeenCalled();
  });
});

describe("opening a suggestion in another file", () => {
  it("opens the file and reveals the suggestion once that file's list arrives", async () => {
    await start();
    const view = await mount();
    const focus = useSuggestions.getState().focus;
    act(() => openSuggestionIn("methods.tex", "m1"));
    expect(mocks.openFile).toHaveBeenCalledWith("methods.tex");
    expect(useSuggestions.getState().selectedId).toBeNull();
    act(() => {
      useFilesStore.setState({ activePath: "methods.tex" });
      setEditorDocumentPath("methods.tex");
    });
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ path: "methods.tex", selectedId: "m1", focus: focus + 1 });
    expect(mocks.scroll).toHaveBeenCalledWith(view, 2);
  });

  it("waits for the right file before revealing, and forgets a suggestion that is gone", async () => {
    await start();
    act(() => openSuggestionIn("methods.tex", "m1"));
    act(() => useFilesStore.setState({ activePath: "refs.tex" }));
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ path: "refs.tex", selectedId: null });
    act(() => useFilesStore.setState({ activePath: "methods.tex" }));
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ path: "methods.tex", selectedId: "m1" });
    act(() => openSuggestionIn("refs.tex", "r-gone"));
    act(() => useFilesStore.setState({ activePath: "refs.tex" }));
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ path: "refs.tex", selectedId: null });
    act(() => useFilesStore.setState({ activePath: "methods.tex" }));
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ path: "methods.tex", selectedId: null });
  });

  it("logs a file that won't open for a suggestion", async () => {
    mocks.openFile.mockRejectedValueOnce(new Error("locked"));
    await start();
    act(() => openSuggestionIn("methods.tex", "m1"));
    await settle();
    expect(mocks.logError).toHaveBeenCalledWith("open suggested file", expect.any(Error));
  });
});
