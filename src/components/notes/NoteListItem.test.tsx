// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteLinkSection, NoteListItem, NoteRowMenu } from "./NoteListItem";

const TITLE = "Lab log";
const MORE = "More";
const ICON = "icon";
const BADGE = "shared";

describe("NoteListItem", () => {
  it("opens from a button that covers the whole row and sets no arrow cursor on the row or anything in it", () => {
    const { container } = render(
      <NoteListItem
        icon={<span>{ICON}</span>}
        title={TITLE}
        meta="you, today"
        snippet="first line"
        badge={<span>{BADGE}</span>}
        trailing={<NoteRowMenu label={MORE}>{null}</NoteRowMenu>}
        onClick={vi.fn()}
      />,
    );
    const open = screen.getByRole("button", { name: TITLE });
    expect(open.tagName).toBe("BUTTON");
    expect(open).toHaveClass("before:absolute", "before:inset-0");
    expect(container.firstElementChild).toHaveClass("relative");
    const elements = [container.firstElementChild, ...container.querySelectorAll("*")];
    const arrows = elements.filter((element) => /\bcursor-(?:default|auto)\b|\bselect-text\b/u.test(element?.getAttribute("class") ?? ""));
    expect(arrows).toEqual([]);
  });
});

describe("NoteLinkSection", () => {
  it("names the region by its title and folds the list only when it can be folded", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <NoteLinkSection title={TITLE} footer={<p>{MORE}</p>}>
        <li>{ICON}</li>
      </NoteLinkSection>,
    );
    expect(screen.getByRole("heading", { name: TITLE })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(
      <NoteLinkSection title={TITLE} count={3} open={false} onOpenChange={onOpenChange} footer={<p>{MORE}</p>}>
        <li>{ICON}</li>
      </NoteLinkSection>,
    );
    const toggle = screen.getByRole("button", { name: `${TITLE} 3` });
    expect(screen.getByRole("region", { name: TITLE })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).toHaveAttribute("hidden");
    expect(screen.queryByText(ICON)).not.toBeInTheDocument();
    expect(screen.queryByText(MORE)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
