// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu";

function renderMenu(onRename = vi.fn(), onMove = vi.fn()) {
  render(
    <ContextMenu>
      <ContextMenuTrigger>{"chapter.tex"}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel inset>{"File"}</ContextMenuLabel>
        <ContextMenuItem inset onSelect={onRename}>
          {"Rename"}
        </ContextMenuItem>
        <ContextMenuItem disabled>{"Delete"}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger inset>{"Move to"}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={onMove}>{"figures"}</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>,
  );
}

describe("ContextMenu", () => {
  it("opens on right click with indented rows and runs the chosen item", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    renderMenu(onRename);

    fireEvent.contextMenu(screen.getByText("chapter.tex"));

    expect(screen.getByText("File").className).toContain("pl-8");
    expect(screen.getByRole("menuitem", { name: "Rename" }).className).toContain("pl-8");
    expect(screen.getByRole("menuitem", { name: "Delete" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("separator")).toBeTruthy();

    await user.click(screen.getByRole("menuitem", { name: "Rename" }));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens a submenu from the keyboard", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderMenu(vi.fn(), onMove);
    fireEvent.contextMenu(screen.getByText("chapter.tex"));

    const trigger = screen.getByRole("menuitem", { name: "Move to" });
    expect(trigger.className).toContain("pl-8");
    trigger.focus();
    await user.keyboard("{ArrowRight}");
    await user.click(await screen.findByRole("menuitem", { name: "figures" }));

    expect(onMove).toHaveBeenCalledTimes(1);
  });
});
