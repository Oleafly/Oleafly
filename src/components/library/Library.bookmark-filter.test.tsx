// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/library/HomeDock", () => ({
  HomeDock: () => null,
  HOME_DOCK_GLASS_SURFACE: "",
}));
vi.mock("@/components/layout/WindowControls", () => ({
  WindowControls: () => null,
}));
vi.mock("@/components/layout/LeafLogo", () => ({ LeafLogo: () => null }));
vi.mock("@/components/pdf/PdfViewer", () => ({
  PdfViewer: ({ data }: { data: Uint8Array | null }) => (
    <div data-testid="library-pdf-viewer">{data?.byteLength ?? 0}</div>
  ),
}));
vi.mock("@/components/library/ProjectImportMenu", () => ({
  ProjectImportMenu: ({
    trigger,
  }: {
    trigger: (busy: boolean) => ReactNode;
  }) => trigger(false),
}));
vi.mock("@/components/library/Book", () => ({
  Book: () => <div>Project card</div>,
  BOOK_COLOR_OPTIONS: ["#287fd1"],
  DEFAULT_BOOK_COLOR: "#287fd1",
}));
vi.mock("@/lib/tauri", () => ({
  appendAppLog: vi.fn(async () => {}),
  recycleProject: vi.fn(),
  duplicateProject: vi.fn(),
  readCompiledPdf: vi.fn(async () => new Uint8Array([1])),
  setProjectColor: vi.fn(async () => {}),
}));
vi.mock("@/lib/pdf-image", () => ({
  pdfPageToPng: vi.fn(async () => "data:image/png;base64,preview"),
}));

import { Library } from "./Library";
import { useFavoritesStore } from "@/store/favorites";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

beforeEach(() => {
  localStorage.clear();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();

  useHomeViewStore.setState({ page: "library" });
  useFavoritesStore.setState({ favs: ["paper"] });
  useSettingsStore.setState({
    bgPattern: "none",
    hoverPreview: false,
    homeProjectLayout: "grid",
  });
  useFilesStore.setState({
    projectsLoaded: true,
    projects: [
      {
        id: "paper",
        name: "Research paper",
        main_doc: "main.tex",
        engine: "tectonic",
        kind: "document",
        created_at: 1,
        updated_at: 1,
        has_preview: true,
        exports: [],
        forked_from: null,
      },
    ],
    refreshProjects: vi.fn(async () => {}),
    openProject: vi.fn(async () => {}),
  });
});

describe("Library bookmark filters", () => {
  it("shows the current product scope and only one import action when empty", () => {
    useFilesStore.setState({ projects: [], projectsLoaded: true });

    render(<Library />);

    expect(screen.getByRole("img", { name: "Oleafly app icon" })).toHaveAttribute(
      "src",
      "/oleafly-tile-gradient.png",
    );
    expect(
      screen.getByText(/Write, compile, and proofread LaTeX, Typst, and Markdown/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^Oleafly$/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("import-project-button")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Import an existing project" }),
    ).toHaveLength(1);
  });

  it("filters projects from the library header search", () => {
    render(<Library />);

    const search = screen.getByRole("searchbox", { name: "Search projects" });
    expect(search).toHaveAttribute(
      "placeholder",
      "Search 1 project by name, ID, main file, color, or export",
    );
    fireEvent.change(search, {
      target: { value: "missing project" },
    });

    expect(screen.getByText("No matches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear project search" }));
    expect(screen.getByTestId("project-grid")).toBeInTheDocument();
  });

  it("keeps bookmark filtering in the advanced filter panel", async () => {
    render(<Library />);

    fireEvent.click(
      screen.getByRole("button", { name: "Advanced project filters" }),
    );
    expect(screen.queryByText("Project metadata")).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing \d+ of \d+ projects/)).not.toBeInTheDocument();
    fireEvent.pointerDown(screen.getByLabelText("Bookmark"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Bookmarked" }));

    expect(screen.getByLabelText("Bookmark")).toHaveTextContent("Bookmarked");
    expect(
      screen.queryByRole("button", { name: "Show all projects" }),
    ).not.toBeInTheDocument();
  });

  it("closes advanced filters on an outside click", async () => {
    render(<Library />);

    fireEvent.click(
      screen.getByRole("button", { name: "Advanced project filters" }),
    );
    expect(
      screen.getByRole("heading", { name: "Advanced filters" }),
    ).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    fireEvent.pointerDown(screen.getByRole("heading", { name: "Oleafly" }), {
      button: 0,
      pointerType: "mouse",
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Advanced filters" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("switches between grid and list layouts and remembers the choice", () => {
    const view = render(<Library />);

    expect(screen.getByRole("heading", { name: "Oleafly" })).toBeInTheDocument();
    expect(screen.queryByText("1 project")).not.toBeInTheDocument();
    expect(screen.queryByText("All projects")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-grid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "List view" }));

    expect(screen.getByTestId("project-list")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Research paper" })).toBeInTheDocument();
    const favorite = screen.getByRole("button", {
      name: "Remove from favorites",
    });
    expect(favorite.querySelector(".lucide-bookmark-check")).not.toBeNull();
    expect(favorite).toHaveStyle({ color: "rgb(245, 158, 11)" });
    expect(useSettingsStore.getState().homeProjectLayout).toBe("list");
    expect(localStorage.getItem("oleafly.library.projectLayout")).toBe("list");

    view.unmount();
    render(<Library />);
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("restores the list book color when a hover preview ends", async () => {
    useSettingsStore.setState({ hoverPreview: true });
    render(<Library />);
    fireEvent.click(screen.getByRole("button", { name: "List view" }));

    const projectButton = screen.getByRole("button", {
      name: "Open Research paper",
    });
    const projectList = screen.getByTestId("project-list");

    fireEvent.mouseEnter(projectButton);
    await waitFor(() => expect(projectList.querySelector("img")).not.toBeNull());

    fireEvent.mouseLeave(projectButton);
    expect(projectList.querySelector("img")).toBeNull();
  });

  it("marks forked projects in the list actions", () => {
    useFilesStore.setState((state) => ({
      projects: [
        ...state.projects.map((project) => ({
          ...project,
          forked_from: "original-paper",
        })),
        {
          ...state.projects[0],
          id: "original-paper",
          name: "Original research",
          forked_from: null,
        },
      ],
    }));
    render(<Library />);
    fireEvent.click(screen.getByRole("button", { name: "List view" }));

    expect(
      screen.getByRole("img", { name: "Forked from Original research" }),
    ).toBeInTheDocument();
  });

  it("opens the compiled PDF from the list preview action", async () => {
    render(<Library />);
    fireEvent.click(screen.getByRole("button", { name: "List view" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Preview Research paper" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "PDF preview — Research paper",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveClass("max-w-[54rem]");
    expect(await screen.findByTestId("library-pdf-viewer")).toHaveTextContent(
      "1",
    );
  });
});
