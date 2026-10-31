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

const mocks = vi.hoisted(() => ({
  openTool: vi.fn(),
  withoutArt: new Set<string>(),
}));

vi.mock("@/features/open-tool", () => ({ openTool: mocks.openTool }));
vi.mock("./tool-art", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tool-art")>();
  return {
    ...actual,
    toolArt: (id: Parameters<typeof actual.toolArt>[0]) =>
      mocks.withoutArt.has(id) ? undefined : actual.toolArt(id),
  };
});
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => null }));

import { LatexToolsView } from "./LatexToolsView";

const CATEGORY_KEYS: readonly ToolCategory[] = [...TOOL_CATEGORY_ORDER];

function searchBox() {
  return screen.getByLabelText(enResearchTools.tools.searchAria);
}

beforeEach(() => {
  mocks.openTool.mockClear();
  mocks.withoutArt.clear();
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

  it("renders the catalog as a full page with 32 converter cards", () => {
    render(<LatexToolsView />);
    expect(screen.getByTestId("latex-tools-view")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: enResearchTools.tools.heroTitle })).toBeVisible();
    expect(screen.getByText(enResearchTools.tools.heroBody)).toBeVisible();
    expect(screen.getByText("32", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByTestId("latex-tool-card-image-to-latex")).toBeVisible();
    expect(screen.getByTestId("latex-tool-card-word-to-latex")).toBeVisible();
    for (const id of [
      "word-to-typst",
      "typst-to-word",
      "typst-to-html",
      "typst-to-markdown",
      "mermaid-to-typst",
      "arxiv-to-typst",
      "equation-to-typst",
      "csv-to-typst",
      "excel-to-typst",
      "html-to-typst",
    ]) {
      expect(screen.getByTestId(`latex-tool-card-${id}`)).toBeVisible();
    }
    expect(screen.getByTestId("latex-tool-card-doi-to-bibtex")).toBeVisible();
    expect(screen.getByTestId("latex-tool-card-url-to-bibtex")).toBeVisible();
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
      expect(screen.getByText(toolCategoryLabel(category))).toBeInTheDocument();
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

  it("tops every card with a decorative picture instead of the icon", () => {
    render(<LatexToolsView />);
    for (const tool of TOOL_DEFINITIONS) {
      const card = screen.getByTestId(`latex-tool-card-${tool.id}`);
      const picture = card.querySelector("img");
      expect(picture, tool.id).not.toBeNull();
      expect(picture).toHaveAttribute("src", `/tool-art/${tool.id}.webp`);
      expect(picture).toHaveAttribute("alt", "");
      expect(picture).toHaveAttribute("aria-hidden", "true");
      expect(picture).toHaveAttribute("loading", "lazy");
      expect(picture).toHaveAttribute("decoding", "async");
      expect(card.querySelector("svg"), tool.id).toBeNull();
      expect(card).toHaveTextContent(toolName(tool.id));
      expect(card).toHaveTextContent(`/${tool.slash[0]}`);
      expect(card).toHaveTextContent(toolDescription(tool.id));
      for (const tag of toolTags(tool.id)) expect(card).toHaveTextContent(tag);
    }
    expect(
      screen.getByRole("button", { name: new RegExp(`^${toolName("bibtex")}`) }),
    ).toBe(screen.getByTestId("latex-tool-card-bibtex"));
  });

  it("falls back to the tool's icon when it has no picture", () => {
    mocks.withoutArt.add("bibtex");
    render(<LatexToolsView />);
    const card = screen.getByTestId("latex-tool-card-bibtex");
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("latex-tool-card-doi-to-bibtex").querySelector("img")).not.toBeNull();
  });

  it("keeps each card a focusable native button, so Enter and Space open it", () => {
    render(<LatexToolsView />);
    const card = screen.getByTestId("latex-tool-card-stats");
    expect(card.tagName).toBe("BUTTON");
    expect(card).toHaveAttribute("type", "button");
    card.focus();
    expect(card).toHaveFocus();
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
