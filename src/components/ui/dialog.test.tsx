// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "./confirmation-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { ModalShell } from "./modal-shell";

function Nested({ onCloseOuter }: Readonly<{ onCloseOuter: () => void }>) {
  const [nested, setNested] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <ModalShell open onClose={onCloseOuter} closeLabel={"Close settings"} label={"Settings"}>
      <button type="button" onClick={() => setNested(true)}>
        {"Create skill"}
      </button>
      <Dialog open={nested} onOpenChange={setNested}>
        <DialogContent>
          <DialogTitle>{"New skill"}</DialogTitle>
          <DialogDescription>{"Name the skill"}</DialogDescription>
          <input aria-label={"Skill name"} />
          <button type="button" onClick={() => setConfirming(true)}>
            {"Discard"}
          </button>
          <ConfirmationDialog
            open={confirming}
            title={"Discard the skill?"}
            description={"The draft is lost."}
            confirmLabel={"Discard"}
            onConfirm={() => setConfirming(false)}
            onCancel={() => setConfirming(false)}
          />
        </DialogContent>
      </Dialog>
    </ModalShell>
  );
}

describe("Dialog inside another modal", () => {
  it("closes only the topmost dialog on each Escape", async () => {
    const user = userEvent.setup();
    const closeOuter = vi.fn();
    render(<Nested onCloseOuter={closeOuter} />);
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    await screen.findByRole("dialog", { name: "New skill" });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New skill" })).toBeNull());
    expect(closeOuter).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(closeOuter).toHaveBeenCalledTimes(1);
  });

  it("marks every kit modal with the shared modal surface", async () => {
    const user = userEvent.setup();
    render(<Nested onCloseOuter={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    await screen.findByRole("dialog", { name: "New skill" });
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const modals = [
      screen.getByRole("dialog", { name: "Settings", hidden: true }),
      screen.getByRole("dialog", { name: "New skill", hidden: true }),
      await screen.findByRole("alertdialog", { name: "Discard the skill?", hidden: true }),
    ];
    for (const modal of modals) expect(modal).toHaveAttribute("data-modal-surface");
  });

  it("puts focus back on the control that opened it", async () => {
    const user = userEvent.setup();
    render(<Nested onCloseOuter={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "Create skill" });
    await user.click(opener);
    await screen.findByRole("dialog", { name: "New skill" });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("lets the dialog's action move focus once it has closed", async () => {
    const user = userEvent.setup();
    function Moves() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            {"Open"}
          </button>
          <textarea aria-label={"Editor"} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>{"Insert figure"}</DialogTitle>
              <DialogDescription>{"Pick an image"}</DialogDescription>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  requestAnimationFrame(() => screen.getByLabelText("Editor").focus());
                }}
              >
                {"Insert"}
              </button>
            </DialogContent>
          </Dialog>
        </>
      );
    }
    render(<Moves />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Insert" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Editor" })).toHaveFocus());
  });

  it("keeps Tab inside the dialog on top", async () => {
    const user = userEvent.setup();
    render(<Nested onCloseOuter={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    const dialog = await screen.findByRole("dialog", { name: "New skill" });

    for (let step = 0; step < 4; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("leaves the dialog open while a confirmation above it takes Escape and clicks", async () => {
    const user = userEvent.setup();
    const closeOuter = vi.fn();
    render(<Nested onCloseOuter={closeOuter} />);
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    await screen.findByRole("dialog", { name: "New skill" });
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "Discard the skill?" });

    await user.click(confirmation);
    expect(screen.getByRole("dialog", { name: "New skill" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "New skill" })).toBeInTheDocument();
    expect(closeOuter).not.toHaveBeenCalled();
  });
});
