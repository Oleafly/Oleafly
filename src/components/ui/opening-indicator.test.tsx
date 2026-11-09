// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENING_DELAY_MS, OpeningIndicator } from "./opening-indicator";

afterEach(() => {
  vi.useRealTimers();
});

function layer(element: Element): number {
  const match = /(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?:\s|$)/.exec(element.className);
  return Number(match?.[1] ?? match?.[2] ?? 0);
}

describe("OpeningIndicator", () => {
  it("shows only after a short delay, outside its parent and above full-window pages and dialogs", () => {
    vi.useFakeTimers();
    const view = render(
      <>
        <div data-testid="owner" className="contents">
          <OpeningIndicator />
        </div>
        <div data-testid="notes" className="fixed inset-0 z-50" />
      </>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    act(() => void vi.advanceTimersByTime(OPENING_DELAY_MS));
    const status = screen.getByRole("status");
    const overlay = status.parentElement as HTMLElement;
    expect(overlay.parentElement).toBe(document.body);
    expect(screen.getByTestId("owner")).not.toContainElement(status);
    expect(layer(overlay)).toBeGreaterThan(layer(screen.getByTestId("notes")));
    expect(layer(overlay)).toBeGreaterThan(120);
    expect(overlay).toHaveClass("pointer-events-none");
    view.unmount();
    expect(document.querySelector("[data-opening-indicator]")).toBeNull();
  });
});
