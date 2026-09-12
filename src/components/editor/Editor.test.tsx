// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import common from "@/i18n/locales/en/common.json" with { type: "json" };
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { acquireEditorMutationLease } from "@/lib/editor-mutation-lease";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { getWysiwygMode, setWysiwygMode } from "@/lib/wysiwyg-mode";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const tauri = vi.hoisted(() => ({
  readFileBase64: vi.fn(async () => "AAA="),
  base64ToUint8Array: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

const wrapSelection = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, ...tauri };
});

vi.mock("./cm/controller", () => ({ wrapSelection }));

vi.mock("./CodeMirrorEditor", () => ({
  CodeMirrorEditor: () => <div data-testid="codemirror" />,
}));
vi.mock("./diff/DiffView", () => ({ DiffView: () => <div data-testid="diff-view" /> }));
vi.mock("./SelectionActionMenu", () => ({ SelectionActionMenu: () => null }));
vi.mock("./ProofreadingNotifications", () => ({ ProofreadingNotifications: () => null }));
vi.mock("./EditorToolbar", () => ({ EditorToolbar: () => <div data-testid="latex-toolbar" /> }));
vi.mock("./MarkdownToolbar", () => ({
  MarkdownToolbar: () => <div data-testid="markdown-toolbar" />,
}));
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

import { Editor } from "./Editor";

const shell = en.shell;

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
    useDiffStore.setState({ diffs: [], activeKey: null });
    useSettingsStore.setState({ visualEditor: false, settingsOpen: false });
    useFilesStore.setState({
      projectId: "project",
      projectKind: "",
      activePath: null,
      openTabs: [],
      tabOrder: {},
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

  it("names each file tab, marks unsaved edits, and closes on request", () => {
    openFile("chapters/intro.tex", {
      openTabs: ["chapters/intro.tex", "notes.md"],
      tabOrder: { "chapters/intro.tex": 1, "notes.md": 2 },
      files: { "notes.md": { content: "x", dirty: true } },
    });
    render(<Editor />);

    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(
      screen.getByLabelText(shell.closeFile.replace("{{name}}", "notes.md")),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("notes.md"));
    expect(useFilesStore.getState().activePath).toBe("notes.md");

    fireEvent.click(screen.getByLabelText(shell.closeFile.replace("{{name}}", "intro.tex")));
    expect(useFilesStore.getState().openTabs).not.toContain("chapters/intro.tex");
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

  it("renders an image tab as a data url and reports a read failure", async () => {
    openFile("figures/plot.png");
    render(<Editor />);

    const image = (await screen.findByAltText("plot.png")) as HTMLImageElement;
    expect(image.src).toContain("data:image/png;base64,AAA=");

    cleanup();
    tauri.readFileBase64.mockRejectedValueOnce(new Error("missing"));
    openFile("figures/plot.png");
    render(<Editor />);

    await waitFor(() =>
      expect(
        screen.getByText(shell.imageLoadFailed.replace("{{detail}}", "Error: missing")),
      ).toBeInTheDocument(),
    );
  });

  it("shows the loading state until the file bytes arrive", () => {
    tauri.readFileBase64.mockReturnValueOnce(new Promise(() => {}));
    openFile("out/paper.pdf");
    render(<Editor />);

    expect(screen.getByText(common.state.loading)).toBeInTheDocument();
  });

  it("keeps the visual surface mounted next to the source surface", async () => {
    useSettingsStore.setState({ visualEditor: true });
    openFile("main.tex");
    render(<Editor />);

    expect(await screen.findByTestId("wysiwyg")).toBeInTheDocument();
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
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

  it("returns to the source surface when navigation reveals it", async () => {
    setWysiwygMode("project", true);
    useSettingsStore.setState({ visualEditor: true });
    openFile("main.tex");
    const { revealSourceEditor } = await import("./wysiwyg/controller");
    render(<Editor />);

    expect(await screen.findByTestId("wysiwyg")).toBeInTheDocument();

    act(() => revealSourceEditor());

    expect(getWysiwygMode("project")).toBe(false);
  });

  it("edits the diagram main file on the canvas or in its source", async () => {
    setWysiwygMode("project", false);
    openFile("diagram.tex", { projectKind: "diagram", mainDoc: "diagram.tex" });
    const source = render(<Editor />);
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
    source.unmount();

    setWysiwygMode("project", true);
    openFile("diagram.tex", { projectKind: "diagram", mainDoc: "diagram.tex" });
    render(<Editor />);

    expect(await screen.findByTestId("diagram-main")).toBeInTheDocument();
    setWysiwygMode("project", false);
  });

  it("applies the engine bold and italic bindings only from a focused source editor", () => {
    openFile("main.tex");
    const { container } = render(<Editor />);

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(wrapSelection).not.toHaveBeenCalled();

    const surface = document.createElement("div");
    surface.className = "cm-editor";
    const focusable = document.createElement("input");
    surface.appendChild(focusable);
    container.appendChild(surface);
    focusable.focus();

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(wrapSelection).toHaveBeenLastCalledWith("\\textbf{", "}");

    fireEvent.keyDown(window, { key: "i", ctrlKey: true });
    expect(wrapSelection).toHaveBeenLastCalledWith("\\textit{", "}");

    fireEvent.keyDown(window, { key: "q", metaKey: true });
    expect(wrapSelection).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "b" });
    expect(wrapSelection).toHaveBeenCalledTimes(2);
  });
});
