// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutlineRail, railMarks } from "./outline-rail";

interface Heading {
  readonly level: number;
  readonly title: string;
}

const TITLE = "Outline";

const heading = (level: number, title: string): Heading => ({ level, title });

function Rail({
  items,
  hidden,
  onSelect = () => undefined,
}: Readonly<{ items: readonly Heading[]; hidden?: boolean; onSelect?: (title: string) => void }>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <output data-testid="open">{String(open)}</output>
      <OutlineRail
        items={items}
        itemKey={(item) => item.title}
        row={(item) => ({ label: item.title, onSelect: () => onSelect(item.title) })}
        activeIndex={1}
        title={TITLE}
        source="draft"
        open={open}
        onOpenChange={setOpen}
        hidden={hidden}
        top={24}
      />
    </>
  );
}

afterEach(cleanup);

describe("railMarks", () => {
  it("draws every heading, a level down as a shorter mark", () => {
    const rail = railMarks([heading(1, "A"), heading(2, "B"), heading(3, "C"), heading(4, "D")]);
    expect(rail.depths).toEqual([0, 1, 2, 2]);
    expect(rail.shown).toEqual([0, 1, 2, 3]);
  });

  it("keeps the upper levels when there are too many, lighting a hidden heading's section", () => {
    const items = [heading(2, "A"), heading(3, "A.1"), heading(3, "A.2"), heading(2, "B"), heading(3, "B.1")];
    expect(railMarks(items, 3)).toEqual({ depths: [0, 1, 1, 0, 1], shown: [0, 3], markOf: [0, 0, 0, 1, 1] });
    expect(railMarks(items, 1).shown).toEqual([0, 3]);
  });

  it("draws nothing for an empty outline", () => {
    expect(railMarks([])).toEqual({ depths: [], shown: [], markOf: [] });
  });
});

describe("OutlineRail", () => {
  const items = [heading(1, "Intro"), heading(2, "Methods"), heading(1, "Results")];

  it("lists the headings beside its marks and reports the chosen one", () => {
    const chosen = vi.fn();
    render(<Rail items={items} onSelect={chosen} />);
    expect(screen.getByTestId("outline-rail")).toHaveStyle({ top: "24px" });
    const trigger = screen.getByRole("button", { name: TITLE });
    const marks = trigger.querySelectorAll("span");
    expect(marks).toHaveLength(3);
    expect(marks[1]).toHaveAttribute("data-current");

    fireEvent.click(trigger);
    const list = screen.getByRole("dialog", { name: TITLE });
    expect(within(list).getByText("draft")).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Methods" })).toHaveAttribute("aria-current", "location");
    fireEvent.click(within(list).getByRole("button", { name: "Results" }));
    expect(chosen).toHaveBeenCalledWith("Results");
  });

  it("stays away with fewer than two marks, and closes when its host hides it", () => {
    render(<Rail items={[heading(1, "Only")]} />);
    expect(screen.queryByTestId("outline-rail")).toBeNull();
    cleanup();

    const { rerender } = render(<Rail items={items} />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    rerender(<Rail items={items} hidden />);
    expect(screen.queryByTestId("outline-rail")).toBeNull();
    expect(screen.getByTestId("open")).toHaveTextContent("false");
  });
});
