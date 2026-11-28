// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { ModalShell } from "./modal-shell";

const STATE_LABEL = "state";

function Menu({ onExport }: Readonly<{ onExport: () => void }>) {
  const [wrap, setWrap] = useState(false);
  const [engine, setEngine] = useState("typst");
  return (
    <>
      <output aria-label={STATE_LABEL}>{`${wrap} ${engine}`}</output>
      <DropdownMenu>
        <DropdownMenuTrigger>{"View"}</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>{"Editor"}</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={setWrap}>
            {"Wrap lines"}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={engine} onValueChange={setEngine}>
            <DropdownMenuRadioItem value="typst">{"Typst"}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="latex">{"LaTeX"}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuItem inset disabled>
            {"Print"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>{"Export"}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={onExport}>{"PDF"}</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "View" }), { button: 0, ctrlKey: false });
}

describe("DropdownMenu", () => {
  it("toggles a checkbox row and picks a radio row", async () => {
    const user = userEvent.setup();
    render(<Menu onExport={vi.fn()} />);

    openMenu();
    expect(screen.getByText("Editor").className).toContain("pl-8");
    expect(screen.getByRole("menuitem", { name: "Print" }).className).toContain("pl-8");
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: "Wrap lines" }).getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Wrap lines" }));
    expect(screen.getByLabelText(STATE_LABEL).textContent).toBe("true typst");

    openMenu();
    expect(screen.getByRole("menuitemcheckbox", { name: "Wrap lines" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("menuitemradio", { name: "LaTeX" }));
    expect(screen.getByLabelText(STATE_LABEL).textContent).toBe("true latex");
  });

  it("opens a submenu from the keyboard", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<Menu onExport={onExport} />);
    openMenu();

    const trigger = screen.getByRole("menuitem", { name: "Export" });
    expect(trigger.className).toContain("pl-8");
    trigger.focus();
    await user.keyboard("{ArrowRight}");
    await user.click(await screen.findByRole("menuitem", { name: "PDF" }));

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("opens submenus on the left with the chevron in front and keeps the text left to right", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(
      <DropdownMenu submenuSide="left">
        <DropdownMenuTrigger>{"View"}</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>
            <DropdownMenuItemText label={"Reset"} detail={"All projects"} />
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{"Export"}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={onExport}>{"PDF"}</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    openMenu();

    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("dir", "ltr");
    expect(menu.parentElement).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("All projects").previousElementSibling).toHaveTextContent("Reset");
    const trigger = screen.getByRole("menuitem", { name: "Export" });
    expect(trigger.firstElementChild).toHaveClass("lucide-chevron-left");
    trigger.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.queryByRole("menuitem", { name: "PDF" })).toBeNull();
    await user.keyboard("{ArrowLeft}");
    const pdf = await screen.findByRole("menuitem", { name: "PDF" });
    expect(pdf.closest("[role=menu]")).toHaveAttribute("dir", "ltr");
    expect(pdf.closest("[role=menu]")).toHaveAttribute("data-side", "left");
    await user.click(pdf);

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("leaves the rest of a modal shell readable and closes only itself on Escape", async () => {
    const onClose = vi.fn();
    render(
      <ModalShell open onClose={onClose} closeLabel={"Close"}>
        <p>{"Behind the menu"}</p>
        <DropdownMenu>
          <DropdownMenuTrigger>{"Language"}</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>{"LaTeX"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ModalShell>,
    );
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await userEvent.click(screen.getByRole("button", { name: "Language" }));
    expect(await screen.findByRole("menuitem", { name: "LaTeX" })).toBeInTheDocument();
    expect(screen.getByText("Behind the menu").closest("[aria-hidden='true']")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still hides the page behind a menu outside a modal shell", async () => {
    render(
      <>
        <p>{"Behind the menu"}</p>
        <DropdownMenu>
          <DropdownMenuTrigger>{"Language"}</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>{"LaTeX"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Language" }));
    expect(await screen.findByRole("menuitem", { name: "LaTeX" })).toBeInTheDocument();
    expect(screen.getByText("Behind the menu").closest("[aria-hidden='true']")).not.toBeNull();
  });
});
