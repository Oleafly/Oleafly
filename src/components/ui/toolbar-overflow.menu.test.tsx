// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { Bold, Italic, Type } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Popover } from "./popover";
import {
  ICON_BUTTON_WIDTH,
  type ToolbarControl,
  ToolbarDropdown,
  ToolbarMenuItem,
  ToolbarOverflow,
  toolbarPicker,
} from "./toolbar-overflow";

const MORE = "More options";
const HEADING = "Heading";
const HEADING_LEVEL = "Heading level";
const BOLD = "Bold";
const ITALIC = "Italic";

function control(id: string, label: string, onSelect: () => void): ToolbarControl {
  return {
    id,
    width: ICON_BUTTON_WIDTH,
    render: () => <button type="button">{label}</button>,
    renderMenu: () => <ToolbarMenuItem key={id} icon={id === "bold" ? Bold : Italic} label={label} onSelect={onSelect} />,
  };
}

describe("ToolbarOverflow", () => {
  it("moves controls that do not fit into one More menu that closes after a pick", () => {
    const bold = vi.fn();
    render(<ToolbarOverflow label={MORE} controls={[control("bold", "Bold", bold), control("italic", "Italic", vi.fn())]} />);
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: MORE }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Bold" }));
    expect(bold).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("greys out a disabled menu item and ignores picking it", () => {
    const bold = vi.fn();
    const italic = vi.fn();
    const items: ToolbarControl = {
      id: "items",
      width: ICON_BUTTON_WIDTH,
      render: () => null,
      renderMenu: () => (
        <>
          <ToolbarMenuItem icon={Bold} label={BOLD} disabled onSelect={bold} />
          <ToolbarMenuItem icon={Italic} label={ITALIC} checked={false} disabled onSelect={italic} />
        </>
      ),
    };
    render(<ToolbarOverflow label={MORE} controls={[items]} />);
    fireEvent.click(screen.getByRole("button", { name: MORE }));
    const plain = screen.getByRole("menuitem", { name: BOLD });
    const check = screen.getByRole("menuitemcheckbox", { name: ITALIC });
    expect(plain).toHaveAttribute("aria-disabled", "true");
    expect(check).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(plain);
    fireEvent.click(check);
    expect(bold).not.toHaveBeenCalled();
    expect(italic).not.toHaveBeenCalled();
  });

  it("opens a dropdown's items as a submenu", () => {
    const pick = vi.fn();
    const heading: ToolbarControl = {
      id: "heading",
      width: ICON_BUTTON_WIDTH,
      render: () => null,
      renderMenu: () => (
        <ToolbarDropdown
          key="heading"
          variant="menu"
          icon={Type}
          label={HEADING}
          ariaLabel={HEADING_LEVEL}
          items={[{ key: "h1", content: "Title", onSelect: pick }]}
        />
      ),
    };
    render(<ToolbarOverflow label={MORE} controls={[heading]} />);
    fireEvent.click(screen.getByRole("button", { name: MORE }));
    fireEvent.click(screen.getByRole("menuitem", { name: HEADING_LEVEL }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Title" }));
    expect(pick).toHaveBeenCalledOnce();
  });

  it("hosts a popover picker as a menu row that opens it from the keyboard and keeps the menu open", () => {
    const picker = toolbarPicker("table", ICON_BUTTON_WIDTH, (menuRow) => (
      <Popover ariaLabel="Insert table" trigger={menuRow ? "Table" : "T"}>
        <p>{"Grid"}</p>
      </Popover>
    ));
    render(<ToolbarOverflow label={MORE} controls={[picker]} />);
    fireEvent.click(screen.getByRole("button", { name: MORE }));

    const row = screen.getByRole("menuitem", { name: "Table" });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByText("Grid")).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
