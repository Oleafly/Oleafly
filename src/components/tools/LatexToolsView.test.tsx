// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";

const mocks = vi.hoisted(() => ({ openTool: vi.fn() }));

vi.mock("@/features/open-tool", () => ({ openTool: mocks.openTool }));
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => null }));

import { LatexToolsView } from "./LatexToolsView";

beforeEach(() => {
  mocks.openTool.mockClear();
  useFilesStore.setState({ projectId: null });
  useHomeViewStore.setState({ page: "tools", activeConverter: null });
});

describe("LatexToolsView", () => {
  it("renders the catalog as a full page with 22 converter cards", () => {
    render(<LatexToolsView />);
    expect(screen.getByTestId("latex-tools-view")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("22", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByTestId("latex-tool-card-image-to-latex")).toBeVisible();
    expect(screen.getByTestId("latex-tool-card-word-to-latex")).toBeVisible();
  });

  it("filters by name, description, tag, or command", () => {
    render(<LatexToolsView />);
    fireEvent.change(screen.getByLabelText("Search Oleafly Tools"), {
      target: { value: "spreadsheet" },
    });
    expect(screen.getByTestId("latex-tool-card-excel-to-latex")).toBeVisible();
    expect(screen.queryByTestId("latex-tool-card-image-to-latex")).not.toBeInTheDocument();
  });

  it("opens the selected registry definition", () => {
    render(<LatexToolsView />);
    fireEvent.click(screen.getByTestId("latex-tool-card-latex-to-typst"));
    expect(mocks.openTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "latex-to-typst" }),
    );
  });
});
