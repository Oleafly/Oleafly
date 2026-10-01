// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover } from "@/components/ui/popover";
import { Private, PrivatePath } from "@/components/ui/private";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { usePersonalDetailsStore } from "@/store/personal-details";

// Opening a dialog focuses its first control, and focus reveals a personal
// value. In screenshot mode that must not happen without the user asking.

const TITLE = "Exports";
const OPEN_FOLDER = "Open folder";
const USE_SYSTEM_TEX = "Use system TeX";
const USAGE = "Usage";
const TOKENS = "Tokens";
const TOKEN_COUNT = "12,345";

function hide(hidden: boolean) {
  act(() => usePersonalDetailsStore.getState().setHidden(hidden));
}

beforeEach(() => setDisplayHomes(["/Users/ada"]));

afterEach(() => {
  cleanup();
  hide(false);
  resetDisplayHomes();
});

function ExportsDialog({ withAction = false }: Readonly<{ withAction?: boolean }>) {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>{TITLE}</DialogTitle>
        <PrivatePath path="/Users/ada/paper/paper.pdf" />
        {withAction ? <button type="button">{OPEN_FOLDER}</button> : null}
      </DialogContent>
    </Dialog>
  );
}

describe("dialog focus in screenshot mode", () => {
  it("opens on the first control that is not a personal value", async () => {
    hide(true);
    render(<ExportsDialog withAction />);
    const path = await screen.findByText("~/paper/paper.pdf");
    expect(path).toHaveAttribute("tabindex", "0");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: OPEN_FOLDER })),
    );
  });

  it("never opens onto a personal value that comes first", async () => {
    hide(true);
    render(<ExportsDialog />);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    expect(document.activeElement).not.toBe(screen.getByText("~/paper/paper.pdf"));
  });

  it("keeps the usual first-control focus while details are shown", async () => {
    render(<ExportsDialog withAction />);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: OPEN_FOLDER })),
    );
  });
});

describe("popover focus in screenshot mode", () => {
  it("does not open onto a personal number", async () => {
    hide(true);
    render(
      <Popover ariaLabel={USAGE} trigger={<span>{USAGE}</span>}>
        <p>
          {TOKENS} <Private>{TOKEN_COUNT}</Private>
        </p>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: USAGE }));
    const value = await screen.findByText(TOKEN_COUNT);
    expect(value).toHaveAttribute("tabindex", "0");
    const content = value.closest("[role='dialog']") as HTMLElement;
    await waitFor(() => expect(content).toContainElement(document.activeElement as HTMLElement));
    expect(document.activeElement).not.toBe(value);
  });
});

describe("modal focus in screenshot mode", () => {
  function Modal() {
    const { dialogRef } = useModalAccessibility<HTMLDivElement>(true, () => {});
    return (
      <div role="dialog" ref={dialogRef} tabIndex={-1}>
        <PrivatePath path="/Users/ada/bin/latexmk" />
        <button type="button">{USE_SYSTEM_TEX}</button>
      </div>
    );
  }

  it("opens on the first control that is not a personal value", async () => {
    hide(true);
    render(<Modal />);
    expect(screen.getByText("~/bin/latexmk")).toHaveAttribute("tabindex", "0");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: USE_SYSTEM_TEX })),
    );
  });
});
