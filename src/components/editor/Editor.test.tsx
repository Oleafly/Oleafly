// @vitest-environment jsdom

import type { ReactNode } from "react";
import { defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import common from "@/i18n/locales/en/common.json" with { type: "json" };
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { acquireEditorMutationLease } from "@/lib/editor-mutation-lease";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { getKindModes, kindMode, saveKindModes } from "@/lib/wysiwyg-mode";
import { fileMode, useVisualModeStore } from "@/store/visual-mode";
import { useDiffStore } from "@/store/diff";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useZenStore } from "@/store/zen";
import { setWysiwygFlushController } from "./wysiwyg/controller";

const tauri = vi.hoisted(() => ({
  readFileBase64: vi.fn(async () => "AAA="),
  base64ToUint8Array: vi.fn(() => new Uint8Array([1, 2, 3])),
  projectFileSizes: vi.fn(async (_projectId: string, paths: readonly string[]) => Object.fromEntries(paths.map((path) => [path, 4]))),
  readProjectBytes: vi.fn(async (_projectId: string, _path: string) => new Uint8Array([137, 80, 78, 71]).buffer),
}));

const native = vi.hoisted(() => ({
  enabled: false,
  fileChange: null as ((payload: { projectId?: string; path?: string }) => void) | null,
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => native.enabled,
}));

vi.mock("@/hooks/use-tauri-event", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-tauri-event")>()),
  useTauriEvent: (event: string, handler: NonNullable<typeof native.fileChange>, enabled = true) => {
    if (event === "pdf-sync:written" && enabled) native.fileChange = handler;
  },
}));

const wrapSelection = vi.hoisted(() => vi.fn());
const controller = vi.hoisted(() => ({
  getEditorView: vi.fn(() => null),
  gotoRange: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, ...tauri };
});

vi.mock("./cm/controller", () => ({ wrapSelection, ...controller }));
const runMarkdownFormatting = vi.hoisted(() => vi.fn());
const editorKeyTaken = vi.hoisted(() => vi.fn(() => false));
vi.mock("./markdown-keymap", () => ({ runMarkdownFormatting, editorKeyTaken }));

vi.mock("./CodeMirrorEditor", () => ({
  CodeMirrorEditor: () => <div data-testid="codemirror" />,
}));
vi.mock("./diff/DiffView", () => ({ DiffView: () => <div data-testid="diff-view" /> }));
vi.mock("./SelectionActionMenu", () => ({ SelectionActionMenu: () => null }));
vi.mock("./ProofreadingNotifications", () => ({ ProofreadingNotifications: () => null }));
vi.mock("./EditorToolbar", () => ({
  EditorToolbar: ({ wysiwyg, onToggleWysiwyg }: { wysiwyg: boolean; onToggleWysiwyg: () => void }) => (
    <button type="button" data-testid="latex-toolbar" aria-label={en.toolbar.switchToVisual} aria-pressed={wysiwyg} onClick={onToggleWysiwyg} />
  ),
  WysiwygModeSwitch: ({ mode, secondLabel, onModeChange }: {
    mode: "code" | "visual" | "both"; secondLabel: string;
    onModeChange: (mode: "code" | "visual" | "both", layout?: "stacked" | "split") => void;
  }) => (
    <div data-testid="mode-switch" data-mode={mode}>
      <button type="button" onClick={() => onModeChange("code")}>{en.toolbar.code}</button>
      <button type="button" onClick={() => onModeChange("visual")}>{secondLabel}</button>
      <button type="button" onClick={() => onModeChange("both", "split")}>{en.toolbar.split}</button>
    </div>
  ),
}));
vi.mock("./HtmlFilePreview", () => ({
  HtmlFilePreview: ({ path }: { path: string }) => <div data-testid="html-preview">{path}</div>,
}));
vi.mock("./BibReferenceList", () => ({
  BibReferenceList: ({ path, onReveal }: { path: string; onReveal: (from: number) => void }) => (
    <button type="button" data-testid="bib-preview" onClick={() => onReveal(12)}>{path}</button>
  ),
}));
vi.mock("./SheetFilePreview", () => ({
  SheetFilePreview: ({ path, workbook }: { path: string; workbook?: boolean }) => (
    <div data-testid="sheet-preview" data-workbook={workbook ? "" : undefined}>{path}</div>
  ),
}));
vi.mock("./board/BoardFileView", () => ({
  BoardFileView: ({ path }: { path: string }) => <div data-testid="board-file">{path}</div>,
}));
vi.mock("./deck/DeckView", () => ({
  DeckView: ({ path, onPresent }: { path: string; onPresent: (mode: "page", page: number) => void }) => (
    <button type="button" data-testid="deck-preview" onClick={() => onPresent("page", 2)}>{path}</button>
  ),
}));
const present = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/features/presentation/launch", () => ({ present }));
vi.mock("@/lib/project-intelligence/navigation", () => ({ navigateToProjectRange: vi.fn(async () => undefined) }));
vi.mock("./MarkdownToolbar", () => ({
  MarkdownToolbar: ({ wysiwyg, onToggleWysiwyg, onModeChange }: {
    wysiwyg: boolean; onToggleWysiwyg: () => void;
    onModeChange?: (mode: "code" | "visual" | "both", layout?: "stacked" | "split") => void;
  }) => (<>
    <button type="button" data-testid="markdown-toolbar" aria-label={en.toolbar.switchToVisual} aria-pressed={wysiwyg} onClick={onToggleWysiwyg} />
    {onModeChange && <>
      <button type="button" onClick={() => onModeChange("both", "split")}>{en.toolbar.split}</button>
      <button type="button" onClick={() => onModeChange("both", "stacked")}>{en.toolbar.stacked}</button>
    </>}
  </>),
}));
vi.mock("./MarkdownPreview", () => ({ MarkdownPreview: () => <div data-testid="markdown-preview" /> }));
vi.mock("./TypstToolbar", () => ({ TypstToolbar: () => <div data-testid="typst-toolbar" /> }));
vi.mock("./EditorContextMenu", () => ({
  EditorContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./wysiwyg/WysiwygEditor", () => ({
  WysiwygEditor: () => <div data-testid="wysiwyg" />,
}));
vi.mock("@/components/pdf/PdfViewer", () => ({ PdfViewer: () => <div data-testid="pdf-viewer" /> }));
vi.mock("./DiagramMainFileView", () => ({
  default: () => <div data-testid="diagram-main" />,
}));
vi.mock("@/components/layout/WorkspaceControls", () => ({
  SidebarCollapseToggle: () => <div data-testid="sidebar-toggle" />,
}));
vi.mock("@/components/collab/CollabSlots", () => ({
  CollabRemovedFileSlot: () => <div data-testid="collab-removed-slot" />,
}));

import { Editor } from "./Editor";

const shell = en.shell;

function preferVisual() {
  saveKindModes("project", { source: "visual", markdown: "visual" });
}

function savedMode(path: string) {
  return kindMode(getKindModes("project"), path);
}

function showFile(path: string) {
  act(() => useFilesStore.setState({ activePath: path }));
}

function engineWithProfile(profile: string, extensions: string[]): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    source_extensions: extensions,
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: profile },
  } as DocumentEngineDescriptor;
}

function openFile(path: string, extra: Record<string, unknown> = {}) {
  useFilesStore.setState({
    projectId: "project",
    projectKind: "",
    activePath: path,
    openTabs: [path],
    tabOrder: { [path]: 1 },
    files: {},
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    ...extra,
  });
}

describe("Editor shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useVisualModeStore.setState({ projectId: null, kinds: {}, files: {}, markdownSplitLayout: "split" });
    useDiffStore.setState({ diffs: [], activeKey: null });
    useSettingsStore.setState({ settingsOpen: false });
    useFilesStore.setState({
      projectId: "project",
      projectKind: "",
      activePath: null,
      openTabs: [],
      tabOrder: {},
      assistantTabs: [],
      files: {},
      mainDoc: "main.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
    });
  });

  it("invites the reader to pick a file when nothing is open", () => {
    render(<Editor />);

    expect(screen.getByText(shell.noFileOpenTab)).toBeInTheDocument();
    expect(screen.getByText(shell.noFileOpen)).toBeInTheDocument();
    expect(screen.getByText(shell.noFileOpenHint)).toBeInTheDocument();
  });

  it("keeps the notice about files others deleted in the editor area, with or without an open file", () => {
    const { unmount } = render(<Editor />);
    expect(screen.getByTestId("collab-removed-slot")).toBeInTheDocument();
    unmount();
    openFile("chapters/intro.tex");
    render(<Editor />);
    expect(screen.getByTestId("collab-removed-slot")).toBeInTheDocument();
  });

  it("names each file tab, marks unsaved edits, and closes on request", () => {
    openFile("chapters/intro.tex", {
      openTabs: ["chapters/intro.tex", "notes.md"],
      tabOrder: { "chapters/intro.tex": 1, "notes.md": 2 },
      files: { "notes.md": { content: "x", dirty: true } },
    });
    render(<Editor />);

    expect(screen.getAllByText("intro.tex").length).toBeGreaterThan(0);
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(
      screen.getByLabelText(shell.closeFile.replace("{{name}}", "notes.md")),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("notes.md"));
    expect(useFilesStore.getState().activePath).toBe("notes.md");

    fireEvent.click(screen.getByLabelText(shell.closeFile.replace("{{name}}", "intro.tex")));
    expect(useFilesStore.getState().openTabs).not.toContain("chapters/intro.tex");
  });

  it("closes the other tabs from a tab's right-click menu", () => {
    openFile("chapters/intro.tex", {
      openTabs: ["chapters/intro.tex", "notes.md", "refs.bib"],
      tabOrder: { "chapters/intro.tex": 1, "notes.md": 2, "refs.bib": 4 },
    });
    useDiffStore.setState({ diffs: [{ path: "main.tex", side: "working", order: 3 }], activeKey: null });
    render(<Editor />);

    fireEvent.contextMenu(screen.getByText("notes.md"));
    fireEvent.click(screen.getByRole("menuitem", { name: shell.closeOthers }));

    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.queryByText("refs.bib")).not.toBeInTheDocument();
    expect(screen.queryByText(shell.diffWorkingTree)).not.toBeInTheDocument();
    expect(useFilesStore.getState()).toMatchObject({ openTabs: ["notes.md"], activePath: "notes.md" });
    expect(useDiffStore.getState().diffs).toEqual([]);
  });

  it("closes a tab on middle click", () => {
    openFile("main.tex", {
      openTabs: ["main.tex", "draft.tex"],
      tabOrder: { "main.tex": 1, "draft.tex": 2 },
    });
    render(<Editor />);

    fireEvent(
      screen.getByText("draft.tex"),
      new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
    );

    expect(useFilesStore.getState().openTabs).toEqual(["main.tex"]);
  });

  it("labels both diff sides and closes a diff tab", () => {
    openFile("main.tex");
    useDiffStore.setState({
      diffs: [
        { path: "main.tex", side: "working", order: 2 },
        { path: "refs.bib", side: "staged", order: 3 },
      ],
      activeKey: "working:main.tex",
    });
    render(<Editor />);

    expect(screen.getByText(shell.diffWorkingTree)).toBeInTheDocument();
    expect(screen.getByText(shell.diffIndex)).toBeInTheDocument();
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();

    fireEvent.click(screen.getByText("refs.bib"));
    expect(useDiffStore.getState().activeKey).toBe("staged:refs.bib");

    fireEvent.click(screen.getByLabelText(shell.closeDiffTab.replace("{{name}}", "refs.bib")));
    expect(useDiffStore.getState().diffs).toHaveLength(1);
  });

  it("labels a diff against the file on disk", () => {
    openFile("main.tex");
    useDiffStore.setState({
      diffs: [{ path: "main.tex", side: "disk", order: 2 }],
      activeKey: "disk:main.tex",
    });
    render(<Editor />);

    expect(screen.getByText(shell.diffOnDisk)).toBeInTheDocument();
    expect(screen.queryByText(shell.diffWorkingTree)).not.toBeInTheDocument();
    expect(screen.queryByText(shell.diffIndex)).not.toBeInTheDocument();
  });

  it("opens the editor settings section from the tab strip", () => {
    render(<Editor />);

    fireEvent.click(screen.getByLabelText(shell.editorSettings));

    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialSection).toBe("appearance");
  });

  it("picks the toolbar that matches the file and the engine", () => {
    openFile("main.tex");
    const first = render(<Editor />);
    expect(screen.getByTestId("latex-toolbar")).toBeInTheDocument();
    first.unmount();

    openFile("README.md");
    const second = render(<Editor />);
    expect(screen.getByTestId("markdown-toolbar")).toBeInTheDocument();
    second.unmount();

    openFile("main.typ", { engine: engineWithProfile("typst", ["typ"]) });
    const third = render(<Editor />);
    expect(screen.getByTestId("typst-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
    third.unmount();

    openFile("paper.md", { engine: engineWithProfile("markdown", ["md"]) });
    render(<Editor />);
    expect(screen.getByTestId("markdown-toolbar")).toBeInTheDocument();
  });

  it("gives an HTML file Code, Preview and Split, the page taking the source's place or its side", async () => {
    openFile("site/attention-demo.html");
    render(<Editor />);
    const switcher = screen.getByTestId("mode-switch");
    expect(switcher).toHaveAttribute("data-mode", "code");
    expect(screen.queryByTestId("html-preview")).toBeNull();

    fireEvent.click(within(switcher).getByText(en.toolbar.preview));
    expect(screen.getByTestId("mode-switch")).toHaveAttribute("data-mode", "visual");
    expect(await screen.findByTestId("html-preview")).toHaveTextContent("site/attention-demo.html");
    expect(screen.getByTestId("codemirror").closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(within(screen.getByTestId("mode-switch")).getByText(en.toolbar.split));
    expect(screen.getByTestId("mode-switch")).toHaveAttribute("data-mode", "both");
    expect(screen.getAllByTestId("html-preview")).toHaveLength(1);
    expect(screen.getByTestId("codemirror").closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("separator", { name: `${en.toolbar.code} / ${en.toolbar.preview}` })).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("mode-switch")).getByText(en.toolbar.code));
    expect(screen.queryByTestId("html-preview")).toBeNull();
  });

  it.each([
    ["refs.bib", "bib-preview"],
    ["data/results.csv", "sheet-preview"],
    ["data/runs.tsv", "sheet-preview"],
  ])("gives %s Code, Preview and Split with its own preview", async (path, preview) => {
    openFile(path);
    render(<Editor />);
    fireEvent.click(within(screen.getByTestId("mode-switch")).getByText(en.toolbar.preview));
    expect(await screen.findByTestId(preview)).toHaveTextContent(path);
    expect(screen.getByTestId("codemirror").closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the source beside the reference list when an entry is picked from the preview alone", async () => {
    openFile("refs.bib");
    render(<Editor />);
    fireEvent.click(within(screen.getByTestId("mode-switch")).getByText(en.toolbar.preview));
    fireEvent.click(await screen.findByTestId("bib-preview"));
    expect(screen.getByTestId("mode-switch")).toHaveAttribute("data-mode", "both");
    expect(navigateToProjectRange).toHaveBeenCalledWith({ path: "refs.bib", range: { from: 12, to: 12 }, source: "outline" });
  });

  it("previews a slide deck beside its source and presents it from the slide on screen", async () => {
    openFile("slides/talk/index.tsx");
    render(<Editor />);
    fireEvent.click(within(screen.getByTestId("mode-switch")).getByText(en.toolbar.split));
    const deck = await screen.findByTestId("deck-preview");
    expect(deck).toHaveTextContent("slides/talk/index.tsx");
    fireEvent.click(deck);
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "page", page: 3, mainDoc: null, typst: false, source: { kind: "deck", path: "slides/talk/index.tsx" } }),
    );
  });

  it("opens a whiteboard straight onto its canvas, with no source to switch to", async () => {
    openFile("figures/sketch.excalidraw");
    render(<Editor />);
    expect(await screen.findByTestId("board-file")).toHaveTextContent("figures/sketch.excalidraw");
    expect(screen.queryByTestId("mode-switch")).toBeNull();
    expect(screen.queryByTestId("codemirror")).toBeNull();
  });

  it("opens a workbook straight into its table, with no source to switch to", async () => {
    openFile("data/results.xlsx");
    render(<Editor />);
    expect(await screen.findByTestId("sheet-preview")).toHaveAttribute("data-workbook");
    expect(screen.queryByTestId("mode-switch")).toBeNull();
    expect(screen.queryByTestId("codemirror")).toBeNull();
  });

  it("shows the changed-on-disk banner above a Typst file", () => {
    openFile("main.typ", {
      engine: engineWithProfile("typst", ["typ"]),
      changedOnDisk: ["main.typ"],
      tree: [],
      manifestHome: "library",
    });
    render(<Editor />);

    expect(screen.getByTestId("changed-on-disk-banner")).toHaveTextContent(
      en.changedOnDisk.message.replace("{{file}}", "main.typ"),
    );
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
    expect(screen.getByTestId("editor-breadcrumbs")).toBeInTheDocument();
  });

  it("marks a managed Typst file as read-only", () => {
    openFile(".oleafly/notes.typ", {
      engine: engineWithProfile("typst", ["typ"]),
      changedOnDisk: [],
      tree: [],
      manifestHome: "library",
    });
    render(<Editor />);

    expect(screen.getByTestId("managed-file-notice")).toHaveTextContent(
      shell.managedFileReadOnly.replace("{{file}}", ".oleafly/notes.typ"),
    );
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
  });

  it("marks a linked Typst file as read-only", () => {
    openFile("shared/chapter.typ", {
      engine: engineWithProfile("typst", ["typ"]),
      changedOnDisk: [],
      tree: [{ path: "shared/chapter.typ", is_dir: false, read_only: true }],
      manifestHome: "library",
    });
    render(<Editor />);

    expect(screen.getByTestId("linked-file-notice")).toHaveTextContent(
      shell.linkedFileReadOnly.replace("{{file}}", "shared/chapter.typ"),
    );
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
  });

  it("refuses to edit a file it cannot preview", () => {
    openFile("assets/fonts/body.woff2");
    render(<Editor />);

    expect(screen.getByTestId("binary-file-notice")).toHaveTextContent(shell.binaryFile);
    expect(screen.queryByTestId("codemirror")).not.toBeInTheDocument();
  });

  it("renders a PDF tab through the viewer and reports a read failure", async () => {
    openFile("out/paper.pdf");
    render(<Editor />);

    expect(await screen.findByTestId("pdf-viewer")).toBeInTheDocument();

    cleanup();
    tauri.readFileBase64.mockRejectedValueOnce(new Error("gone"));
    openFile("out/paper.pdf");
    render(<Editor />);

    await waitFor(() =>
      expect(
        screen.getByText(shell.pdfLoadFailed.replace("{{detail}}", "Error: gone")),
      ).toBeInTheDocument(),
    );
  });

  it("rereads an open PDF when sync rewrites that file and no other", async () => {
    native.enabled = true;
    try {
      openFile("Thesis.pdf");
      render(<Editor />);
      expect(await screen.findByTestId("pdf-viewer")).toBeInTheDocument();
      await waitFor(() => expect(native.fileChange).not.toBeNull());
      const projectId = useFilesStore.getState().projectId ?? "";
      tauri.readFileBase64.mockClear();

      act(() => native.fileChange?.({ projectId, path: "other.pdf" }));
      act(() => native.fileChange?.({ projectId: "elsewhere", path: "Thesis.pdf" }));
      expect(tauri.readFileBase64).not.toHaveBeenCalled();

      act(() => native.fileChange?.({ projectId, path: "Thesis.pdf" }));
      await waitFor(() => expect(tauri.readFileBase64).toHaveBeenCalledWith(projectId, "Thesis.pdf"));
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    } finally {
      native.enabled = false;
      native.fileChange = null;
    }
  });

  function withObjectUrls(): () => void {
    const native = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = () => "blob:plot";
    URL.revokeObjectURL = () => undefined;
    return () => {
      URL.createObjectURL = native.create;
      URL.revokeObjectURL = native.revoke;
    };
  }

  it("renders an image tab from the file's bytes and reports a read failure", async () => {
    const restore = withObjectUrls();
    try {
      openFile("figures/plot.png");
      render(<Editor />);

      const image = (await screen.findByAltText("plot.png")) as HTMLImageElement;
      expect(image.src).toBe("blob:plot");
      expect(tauri.readProjectBytes).toHaveBeenCalledWith(useFilesStore.getState().projectId, "figures/plot.png");

      cleanup();
      tauri.readProjectBytes.mockRejectedValueOnce(new Error("missing"));
      openFile("figures/plot.png");
      render(<Editor />);

      await waitFor(() =>
        expect(
          screen.getByText(shell.imageLoadFailed.replace("{{detail}}", "Error: missing")),
        ).toBeInTheDocument(),
      );
    } finally {
      restore();
    }
  });

  it("says so when an image file's bytes are not a picture", async () => {
    const restore = withObjectUrls();
    onTestFinished(restore);
    openFile("figures/plot.png");
    render(<Editor />);

    fireEvent.error(await screen.findByAltText("plot.png"));

    const notice = screen.getByTestId("image-undecodable");
    expect(notice).toHaveTextContent("plot.png");
    expect(notice).toHaveTextContent(shell.imageUnreadable);
    expect(screen.queryByAltText("plot.png")).toBeNull();
  });

  it("shows the loading state until the file bytes arrive", () => {
    tauri.readFileBase64.mockReturnValueOnce(new Promise(() => {}));
    openFile("out/paper.pdf");
    render(<Editor />);

    expect(screen.getByText(common.state.loading)).toBeInTheDocument();
  });

  it("renders LaTeX Visual mode inside the source editor without the rich-text surface", () => {
    preferVisual();
    openFile("main.tex");
    render(<Editor />);

    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
    expect(screen.queryByTestId("wysiwyg")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-breadcrumbs")).toBeInTheDocument();
  });

  it.each([
    ["LaTeX", "main.tex", "document", "latex", ["tex"], "latex-toolbar"],
    ["LaTeX image", "main.tex", "image", "latex", ["tex"], "latex-toolbar"],
    ["diagram", "main.tex", "diagram", "latex", ["tex"], "latex-toolbar"],
    ["Markdown", "main.md", "document", "markdown", ["md"], "markdown-toolbar"],
    ["Markdown in LaTeX", "README.md", "document", "latex", ["tex"], "markdown-toolbar"],
    ["Markdown in Typst", "README.md", "document", "typst", ["typ"], "markdown-toolbar"],
  ] as const)("keeps the saved Visual choice for %s even when the old experiment was disabled", async (
    _name, path, projectKind, profile, extensions, toolbarId,
  ) => {
    localStorage.setItem("oleafly.visualEditor", "0");
    localStorage.setItem("oleafly.wysiwyg.project", "1");
    openFile(path, { projectKind, mainDoc: path, engine: engineWithProfile(profile, [...extensions]) });
    const view = render(<Editor />);

    expect(screen.getByTestId(toolbarId)).toHaveAttribute("aria-pressed", "true");
    if (path.endsWith(".md")) expect(await screen.findByTestId("wysiwyg")).toBeVisible();
    expect(localStorage.getItem("oleafly.wysiwyg.project")).toBeNull();

    fireEvent.click(screen.getByTestId(toolbarId));
    expect(savedMode(path)).toBe("code");
    view.unmount();
    render(<Editor />);
    expect(screen.getByTestId(toolbarId)).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId(toolbarId));
    expect(savedMode(path)).toBe("visual");
  });

  it("keeps the Markdown visual surface mounted next to the source surface", async () => {
    openFile("notes.md");
    render(<Editor />);

    expect(await screen.findByTestId("wysiwyg")).toBeInTheDocument();
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-breadcrumbs")).not.toBeInTheDocument();
  });

  it("arranges Markdown both ways, flushes Visual edits, and restores the choice after reopening", async () => {
    preferVisual();
    openFile("notes.md");
    const view = render(<Editor />);
    const flush = vi.fn();
    setWysiwygFlushController(flush);
    const source = screen.getByTestId("codemirror");

    fireEvent.click(screen.getByRole("button", { name: "Split" }));

    expect(flush).toHaveBeenCalledOnce();
    setWysiwygFlushController(null);
    expect(await screen.findByTestId("markdown-preview")).toBeVisible();
    expect(screen.getByTestId("codemirror")).toBe(source);
    expect(source).toBeVisible();
    expect(getKindModes("project")).toEqual({ source: "visual", markdown: "both" });
    const group = source.closest("[data-group]");
    expect(group).toHaveStyle({ flexDirection: "row" });
    fireEvent.click(screen.getByRole("button", { name: "Stacked" }));
    expect(source.closest("[data-group]")).toBe(group);
    expect(group).toHaveStyle({ flexDirection: "column" });

    for (const path of ["main.tex", "main.typ", "notes.txt"]) {
      act(() => openFile(path));
      expect(screen.queryByRole("button", { name: "Split" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("markdown-preview")).not.toBeInTheDocument();
    }
    view.unmount();
    openFile("notes.markdown");
    render(<Editor />);
    expect(await screen.findByTestId("markdown-preview")).toBeVisible();
    expect(screen.getByTestId("codemirror")).toBeVisible();
    expect(screen.getByTestId("codemirror").closest("[data-group]")).toHaveStyle({ flexDirection: "column" });
  });

  it("locks the surface while an external mutation holds the lease", () => {
    openFile("main.tex");
    const { container } = render(<Editor />);
    const root = container.firstElementChild as HTMLElement;

    const lease = acquireEditorMutationLease("project");
    expect(root).toHaveAttribute("aria-busy", "true");

    lease.release();
    expect(root).not.toHaveAttribute("aria-busy");
  });

  it("returns to the source surface when navigation reveals it, and leaves Both alone", async () => {
    preferVisual();
    openFile("main.tex");
    const { revealSourceEditor } = await import("./wysiwyg/controller");
    render(<Editor />);

    expect(fileMode(useVisualModeStore.getState(), "main.tex")).toBe("visual");

    act(() => revealSourceEditor());

    expect(savedMode("main.tex")).toBe("code");
    expect(fileMode(useVisualModeStore.getState(), "main.tex")).toBe("code");

    showFile("site/page.html");
    fireEvent.click(within(screen.getByTestId("mode-switch")).getByText(en.toolbar.split));
    act(() => revealSourceEditor());
    expect(screen.getByTestId("mode-switch")).toHaveAttribute("data-mode", "both");
  });

  it("edits the diagram main file on the canvas or in its source", async () => {
    openFile("diagram.tex", { projectKind: "diagram", mainDoc: "diagram.tex" });
    render(<Editor />);
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("latex-toolbar"));

    expect(await screen.findByTestId("diagram-main")).toBeInTheDocument();
  });

  it("opens a CSV or TSV as its table, with Code a click away", async () => {
    openFile("data/results.csv");
    render(<Editor />);
    expect(screen.getByTestId("mode-switch")).toHaveAttribute("data-mode", "visual");
    expect(await screen.findByTestId("sheet-preview")).toHaveTextContent("data/results.csv");

    showFile("data/runs.tsv");
    expect(screen.getByTestId("mode-switch")).toHaveAttribute("data-mode", "visual");
    fireEvent.click(within(screen.getByTestId("mode-switch")).getByText(en.toolbar.code));
    expect(screen.queryByTestId("sheet-preview")).toBeNull();
  });

  it("keeps each file in its own mode, and starts a new file in the mode last picked for its kind", async () => {
    const files = ["slides/demo/index.tsx", "results.csv", "notes.md", "main.tex", "refs.bib", "draft.md", "more.csv"];
    openFile(files[0], { openTabs: files, tabOrder: Object.fromEntries(files.map((path, index) => [path, index + 1])) });
    render(<Editor />);
    const mode = () => screen.getByTestId("mode-switch").getAttribute("data-mode");
    const pick = (label: string) => fireEvent.click(within(screen.getByTestId("mode-switch")).getByText(label));

    pick(en.toolbar.split);
    expect(await screen.findByTestId("deck-preview")).toBeInTheDocument();

    showFile("results.csv");
    expect(mode()).toBe("visual");
    pick(en.toolbar.code);

    showFile("notes.md");
    expect(screen.getByTestId("markdown-toolbar")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("markdown-preview")).toBeNull();

    showFile("main.tex");
    expect(screen.getByTestId("latex-toolbar")).toHaveAttribute("aria-pressed", "false");

    showFile("draft.md");
    fireEvent.click(screen.getByTestId("markdown-toolbar"));
    expect(screen.getByTestId("markdown-toolbar")).toHaveAttribute("aria-pressed", "true");

    showFile("refs.bib");
    expect(mode()).toBe("code");

    showFile("main.tex");
    expect(screen.getByTestId("latex-toolbar")).toHaveAttribute("aria-pressed", "false");
    showFile("notes.md");
    expect(screen.getByTestId("markdown-toolbar")).toHaveAttribute("aria-pressed", "false");
    showFile("slides/demo/index.tsx");
    expect(mode()).toBe("both");
    showFile("results.csv");
    expect(mode()).toBe("code");
    showFile("more.csv");
    expect(mode()).toBe("code");
    expect(getKindModes("project")).toEqual({ deck: "both", sheet: "code", markdown: "visual" });
  });

  it("applies the engine bold and italic bindings only from a focused source editor", () => {
    openFile("main.tex");
    const { container } = render(<Editor />);

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(wrapSelection).not.toHaveBeenCalled();

    const surface = document.createElement("div");
    surface.className = "cm-editor";
    const focusable = document.createElement("input");
    surface.appendChild(focusable);
    container.appendChild(surface);
    focusable.focus();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(wrapSelection).toHaveBeenLastCalledWith("\\textbf{", "}");

    fireEvent.keyDown(window, { key: "i", ctrlKey: true });
    expect(wrapSelection).toHaveBeenLastCalledWith("\\textit{", "}");

    fireEvent.keyDown(window, { key: "q", ctrlKey: true });
    expect(wrapSelection).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "b" });
    expect(wrapSelection).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(wrapSelection).toHaveBeenCalledTimes(2);

    const handled = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(wrapSelection).toHaveBeenCalledTimes(2);
  });

  it("picks the toolbar from the file language when it differs from the engine", () => {
    openFile("notes.typ");
    const typstInLatex = render(<Editor />);
    expect(screen.getByTestId("typst-toolbar")).toBeInTheDocument();
    expect(screen.queryByTestId("latex-toolbar")).not.toBeInTheDocument();
    typstInLatex.unmount();

    openFile("appendix.tex", { engine: engineWithProfile("typst", ["typ"]) });
    const latexInTypst = render(<Editor />);
    expect(screen.getByTestId("latex-toolbar")).toBeInTheDocument();
    expect(screen.queryByTestId("typst-toolbar")).not.toBeInTheDocument();
    latexInTypst.unmount();

    openFile("README.md", { engine: engineWithProfile("typst", ["typ"]) });
    const markdownInTypst = render(<Editor />);
    expect(screen.getByTestId("markdown-toolbar")).toBeInTheDocument();
    expect(screen.queryByTestId("typst-toolbar")).not.toBeInTheDocument();
    markdownInTypst.unmount();

    openFile("refs.bib");
    render(<Editor />);
    expect(screen.queryByTestId("latex-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("typst-toolbar")).not.toBeInTheDocument();
  });

  it("formats in the file's own language when it differs from the engine", () => {
    openFile("notes.typ");
    const { container } = render(<Editor />);
    const surface = document.createElement("div");
    surface.className = "cm-editor";
    const focusable = document.createElement("input");
    surface.appendChild(focusable);
    container.appendChild(surface);
    focusable.focus();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(wrapSelection).toHaveBeenLastCalledWith("*", "*");

    act(() => {
      useFilesStore.setState({ activePath: "README.md", engine: engineWithProfile("typst", ["typ"]) });
    });
    fireEvent.keyDown(window, { key: "i", ctrlKey: true });
    expect(runMarkdownFormatting.mock.calls.at(-1)?.[1]).toBe("italic");
    expect(wrapSelection).toHaveBeenCalledTimes(1);

    act(() => {
      useFilesStore.setState({ activePath: "refs.bib", engine: LATEX_ENGINE });
    });
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(wrapSelection).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["main.tex", "\\textit{", "}"],
    ["notes.typ", "_", "_"],
  ])("italicizes with Ctrl+I in %s although CodeMirror's own Mod-i binding claims the key", (path, before, after) => {
    openFile(path);
    const { container } = render(<Editor />);
    const view = new EditorView({ state: EditorState.create({ doc: "A word b.", selection: { anchor: 2, head: 6 }, extensions: keymap.of(defaultKeymap) }), parent: container });
    view.focus();
    const event = new KeyboardEvent("keydown", { key: "i", ctrlKey: true, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(wrapSelection).toHaveBeenLastCalledWith(before, after);
    editorKeyTaken.mockReturnValueOnce(true);
    wrapSelection.mockClear();
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(wrapSelection).not.toHaveBeenCalled();
    view.destroy();
  });

  it("leaves Ctrl+Alt and Ctrl+Shift chords with B or I alone", () => {
    openFile("README.md");
    const { container } = render(<Editor />);
    const surface = document.createElement("div");
    surface.className = "cm-editor";
    const focusable = document.createElement("input");
    surface.appendChild(focusable);
    container.appendChild(surface);
    focusable.focus();

    for (const key of ["b", "i", "B", "I"]) {
      fireEvent.keyDown(window, { key, ctrlKey: true, altKey: true });
      fireEvent.keyDown(window, { key, ctrlKey: true, altKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key, ctrlKey: true, shiftKey: true });
    }
    expect(runMarkdownFormatting).not.toHaveBeenCalled();

    act(() => {
      useFilesStore.setState({ activePath: "main.tex" });
    });
    fireEvent.keyDown(window, { key: "b", ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: "I", ctrlKey: true, shiftKey: true });
    expect(wrapSelection).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(wrapSelection).toHaveBeenLastCalledWith("\\textbf{", "}");
  });

  it("leaves bold and italic to a form field or a table cell inside the text", () => {
    openFile("notes.typ");
    const { container } = render(<Editor />);
    const surface = document.createElement("div");
    surface.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    const card = document.createElement("div");
    card.setAttribute("data-ofl-visual-form", "");
    const field = document.createElement("input");
    const cell = document.createElement("textarea");
    card.append(field);
    content.append(card, cell);
    surface.append(content);
    container.appendChild(surface);

    field.focus();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    cell.focus();
    fireEvent.keyDown(window, { key: "i", ctrlKey: true });
    expect(wrapSelection).not.toHaveBeenCalled();
  });
});

describe("Editor in Zen mode", () => {
  function beginZen() {
    act(() => {
      useZenStore.getState().begin({
        projectId: "project",
        snapshot: {
          showTree: true,
          railTab: "files",
          workspaceHidden: false,
          viewMode: "editor",
          terminalOpen: false,
        },
        pdfVisibleAtStart: false,
        fullscreen: "none",
      });
    });
  }

  beforeEach(() => {
    controller.getEditorView.mockReturnValue(null);
    useZenStore.getState().end();
    useVisualModeStore.setState({ projectId: null, kinds: {}, files: {}, markdownSplitLayout: "split" });
    useDiffStore.setState({ diffs: [], activeKey: null });
  });

  it.each([
    ["LaTeX", "main.tex", LATEX_ENGINE, "latex-toolbar"],
    ["Markdown", "main.md", engineWithProfile("markdown", ["md"]), "markdown-toolbar"],
    ["Typst", "main.typ", engineWithProfile("typst", ["typ"]), "typst-toolbar"],
  ])("hides the tab strip, breadcrumbs and %s toolbar and keeps the source", (_name, path, engine, toolbar) => {
    openFile(path, { engine, openTabs: [path, "notes.bib"], tabOrder: { [path]: 1, "notes.bib": 2 } });
    render(<Editor />);
    expect(screen.getByTestId(toolbar)).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-toggle")).toBeInTheDocument();
    expect(screen.getByText("notes.bib")).toBeInTheDocument();

    beginZen();

    expect(screen.queryByTestId(toolbar)).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-breadcrumbs")).not.toBeInTheDocument();
    expect(screen.queryByText("notes.bib")).not.toBeInTheDocument();
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
  });

  it("brings the chrome back when Zen ends", () => {
    openFile("main.tex");
    render(<Editor />);
    beginZen();
    expect(screen.queryByTestId("latex-toolbar")).not.toBeInTheDocument();
    act(() => useZenStore.getState().end());
    expect(screen.getByTestId("latex-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-toggle")).toBeInTheDocument();
  });

  it("keeps notices that need the writer's attention", () => {
    openFile("main.tex", { changedOnDisk: ["main.tex"], tree: [], manifestHome: "library" });
    render(<Editor />);
    beginZen();
    expect(screen.getByTestId("changed-on-disk-banner")).toBeInTheDocument();
  });

  it("keeps the cursor in the source when the empty margin of a centered column is clicked", () => {
    openFile("main.tex");
    const { container } = render(<Editor />);
    beginZen();
    const scroller = document.createElement("div");
    scroller.className = "cm-scroller";
    container.querySelector("[data-testid='codemirror']")?.parentElement?.append(scroller);
    const view = { focus: vi.fn() };
    controller.getEditorView.mockReturnValue(view as never);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      scroller.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(view.focus).toHaveBeenCalledOnce();
  });

  it("leaves clicks inside the text alone", () => {
    openFile("main.tex");
    const { container } = render(<Editor />);
    beginZen();
    const content = document.createElement("div");
    content.className = "cm-content";
    container.querySelector("[data-testid='codemirror']")?.parentElement?.append(content);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      content.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not intercept clicks outside Zen mode", () => {
    openFile("main.tex");
    const { container } = render(<Editor />);
    const scroller = document.createElement("div");
    scroller.className = "cm-scroller";
    container.querySelector("[data-testid='codemirror']")?.parentElement?.append(scroller);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      scroller.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
