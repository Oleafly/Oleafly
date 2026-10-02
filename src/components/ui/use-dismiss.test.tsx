// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDismiss, type DismissOptions, type DismissReason } from "./use-dismiss";

const INSIDE = "inside";
const OUTSIDE = "outside";
const IGNORED = "ignored";

function Harness({
  active,
  onDismiss,
  options,
}: Readonly<{
  active: boolean;
  onDismiss: (reason: DismissReason) => void;
  options?: DismissOptions;
}>) {
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(active, [panel], onDismiss, options);
  return (
    <div>
      <div ref={panel} data-testid={INSIDE} />
      <div data-testid={OUTSIDE} />
      <div data-skip="true">
        <span data-testid={IGNORED} />
      </div>
    </div>
  );
}

afterEach(cleanup);

describe("useDismiss", () => {
  it("dismisses on an outside pointer press only", () => {
    const onDismiss = vi.fn();
    const view = render(<Harness active onDismiss={onDismiss} />);
    fireEvent.pointerDown(view.getByTestId(INSIDE));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(view.getByTestId(OUTSIDE));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith("outside");
  });

  it("does nothing while inactive", () => {
    const onDismiss = vi.fn();
    const view = render(<Harness active={false} onDismiss={onDismiss} options={{ closeOnEscape: true }} />);
    fireEvent.pointerDown(view.getByTestId(OUTSIDE));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("leaves ignored targets alone", () => {
    const onDismiss = vi.fn();
    const view = render(<Harness active onDismiss={onDismiss} options={{ ignore: "[data-skip]" }} />);
    fireEvent.pointerDown(view.getByTestId(IGNORED));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses on Escape only when asked to", () => {
    const onDismiss = vi.fn();
    const view = render(<Harness active onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();

    view.rerender(<Harness active onDismiss={onDismiss} options={{ closeOnEscape: true }} />);
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith("escape");
  });

  it("can listen for mouse presses instead of pointer presses", () => {
    const onDismiss = vi.fn();
    const view = render(
      <Harness active onDismiss={onDismiss} options={{ pointerEvent: "mousedown" }} />,
    );
    fireEvent.pointerDown(view.getByTestId(OUTSIDE));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseDown(view.getByTestId(OUTSIDE));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith("outside");
  });

  it("leaves a press alone while a stacked layer blocks pointer events", () => {
    const onDismiss = vi.fn();
    render(<Harness active onDismiss={onDismiss} />);
    document.body.style.pointerEvents = "none";
    try {
      fireEvent.pointerDown(document.documentElement);
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      document.body.style.pointerEvents = "";
    }
    fireEvent.pointerDown(document.documentElement);
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith("outside");
  });

  it("calls the latest handler and stops after unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Harness active onDismiss={first} />);
    view.rerender(<Harness active onDismiss={second} />);
    const outside = view.getByTestId(OUTSIDE);
    fireEvent.pointerDown(outside);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    view.unmount();
    fireEvent.pointerDown(document.body);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
