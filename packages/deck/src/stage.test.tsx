// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { createRef, forwardRef, memo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDesign } from "./design";
import type { Page } from "./sdk";
import {
  clampPage,
  type DeckModule,
  type DeckPosition,
  DeckStage,
  type DeckStageHandle,
  DeckThumbnail,
  readDeckModule,
} from "./stage";
import { Step, Steps } from "./step-context";
import type { SlideTransition } from "./transition";

let box = { width: 960, height: 600 };
let reduceMotion = false;
let resizeCallbacks: ResizeObserverCallback[] = [];
let animateCalls: Element[] = [];

const Intro: Page = () => <h1>{"Intro"}</h1>;
const Listing: Page = () => (
  <Steps>
    <Step>{"First point"}</Step>
    <Step>{"Second point"}</Step>
  </Steps>
);
const Closing: Page = () => <h1>{"Closing"}</h1>;

function deckOf(pages: Page[], extra: Partial<DeckModule> = {}): DeckModule {
  return { pages, notes: [], ...extra };
}

function canvas(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-osd-canvas]");
  if (!el) throw new Error("no canvas");
  return el;
}

function stageAt(deck: DeckModule, page = 0, props: { keyboard?: boolean; flat?: boolean } = {}) {
  const ref = createRef<DeckStageHandle>();
  const positions: DeckPosition[] = [];
  const onPositionChange = (position: DeckPosition) => positions.push(position);
  const view = render(<DeckStage ref={ref} deck={deck} page={page} onPositionChange={onPositionChange} {...props} />);
  return {
    ref,
    positions,
    last: () => positions.at(-1),
    rerender: (nextDeck: DeckModule, nextPage: number) =>
      view.rerender(
        <DeckStage ref={ref} deck={nextDeck} page={nextPage} onPositionChange={onPositionChange} {...props} />,
      ),
  };
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function shown(): string | null | undefined {
  return document.querySelector("[data-osd-current-page]")?.textContent;
}

function layerTexts(): (string | null)[] {
  const layers = document.querySelector("[data-osd-current-page]")?.parentElement?.children ?? [];
  return [...layers].map((el) => el.textContent);
}

beforeEach(() => {
  box = { width: 960, height: 600 };
  reduceMotion = false;
  resizeCallbacks = [];
  animateCalls = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduceMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ x: 0, y: 0, left: 0, top: 0, ...box, right: box.width, bottom: box.height, toJSON: () => ({}) }) as DOMRect,
  );
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value(this: Element) {
      animateCalls.push(this);
      return { finished: new Promise(() => {}), cancel: () => {} };
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "animate");
});

describe("readDeckModule", () => {
  it("reads pages, notes, metadata, design and transition from a deck module", () => {
    const Memo = memo(() => <p>{"memo"}</p>);
    const Forwarded = forwardRef<HTMLParagraphElement>((_props, ref) => <p ref={ref}>{"forwarded"}</p>);
    const transition: SlideTransition = { duration: 200 };
    const deck = readDeckModule({
      default: [Intro, Memo, Forwarded],
      notes: ["Say hello", 42, undefined],
      meta: { title: "Talk" },
      design: defaultDesign,
      transition,
    });

    expect(deck?.pages).toEqual([Intro, Memo, Forwarded]);
    expect(deck?.notes).toEqual(["Say hello", undefined, undefined]);
    expect(deck?.meta).toEqual({ title: "Talk" });
    expect(deck?.design).toBe(defaultDesign);
    expect(deck?.transition).toBe(transition);
  });

  it("has no notes when the module exports none", () => {
    expect(readDeckModule({ default: [Intro] })?.notes).toEqual([]);
  });

  it.each([
    ["no default export", {}],
    ["a default that is not a list", { default: Intro }],
    ["an empty deck", { default: [] }],
    ["a page that is not a component", { default: [Intro, "Closing"] }],
    ["a null page", { default: [null] }],
    ["a rendered element in place of a page component", { default: [Intro, <Intro key="intro" />] }],
  ])("rejects %s", (_label, exports: Record<string, unknown>) => {
    expect(readDeckModule(exports)).toBeNull();
  });
});

describe("clampPage", () => {
  it("rounds into the deck and treats an empty deck as page zero", () => {
    expect(clampPage(1.6, 5)).toBe(2);
    expect(clampPage(-3, 5)).toBe(0);
    expect(clampPage(9, 5)).toBe(4);
    expect(clampPage(3, 0)).toBe(0);
  });
});

describe("DeckStage", () => {
  it("fits the 1920 by 1080 canvas into its box and follows resizes", () => {
    stageAt(deckOf([Intro]));

    const frame = canvas().parentElement as HTMLElement;
    expect(canvas().style.transform).toBe("scale(0.5)");
    expect(canvas().style.transformOrigin).toBe("top left");
    expect(frame.style.width).toBe("960px");
    expect(frame.style.height).toBe("540px");
    expect(frame.style.visibility).toBe("");
    expect(frame.style.borderRadius).toBe("6px");
    expect(frame.style.position).toBe("absolute");

    box = { width: 384, height: 1000 };
    act(() => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    });
    expect(canvas().style.transform).toBe("scale(0.2)");

    box = { width: 0, height: 0 };
    act(() => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    });
    expect(canvas().style.transform).toBe("scale(0.2)");
  });

  it("stays hidden until its box has a size, and applies the deck design", () => {
    box = { width: 0, height: 300 };
    stageAt(deckOf([Intro], { design: defaultDesign }), 0, { flat: true });

    const frame = canvas().parentElement as HTMLElement;
    const outer = frame.parentElement as HTMLElement;
    expect(frame.style.visibility).toBe("hidden");
    expect(canvas().style.transform).toBe("scale(1)");
    expect(outer.style.overflow).toBe("hidden");
    expect(frame.style.borderRadius).toBe("");
    expect(frame.style.background).toBe("var(--osd-bg)");
    expect(canvas().style.getPropertyValue("--osd-accent")).toBe(defaultDesign.palette.accent);
    expect(canvas().style.getPropertyValue("--osd-radius")).toBe("12px");
  });

  it("walks through a slide's steps before moving on, and reports where it is", () => {
    const stage = stageAt(deckOf([Intro, Listing, Closing]));
    expect(shown()).toBe("Intro");
    expect(stage.last()).toEqual({ page: 0, revealed: 0, steps: 0 });

    act(() => stage.ref.current?.next());
    expect(shown()).toBe("First pointSecond point");
    expect(stage.last()).toEqual({ page: 1, revealed: 0, steps: 2 });

    act(() => stage.ref.current?.next());
    expect(stage.last()).toEqual({ page: 1, revealed: 1, steps: 2 });
    act(() => stage.ref.current?.next());
    expect(stage.last()).toEqual({ page: 1, revealed: 2, steps: 2 });
    act(() => stage.ref.current?.next());
    expect(shown()).toBe("Closing");
    expect(stage.last()).toEqual({ page: 2, revealed: 0, steps: 0 });
    act(() => stage.ref.current?.next());
    expect(shown()).toBe("Closing");

    act(() => stage.ref.current?.previous());
    expect(stage.last()).toEqual({ page: 1, revealed: 2, steps: 2 });
    act(() => stage.ref.current?.previous());
    expect(stage.last()).toEqual({ page: 1, revealed: 1, steps: 2 });

    act(() => stage.ref.current?.goto(0));
    expect(shown()).toBe("Intro");
    act(() => stage.ref.current?.previous());
    expect(shown()).toBe("Intro");

    act(() => stage.ref.current?.goto(2));
    expect(shown()).toBe("Closing");
  });

  it("follows the page it is given, clamped to the deck, showing every step after a jump", () => {
    const deck = deckOf([Intro, Closing, Listing]);
    const stage = stageAt(deck, 7);
    expect(stage.last()).toEqual({ page: 2, revealed: 2, steps: 2 });

    stage.rerender(deck, 0);
    expect(shown()).toBe("Intro");

    stage.rerender(deck, 2);
    expect(stage.last()).toEqual({ page: 2, revealed: 2, steps: 2 });

    stage.rerender(deck, 1);
    expect(shown()).toBe("Closing");
  });

  it("stays on a valid page when the deck shrinks or grows", () => {
    const stage = stageAt(deckOf([Intro, Listing, Closing]), 2);

    stage.rerender(deckOf([Intro, Listing]), 2);
    expect(shown()).toBe("First pointSecond point");
    expect(stage.last()?.page).toBe(1);

    stage.rerender(deckOf([Intro, Listing, Closing]), 2);
    expect(shown()).toBe("Closing");
  });

  it("moves with the keyboard when asked to", () => {
    const stage = stageAt(deckOf([Intro, Listing, Closing]), 0, { keyboard: true });

    expect(press("ArrowRight").defaultPrevented).toBe(true);
    expect(stage.last()).toEqual({ page: 1, revealed: 0, steps: 2 });
    press(" ");
    press("PageDown");
    press("Enter");
    expect(shown()).toBe("Closing");
    press("Backspace");
    expect(stage.last()).toEqual({ page: 1, revealed: 2, steps: 2 });
    press("ArrowUp");
    press("PageUp");
    expect(stage.last()).toEqual({ page: 1, revealed: 0, steps: 2 });
    press("ArrowLeft");
    expect(shown()).toBe("Intro");
    expect(press("End").defaultPrevented).toBe(true);
    expect(shown()).toBe("Closing");
    expect(press("Home").defaultPrevented).toBe(true);
    expect(shown()).toBe("Intro");
    press("ArrowDown");
    expect(stage.last()?.page).toBe(1);
  });

  it("ignores shortcuts with modifiers, handled keys and other keys", () => {
    stageAt(deckOf([Intro, Closing]), 0, { keyboard: true });

    expect(press("ArrowRight", { metaKey: true }).defaultPrevented).toBe(false);
    press("ArrowRight", { ctrlKey: true });
    press("ArrowRight", { altKey: true });
    expect(press("x").defaultPrevented).toBe(false);
    const handled = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    handled.preventDefault();
    act(() => {
      window.dispatchEvent(handled);
    });
    expect(shown()).toBe("Intro");
  });

  it("leaves the keyboard alone by default", () => {
    stageAt(deckOf([Intro, Closing]));

    expect(press("ArrowRight").defaultPrevented).toBe(false);
    expect(shown()).toBe("Intro");
  });

  it("plays the deck transition between slides", () => {
    const transition: SlideTransition = { duration: 300, enter: { keyframes: [{ opacity: 0 }, { opacity: 1 }] } };
    const moving = stageAt(deckOf([Intro, Closing], { transition }));
    act(() => moving.ref.current?.next());
    expect(animateCalls).toHaveLength(1);
    expect(animateCalls[0]).toHaveAttribute("data-osd-current-page", "1");
    expect(layerTexts()).toEqual(["Intro", "Closing"]);
  });

  it("swaps slides at once when the system asks for reduced motion", () => {
    reduceMotion = true;
    const transition: SlideTransition = { duration: 300, enter: { keyframes: [{ opacity: 0 }, { opacity: 1 }] } };
    const calm = stageAt(deckOf([Intro, Closing], { transition }));
    act(() => calm.ref.current?.next());

    expect(animateCalls).toHaveLength(0);
    expect(layerTexts()).toEqual(["Closing"]);
  });

  it("reports a slide whose step list is empty only once", () => {
    const Empty: Page = () => (
      <Steps>
        <p>{"Nothing to step through"}</p>
      </Steps>
    );
    const stage = stageAt(deckOf([Empty]));

    expect(stage.positions).toEqual([{ page: 0, revealed: 0, steps: 0 }]);
  });

  it("does not report positions without a listener", () => {
    const ref = createRef<DeckStageHandle>();
    render(<DeckStage ref={ref} deck={deckOf([Intro, Closing])} page={0} />);
    act(() => ref.current?.next());
    expect(shown()).toBe("Closing");
  });
});

describe("DeckThumbnail", () => {
  it("draws a frozen page with every step shown", () => {
    const { container } = render(<DeckThumbnail deck={deckOf([Intro, Listing])} page={1} />);

    expect([...container.querySelectorAll("[data-osd-step]")].map((el) => el.getAttribute("data-osd-step"))).toEqual([
      "revealed",
      "revealed",
    ]);
    expect(canvas()).toHaveAttribute("data-osd-freeze-motion", "");
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it("draws nothing for a page the deck does not have", () => {
    const { container } = render(<DeckThumbnail deck={deckOf([Intro])} page={3} />);
    expect(container).toBeEmptyDOMElement();
  });
});
