// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";
import {
  TOOL_CATEGORY_ORDER,
  TOOL_DEFINITIONS,
  toolCategoryLabel,
  toolDescription,
  toolName,
  toolTags,
  type ToolCategory,
} from "@/lib/tool-catalog";

const mocks = vi.hoisted(() => ({ openTool: vi.fn() }));

vi.mock("@/features/open-tool", () => ({ openTool: mocks.openTool }));
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => null }));

import { LatexToolsView } from "./LatexToolsView";

const CATEGORY_KEYS: readonly ToolCategory[] = [
  "convert",
  "validate",
  "tables",
  "research",
];

function searchBox() {
  return screen.getByLabelText(enResearchTools.tools.searchAria);
}

beforeEach(() => {
  mocks.openTool.mockClear();
  useFilesStore.setState({ projectId: null });
  useHomeViewStore.setState({ page: "tools", activeConverter: null });
});

describe("tool catalog copy", () => {
  it("resolves a name, a description and tags for every tool", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(toolName(tool.id).length).toBeGreaterThan(0);
      expect(toolDescription(tool.id).length).toBeGreaterThan(0);
      const tags = toolTags(tool.id);
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag.length).toBeGreaterThan(0);
    }
  });

  it("resolves a label for every localized category", () => {
    for (const category of CATEGORY_KEYS) {
      expect(toolCategoryLabel(category).length).toBeGreaterThan(0);
    }
  });
});

describe("LatexToolsView", () => {
  it("renders nothing while another page is active", () => {
    useHomeViewStore.setState({ page: "library" });
    const { container } = render(<LatexToolsView />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the catalog as a full page with 22 converter cards", () => {
    render(<LatexToolsView />);
    expect(screen.getByTestId("latex-tools-view")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("22", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByTestId("latex-tool-card-image-to-latex")).toBeVisible();
    expect(screen.getByTestId("latex-tool-card-word-to-latex")).toBeVisible();
  });

  it("renders a card for every tool grouped by category", () => {
    render(<LatexToolsView />);
    expect(
      screen.getByText(enResearchTools.tools.galleryTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.tools.gallerySubtitle),
    ).toBeInTheDocument();
    for (const tool of TOOL_DEFINITIONS) {
      expect(
        screen.getByTestId(`latex-tool-card-${tool.id}`),
      ).toBeInTheDocument();
    }
    for (const category of TOOL_CATEGORY_ORDER) {
      expect(screen.getByText(category)).toBeInTheDocument();
    }
    expect(searchBox()).toHaveAttribute(
      "placeholder",
      enResearchTools.tools.searchPlaceholder.replace(
        "{{total}}",
        String(TOOL_DEFINITIONS.length),
      ),
    );
  });

  it("filters by name, description, tag, or command", () => {
    render(<LatexToolsView />);
    fireEvent.change(searchBox(), { target: { value: "spreadsheet" } });
    expect(screen.getByTestId("latex-tool-card-excel-to-latex")).toBeVisible();
    expect(screen.queryByTestId("latex-tool-card-image-to-latex")).not.toBeInTheDocument();
  });

  it("filters the gallery by slash command", () => {
    render(<LatexToolsView />);
    fireEvent.change(searchBox(), {
      target: { value: TOOL_DEFINITIONS[0].slash[0] },
    });
    expect(
      screen.getByTestId(`latex-tool-card-${TOOL_DEFINITIONS[0].id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`latex-tool-card-${TOOL_DEFINITIONS[1].id}`),
    ).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    render(<LatexToolsView />);
    fireEvent.change(searchBox(), { target: { value: "zzzzz-no-such-tool" } });
    expect(
      screen.getByText(enResearchTools.tools.noMatches),
    ).toBeInTheDocument();
  });

  it("opens the selected registry definition", () => {
    render(<LatexToolsView />);
    fireEvent.click(screen.getByTestId("latex-tool-card-latex-to-typst"));
    expect(mocks.openTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "latex-to-typst" }),
    );
  });

  it("opens a tool page from its card", () => {
    render(<LatexToolsView />);
    fireEvent.click(screen.getByTestId("latex-tool-card-bibtex"));
    expect(mocks.openTool).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "bibtex",
        destination: { kind: "page", page: "bibtex" },
      }),
    );
  });
});
