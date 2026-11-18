// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckFrame } from "@/components/editor/deck/use-deck-frame";

const frame = vi.hoisted(() => ({ current: null as unknown as DeckFrame, options: [] as unknown[] }));
vi.mock("@/components/editor/deck/use-deck-frame", () => ({
  useDeckFrame: (options: unknown) => {
    frame.options.push(options);
    return frame.current;
  },
}));

import { DeckSlide, type DeckSlideProps } from "./DeckSlide";

const INFO = { pages: 4, notes: [null, "Show the formula", null, null], title: "Attention" };
const send = vi.fn();
const onLoad = vi.fn();

function deck(overrides: Partial<DeckFrame> = {}): DeckFrame {
  return {
    frameRef: { current: null },
    url: "oleafly-artifact://localhost/t1",
    failure: null,
    info: INFO,
    position: { page: 1, revealed: 0, steps: 0 },
    error: null,
    onLoad,
    send,
    ...overrides,
  };
}

function props(overrides: Partial<DeckSlideProps> = {}): DeckSlideProps {
  return {
    projectId: "p1",
    path: "slides/talk/index.tsx",
    code: "export default [];",
    page: 2,
    mode: "present",
    label: "Slide 2 of 4",
    ...overrides,
  };
}

beforeEach(() => {
  frame.options = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DeckSlide", () => {
  it("opens the deck on the requested slide in a sandboxed frame named after the slide", () => {
    frame.current = deck();
    const { container } = render(<DeckSlide {...props({ className: "invisible" })} />);
    expect(frame.options[0]).toEqual({
      projectId: "p1",
      path: "slides/talk/index.tsx",
      code: "export default [];",
      mode: "present",
      startPage: 1,
    });
    const iframe = screen.getByTitle("Slide 2 of 4");
    expect(iframe).toHaveAttribute("src", "oleafly-artifact://localhost/t1");
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(container.firstElementChild).toHaveClass("invisible");

    fireEvent.load(iframe);
    expect(onLoad).toHaveBeenCalledExactlyOnceWith("oleafly-artifact://localhost/t1");
  });

  it("shows nothing until the deck has an address", () => {
    frame.current = deck({ url: null, info: null });
    render(<DeckSlide {...props()} />);
    expect(screen.queryByTitle("Slide 2 of 4")).toBeNull();
  });

  it("hands its parent the deck's commands", () => {
    frame.current = deck();
    const commands: DeckSlideProps["commands"] = { current: null };
    render(<DeckSlide {...props({ commands })} />);
    commands.current?.({ type: "next" });
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "next" });
  });

  it("reports the deck's slides and the slide on screen once the deck is ready", () => {
    const onInfo = vi.fn();
    const onPage = vi.fn();
    frame.current = deck({ info: null });
    const { rerender } = render(<DeckSlide {...props({ onInfo, onPage })} />);
    expect(onInfo).not.toHaveBeenCalled();
    expect(onPage).not.toHaveBeenCalled();

    frame.current = deck();
    rerender(<DeckSlide {...props({ onInfo, onPage })} />);
    expect(onInfo).toHaveBeenCalledExactlyOnceWith(INFO);
    expect(onPage).toHaveBeenCalledExactlyOnceWith(2);

    const nextPage = vi.fn();
    frame.current = deck({ position: { page: 2, revealed: 0, steps: 1 } });
    rerender(<DeckSlide {...props({ onInfo, onPage: nextPage })} />);
    expect(nextPage).toHaveBeenCalledExactlyOnceWith(3);
    expect(onPage).toHaveBeenCalledOnce();
    expect(onInfo).toHaveBeenCalledOnce();
  });

  it("moves a ready deck to a newly requested slide unless it already shows it", () => {
    frame.current = deck();
    const { rerender } = render(<DeckSlide {...props()} />);
    expect(send).not.toHaveBeenCalled();

    rerender(<DeckSlide {...props({ page: 4 })} />);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "goto", page: 3 });

    rerender(<DeckSlide {...props({ page: 4, label: "Slide 4 of 4" })} />);
    expect(send).toHaveBeenCalledOnce();

    frame.current = deck({ position: { page: 2, revealed: 0, steps: 0 } });
    rerender(<DeckSlide {...props({ page: 3 })} />);
    expect(send).toHaveBeenCalledOnce();
  });

  it("leaves a deck that is still loading on the slide it opened with", () => {
    frame.current = deck({ info: null });
    const { rerender } = render(<DeckSlide {...props()} />);
    rerender(<DeckSlide {...props({ page: 3 })} />);
    expect(send).not.toHaveBeenCalled();
  });
});
