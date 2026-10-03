// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./presentation-test-harness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./presentation-test-harness")).windowModule);
vi.mock("@/features/presentation/load", async () => (await import("./presentation-test-harness")).loadModule);
vi.mock("@/features/presentation/pdf-slides", async () => (await import("./presentation-test-harness")).slidesModule);

import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { presentationHarness, presentationUrl } from "./presentation-test-harness";
import { PresenterWindow } from "./PresenterWindow";

const copy = enPreview.presentation;
const size = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
});

afterAll(() => {
  if (size) Object.defineProperty(HTMLElement.prototype, "clientWidth", size);
});

beforeEach(() => {
  presentationHarness.reset();
  presentationHarness.notes = new Map([
    [2, "Explain the latency budget"],
    [3, "Close with the result"],
  ]);
  presentationUrl("presenter");
});

afterEach(() => vi.useRealTimers());

describe("PresenterWindow", () => {
  it("shows the current slide, the next slide and the speaker notes", async () => {
    render(<PresenterWindow />);
    expect(await screen.findByRole("figure", { name: "Slide 2 of 3" })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Slide 3 of 3" })).toBeInTheDocument();
    expect(await screen.findByTestId("presenter-notes")).toHaveTextContent("Explain the latency budget");

    fireEvent.click(screen.getByRole("button", { name: copy.nextAction }));
    expect(await screen.findByText(copy.lastSlide)).toBeInTheDocument();
    expect(screen.getByTestId("presenter-notes")).toHaveTextContent("Close with the result");
    expect(presentationHarness.emitted).toContainEqual({ event: "presentation:goto", payload: { session: "s1", page: 3 } });
  });

  it("says when a slide has no notes", async () => {
    render(<PresenterWindow />);
    await screen.findByTestId("presenter-notes");
    fireEvent.click(screen.getByRole("button", { name: copy.previousAction }));
    expect(await screen.findByText(copy.noNotes)).toBeInTheDocument();
  });

  it("shows when the audience screen is blank", async () => {
    render(<PresenterWindow />);
    await screen.findByRole("figure", { name: "Slide 2 of 3" });
    act(() => presentationHarness.deliver("presentation:blank", { session: "s1", blank: true }));
    expect(await screen.findByText(copy.blank)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.toggleBlank }));
    await waitFor(() => expect(screen.queryByText(copy.blank)).toBeNull());
  });

  it("times the talk and can pause and reset the timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PresenterWindow />);
    expect(screen.getByTestId("presenter-timer")).toHaveTextContent("0:00");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(screen.getByTestId("presenter-timer")).toHaveTextContent("1:05");
    fireEvent.click(screen.getByRole("button", { name: copy.pause }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByTestId("presenter-timer")).toHaveTextContent("1:05");
    fireEvent.click(screen.getByRole("button", { name: copy.resume }));
    fireEvent.click(screen.getByRole("button", { name: copy.reset }));
    expect(screen.getByTestId("presenter-timer")).toHaveTextContent("0:00");
  });

  it("ends the presentation for both windows", async () => {
    render(<PresenterWindow />);
    await screen.findByRole("figure", { name: "Slide 2 of 3" });
    fireEvent.click(screen.getByRole("button", { name: copy.end }));
    expect(presentationHarness.emitted).toContainEqual({ event: "presentation:end", payload: { session: "s1" } });
    expect(presentationHarness.close).toHaveBeenCalled();
  });
});
