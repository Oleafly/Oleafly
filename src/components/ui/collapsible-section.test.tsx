// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { Search } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { CollapsibleSection } from "./collapsible-section";

const FIND_AGENTS = "Find more agents";
const ADD_AGENT = "Add a custom agent";
const SWITCH = "Switch";
const BODY = "Body";

describe("CollapsibleSection", () => {
  it("keeps the icon first and the chevron at the far end, after the trailing controls", () => {
    render(
      <CollapsibleSection id="demo" title={FIND_AGENTS} icon={Search} trailing={<button type="button">{SWITCH}</button>}>
        <p>{BODY}</p>
      </CollapsibleSection>,
    );
    const row = screen.getByTestId("demo-toggle").parentElement as HTMLElement;
    const chevron = row.querySelector('[data-slot="collapsible-chevron"]');
    expect(row.lastElementChild).toBe(chevron);
    expect(screen.getByTestId("demo-toggle").firstElementChild).toHaveClass("lucide-search");
    expect(chevron).not.toHaveClass("rotate-90");
  });

  it("opens from the toggle, turns the chevron and leaves trailing controls to themselves", () => {
    const onOpenChange = vi.fn();
    const onTrailing = vi.fn();
    render(
      <CollapsibleSection
        id="demo"
        title={ADD_AGENT}
        onOpenChange={onOpenChange}
        trailing={
          <button type="button" onClick={onTrailing}>
            {SWITCH}
          </button>
        }
      >
        <p>{BODY}</p>
      </CollapsibleSection>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(onTrailing).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Body")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("demo-toggle"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("demo-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="collapsible-chevron"]')).toHaveClass("rotate-90");
  });
});
