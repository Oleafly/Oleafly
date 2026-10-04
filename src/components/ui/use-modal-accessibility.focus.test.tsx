// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalAccessibility } from "./use-modal-accessibility";

const DIALOG_LABEL = "Dialog";
const NAME_LABEL = "Name";

function Dialog({
  onClose,
  open = true,
  children,
  initialOnDialog = false,
}: {
  onClose: () => void;
  open?: boolean;
  children?: React.ReactNode;
  initialOnDialog?: boolean;
}) {
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div data-testid="backdrop" onMouseDown={onBackdropMouseDown}>
      <div
        role="dialog"
        aria-label={DIALOG_LABEL}
        ref={dialogRef}
        tabIndex={-1}
        {...(initialOnDialog ? { "data-modal-initial-focus": "" } : {})}
      >
        {children}
      </div>
    </div>
  );
}

function Toggle({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {"Open"}
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        {"Shut"}
      </button>
      <Dialog open={open} onClose={onClose}>
        <button type="button">{"Inside"}</button>
      </Dialog>
    </>
  );
}

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function runFrames() {
  act(() => {
    for (const frame of frames.splice(0)) frame(0);
  });
}

describe("modal focus handling", () => {
  it("focuses the first control, or the element marked for initial focus", () => {
    const { unmount } = render(
      <Dialog onClose={vi.fn()}>
        <button type="button">{"First"}</button>
        <button type="button">{"Second"}</button>
      </Dialog>,
    );
    runFrames();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    unmount();

    render(
      <Dialog onClose={vi.fn()}>
        <button type="button">{"First"}</button>
        <input aria-label={NAME_LABEL} data-modal-initial-focus="" />
      </Dialog>,
    );
    runFrames();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });

  it("focuses the dialog itself when it is marked or has no controls", () => {
    const { unmount } = render(
      <Dialog onClose={vi.fn()} initialOnDialog>
        <button type="button">{"First"}</button>
      </Dialog>,
    );
    runFrames();
    expect(screen.getByRole("dialog")).toHaveFocus();
    unmount();

    render(<Dialog onClose={vi.fn()}>{"Just text"}</Dialog>);
    runFrames();
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("keeps Tab inside the dialog in both directions", () => {
    render(
      <Dialog onClose={vi.fn()}>
        <button type="button">{"First"}</button>
        <button type="button" hidden>
          {"Hidden"}
        </button>
        <button type="button">{"Last"}</button>
      </Dialog>,
    );
    runFrames();
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "Tab" });
    expect(first).toHaveFocus();
  });

  it("pulls focus back into the dialog when it is outside", () => {
    render(
      <>
        <button type="button">{"Outside"}</button>
        <Dialog onClose={vi.fn()}>
          <button type="button">{"First"}</button>
          <button type="button">{"Last"}</button>
        </Dialog>
      </>,
    );
    const outside = screen.getByRole("button", { name: "Outside" });

    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();

    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("holds focus on a dialog without controls and ignores other keys", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose}>{"Only text"}</Dialog>);

    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.getByRole("dialog")).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from a click on the backdrop but not from inside the dialog", () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose}>
        <button type="button">{"Inside"}</button>
      </Dialog>,
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId("backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the control that opened it", () => {
    render(<Toggle onClose={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "Open" });

    opener.focus();
    fireEvent.click(opener);
    runFrames();
    expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Shut" }));
    expect(opener).toHaveFocus();
  });

  it("lets only the top dialog react to Escape and backdrop clicks", () => {
    const below = vi.fn();
    const above = vi.fn();
    render(
      <>
        <Dialog onClose={below}>
          <button type="button">{"Below"}</button>
        </Dialog>
        <Dialog onClose={above}>
          <button type="button">{"Above"}</button>
        </Dialog>
      </>,
    );

    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.mouseDown(screen.getAllByTestId("backdrop")[0]);

    expect(above).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
  });
});
