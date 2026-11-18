// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { Bold, Italic, Type } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Popover } from "./popover";
import {
  ICON_BUTTON_WIDTH,
  type ToolbarControl,
  ToolbarDropdown,
  ToolbarMenuButton,
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

  function levels(pick: (key: string) => void) {
    return [
      { key: "h1", content: "Title", checked: false },
      { key: "h2", content: "Section", checked: true },
      { key: "h3", content: "Subsection", checked: false },
    ].map((level) => ({ ...level, onSelect: () => pick(level.key) }));
  }

  function checkedRows(): [string, string | null, boolean][] {
    return screen
      .getAllByRole("menuitemcheckbox")
      .map((row) => [row.textContent ?? "", row.getAttribute("aria-checked"), row.querySelector('[data-slot="check-badge"]') !== null]);
  }

  it("checks the current choice in the bar dropdown, draws its trigger like its neighbours, and picks from it", () => {
    const pick = vi.fn();
    render(<ToolbarDropdown variant="bar" icon={Type} label={HEADING} ariaLabel={HEADING_LEVEL} items={levels(pick)} active />);
    const trigger = screen.getByRole("button", { name: HEADING_LEVEL });
    for (const name of ["h-7", "rounded", "px-1.5", "gap-0.5", "bg-primary/10"]) expect(trigger.className.split(/\s+/u)).toContain(name);
    fireEvent.click(trigger);
    expect(checkedRows()).toEqual([
      ["Title", "false", false],
      ["Section", "true", true],
      ["Subsection", "false", false],
    ]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Subsection" }));
    expect(pick).toHaveBeenCalledWith("h3");
  });

  it("checks the current choice in the dropdown's More submenu too", () => {
    const pick = vi.fn();
    const heading: ToolbarControl = {
      id: "heading",
      width: ICON_BUTTON_WIDTH,
      active: true,
      render: () => null,
      renderMenu: () => <ToolbarDropdown key="heading" variant="menu" icon={Type} label={HEADING} ariaLabel={HEADING_LEVEL} items={levels(pick)} active />,
    };
    render(<ToolbarOverflow label={MORE} controls={[heading]} />);
    fireEvent.click(screen.getByRole("button", { name: MORE }));
    fireEvent.click(screen.getByRole("menuitem", { name: HEADING_LEVEL }));
    expect(checkedRows()).toEqual([
      ["Title", "false", false],
      ["Section", "true", true],
      ["Subsection", "false", false],
    ]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Title" }));
    expect(pick).toHaveBeenCalledWith("h1");
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

describe("focus after a ToolbarMenuButton closes", () => {
  const frames: FrameRequestCallback[] = [];
  const nextFrame = () => {
    for (const frame of frames.splice(0)) frame(0);
  };
  const timers = () => new Promise((resolve) => setTimeout(resolve, 0));

  afterEach(() => {
    frames.length = 0;
    vi.unstubAllGlobals();
    for (const editor of document.querySelectorAll("textarea")) editor.remove();
  });

  function setup(pick: (editor: HTMLElement) => void) {
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
    const editor = document.createElement("textarea");
    document.body.append(editor);
    render(
      <ToolbarMenuButton label={HEADING_LEVEL} icon={<Type aria-hidden className="size-4" />}>
        <ToolbarMenuItem icon={Bold} label={BOLD} onSelect={() => pick(editor)} />
      </ToolbarMenuButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: HEADING_LEVEL }));
    return { editor, trigger: screen.getByRole("button", { name: HEADING_LEVEL }) };
  }

  it("leaves focus in the editor a pick focuses one frame late, as Tiptap does in Chromium", async () => {
    const { editor } = setup((target) => requestAnimationFrame(() => target.focus()));
    fireEvent.click(screen.getByRole("menuitem", { name: BOLD }));
    nextFrame();
    await timers();
    nextFrame();
    expect(document.activeElement).toBe(editor);
  });

  it("leaves focus in the editor when the late focus lands after the menu has let go", async () => {
    const { editor } = setup((target) => requestAnimationFrame(() => target.focus()));
    fireEvent.click(screen.getByRole("menuitem", { name: BOLD }));
    await timers();
    nextFrame();
    expect(document.activeElement).toBe(editor);
  });

  it("returns focus to the bar button after a pick that focuses nothing, and after Escape", async () => {
    const { trigger } = setup(() => {});
    fireEvent.click(screen.getByRole("menuitem", { name: BOLD }));
    await timers();
    nextFrame();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await timers();
    nextFrame();
    expect(document.activeElement).toBe(trigger);
  });
});
