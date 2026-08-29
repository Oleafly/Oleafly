// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query";
import { useComposerOutputsStore } from "@/store/composer-outputs";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { AgenticHarness } from "./AgenticHarness";

vi.mock("@/lib/skills", () => ({
  useSkills: () => ({
    data: [
      {
        id: "research-review",
        name: "research-review",
        version: "1.0.0",
        description: "Review the manuscript.",
        instructions: "Review the manuscript like a referee.",
      },
    ],
  }),
}));

vi.mock("@/components/ai/ChatCore", () => ({
  ChatCore: ({ variant }: { variant?: string }) => (
    <div data-testid="chat-core" data-variant={variant ?? "panel"} />
  ),
}));

vi.mock("./TerminalPane", () => ({
  TerminalPane: ({ projectName }: { projectName?: string }) => (
    <div data-testid="terminal-pane-stub" data-project={projectName ?? ""} />
  ),
}));

function renderHarness() {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <AgenticHarness />
    </QueryClientProvider>,
  );
}

function setFiles(patch: Partial<ReturnType<typeof useFilesStore.getState>>) {
  useFilesStore.setState(patch as ReturnType<typeof useFilesStore.getState>);
}

describe("AgenticHarness", () => {
  beforeEach(() => {
    useHomeViewStore.setState({ page: "agentic-harness" });
    useFilesStore.setState({
      projectId: null,
      projectName: "",
      engineLoaded: false,
      projects: [
        { id: "p1", name: "Thesis", main_doc: "main.tex", kind: "latex", created_at: 1, updated_at: 2 },
      ] as unknown as ReturnType<typeof useFilesStore.getState>["projects"],
      openProject: async () => {
        setFiles({ projectId: "p1", engineLoaded: true });
      },
      tree: [],
    } as Partial<ReturnType<typeof useFilesStore.getState>>);
    useComposerOutputsStore.setState({ fileOpen: null, pdfEpoch: 0 });
  });

  it("renders nothing when the composer page is not active", () => {
    useHomeViewStore.setState({ page: "library" });
    renderHarness();
    expect(screen.queryByTestId("agentic-harness")).not.toBeInTheDocument();
  });

  it("shows the project chooser with a start-new affordance when no project is open", () => {
    renderHarness();
    expect(screen.getByTestId("harness-project-chooser")).toBeInTheDocument();
    expect(screen.getByTestId("harness-choose-project-p1")).toBeInTheDocument();
    expect(screen.getByTestId("harness-new-project")).toBeInTheDocument();
  });

  it("choosing a project mounts the composer chat surface", async () => {
    renderHarness();
    fireEvent.click(screen.getByTestId("harness-choose-project-p1"));
    await waitFor(() => expect(useFilesStore.getState().projectId).toBe("p1"));
    await waitFor(() => expect(screen.getByTestId("chat-core")).toHaveAttribute("data-variant", "composer"));
  });

  it("start-new opens the global new-project dialog", () => {
    useSettingsStore.setState({ newProjectOpen: false });
    renderHarness();
    fireEvent.click(screen.getByTestId("harness-new-project"));
    expect(useSettingsStore.getState().newProjectOpen).toBe(true);
  });

  it("keeps the output panels disabled until a project is open", () => {
    renderHarness();
    expect(screen.getByTestId("harness-panel-terminal")).toBeDisabled();
    expect(screen.getByTestId("harness-panel-files")).toBeDisabled();
  });

  it("opens a run's file as its own tab and focuses it", async () => {
    setFiles({ projectId: "p1", engineLoaded: true });
    renderHarness();
    expect(screen.queryByTestId("harness-file-viewer-path")).not.toBeInTheDocument();

    useComposerOutputsStore.getState().openFile("chapters/intro.tex", "write");

    await waitFor(() => expect(screen.getByTestId("harness-file-viewer-path")).toBeInTheDocument());
    expect(screen.getByTestId("harness-file-viewer-path")).toHaveTextContent("intro.tex");
    expect(
      screen.getByTestId("harness-tab-file:chapters/intro.tex"),
    ).toBeInTheDocument();
    // Reopening the same path focuses the existing tab instead of stacking.
    useComposerOutputsStore.getState().openFile("chapters/intro.tex", "read");
    expect(screen.getAllByTestId("harness-file-viewer-path")).toHaveLength(1);
  });

  it("renders project PDFs in a PDF viewer instead of the text reader", async () => {
    setFiles({ projectId: "p1", engineLoaded: true });
    renderHarness();

    useComposerOutputsStore.getState().openFile("extras/tux.pdf", "read");

    await waitFor(() => expect(screen.getByTestId("harness-pdf-file")).toBeInTheDocument());
    expect(screen.queryByTestId("harness-file-viewer")).not.toBeInTheDocument();
  });

  it("switches to the compiled-PDF tab after a successful compile", async () => {
    setFiles({ projectId: "p1", engineLoaded: true });
    renderHarness();

    useComposerOutputsStore.getState().openPdf();

    await waitFor(() => expect(screen.getByTestId("harness-tab-pdf")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("harness-panel-pdf")).toHaveClass("bg-accent"));
  });

  it("opens new panel tabs from the + picker and closes them individually", async () => {
    setFiles({ projectId: "p1", engineLoaded: true });
    renderHarness();

    // The strip (and its +) appears once the first tab exists — open one
    // from the rail, then use the picker for more.
    fireEvent.click(screen.getByTestId("harness-panel-terminal"));
    fireEvent.pointerDown(screen.getByTestId("harness-new-tab"), { button: 0 });
    fireEvent.click(screen.getByTestId("harness-new-tab"));
    fireEvent.click(await screen.findByText("Files"));
    expect(screen.getByTestId("harness-tab-files")).toBeInTheDocument();
    expect(screen.getByTestId("harness-tab-terminal")).toBeInTheDocument();

    // Closing the active tab falls back to a neighbor; the rest stay.
    fireEvent.click(screen.getByTestId("harness-tab-close-files"));
    expect(screen.queryByTestId("harness-tab-files")).not.toBeInTheDocument();
    expect(screen.getByTestId("harness-tab-terminal")).toBeInTheDocument();
  });

  it("collapses the output panel without losing its tabs", async () => {
    setFiles({ projectId: "p1", engineLoaded: true });
    renderHarness();
    useComposerOutputsStore.getState().openFile("chapters/intro.tex", "read");
    await waitFor(() => expect(screen.getByTestId("harness-file-viewer-path")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("harness-panel-collapse"));
    expect(screen.queryByTestId("harness-file-viewer-path")).not.toBeInTheDocument();

    // Reopening from the tab itself restores the same file.
    fireEvent.click(screen.getByTestId("harness-tab-label-file:chapters/intro.tex"));
    await waitFor(() => expect(screen.getByTestId("harness-file-viewer-path")).toBeInTheDocument());
    expect(screen.getByTestId("harness-file-viewer-path")).toHaveTextContent("intro.tex");
  });

  it("closes back to the library via the home button", () => {
    renderHarness();
    fireEvent.click(screen.getByLabelText("Back to home"));
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("home with a project open closes it instead of revealing the editor", () => {
    const closeProject = vi.fn(async () => {});
    setFiles({ projectId: "p1", engineLoaded: true, closeProject });
    renderHarness();
    fireEvent.click(screen.getByLabelText("Back to home"));
    expect(closeProject).toHaveBeenCalledTimes(1);
    // The route flag itself is untouched; the project close routes home.
    expect(useHomeViewStore.getState().page).toBe("agentic-harness");
  });
});
