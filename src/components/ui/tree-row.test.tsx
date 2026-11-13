// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TreeRow } from "./tree-row";

const TOGGLE = "Collapse Intro";
const INTRO = "Intro";
const DETAIL = "Detail";
const ROW = "Row";
const HELP = "Row help";

describe("TreeRow", () => {
  it("indents by depth and toggles a branch through an expandable button", () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <>
        <TreeRow depth={0} expanded onToggle={onToggle} toggleLabel={TOGGLE} onSelect={onSelect} label={INTRO} />
        <TreeRow depth={2} onSelect={vi.fn()} label={DETAIL} trailing={<span>{3}</span>} />
      </>,
    );
    const toggle = screen.getByRole("button", { name: TOGGLE });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: INTRO }));
    expect(onSelect).toHaveBeenCalledOnce();

    const [first, second] = Array.from(container.children) as HTMLElement[];
    expect(Number.parseFloat(second.style.paddingLeft)).toBeGreaterThan(Number.parseFloat(first.style.paddingLeft));
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(second).toHaveTextContent("Detail3");
  });

  it("marks the active row as the current location", () => {
    render(<TreeRow depth={0} active onSelect={vi.fn()} label={ROW} tooltip={HELP} />);
    const row = screen.getByRole("button", { name: ROW });
    expect(row).toHaveAttribute("aria-current", "location");
    expect(row).not.toHaveAttribute("aria-pressed");
    expect(row).toHaveAttribute("data-tooltip", HELP);
    expect(row).not.toHaveAttribute("title");
  });
});
