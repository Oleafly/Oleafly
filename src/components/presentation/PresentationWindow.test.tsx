// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./presentation-test-harness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./presentation-test-harness")).windowModule);
vi.mock("@/features/presentation/load", async () => (await import("./presentation-test-harness")).loadModule);
vi.mock("@/features/presentation/pdf-slides", async () => (await import("./presentation-test-harness")).slidesModule);

import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { presentationHarness, presentationUrl } from "./presentation-test-harness";
import { PresentationWindow } from "./PresentationWindow";

const copy = enPreview.presentation;
const size = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 450 });
});

afterAll(() => {
  if (size) Object.defineProperty(HTMLElement.prototype, "clientWidth", size);
});

beforeEach(() => {
  presentationHarness.reset();
  presentationUrl("present");
});

function slide(name: string) {
  return screen.findByRole("figure", { name });
}

describe("PresentationWindow", () => {
  it("starts on the requested slide and moves with the keyboard", async () => {
    render(<PresentationWindow />);
    expect(await slide("Slide 2 of 3")).toBeInTheDocument();
    await waitFor(() =>
      expect(presentationHarness.render).toHaveBeenCalledWith(2, expect.any(HTMLCanvasElement), { width: 800, height: 450 }, 1),
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await slide("Slide 3 of 3")).toBeInTheDocument();
    expect(presentationHarness.emitted).toContainEqual({ event: "presentation:goto", payload: { session: "s1", page: 3 } });

    fireEvent.keyDown(window, { key: " " });
    expect(await slide("Slide 3 of 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Home" });
    expect(await slide("Slide 1 of 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "End" });
    expect(await slide("Slide 3 of 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(await slide("Slide 2 of 3")).toBeInTheDocument();
  });

  it("follows the presenter window in the same session only", async () => {
    render(<PresentationWindow />);
    await slide("Slide 2 of 3");
    act(() => presentationHarness.deliver("presentation:goto", { session: "other", page: 1 }));
    expect(screen.getByRole("figure", { name: "Slide 2 of 3" })).toBeInTheDocument();
    act(() => presentationHarness.deliver("presentation:goto", { session: "s1", page: 1 }));
    expect(await slide("Slide 1 of 3")).toBeInTheDocument();
  });

  it("moves forward on click and back on right click", async () => {
    render(<PresentationWindow />);
    await slide("Slide 2 of 3");
    fireEvent.click(screen.getByTestId("presentation-audience"));
    expect(await slide("Slide 3 of 3")).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId("presentation-audience"));
    expect(await slide("Slide 2 of 3")).toBeInTheDocument();
  });

  it("blanks the screen and ends with Escape", async () => {
    render(<PresentationWindow />);
    await slide("Slide 2 of 3");
    fireEvent.keyDown(window, { key: "b" });
    await waitFor(() => expect(screen.queryByRole("figure")).toBeNull());
    expect(presentationHarness.emitted).toContainEqual({ event: "presentation:blank", payload: { session: "s1", blank: true } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(presentationHarness.emitted).toContainEqual({ event: "presentation:end", payload: { session: "s1" } });
    expect(presentationHarness.close).toHaveBeenCalled();
  });

  it("ignores shortcuts with modifier keys", async () => {
    render(<PresentationWindow />);
    await slide("Slide 2 of 3");
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    expect(screen.getByRole("figure", { name: "Slide 2 of 3" })).toBeInTheDocument();
  });

  it("explains when the PDF cannot be opened", async () => {
    presentationHarness.failLoad = true;
    render(<PresentationWindow />);
    expect(await screen.findByText(copy.failed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.close }));
    expect(presentationHarness.close).toHaveBeenCalled();
  });

  it("refuses an address without a session", async () => {
    window.history.replaceState({}, "", "/?view=present&project=deck");
    render(<PresentationWindow />);
    expect(await screen.findByText(copy.failed)).toBeInTheDocument();
  });
});

describe("PresentationWindow details", () => {
  it("hides the cursor after the pointer rests and shows it again on movement", async () => {
    render(<PresentationWindow />);
    await slide("Slide 2 of 3");
    const audience = screen.getByTestId("presentation-audience");
    vi.useFakeTimers();
    try {
      fireEvent.mouseMove(window);
      expect(audience).not.toHaveClass("cursor-none");
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      fireEvent.mouseMove(window);
      act(() => {
        vi.advanceTimersByTime(1_500);
      });
      expect(audience).not.toHaveClass("cursor-none");
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(audience).toHaveClass("cursor-none");
      fireEvent.mouseMove(window);
      expect(audience).not.toHaveClass("cursor-none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores middle clicks and keys typed into a control", async () => {
    render(<PresentationWindow />);
    await slide("Slide 2 of 3");
    const field = document.createElement("input");
    document.body.appendChild(field);

    fireEvent.click(screen.getByTestId("presentation-audience"), { button: 1 });
    fireEvent.keyDown(field, { key: " " });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(screen.getByRole("figure", { name: "Slide 2 of 3" })).toBeInTheDocument();
    field.remove();
  });

  it("blanks and closes when the presenter window says so", async () => {
    render(<PresentationWindow />);
    await slide("Slide 2 of 3");

    act(() => presentationHarness.deliver("presentation:blank", { session: "other", blank: true }));
    expect(screen.getByRole("figure", { name: "Slide 2 of 3" })).toBeInTheDocument();
    act(() => presentationHarness.deliver("presentation:blank", { session: "s1", blank: true }));
    await waitFor(() => expect(screen.queryByRole("figure")).toBeNull());
    act(() => presentationHarness.deliver("presentation:blank", { session: "s1", blank: false }));
    expect(await slide("Slide 2 of 3")).toBeInTheDocument();

    act(() => presentationHarness.deliver("presentation:end", { session: "other" }));
    expect(presentationHarness.close).not.toHaveBeenCalled();
    act(() => presentationHarness.deliver("presentation:end", { session: "s1" }));
    expect(presentationHarness.close).toHaveBeenCalled();
  });

  it("ignores malformed slide requests and clamps out-of-range ones", async () => {
    render(<PresentationWindow />);
    await slide("Slide 2 of 3");

    act(() => presentationHarness.deliver("presentation:goto", { session: "s1", page: 1.5 }));
    act(() => presentationHarness.deliver("presentation:goto", { session: "s1" }));
    expect(screen.getByRole("figure", { name: "Slide 2 of 3" })).toBeInTheDocument();

    act(() => presentationHarness.deliver("presentation:goto", { session: "s1", page: 99 }));
    expect(await slide("Slide 3 of 3")).toBeInTheDocument();
  });

  it("tells the presenter window when the audience window is closed", async () => {
    render(<PresentationWindow />);
    await slide("Slide 2 of 3");

    act(() => presentationHarness.closeRequested?.());

    expect(presentationHarness.emitted).toContainEqual({ event: "presentation:end", payload: { session: "s1" } });
  });

  it("does not move between slides while the deck is unavailable", async () => {
    presentationHarness.failLoad = true;
    render(<PresentationWindow />);
    await screen.findByText(copy.failed);

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(presentationHarness.emitted.filter((entry) => entry.event === "presentation:goto")).toEqual([]);
  });

  it("stops before opening the slides when the window closed during the download", async () => {
    const { unmount } = render(<PresentationWindow />);
    unmount();

    await act(async () => {
      await Promise.resolve();
    });
    expect(presentationHarness.opened).toBe(0);
  });

  it("releases a deck that finishes opening after the window closed", async () => {
    presentationHarness.holdSlides = true;
    const { unmount } = render(<PresentationWindow />);
    await waitFor(() => expect(presentationHarness.opened).toBe(1));
    unmount();

    await act(async () => {
      presentationHarness.releaseSlides();
    });

    await waitFor(() => expect(presentationHarness.destroy).toHaveBeenCalledTimes(1));
  });

  it("releases the open deck when the window closes", async () => {
    const { unmount } = render(<PresentationWindow />);
    await slide("Slide 2 of 3");

    unmount();

    expect(presentationHarness.destroy).toHaveBeenCalledTimes(1);
  });
});
