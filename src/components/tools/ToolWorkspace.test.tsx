// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
        <div>Input</div>
        <div>Output</div>
      </ToolSplitView>,
    );
    expect(screen.getByText("Input")).toBeVisible();
    expect(screen.getByText("Output")).toBeVisible();
    expect(screen.getByRole("separator", { name: "Resize tool panels" })).toBeVisible();
  });

  it("stacks panes without a drag handle on narrow screens", () => {
    installMatchMedia(false);
    render(
      <ToolSplitView>
        <div>Input</div>
        <div>Output</div>
      </ToolSplitView>,
    );
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByTestId("tool-split-view")).toHaveClass("grid-cols-1");
  });

  it("stacks an incomplete split even on desktop", () => {
    installMatchMedia(true);
    render(<ToolSplitView><div>Only pane</div></ToolSplitView>);
    expect(screen.getByTestId("tool-split-view")).toHaveClass("grid");
  });

  it("renders the shared pane, preview, status, and segmented-control states", () => {
    const onChange = vi.fn();
    render(
      <ToolPane
        title="Output"
        badge="Ready"
        actions={<button type="button">Action</button>}
        footer={<span>Footer</span>}
        className="custom-pane"
      >
        <ToolPreviewSurface className="custom-preview">Preview</ToolPreviewSurface>
        <ToolStatus state="ready">Ready state</ToolStatus>
        <ToolStatus state="busy">Busy state</ToolStatus>
        <ToolStatus state="error">Error state</ToolStatus>
        <ToolSegmentedControl
          label="Output mode"
          value="first"
          onChange={onChange}
          options={[
            { value: "first", label: "First", testId: "first-mode" },
            { value: "second", label: "Second" },
          ]}
        />
      </ToolPane>,
    );
    expect(screen.getByRole("region", { name: "Output" })).toHaveClass("custom-pane");
    expect(screen.getByText("Preview")).toHaveClass("custom-preview");
    expect(screen.getByText("Footer")).toBeVisible();
    expect(screen.getByText("Ready state").firstElementChild).toHaveClass("bg-emerald-500");
    expect(screen.getByText("Busy state").firstElementChild).toHaveClass("bg-amber-500");
    expect(screen.getByText("Error state").firstElementChild).toHaveClass("bg-destructive");
    expect(screen.getByTestId("first-mode")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Second" }));
    expect(onChange).toHaveBeenCalledWith("second");
  });
});
