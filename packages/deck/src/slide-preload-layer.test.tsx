// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
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
    render(<SlidePreloadLayer pages={deck(5)} index={3} />);

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

    await frame(50);
    expect(root()).toBeNull();
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
    const { container } = render(<SlidePreloadLayer pages={deck(3)} index={0} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("still warms pages when there is no navigator to ask", async () => {
    vi.stubGlobal("navigator", undefined);
    render(<SlidePreloadLayer pages={deck(2)} index={0} />);

    await frame();
    expect(warmed()).toEqual(["P1 2/2"]);
  });

  it("finishes at once for a deck with a single page", () => {
    const { container } = render(<SlidePreloadLayer pages={deck(1)} index={0} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("waits for images to load or fail before finishing", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
    render(<SlidePreloadLayer pages={[numbered("Intro"), withImage("cover"), withImage("chart")]} index={0} />);

    await frame();
    await frame(50);
    expect(root()).not.toBeNull();

    const [cover, chart] = [...(root()?.querySelectorAll("img") ?? [])];
    fireEvent.load(cover);
    await frame();
    expect(root()).not.toBeNull();

    fireEvent.error(chart);
    await frame();
    expect(root()).toBeNull();
  });

  it("gives up waiting after fifteen seconds", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
    render(<SlidePreloadLayer pages={[numbered("Intro"), withImage("never")]} index={0} />);

    await frame(1000);
    expect(root()).not.toBeNull();

    await frame(15000);
    expect(root()).toBeNull();
  });

  it("waits for web fonts when the document loads them", async () => {
    let fontsReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      fontsReady = resolve;
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    render(<SlidePreloadLayer pages={deck(2)} index={0} />);

    await frame();
    await frame(100);
    expect(root()).not.toBeNull();

    await act(async () => {
      fontsReady();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(root()).toBeNull();
  });

  it("still finishes when the document's fonts fail to load", async () => {
    let fontsFailed: () => void = () => {};
    const ready = new Promise<void>((_resolve, reject) => {
      fontsFailed = () => reject(new Error("font load failed"));
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    render(<SlidePreloadLayer pages={deck(2)} index={0} />);

    await frame();
    await frame(100);
    expect(root()).not.toBeNull();

    await act(async () => {
      fontsFailed();
      await vi.advanceTimersByTimeAsync(0);
    });
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

  it("warms only the neighbours while editing, and keeps what it warmed across edits of the same length", async () => {
    let mounts = 0;
    const counted = (count: number, prefix: string): Page[] =>
      Array.from({ length: count }, (_, page) => {
        const Counted = () => {
          useEffect(() => {
            mounts += 1;
          }, []);
          return <p>{`${prefix}${page}`}</p>;
        };
        return Counted;
      });
    const view = render(<SlidePreloadLayer pages={counted(100, "A")} index={50} warmup="neighbours" />);
    await frame();
    expect(warmed()).toEqual(["A51", "A49"]);
    await frame(50);
    expect(root()).toBeNull();
    expect(mounts).toBe(2);

    for (const edit of ["B", "C", "D"]) {
      view.rerender(<SlidePreloadLayer pages={counted(100, edit)} index={50} warmup="neighbours" />);
      await frame(50);
    }
    expect(root()).toBeNull();
    expect(mounts).toBe(2);

    view.rerender(<SlidePreloadLayer pages={counted(100, "D")} index={51} warmup="neighbours" />);
    await frame();
    expect(warmed()).toEqual(["D52"]);
    await frame(50);
    expect(mounts).toBe(3);

    view.rerender(<SlidePreloadLayer pages={counted(101, "E")} index={51} warmup="neighbours" />);
    await frame();
    expect(warmed()).toEqual(["E52", "E50"]);
  });

  it("keeps a finished warm-up of the whole deck when an edit keeps the page count", async () => {
    const view = render(<SlidePreloadLayer pages={deck(4)} index={0} />);
    await frame();
    await frame();
    await frame(50);
    expect(root()).toBeNull();

    view.rerender(<SlidePreloadLayer pages={deck(4, "Q")} index={0} />);
    expect(root()).toBeNull();
    await frame(50);
    expect(root()).toBeNull();
  });
});
