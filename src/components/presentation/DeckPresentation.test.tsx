// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./presentation-test-harness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./presentation-test-harness")).windowModule);
vi.mock("@/features/presentation/load", async () => (await import("./presentation-test-harness")).loadModule);
vi.mock("@/features/presentation/pdf-slides", async () => (await import("./presentation-test-harness")).slidesModule);

const frames = vi.hoisted(() => ({
  commands: [] as unknown[],
  onPage: null as ((page: number) => void) | null,
}));

vi.mock("./DeckSlide", () => ({
  DeckSlide: (props: {
    page: number;
    mode: string;
    className?: string;
    onInfo?: (info: { pages: number; notes: (string | null)[]; title: string | null }) => void;
    onPage?: (page: number) => void;
    commands?: { current: ((command: unknown) => void) | null };
  }) => {
    const { onInfo } = props;
    useEffect(() => {
      onInfo?.({ pages: 3, notes: ["Open with the question", "Show the formula", null], title: "Attention" });
    }, [onInfo]);
    if (props.commands) props.commands.current = (command) => frames.commands.push(command);
    if (props.onPage) frames.onPage = props.onPage;
    return <div data-testid={`deck-slide-${props.mode}`} data-page={props.page} className={props.className} />;
  },
}));

import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { presentationHarness } from "./presentation-test-harness";
import { PresentationWindow } from "./PresentationWindow";
import { PresenterWindow } from "./PresenterWindow";

const copy = enPreview.presentation;

function deckUrl(view: "present" | "presenter") {
  window.history.replaceState({}, "", `/?view=${view}&session=s1&project=p1&source=deck&path=slides/talk/index.tsx&start=2&presenter=1&typst=0`);
}

beforeEach(() => {
  presentationHarness.reset();
  frames.commands = [];
  frames.onPage = null;
});

describe("presenting a deck", () => {
  it("sends next and previous to the deck, so its steps play, and follows the slide it reports", async () => {
    deckUrl("present");
    render(<PresentationWindow />);
    const slide = await screen.findByTestId("deck-slide-present");
    expect(slide).toHaveAttribute("data-page", "2");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(frames.commands).toEqual([{ type: "next" }, { type: "previous" }]);
    expect(screen.getByTestId("deck-slide-present")).toHaveAttribute("data-page", "2");

    act(() => frames.onPage?.(3));
    expect(screen.getByTestId("deck-slide-present")).toHaveAttribute("data-page", "3");
    expect(presentationHarness.emitted).toContainEqual({ event: "presentation:goto", payload: { session: "s1", page: 3 } });

    act(() => presentationHarness.deliver("presentation:step", { session: "s1", action: "next" }));
    act(() => presentationHarness.deliver("presentation:step", { session: "other", action: "next" }));
    expect(frames.commands.at(-1)).toEqual({ type: "next" });
    expect(frames.commands).toHaveLength(3);

    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByTestId("deck-slide-present")).toHaveClass("invisible");
  });

  it("drives the audience deck from the presenter view and reads the deck's own notes", async () => {
    deckUrl("presenter");
    render(<PresenterWindow />);
    expect(await screen.findByText(copy.slideLabel.replace("{{page}}", "2").replace("{{total}}", "3"))).toBeInTheDocument();
    expect(screen.getByTestId("presenter-notes")).toHaveTextContent("Show the formula");
    const previews = screen.getAllByTestId("deck-slide-page");
    expect(previews.map((preview) => preview.getAttribute("data-page"))).toEqual(["2", "3"]);

    fireEvent.click(screen.getByRole("button", { name: copy.nextAction }));
    expect(presentationHarness.emitted).toContainEqual({ event: "presentation:step", payload: { session: "s1", action: "next" } });
    act(() => presentationHarness.deliver("presentation:goto", { session: "s1", page: 1 }));
    expect(screen.getByTestId("presenter-notes")).toHaveTextContent("Open with the question");
  });
});
