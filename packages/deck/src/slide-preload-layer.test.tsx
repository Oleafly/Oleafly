// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDesign } from "./design";
import { useSlidePageNumber } from "./page-context";
import type { Page } from "./sdk";
import { SlidePreloadLayer } from "./slide-preload-layer";
import { Step, Steps } from "./step-context";

function numbered(label: string): Page {
  return function Numbered() {
    const { current, total } = useSlidePageNumber();
    return <p>{`${label} ${current}/${total}`}</p>;
  };
}

function deck(count: number, prefix = "P"): Page[] {
  return Array.from({ length: count }, (_, i) => numbered(`${prefix}${i}`));
}

function withImage(alt: string): Page {
  return () => <img alt={alt} src={`${alt}.png`} />;
}

function root(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-osd-freeze-motion]");
}

function warmed(): (string | null)[] {
  return [...(root()?.children ?? [])].map((el) => el.textContent);
}

async function frame(ms = 16): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "connection");
  Reflect.deleteProperty(document, "fonts");
});

describe("SlidePreloadLayer", () => {
  it("warms the following pages two per frame, wrapping around, then removes itself", async () => {
    const onDone = vi.fn();
    render(<SlidePreloadLayer pages={deck(5)} index={3} onDone={onDone} />);

    const layer = root();
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer?.style.visibility).toBe("hidden");
    expect(layer?.style.pointerEvents).toBe("none");
    expect(warmed()).toEqual([]);

    await frame();
    expect(warmed()).toEqual(["P4 5/5", "P0 1/5"]);
    const slot = layer?.firstElementChild as HTMLElement;
    expect(slot.style.width).toBe("1920px");
    expect(slot.style.height).toBe("1080px");

    await frame();
    expect(warmed()).toEqual(["P4 5/5", "P0 1/5", "P1 2/5", "P2 3/5"]);
    expect(onDone).not.toHaveBeenCalled();

    await frame(50);
    expect(root()).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("can start with the current page", async () => {
    render(<SlidePreloadLayer pages={deck(3)} index={1} includeCurrent />);

    await frame();
    expect(warmed()).toEqual(["P1 2/3", "P2 3/3"]);
    await frame();
    expect(warmed()).toEqual(["P1 2/3", "P2 3/3", "P0 1/3"]);
  });

  it("starts from the last page when the index is past the end", async () => {
    render(<SlidePreloadLayer pages={deck(3)} index={99} />);

    await frame();
    expect(warmed()).toEqual(["P0 1/3", "P1 2/3"]);
  });

  it("warms pages with their steps already shown, as they look when you come back to them", async () => {
    const Listing: Page = () => (
      <Steps>
        <Step>{"One"}</Step>
        <Step>{"Two"}</Step>
      </Steps>
    );
    render(<SlidePreloadLayer pages={[numbered("Intro"), Listing]} index={0} />);

    await frame();
    const steps = root()?.querySelectorAll("[data-osd-step]") ?? [];
    expect([...steps].map((el) => el.getAttribute("data-osd-step"))).toEqual(["revealed", "revealed"]);
  });

  it("carries the deck design onto the hidden pages", () => {
    render(<SlidePreloadLayer pages={deck(2)} index={0} design={defaultDesign} />);

    expect(root()?.style.getPropertyValue("--osd-bg")).toBe(defaultDesign.palette.bg);
    expect(root()?.style.getPropertyValue("--osd-size-hero")).toBe("168px");
  });

  it("does nothing when the connection asks to save data", () => {
    Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } });
    const onDone = vi.fn();
    const { container } = render(<SlidePreloadLayer pages={deck(3)} index={0} onDone={onDone} />);

    expect(container).toBeEmptyDOMElement();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("still warms pages when there is no navigator to ask", async () => {
    vi.stubGlobal("navigator", undefined);
    render(<SlidePreloadLayer pages={deck(2)} index={0} />);

    await frame();
    expect(warmed()).toEqual(["P1 2/2"]);
  });

  it("finishes at once for a deck with a single page", () => {
    const onDone = vi.fn();
    const { container } = render(<SlidePreloadLayer pages={deck(1)} index={0} onDone={onDone} />);

    expect(container).toBeEmptyDOMElement();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("waits for images to load or fail before finishing", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
    const onDone = vi.fn();
    render(<SlidePreloadLayer pages={[withImage("cover"), withImage("chart")]} index={0} includeCurrent onDone={onDone} />);

    await frame();
    await frame(50);
    expect(onDone).not.toHaveBeenCalled();

    const [cover, chart] = [...(root()?.querySelectorAll("img") ?? [])];
    fireEvent.load(cover);
    await frame();
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.error(chart);
    await frame();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(root()).toBeNull();
  });

  it("gives up waiting after fifteen seconds", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
    const onDone = vi.fn();
    render(<SlidePreloadLayer pages={[numbered("Intro"), withImage("never")]} index={0} onDone={onDone} />);

    await frame(1000);
    expect(onDone).not.toHaveBeenCalled();

    await frame(15000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("waits for web fonts when the document loads them", async () => {
    let fontsReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      fontsReady = resolve;
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    const onDone = vi.fn();
    render(<SlidePreloadLayer pages={deck(2)} index={0} onDone={onDone} />);

    await frame();
    await frame(100);
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      fontsReady();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("still finishes when the document's fonts fail to load", async () => {
    let fontsFailed: () => void = () => {};
    const ready = new Promise<void>((_resolve, reject) => {
      fontsFailed = () => reject(new Error("font load failed"));
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    const onDone = vi.fn();
    render(<SlidePreloadLayer pages={deck(2)} index={0} onDone={onDone} />);

    await frame();
    await frame(100);
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      fontsFailed();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(root()).toBeNull();
  });

  it("starts over when the deck changes", async () => {
    const view = render(<SlidePreloadLayer pages={deck(3)} index={0} />);
    await frame();
    expect(warmed()).toEqual(["P1 2/3", "P2 3/3"]);

    view.rerender(<SlidePreloadLayer pages={deck(3, "Q")} index={0} />);
    expect(warmed()).toEqual([]);

    await frame();
    expect(warmed()).toEqual(["Q1 2/3", "Q2 3/3"]);
  });

  it("drops pages that a shorter deck no longer has", async () => {
    const view = render(<SlidePreloadLayer pages={deck(5)} index={0} />);
    await frame();
    await frame();
    expect(warmed()).toHaveLength(4);

    view.rerender(<SlidePreloadLayer pages={deck(2)} index={0} />);
    expect(warmed()).toEqual([]);

    await frame();
    expect(warmed()).toEqual(["P1 2/2"]);
  });

  it("never reports done once it is gone", async () => {
    const onDone = vi.fn();
    const view = render(<SlidePreloadLayer pages={deck(2)} index={0} onDone={onDone} />);
    await frame();

    view.unmount();
    await frame(100);

    expect(onDone).not.toHaveBeenCalled();
  });
});
