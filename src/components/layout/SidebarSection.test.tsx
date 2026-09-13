// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarSection } from "./SidebarSection";

describe("SidebarSection", () => {
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
