// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { FileNoticesBanner } from "./FileNoticesBanner";
import { useFileNotices } from "./file-notices";
import { receiveOverleafTree } from "./overleaf-tree";

const PROJECT = "project-1";

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  useFilesStore.setState({ projectId: PROJECT });
  useFileNotices.setState({
    projectId: PROJECT,
    uploads: [],
    kept: [],
    notAllowed: [],
    keptAway: [],
    linkedKept: [],
    downloads: {},
    offer: null,
    broughtIn: null,
  });
});

describe("FileNoticesBanner on Overleaf", () => {
  it("says which changes stay on this computer and which files are still on Overleaf, and dismisses both", async () => {
    render(<FileNoticesBanner />);
    act(() => {
      receiveOverleafTree({ projectId: PROJECT, kind: "not_allowed", paths: ["chapters/mine.tex", "plot.png"] });
      receiveOverleafTree({ projectId: PROJECT, kind: "kept_away", paths: ["notes.tex"] });
    });
    expect(screen.getByTestId("collab-tree-not-allowed")).toHaveTextContent(
      "You can't change files in this project on Overleaf, so your changes to mine.tex and plot.png stay on this computer.",
    );
    expect(screen.getByTestId("collab-tree-kept-away")).toHaveTextContent("Deleted here but still on Overleaf: notes.tex");
    for (const button of screen.getAllByRole("button", { name: "Dismiss" })) await userEvent.click(button);
    expect(screen.queryByTestId("collab-tree-not-allowed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("collab-tree-kept-away")).not.toBeInTheDocument();
  });

  it("says an edit to a linked file stays here, without repeating a path, and dismisses it", async () => {
    render(<FileNoticesBanner />);
    act(() => {
      receiveOverleafTree({ projectId: PROJECT, kind: "linked_kept", paths: ["refs.bib"] });
      receiveOverleafTree({ projectId: PROJECT, kind: "linked_kept", paths: ["refs.bib"] });
    });
    expect(screen.getByTestId("collab-tree-linked-kept")).toHaveTextContent(
      "Overleaf links refs.bib to a source, so your changes stay on this computer. Choose Refresh from source to get the Overleaf copy back.",
    );
    expect(useFileNotices.getState().linkedKept).toEqual(["refs.bib"]);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("collab-tree-linked-kept")).not.toBeInTheDocument();
  });

  it("shows how far each big download got, and nothing once it is done", () => {
    render(<FileNoticesBanner />);
    act(() => useFileNotices.setState({ downloads: { "figures/scan.png": { done: 512, total: 2048 } } }));
    const row = screen.getByTestId("collab-download-progress");
    expect(row).toHaveTextContent(/^Downloading scan\.png: /);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    act(() => useFileNotices.setState({ downloads: {} }));
    expect(screen.queryByTestId("collab-download-progress")).not.toBeInTheDocument();
  });

  it("shows how much arrived when the server does not say how big the file is", () => {
    render(<FileNoticesBanner />);
    act(() => useFileNotices.setState({ downloads: { "figures/scan.png": { done: 1_572_864, total: null } } }));
    expect(screen.getByTestId("collab-download-progress")).toHaveTextContent(/^Downloading scan\.png: \S/);
    expect(screen.getByTestId("collab-download-progress")).not.toHaveTextContent(" of ");
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("data-state", "indeterminate");
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });
});
