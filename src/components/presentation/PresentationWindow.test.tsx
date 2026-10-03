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
