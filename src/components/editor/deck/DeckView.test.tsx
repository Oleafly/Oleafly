// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import type { DeckFrame } from "./use-deck-frame";

const frame = vi.hoisted(() => ({ current: null as unknown as DeckFrame, options: [] as unknown[] }));
vi.mock("./use-deck-frame", () => ({
  useDeckFrame: (options: unknown) => {
    frame.options.push(options);
    return frame.current;
  },
}));

import { DeckView } from "./DeckView";

const copy = enPreview.presentation;

function deck(overrides: Partial<DeckFrame> = {}): DeckFrame {
  return {
    frameRef: { current: null },
    url: "oleafly-artifact://frame/t1",
    failure: null,
    info: { pages: 3, notes: [null, "Pause for questions", null], title: "Talk" },
    position: { page: 1, revealed: 0, steps: 2 },
    error: null,
    onLoad: vi.fn(),
    send: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  frame.options = [];
  useFilesStore.setState({ files: { "slides/talk/index.tsx": { content: "export default [];" } } } as never);
});

describe("DeckView", () => {
  it("runs the open deck in edit mode and steps through it from the toolbar", () => {
    frame.current = deck();
    render(<DeckView projectId="p1" path="slides/talk/index.tsx" />);
    expect(frame.options[0]).toEqual({ projectId: "p1", path: "slides/talk/index.tsx", code: "export default [];", mode: "edit", startPage: 0 });
    expect(screen.getByText(copy.slideLabel.replace("{{page}}", "2").replace("{{total}}", "3"))).toBeInTheDocument();
    expect(screen.getByRole("region", { name: copy.notes })).toHaveTextContent("Pause for questions");
    expect(screen.queryByRole("button", { name: copy.present })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: copy.nextAction }));
    fireEvent.click(screen.getByRole("button", { name: copy.previousAction }));
    expect(frame.current.send).toHaveBeenNthCalledWith(1, { type: "next" });
    expect(frame.current.send).toHaveBeenNthCalledWith(2, { type: "previous" });
  });

  it("stops at the ends of the deck once every step has played", () => {
    frame.current = deck({ position: { page: 2, revealed: 2, steps: 2 } });
    const { rerender } = render(<DeckView projectId="p1" path="slides/talk/index.tsx" />);
    expect(screen.getByRole("button", { name: copy.nextAction })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.previousAction })).toBeEnabled();

    frame.current = deck({ position: { page: 0, revealed: 0, steps: 0 } });
    rerender(<DeckView projectId="p1" path="slides/talk/index.tsx" />);
    expect(screen.getByRole("button", { name: copy.previousAction })).toBeDisabled();
  });

  it("presents from the start, from the slide on screen or with the presenter view", async () => {
    frame.current = deck();
    const onPresent = vi.fn();
    render(<DeckView projectId="p1" path="slides/talk/index.tsx" onPresent={onPresent} />);
    const user = userEvent.setup();
    for (const label of [copy.presentFromStart, copy.presentFromPage, copy.presentWithPresenter]) {
      await user.click(screen.getByRole("button", { name: copy.present }));
      await user.click(await screen.findByRole("menuitem", { name: label }));
    }
    expect(onPresent.mock.calls).toEqual([
      ["start", 0],
      ["page", 1],
      ["presenter", 1],
    ]);
  });

  it("says why the deck could not open, and waits while it loads", () => {
    frame.current = deck({ url: null, failure: "The frame was refused", info: null });
    const { rerender } = render(<DeckView projectId="p1" path="slides/talk/index.tsx" onPresent={vi.fn()} />);
    expect(screen.getByText("The frame was refused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.present })).toBeDisabled();

    frame.current = deck({ url: null, info: null });
    rerender(<DeckView projectId="p1" path="slides/talk/index.tsx" />);
    expect(screen.queryByTitle(copy.windowTitle)).toBeNull();
    expect(screen.queryByRole("region", { name: copy.notes })).toBeNull();
  });
});
