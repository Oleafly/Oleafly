// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { DetectionCandidate, FolderDetection, OpenedFolder } from "@/lib/folder-detection";

const mocks = vi.hoisted(() => ({
  chooseMainDocument: vi.fn(),
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
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/store/main-document", () => ({
  chooseMainDocument: mocks.chooseMainDocument,
}));

import { describeError } from "@/lib/app-error";
import { useFilesStore } from "@/store/files";
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
});

afterEach(() => {
  useOpenFolderStore.getState().dismiss();
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

  it("stays closed for a folder whose main was clear", () => {
    render(<MainDocumentPicker />);
    present({ ...ambiguous, main: "paper/main.tex", decision: "auto" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("says why when a read-only folder refuses the choice", async () => {
    const refused = new Error(
      `@oleafly/error:${JSON.stringify({
        code: "project.folder_read_only",
        params: { name: "project.json" },
        detail: null,
      })}`,
    );
    mocks.chooseMainDocument.mockRejectedValue(refused);
    render(<MainDocumentPicker />);
    present();
    fireEvent.click(screen.getByRole("button", { name: labels.picker.open }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledTimes(1));
    expect(mocks.notifyError).toHaveBeenCalledWith("choose the main document", refused, undefined);
    expect(describeError(refused)).toBe(
      "Oleafly can't make this change because project.json or its folder is read-only. Copy the folder you opened into your library and edit it there.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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
    });
    present(ambiguous, "linked-b");
    expect(screen.getByRole("button", { name: labels.picker.open })).not.toBeDisabled();
    await act(async () => finish(false));
    expect(useOpenFolderStore.getState().opened?.project_id).toBe("linked-b");
    expect(screen.getByRole("dialog", { name: labels.picker.askTitle })).toBeInTheDocument();
  });

  it("says when the search stopped early", () => {
    render(<MainDocumentPicker />);
    present({ ...ambiguous, truncated: true });
    expect(screen.getByText(labels.picker.truncated)).toBeInTheDocument();
  });

  it("explains a list with no documents", () => {
    render(<MainDocumentPicker />);
    present({ ...ambiguous, candidates: [] });
    expect(screen.getByText(labels.picker.empty)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: labels.picker.open })).toBeDisabled();
  });
});
