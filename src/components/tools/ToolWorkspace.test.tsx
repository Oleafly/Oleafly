// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import {
  ToolPane,
  ToolPreviewSurface,
  ToolSegmentedControl,
  ToolSplitView,
  ToolStatus,
} from "./ToolWorkspace";

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(min-width: 768px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ToolSplitView", () => {
  it("gives two-pane desktop tools a keyboard-accessible resize handle", () => {
    installMatchMedia(true);
    render(
      <ToolSplitView storageId="test-tool">
        <div>{enResearchTools.bibtex.inputHeading}</div>
        <div>{enResearchTools.table.output}</div>
      </ToolSplitView>,
    );
    expect(screen.getByText(enResearchTools.bibtex.inputHeading)).toBeVisible();
    expect(screen.getByText(enResearchTools.table.output)).toBeVisible();
    expect(screen.getByRole("separator", { name: enResearchTools.tools.resizePanels })).toBeVisible();
  });

  it("stacks panes without a drag handle on narrow screens", () => {
    installMatchMedia(false);
    render(
      <ToolSplitView>
        <div>{enResearchTools.bibtex.inputHeading}</div>
        <div>{enResearchTools.table.output}</div>
      </ToolSplitView>,
    );
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByTestId("tool-split-view")).toHaveClass("grid-cols-1");
  });

  it("stacks an incomplete split even on desktop", () => {
    installMatchMedia(true);
    render(<ToolSplitView><div>{enResearchTools.tools.noMatches}</div></ToolSplitView>);
    expect(screen.getByTestId("tool-split-view")).toHaveClass("grid");
  });

  it("renders the shared pane, preview, status, and segmented-control states", () => {
    const onChange = vi.fn();
    render(
      <ToolPane
        title={enResearchTools.table.output}
        badge={enResearchTools.equation.statusRendered}
        actions={<button type="button">{enCommon.actions.apply}</button>}
        footer={<span>{enResearchTools.tools.gallerySubtitle}</span>}
        className="custom-pane"
      >
        <ToolPreviewSurface className="custom-preview">{enResearchTools.equation.previewHeading}</ToolPreviewSurface>
        <ToolStatus state="ready">{enResearchTools.equation.statusRendered}</ToolStatus>
        <ToolStatus state="busy">{enCommon.state.loading}</ToolStatus>
        <ToolStatus state="error">{enResearchTools.equation.statusError}</ToolStatus>
        <ToolSegmentedControl
          label={enResearchTools.equation.exportOptions}
          value="first"
          onChange={onChange}
          options={[
            { value: "first", label: enResearchTools.equation.inline, testId: "first-mode" },
            { value: "second", label: enResearchTools.equation.display },
          ]}
        />
      </ToolPane>,
    );
    expect(screen.getByRole("region", { name: enResearchTools.table.output })).toHaveClass("custom-pane");
    expect(screen.getByText(enResearchTools.equation.previewHeading)).toHaveClass("custom-preview");
    expect(screen.getByText(enResearchTools.tools.gallerySubtitle)).toBeVisible();
    expect(screen.getAllByText(enResearchTools.equation.statusRendered).at(-1)?.firstElementChild).toHaveClass("bg-emerald-500");
    expect(screen.getByText(enCommon.state.loading).firstElementChild).toHaveClass("bg-amber-500");
    expect(screen.getByText(enResearchTools.equation.statusError).firstElementChild).toHaveClass("bg-destructive");
    expect(screen.getByTestId("first-mode")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: enResearchTools.equation.display }));
    expect(onChange).toHaveBeenCalledWith("second");
  });
});
