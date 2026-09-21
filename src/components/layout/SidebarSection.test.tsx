// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarSection } from "./SidebarSection";

const TITLE = "Explorer";
const ACTION_LABEL = "Expand all";
const CONTENT = "Section content";

describe("SidebarSection", () => {
  it("reveals actions from hover or focus anywhere in the section", () => {
    render(
      <SidebarSection
        id="test-section"
        title={TITLE}
        open
        onOpenChange={vi.fn()}
        actions={<button type="button">{ACTION_LABEL}</button>}
      >
        <div>{CONTENT}</div>
      </SidebarSection>,
    );

    const section = screen.getByTestId("test-section");
    const actions = screen.getByTestId("test-section-actions");
    expect(section).toHaveClass("group/section");
    expect(section.firstElementChild).not.toHaveClass("group/section");
    expect(actions).toHaveClass(
      "hidden",
      "group-hover/section:flex",
      "group-focus-within/section:flex",
      "has-[[data-state=open]]:flex",
    );
    expect(screen.getByRole("button", { name: ACTION_LABEL })).toBeInTheDocument();
  });

  it("keeps one clear divider at the end of collapsed and expanded sections", () => {
    const props = {
      id: "test-section",
      title: "Explorer",
      onOpenChange: vi.fn(),
      children: <div />,
    };
    const { rerender } = render(<SidebarSection {...props} open={false} />);

    const section = screen.getByTestId("test-section");
    const header = section.firstElementChild;
    expect(section).toHaveClass("border-b", "border-sidebar-border");
    expect(header).not.toHaveClass("border-b");

    rerender(<SidebarSection {...props} open />);
    expect(section.firstElementChild).toHaveClass(
      "border-b",
      "border-sidebar-border/65",
    );
  });
});
