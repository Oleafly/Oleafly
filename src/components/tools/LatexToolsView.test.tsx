// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { LatexToolsView } from "@/components/tools/LatexToolsView";
import { useHomeViewStore } from "@/store/home-view";
import {
  TOOL_CATEGORY_ORDER,
  TOOL_DEFINITIONS,
  toolCategoryLabel,
  toolDescription,
  toolName,
  toolTags,
} from "@/lib/tool-catalog";

function searchBox() {
  return screen.getByLabelText(enResearchTools.tools.searchAria);
}

beforeEach(() => {
  useHomeViewStore.setState({ page: "library", toolsOpen: true });
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

  it("resolves a label for every category", () => {
    for (const category of TOOL_CATEGORY_ORDER) {
      expect(toolCategoryLabel(category).length).toBeGreaterThan(0);
    }
  });
});

describe("LatexToolsView", () => {
  it("renders nothing while the gallery is closed", () => {
    useHomeViewStore.setState({ toolsOpen: false });
    const { container } = render(<LatexToolsView />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a card for every tool grouped by category", () => {
    render(<LatexToolsView />);
    expect(screen.getByTestId("latex-tools-view")).toBeInTheDocument();
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

  it("opens a tool's page and closes the gallery", () => {
    render(<LatexToolsView />);
    fireEvent.click(screen.getByTestId("latex-tool-card-bibtex"));
    expect(useHomeViewStore.getState().toolsOpen).toBe(false);
    expect(useHomeViewStore.getState().page).toBe("bibtex");
  });

  it("closes from the header button", () => {
    render(<LatexToolsView />);
    fireEvent.click(
      screen.getByRole("button", { name: enCommon.actions.close }),
    );
    expect(useHomeViewStore.getState().toolsOpen).toBe(false);
  });

  it("closes when the backdrop is pressed", () => {
    render(<LatexToolsView />);
    fireEvent.mouseDown(
      screen.getByRole("button", {
        name: enResearchTools.tools.closeGallery,
      }),
    );
    expect(useHomeViewStore.getState().toolsOpen).toBe(false);
  });
});
