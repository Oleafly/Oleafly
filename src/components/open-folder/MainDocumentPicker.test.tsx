// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { DetectionCandidate, FolderDetection, OpenedFolder } from "@/lib/folder-detection";

const mocks = vi.hoisted(() => ({
  chooseMainDocument: vi.fn(),
  projectDocumentCandidates: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: "linked-a" as string | null,
      loading: false,
      mainDoc: "main.tex",
      manifestHome: "device",
      tree: [],
    })),
  };
});
vi.mock("@/lib/tauri", () => ({
  projectDocumentCandidates: mocks.projectDocumentCandidates,
}));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/store/main-document", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/main-document")>()),
  chooseMainDocument: mocks.chooseMainDocument,
}));

import { useFilesStore } from "@/store/files";
import { useMainDocumentStore } from "@/store/main-document";
import { useOpenFolderStore } from "@/store/open-folder";
import { MainDocumentPicker } from "./MainDocumentPicker";

const labels = enShell.openedFolder;

function candidate(path: string, overrides: Partial<DetectionCandidate> = {}): DetectionCandidate {
  return {
    path,
    family: "latex",
    tier: "s",
    kind: "document",
    class: "article",
    title: null,
    depth: path.split("/").length - 1,
    reasons: [],
    ...overrides,
  };
}

const ambiguous: FolderDetection = {
  main: null,
  decision: "ask",
  source: "scan",
  candidates: [
    candidate("paper/main.tex", {
      title: "Sparse attention for long documents",
      reasons: ["named_main", "has_bibliography"],
    }),
    candidate("talk/slides.tex", { kind: "presentation", class: "beamer", reasons: ["top_level"] }),
    candidate("notes/index.md", { family: "markdown", tier: "m", kind: "markdown", class: null }),
  ],
  truncated: false,
  compile_dir: null,
};

function present(detection: FolderDetection = ambiguous, projectId = "linked-a") {
  const opened: OpenedFolder = { project_id: projectId, detection };
  act(() => useOpenFolderStore.getState().present(opened));
}

function list() {
  return screen.getByRole("group", { name: labels.picker.listLabel });
}

function options() {
  return within(list()).getAllByRole("radio");
}

function row(option: HTMLElement) {
  const label = option.closest("label");
  if (!label) throw new Error("the choice is not inside its row");
  return label;
}

function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.chooseMainDocument.mockResolvedValue(true);
  useFilesStore.setState({
    projectId: "linked-a",
    loading: false,
    mainDoc: "main.tex",
    manifestHome: "device",
    tree: [],
  });
  useOpenFolderStore.getState().dismiss();
  useMainDocumentStore.getState().reset("linked-a");
});

afterEach(() => {
  useOpenFolderStore.getState().dismiss();
  useMainDocumentStore.getState().reset(null);
});

describe("MainDocumentPicker", () => {
  it("stays closed until a folder with several documents is presented", () => {
    render(<MainDocumentPicker />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    present();
    expect(screen.getByRole("dialog", { name: labels.picker.askTitle })).toBeInTheDocument();
    const choices = options();
    expect(choices).toHaveLength(3);
    expect(choices[0]).toBeChecked();
    const rows = choices.map(row);
    expect(within(rows[0]).getByText(labels.picker.bestMatch)).toBeInTheDocument();
    expect(within(rows[0]).getByText("paper/main.tex")).toBeInTheDocument();
    expect(within(rows[0]).getByText(labels.kind.document)).toBeInTheDocument();
    expect(within(rows[0]).getByText("Sparse attention for long documents")).toBeInTheDocument();
    expect(
      within(rows[0]).getByText(
        `${labels.reason.named_main} · ${labels.reason.has_bibliography}`,
      ),
    ).toBeInTheDocument();
    expect(within(rows[1]).getByText(labels.kind.presentation)).toBeInTheDocument();
    expect(within(rows[2]).getByText(labels.kind.markdown)).toBeInTheDocument();
  });

  it("shows the selection with a tint, never an outline or ring", () => {
    render(<MainDocumentPicker />);
    present();
    const [selected, other] = options().map(row);
    expect(selected.className).toMatch(/bg-/);
    expect(selected.className).not.toMatch(/ring|outline/);
    expect(other.className).not.toMatch(/ring|outline/);
    expect(list().className).not.toMatch(/ring|outline/);
    expect(list().className).toMatch(/focus-visible\]:border-/);
  });

  it("ignores a folder presented for another project", () => {
    render(<MainDocumentPicker />);
    present(ambiguous, "linked-b");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("waits for the project to finish loading", () => {
    useFilesStore.setState({ loading: true });
    render(<MainDocumentPicker />);
    present();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => useFilesStore.setState({ loading: false }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("moves with the arrow keys and opens the chosen document with Enter", async () => {
    render(<MainDocumentPicker />);
    present();
    await waitFor(() => expect(options()[0]).toHaveFocus());
    press("ArrowDown");
    expect(options()[1]).toBeChecked();
    expect(options()[1]).toHaveFocus();
    press("End");
    expect(options()[2]).toBeChecked();
    expect(options()[2]).toHaveFocus();
    press("ArrowDown");
    expect(options()[2]).toBeChecked();
    press("Home");
    press("ArrowUp");
    expect(options()[0]).toBeChecked();
    expect(options()[0]).toHaveFocus();
    press("ArrowDown");
    press("Enter");
    await waitFor(() => expect(mocks.chooseMainDocument).toHaveBeenCalledWith("talk/slides.tex"));
    await waitFor(() => expect(useOpenFolderStore.getState().opened).toBeNull());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stops at the ends of the list instead of wrapping around", async () => {
    render(<MainDocumentPicker />);
    present();
    await waitFor(() => expect(options()[0]).toHaveFocus());
    press("ArrowUp");
    expect(options()[0]).toBeChecked();
    press("ArrowLeft");
    expect(options()[0]).toBeChecked();
    press("ArrowRight");
    expect(options()[1]).toBeChecked();
    expect(options()[1]).toHaveFocus();
    press("End");
    press("ArrowRight");
    expect(options()[2]).toBeChecked();
    press("ArrowLeft");
    expect(options()[1]).toBeChecked();
    expect(mocks.chooseMainDocument).not.toHaveBeenCalled();
  });

  it("keeps the keyboard on the list after a click", async () => {
    render(<MainDocumentPicker />);
    present();
    fireEvent.click(options()[1]);
    expect(options()[1]).toBeChecked();
    expect(options()[1]).toHaveFocus();
    press("ArrowDown");
    expect(options()[2]).toBeChecked();
    expect(mocks.chooseMainDocument).not.toHaveBeenCalled();
  });

  it("takes the keyboard back when the selected row is clicked again", async () => {
    render(<MainDocumentPicker />);
    present();
    const browse = screen.getByRole("button", { name: labels.picker.browse });
    act(() => browse.focus());
    expect(browse).toHaveFocus();
    fireEvent.click(options()[0]);
    expect(options()[0]).toBeChecked();
    expect(options()[0]).toHaveFocus();
    press("ArrowDown");
    expect(options()[1]).toBeChecked();
    press("Enter");
    await waitFor(() => expect(mocks.chooseMainDocument).toHaveBeenCalledWith("talk/slides.tex"));
  });

  it("gives the list a single tab stop on the selected choice", async () => {
    render(<MainDocumentPicker />);
    present();
    await waitFor(() => expect(options()[0]).toHaveFocus());
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1, -1]);
    press("End");
    expect(options().map((option) => option.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.click(options()[1]);
    expect(options().map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("opens the selected document from the Open button", async () => {
    render(<MainDocumentPicker />);
    present();
    fireEvent.click(row(options()[2]));
    fireEvent.click(screen.getByRole("button", { name: labels.picker.open }));
    await waitFor(() => expect(mocks.chooseMainDocument).toHaveBeenCalledWith("notes/index.md"));
    await waitFor(() => expect(useOpenFolderStore.getState().opened).toBeNull());
  });

  it("opens a document on double click", async () => {
    render(<MainDocumentPicker />);
    present();
    fireEvent.doubleClick(options()[1]);
    await waitFor(() => expect(mocks.chooseMainDocument).toHaveBeenCalledWith("talk/slides.tex"));
  });

  it("lets the user just browse files without choosing", async () => {
    render(<MainDocumentPicker />);
    present();
    fireEvent.click(screen.getByRole("button", { name: labels.picker.browse }));
    await waitFor(() => expect(useOpenFolderStore.getState().opened).toBeNull());
    expect(mocks.chooseMainDocument).not.toHaveBeenCalled();
  });

  it("treats Escape as just browsing", async () => {
    render(<MainDocumentPicker />);
    present();
    await waitFor(() => expect(options()[0]).toHaveFocus());
    press("Escape");
    await waitFor(() => expect(useOpenFolderStore.getState().opened).toBeNull());
    expect(mocks.chooseMainDocument).not.toHaveBeenCalled();
  });

  it("keeps the picker open and reports a failed choice once", async () => {
    mocks.chooseMainDocument.mockRejectedValue(new Error("refused"));
    render(<MainDocumentPicker />);
    present();
    fireEvent.click(screen.getByRole("button", { name: labels.picker.open }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledTimes(1));
    expect(mocks.notifyError.mock.calls[0]?.[2]).toBe(
      labels.picker.openFailed.replace("{{path}}", "paper/main.tex"),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(useOpenFolderStore.getState().opened).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: labels.picker.open })).not.toBeDisabled(),
    );
  });

  it("leaves the next folder's picker open when an earlier choice finishes late", async () => {
    let finish: (chosen: boolean) => void = () => {};
    mocks.chooseMainDocument.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    render(<MainDocumentPicker />);
    present();
    fireEvent.click(screen.getByRole("button", { name: labels.picker.open }));
    await waitFor(() => expect(mocks.chooseMainDocument).toHaveBeenCalledWith("paper/main.tex"));
    act(() => {
      useFilesStore.setState({ projectId: "linked-b" });
      useMainDocumentStore.getState().reset("linked-b");
    });
    present(ambiguous, "linked-b");
    expect(screen.getByRole("button", { name: labels.picker.open })).not.toBeDisabled();
    await act(async () => finish(false));
    expect(useOpenFolderStore.getState().opened?.project_id).toBe("linked-b");
    expect(screen.getByRole("dialog", { name: labels.picker.askTitle })).toBeInTheDocument();
  });

  it("keeps the change picker of the next folder open when an earlier switch finishes late", async () => {
    let finish: (chosen: boolean) => void = () => {};
    mocks.chooseMainDocument.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    mocks.projectDocumentCandidates.mockResolvedValue(ambiguous);
    useMainDocumentStore.getState().seed("linked-a", ambiguous);
    render(<MainDocumentPicker />);
    act(() => useMainDocumentStore.getState().openChange());
    fireEvent.click(screen.getByRole("button", { name: labels.picker.open }));
    await waitFor(() => expect(mocks.chooseMainDocument).toHaveBeenCalledWith("paper/main.tex"));
    act(() => {
      useFilesStore.setState({ projectId: "linked-b" });
      useMainDocumentStore.getState().reset("linked-b");
      useMainDocumentStore.getState().openChange();
    });
    await act(async () => finish(false));
    expect(useMainDocumentStore.getState().changing).toBe(true);
    expect(screen.getByRole("dialog", { name: labels.picker.changeTitle })).toBeInTheDocument();
  });

  it("shows the last list while it looks again, then the fresh one", async () => {
    let finish: (detection: FolderDetection) => void = () => {};
    mocks.projectDocumentCandidates.mockReturnValueOnce(
      new Promise<FolderDetection>((resolve) => {
        finish = resolve;
      }),
    );
    useMainDocumentStore.getState().seed("linked-a", ambiguous);
    render(<MainDocumentPicker />);
    act(() => useMainDocumentStore.getState().openChange());
    expect(options()).toHaveLength(3);
    await act(async () =>
      finish({ ...ambiguous, candidates: [...ambiguous.candidates, candidate("appendix/extra.tex")] }),
    );
    expect(options()).toHaveLength(4);
    expect(within(row(options()[3])).getByText("appendix/extra.tex")).toBeInTheDocument();
  });

  it("says when the search stopped early", () => {
    render(<MainDocumentPicker />);
    present({ ...ambiguous, truncated: true });
    expect(screen.getByText(labels.picker.truncated)).toBeInTheDocument();
  });

  it("changes the main document from a fresh search with the current main selected", async () => {
    useFilesStore.setState({ mainDoc: "talk/slides.tex", tree: [{ path: "talk/slides.tex", is_dir: false }] });
    mocks.projectDocumentCandidates.mockResolvedValue({
      ...ambiguous,
      main: "talk/slides.tex",
      decision: "auto",
    });
    render(<MainDocumentPicker />);
    act(() => useMainDocumentStore.getState().openChange());
    expect(screen.getByRole("dialog", { name: labels.picker.changeTitle })).toBeInTheDocument();
    await waitFor(() => expect(options()).toHaveLength(3));
    await waitFor(() => expect(options()[1]).toHaveFocus());
    expect(options()[1]).toBeChecked();
    expect(within(row(options()[1])).getByText(labels.picker.current)).toBeInTheDocument();
    expect(screen.queryByText(labels.picker.bestMatch)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(useMainDocumentStore.getState().changing).toBe(false);
    expect(mocks.chooseMainDocument).not.toHaveBeenCalled();
  });

  it("closes without a round trip when the current main is kept", async () => {
    useFilesStore.setState({ mainDoc: "paper/main.tex" });
    useMainDocumentStore.getState().seed("linked-a", { ...ambiguous, main: "paper/main.tex" });
    render(<MainDocumentPicker />);
    act(() => useMainDocumentStore.getState().openChange());
    fireEvent.click(screen.getByRole("button", { name: labels.picker.open }));
    expect(useMainDocumentStore.getState().changing).toBe(false);
    expect(mocks.chooseMainDocument).not.toHaveBeenCalled();
  });

  it("explains an empty search", async () => {
    mocks.projectDocumentCandidates.mockResolvedValue({
      ...ambiguous,
      candidates: [],
      decision: "no_main",
    });
    render(<MainDocumentPicker />);
    act(() => useMainDocumentStore.getState().openChange());
    await waitFor(() => expect(screen.getByText(labels.picker.empty)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: labels.picker.open })).toBeDisabled();
  });

  it("explains a failed search", async () => {
    mocks.projectDocumentCandidates.mockRejectedValue(new Error("gone"));
    render(<MainDocumentPicker />);
    act(() => useMainDocumentStore.getState().openChange());
    await waitFor(() => expect(screen.getByText(labels.picker.failed)).toBeInTheDocument());
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });
});
