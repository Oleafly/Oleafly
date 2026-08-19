// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/library/HomeDock", () => ({ HomeDock: () => null }));
vi.mock("@/components/layout/WindowControls", () => ({
  WindowControls: () => null,
}));
vi.mock("@/components/layout/LeafLogo", () => ({ LeafLogo: () => null }));
vi.mock("@/components/library/ProjectImportMenu", () => ({
  ProjectImportMenu: () => null,
}));
vi.mock("@/components/library/Book", () => ({
  Book: () => <div>Project card</div>,
  BOOK_COLOR_OPTIONS: ["#287fd1"],
  DEFAULT_BOOK_COLOR: "#287fd1",
}));
vi.mock("@/lib/tauri", () => ({
  appendAppLog: vi.fn(async () => {}),
  deleteProject: vi.fn(),
  duplicateProject: vi.fn(),
  readCompiledPdf: vi.fn(),
  setProjectColor: vi.fn(async () => {}),
}));

import { Library } from "./Library";
import { useFavoritesStore } from "@/store/favorites";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();

  useHomeViewStore.setState({ page: "library" });
  useFavoritesStore.setState({ favs: ["paper"] });
  useSettingsStore.setState({ bgPattern: "none", hoverPreview: false });
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
  it("selects the top bookmark control when the advanced filter is Bookmarked", async () => {
    render(<Library />);

    fireEvent.click(
      screen.getByRole("button", { name: "Advanced project filters" }),
    );
    fireEvent.pointerDown(screen.getByLabelText("Bookmark"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Bookmarked" }));

    expect(
      screen.getByRole("button", { name: "Show all projects" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
