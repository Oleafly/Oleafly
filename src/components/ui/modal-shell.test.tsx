// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MODAL_PANEL_SURFACE, ModalShell, modalOverlayClassName } from "./modal-shell";

const CLOSE = "Close dialog";
const TITLE = "Dialog title";
const ACTION = "Primary action";
const FIRST = "First";

function overlayOf(panel: HTMLElement): HTMLElement {
  return panel.parentElement as HTMLElement;
}

describe("modalOverlayClassName", () => {
  it("defaults to the app dialog layer, centred", () => {
    expect(modalOverlayClassName().split(" ")).toEqual(
      expect.arrayContaining([
        "pointer-events-auto",
        "fixed",
        "inset-0",
        "bg-black/50",
        "backdrop-blur-sm",
        "z-[80]",
        "items-center",
        "p-4",
      ]),
    );
  });

  it("maps the raised and nested layers and the top alignment", () => {
    expect(modalOverlayClassName("raised")).toContain("z-[90]");
    const nestedTop = modalOverlayClassName("nested", "top");
    expect(nestedTop).toContain("z-[120]");
    expect(nestedTop).toContain("items-start");
    expect(nestedTop).toContain("pt-[15vh]");
    expect(nestedTop).not.toContain("p-4");
  });
});

describe("ModalShell", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <ModalShell open={false} onClose={vi.fn()} closeLabel={CLOSE}>
        <p>{TITLE}</p>
      </ModalShell>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the backdrop and a labelled modal panel with the shared surface", () => {
    render(
      <ModalShell
        open
        onClose={vi.fn()}
        closeLabel={CLOSE}
        width="md"
        labelledBy="shell-title"
        describedBy="shell-description"
        testId="shell-panel"
        className="p-5"
      >
        <h2 id="shell-title">{TITLE}</h2>
        <p id="shell-description">{ACTION}</p>
      </ModalShell>,
    );

    const panel = screen.getByRole("dialog", { name: TITLE });
    expect(panel).toBe(screen.getByTestId("shell-panel"));
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveAttribute("aria-describedby", "shell-description");
    expect(panel).toHaveAttribute("tabindex", "-1");
    expect(panel).toHaveClass("relative", "w-full", "max-w-md", "p-5", ...MODAL_PANEL_SURFACE.split(" "));
    const overlay = overlayOf(panel);
    expect(overlay).toHaveClass("fixed", "inset-0", "z-[80]", "bg-black/50");
    expect(overlay.firstElementChild).toBe(screen.getByRole("button", { name: CLOSE }));
  });

  it("closes on a backdrop press but not on a press inside the panel", () => {
    const onClose = vi.fn();
    render(
      <ModalShell open onClose={onClose} closeLabel={CLOSE} label={TITLE}>
        <button type="button">{ACTION}</button>
      </ModalShell>,
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: ACTION }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("button", { name: CLOSE }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and focuses the marked initial control", async () => {
    const onClose = vi.fn();
    render(
      <ModalShell open onClose={onClose} closeLabel={CLOSE} label={TITLE}>
        <button type="button">{FIRST}</button>
        <button type="button" data-modal-initial-focus>
          {ACTION}
        </button>
      </ModalShell>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: ACTION })).toHaveFocus(),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: ACTION }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the panel itself when asked, ahead of a marked control", async () => {
    render(
      <ModalShell open onClose={vi.fn()} closeLabel={CLOSE} label={TITLE} focusPanel>
        <button type="button" data-modal-initial-focus>
          {ACTION}
        </button>
      </ModalShell>,
    );

    await waitFor(() => expect(screen.getByRole("dialog", { name: TITLE })).toHaveFocus());
    expect(screen.getByRole("button", { name: ACTION })).not.toHaveFocus();
  });

  it("supports alert dialogs on the nested layer, aligned to the top", () => {
    render(
      <ModalShell
        open
        onClose={vi.fn()}
        closeLabel={CLOSE}
        label={TITLE}
        role="alertdialog"
        layer="nested"
        align="top"
      >
        <p>{ACTION}</p>
      </ModalShell>,
    );

    const panel = screen.getByRole("alertdialog", { name: TITLE });
    expect(overlayOf(panel)).toHaveClass("z-[120]", "items-start", "pt-[15vh]");
  });

  it("portals to the document body and animates when asked", () => {
    const { container } = render(
      <ModalShell open onClose={vi.fn()} closeLabel={CLOSE} label={TITLE} portal animated>
        <p>{ACTION}</p>
      </ModalShell>,
    );

    const panel = screen.getByRole("dialog", { name: TITLE });
    expect(container).not.toContainElement(panel);
    expect(overlayOf(panel).parentElement).toBe(document.body);
    expect(overlayOf(panel)).toHaveClass("animate-in", "fade-in");
    expect(panel).toHaveClass("animate-in", "zoom-in-95");
  });

  it("renders a bare native dialog when the content brings its own surface", () => {
    render(
      <ModalShell
        open
        onClose={vi.fn()}
        closeLabel={CLOSE}
        label={TITLE}
        as="dialog"
        surface={false}
        layer="raised"
        className="bg-transparent"
      >
        <p>{ACTION}</p>
      </ModalShell>,
    );

    const panel = screen.getByRole("dialog", { name: TITLE });
    expect(panel.tagName).toBe("DIALOG");
    expect(panel).toHaveAttribute("open");
    expect(panel).not.toHaveAttribute("role");
    expect(panel).toHaveClass("relative", "bg-transparent");
    for (const surfaceClass of MODAL_PANEL_SURFACE.split(" ")) {
      expect(panel).not.toHaveClass(surfaceClass);
    }
    expect(overlayOf(panel)).toHaveClass("z-[90]");
  });
});
