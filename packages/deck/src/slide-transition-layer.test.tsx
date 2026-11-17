// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { MutableRefObject, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { MorphElement } from "./morph-element";
import type { Page } from "./sdk";
import { SlideTransitionLayer } from "./slide-transition-layer";
import { Step, type StepAggregate, type StepController, Steps } from "./step-context";
import type { SlideTransition } from "./transition";

type FakeAnimation = {
  readonly target: Element;
  readonly keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  readonly options: number | KeyframeAnimationOptions | undefined;
  readonly finished: Promise<FakeAnimation>;
  readonly cancel: Mock<() => void>;
  finish: () => void;
};

type LayerProps = Parameters<typeof SlideTransitionLayer>[0];

const DEFAULT_EASING = "cubic-bezier(.4, 0, .2, 1)";

let animations: FakeAnimation[] = [];
let wrapperRect: DOMRect;
let wrapperOffset = { width: 0, height: 0 };

function rectOf(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

function readRect(value: string | null): DOMRect | null {
  if (!value) return null;
  const [x, y, width, height] = value.split(" ").map(Number);
  return rectOf(x, y, width, height);
}

function isWrapper(el: Element): boolean {
  return el.parentElement?.id === "stage";
}

function measure(this: Element): DOMRect {
  if (isWrapper(this)) return wrapperRect;
  const el = this as HTMLElement;
  const transformed =
    el.style.getPropertyValue("transform") === "none" ? null : readRect(el.getAttribute("data-rect-transformed"));
  return transformed ?? readRect(el.getAttribute("data-rect")) ?? rectOf(0, 0, 0, 0);
}

function fakeAnimate(
  this: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
  options?: number | KeyframeAnimationOptions,
): FakeAnimation {
  let resolve: (value: FakeAnimation) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const finished = new Promise<FakeAnimation>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const animation: FakeAnimation = {
    target: this,
    keyframes,
    options,
    finished,
    cancel: vi.fn(() => reject(new DOMException("The animation was aborted", "AbortError"))),
    finish: () => resolve(animation),
  };
  animations.push(animation);
  return animation;
}

function frames(animation: FakeAnimation | undefined): Keyframe[] {
  return (animation?.keyframes ?? []) as Keyframe[];
}

function animationOn(el: Element | null | undefined): FakeAnimation | undefined {
  return animations.find((a) => a.target === el);
}

function addStyles(css: string): void {
  const style = document.createElement("style");
  style.dataset.test = "";
  style.textContent = css;
  document.head.append(style);
}

function page(label: string, transition?: SlideTransition): Page {
  const Component: Page = () => <p>{label}</p>;
  if (transition) Component.transition = transition;
  return Component;
}

function slide(content: ReactNode): Page {
  return () => <div>{content}</div>;
}

function mount(props: LayerProps) {
  const stage = document.createElement("div");
  stage.id = "stage";
  document.body.append(stage);
  const view = render(<SlideTransitionLayer {...props} />, { container: stage });
  const parts = () => {
    const wrapper = stage.firstElementChild as HTMLElement;
    return {
      wrapper,
      incoming: wrapper.querySelector<HTMLElement>(":scope > [data-osd-current-page]"),
      outgoing: wrapper.querySelector<HTMLElement>(
        ":scope > div:not([data-osd-current-page]):not([data-osd-morph-layer])",
      ),
      overlay: wrapper.querySelector<HTMLElement>(":scope > [data-osd-morph-layer]"),
    };
  };
  return {
    parts,
    rerender: (next: LayerProps) => view.rerender(<SlideTransitionLayer {...next} />),
    unmount: view.unmount,
  };
}

async function finishAll(): Promise<void> {
  await act(async () => {
    for (const animation of animations) animation.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  animations = [];
  wrapperRect = rectOf(0, 0, 960, 540);
  wrapperOffset = { width: 0, height: 0 };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: fakeAnimate });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(measure);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return isWrapper(this) ? wrapperOffset.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return isWrapper(this) ? wrapperOffset.height : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "animate");
  for (const style of document.head.querySelectorAll("style[data-test]")) style.remove();
});

describe("SlideTransitionLayer page changes", () => {
  const fade: SlideTransition = {
    duration: 400,
    enter: { keyframes: [{ opacity: 0, transform: "translateX(10px)" }, { opacity: 1, transform: "none" }] },
    exit: {
      keyframes: [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateX(-10px)" },
      ],
      duration: 200,
      easing: "linear",
      delay: 50,
    },
  };

  it("shows the page at the index and swaps at once when the deck has no transition", () => {
    const pages = [page("Alpha"), page("Beta")];
    const layer = mount({ pages, index: 0, total: 2 });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(layer.parts().incoming?.dataset.osdCurrentPage).toBe("0");

    layer.rerender({ pages, index: 1, total: 2 });

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(layer.parts().incoming?.dataset.osdCurrentPage).toBe("1");
    expect(layer.parts().outgoing).toBeNull();
    expect(animations).toHaveLength(0);
  });

  it("swaps at once while transitions are disabled for reduced motion", () => {
    const pages = [page("Alpha"), page("Beta")];
    const layer = mount({ pages, index: 0, total: 2, moduleTransition: fade, disabled: true });
    layer.rerender({ pages, index: 1, total: 2, moduleTransition: fade, disabled: true });

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(animations).toHaveLength(0);
  });

  it("plays the exit and enter phases forward, holding the exit opacity, then drops the old page", async () => {
    const pages = [page("Alpha"), page("Beta")];
    const layer = mount({ pages, index: 0, total: 2, moduleTransition: fade });
    layer.rerender({ pages, index: 1, total: 2, moduleTransition: fade });

    const { wrapper, incoming, outgoing } = layer.parts();
    expect(outgoing).toHaveTextContent("Alpha");
    expect(incoming).toHaveTextContent("Beta");
    expect(wrapper.dataset.osdDir).toBe("forward");
    expect(wrapper.style.getPropertyValue("--osd-dir")).toBe("1");

    const exit = animationOn(outgoing);
    expect(exit?.keyframes).toEqual([{ transform: "none" }, { transform: "translateX(-10px)" }]);
    expect(exit?.options).toEqual({ duration: 200, easing: "linear", delay: 50, fill: "both" });
    const enter = animationOn(incoming);
    expect(enter?.keyframes).toEqual(fade.enter?.keyframes);
    expect(enter?.options).toEqual({ duration: 400, easing: DEFAULT_EASING, delay: 0, fill: "both" });

    await finishAll();

    expect(layer.parts().outgoing).toBeNull();
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("keeps the exit fade when the transition passes through the background, and runs backward", () => {
    const through: SlideTransition = {
      duration: 300,
      easing: "ease-out",
      throughBackground: true,
      exit: { keyframes: { opacity: [1, 0] } },
    };
    const pages = [page("Alpha"), page("Beta")];
    const layer = mount({ pages, index: 1, total: 2, moduleTransition: through });
    layer.rerender({ pages, index: 0, total: 2, moduleTransition: through });

    const { wrapper, outgoing, incoming } = layer.parts();
    expect(wrapper.dataset.osdDir).toBe("backward");
    expect(wrapper.style.getPropertyValue("--osd-dir")).toBe("-1");
    expect(animationOn(outgoing)?.keyframes).toEqual({ opacity: [1, 0] });
    expect(animationOn(outgoing)?.options).toEqual({ duration: 300, easing: "ease-out", delay: 0, fill: "both" });
    expect(animationOn(incoming)).toBeUndefined();
  });

  it("strips opacity from property-indexed exit keyframes when the slides overlap", () => {
    const overlap: SlideTransition = { duration: 300, exit: { keyframes: { opacity: [1, 0], scale: [1, 0.9] } } };
    const pages = [page("Alpha"), page("Beta")];
    const layer = mount({ pages, index: 0, total: 2, moduleTransition: overlap });
    layer.rerender({ pages, index: 1, total: 2, moduleTransition: overlap });

    expect(animationOn(layer.parts().outgoing)?.keyframes).toEqual({ scale: [1, 0.9] });
  });

  it("uses the incoming page's own transition over the module default", () => {
    const own: SlideTransition = { duration: 120, enter: { keyframes: [{ opacity: 0 }, { opacity: 1 }] } };
    const pages = [page("Alpha"), page("Beta", own)];
    const layer = mount({ pages, index: 0, total: 2, moduleTransition: fade });
    layer.rerender({ pages, index: 1, total: 2, moduleTransition: fade });

    expect(animations).toHaveLength(1);
    expect(animationOn(layer.parts().incoming)?.options).toEqual({
      duration: 120,
      easing: DEFAULT_EASING,
      delay: 0,
      fill: "both",
    });
  });

  it("finishes at once when the transition animates nothing", () => {
    const empty: SlideTransition = { duration: 300 };
    const pages = [page("Alpha"), page("Beta")];
    const layer = mount({ pages, index: 0, total: 2, moduleTransition: empty });
    layer.rerender({ pages, index: 1, total: 2, moduleTransition: empty });

    expect(animations).toHaveLength(0);
    expect(layer.parts().outgoing).toBeNull();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("cancels a running transition when the slide changes again", async () => {
    const pages = [page("Alpha"), page("Beta"), page("Gamma")];
    const layer = mount({ pages, index: 0, total: 3, moduleTransition: fade });
    layer.rerender({ pages, index: 1, total: 3, moduleTransition: fade });
    const first = [...animations];
    expect(first).toHaveLength(2);

    layer.rerender({ pages, index: 2, total: 3, moduleTransition: fade });

    for (const animation of first) expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(layer.parts().outgoing).toHaveTextContent("Beta");
    expect(layer.parts().incoming).toHaveTextContent("Gamma");
    expect(screen.queryByText("Alpha")).toBeNull();

    await finishAll();

    expect(layer.parts().outgoing).toBeNull();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("moves on even when cancelling an old animation throws", async () => {
    const pages = [page("Alpha"), page("Beta"), page("Gamma")];
    const layer = mount({ pages, index: 0, total: 3, moduleTransition: fade });
    layer.rerender({ pages, index: 1, total: 3, moduleTransition: fade });
    animations[0].cancel.mockImplementation(() => {
      throw new Error("already gone");
    });

    layer.rerender({ pages, index: 2, total: 3, moduleTransition: fade });

    expect(animations[1].cancel).toHaveBeenCalled();
    expect(layer.parts().incoming).toHaveTextContent("Gamma");
    for (const animation of animations.slice(2)) {
      animation.cancel.mockImplementation(() => {
        throw new Error("already gone");
      });
    }
    expect(() => layer.unmount()).not.toThrow();
  });

  it("drops the outgoing page when the transition is removed mid-flight", async () => {
    const pages = [page("Alpha"), page("Beta")];
    const layer = mount({ pages, index: 0, total: 2, moduleTransition: fade });
    layer.rerender({ pages, index: 1, total: 2, moduleTransition: fade });
    expect(layer.parts().outgoing).not.toBeNull();

    layer.rerender({ pages, index: 1, total: 2 });

    expect(layer.parts().outgoing).toBeNull();
    expect(screen.getByText("Beta")).toBeInTheDocument();

    await finishAll();

    expect(layer.parts().outgoing).toBeNull();
    expect(layer.parts().incoming).toHaveTextContent("Beta");
  });

  it("shows nothing and animates nothing past the last page", () => {
    const pages = [page("Alpha"), page("Beta")];
    const layer = mount({ pages, index: 0, total: 2, moduleTransition: fade });
    layer.rerender({ pages, index: 5, total: 2, moduleTransition: fade });

    expect(layer.parts().wrapper.childElementCount).toBe(0);
    expect(animations).toHaveLength(0);
  });

  it("skips the exit when the old page is no longer in the deck", () => {
    const pages = [page("Alpha"), page("Beta"), page("Gamma")];
    const layer = mount({ pages, index: 2, total: 3, moduleTransition: fade });
    const shorter = pages.slice(0, 2);
    layer.rerender({ pages: shorter, index: 1, total: 2, moduleTransition: fade });

    expect(layer.parts().outgoing).toBeNull();
    expect(layer.parts().incoming).toHaveTextContent("Beta");
    expect(animations).toHaveLength(0);
  });

  it("hands the step controller to the current page and shows the old page's steps as they were left", async () => {
    const Listing: Page = () => (
      <Steps>
        <Step>{"First point"}</Step>
        <Step>{"Second point"}</Step>
      </Steps>
    );
    const pages = [Listing, page("Closing")];
    const controllerRef: MutableRefObject<StepController | null> = { current: null };
    const onAggregate = vi.fn<(aggregate: StepAggregate) => void>();
    const props = {
      pages,
      total: 2,
      stepControllerRef: controllerRef,
      onStepAggregateChange: onAggregate,
      moduleTransition: fade,
    };
    const layer = mount({ ...props, index: 0, entryDirection: "forward" });

    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 0, stepCount: 2 });
    expect(screen.getByText("First point").closest("[data-osd-step]")).toHaveAttribute("data-osd-step", "pending");
    act(() => {
      expect(controllerRef.current?.advance()).toBe(true);
    });
    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 1, stepCount: 2 });
    expect(screen.getByText("First point").closest("[data-osd-step]")).toHaveAttribute("data-osd-step", "revealed");

    layer.rerender({ ...props, index: 1, entryDirection: "forward" });

    const leaving = layer.parts().outgoing?.querySelectorAll("[data-osd-step]") ?? [];
    expect([...leaving].map((el) => el.getAttribute("data-osd-step"))).toEqual(["revealed", "revealed"]);
    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 0, stepCount: 0 });
    expect(controllerRef.current?.advance()).toBe(false);
    await finishAll();

    layer.rerender({ ...props, index: 0, entryDirection: "backward" });

    const arriving = layer.parts().incoming?.querySelectorAll("[data-osd-step]") ?? [];
    expect([...arriving].map((el) => el.getAttribute("data-osd-step"))).toEqual(["revealed", "revealed"]);
    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 2, stepCount: 2 });
  });

  it("runs steps without a controller ref from the stage", () => {
    const Listing: Page = () => (
      <Steps>
        <Step>{"Only point"}</Step>
      </Steps>
    );
    mount({ pages: [Listing], index: 0, total: 1, entryDirection: "jump" });

    expect(screen.getByText("Only point").closest("[data-osd-step]")).toHaveAttribute("data-osd-step", "revealed");
  });

  it("cancels animations and removes the morph overlay when unmounted mid-transition", () => {
    const morph: SlideTransition = { duration: 300, morph: true };
    const pages = [
      slide(
        <MorphElement id="logo">
          <span data-rect="10 10 50 50">{"Logo"}</span>
        </MorphElement>,
      ),
      slide(
        <MorphElement id="logo">
          <span data-rect="20 20 100 100">{"Logo"}</span>
        </MorphElement>,
      ),
    ];
    const layer = mount({ pages, index: 0, total: 2, moduleTransition: morph });
    layer.rerender({ pages, index: 1, total: 2, moduleTransition: morph });
    const { wrapper, overlay } = layer.parts();
    expect(overlay).not.toBeNull();
    const running = [...animations];

    layer.unmount();

    for (const animation of running) expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(wrapper.querySelector("[data-osd-morph-layer]")).toBeNull();
  });

  describe("when the deck changes mid-morph", () => {
    const morph: SlideTransition = { duration: 300, morph: true };
    const pages = [
      slide(
        <MorphElement id="logo">
          <span data-rect="10 10 50 50">{"Logo"}</span>
        </MorphElement>,
      ),
      slide(
        <MorphElement id="logo">
          <span data-rect="20 20 100 100" style={{ visibility: "visible" }}>
            {"Logo"}
          </span>
        </MorphElement>,
      ),
    ];

    function startMorph() {
      const layer = mount({ pages, index: 0, total: 2, moduleTransition: morph });
      layer.rerender({ pages, index: 1, total: 2, moduleTransition: morph });
      const target = layer.parts().incoming?.querySelector<HTMLElement>("[data-osd-morph=logo]");
      expect(target?.style.getPropertyPriority("visibility")).toBe("important");
      return { layer, target, running: [...animations] };
    }

    it("replaces the old morph overlay and shows the target again once the new run ends", async () => {
      const { layer, target, running } = startMorph();

      layer.rerender({ pages: [...pages], index: 1, total: 2, moduleTransition: morph });

      for (const animation of running) expect(animation.cancel).toHaveBeenCalledTimes(1);
      expect(layer.parts().wrapper.querySelectorAll("[data-osd-morph-layer]")).toHaveLength(1);

      await finishAll();

      expect(layer.parts().wrapper.querySelector("[data-osd-morph-layer]")).toBeNull();
      expect(target?.style.visibility).toBe("visible");
      expect(target?.style.getPropertyPriority("visibility")).toBe("");
    });

    it("removes the overlay and shows the target when the transition is taken away", () => {
      const { layer, target, running } = startMorph();

      layer.rerender({ pages, index: 1, total: 2 });

      for (const animation of running) expect(animation.cancel).toHaveBeenCalledTimes(1);
      expect(layer.parts().wrapper.querySelector("[data-osd-morph-layer]")).toBeNull();
      expect(layer.parts().outgoing).toBeNull();
      expect(target?.style.visibility).toBe("visible");
      expect(target?.style.getPropertyPriority("visibility")).toBe("");
    });
  });
});

describe("SlideTransitionLayer morphs", () => {
  const morph: SlideTransition = { duration: 500, morph: true };

  function morphBetween(from: Page, to: Page, transition: SlideTransition = morph) {
    const pages = [from, to];
    const layer = mount({ pages, index: 0, total: 2, moduleTransition: transition });
    layer.rerender({ pages, index: 1, total: 2, moduleTransition: transition });
    return layer;
  }

  it("flies a shared element from its old box to its new one on a scaled stage", async () => {
    wrapperRect = rectOf(100, 50, 960, 540);
    wrapperOffset = { width: 1920, height: 1080 };
    const layer = morphBetween(
      slide(
        <MorphElement id="title">
          <h1 data-rect="300 150 200 50" style={{ borderTopLeftRadius: "8px" }}>
            {"Title"}
          </h1>
        </MorphElement>,
      ),
      slide(
        <div style={{ opacity: 0.5 }}>
          <MorphElement id="title">
            <h1 data-rect="150 75 400 200" style={{ borderTopLeftRadius: "20px", visibility: "visible" }}>
              {"Title"}
            </h1>
          </MorphElement>
        </div>,
      ),
    );

    const { overlay, outgoing, incoming } = layer.parts();
    const source = outgoing?.querySelector<HTMLElement>("[data-osd-morph=title]");
    const target = incoming?.querySelector<HTMLElement>("[data-osd-morph=title]");
    expect(overlay?.style.zIndex).toBe("2147483647");
    expect(overlay?.style.pointerEvents).toBe("none");
    const clone = overlay?.firstElementChild as HTMLElement;
    expect(overlay?.childElementCount).toBe(1);
    expect(clone).toHaveTextContent("Title");
    expect(clone).not.toHaveAttribute("data-osd-morph");
    expect(clone.style.position).toBe("absolute");
    expect(clone.style.width).toBe("400px");
    expect(clone.style.height).toBe("100px");
    expect(clone.style.transformOrigin).toBe("top left");
    expect(source?.style.getPropertyValue("visibility")).toBe("hidden");
    expect(source?.style.getPropertyPriority("visibility")).toBe("important");
    expect(target?.style.getPropertyValue("visibility")).toBe("hidden");
    expect(outgoing?.style.visibility).toBe("hidden");
    expect(animationOn(outgoing)).toBeUndefined();

    const fly = animationOn(clone);
    expect(frames(fly)[0]).toMatchObject({
      opacity: "1",
      transform: "translate(400px, 200px) scale(1, 1)",
      borderTopLeftRadius: "8px",
    });
    expect(frames(fly)[1]).toMatchObject({
      opacity: "0.5",
      transform: "translate(100px, 50px) scale(2, 4)",
      borderTopLeftRadius: "10px 5px",
    });
    expect(fly?.options).toEqual({ duration: 500, easing: DEFAULT_EASING, delay: 0, fill: "both" });

    await finishAll();

    expect(layer.parts().overlay).toBeNull();
    expect(layer.parts().outgoing).toBeNull();
    expect(target?.style.visibility).toBe("visible");
    expect(target?.style.getPropertyPriority("visibility")).toBe("");
  });

  it("fades out an element with no partner and fades in a new one", async () => {
    const layer = morphBetween(
      slide(
        <MorphElement id="old">
          <p data-rect="0 0 100 40">{"Leaving"}</p>
        </MorphElement>,
      ),
      slide(
        <MorphElement id="new">
          <p data-rect="50 60 200 40">{"Arriving"}</p>
        </MorphElement>,
      ),
    );

    const { overlay, incoming } = layer.parts();
    const [leaving, arriving] = [...(overlay?.children ?? [])];
    expect(leaving).toHaveTextContent("Leaving");
    expect(frames(animationOn(leaving)).map((f) => f.opacity)).toEqual(["1", "0"]);
    expect(frames(animationOn(leaving))[0].transform).toBe("translate(0px, 0px) scale(1, 1)");
    expect(arriving).toHaveTextContent("Arriving");
    expect(frames(animationOn(arriving)).map((f) => f.opacity)).toEqual(["0", "1"]);
    expect(frames(animationOn(arriving))[1].transform).toBe("translate(50px, 60px) scale(1, 1)");

    await finishAll();

    expect(incoming?.querySelector<HTMLElement>("[data-osd-morph=new]")?.style.visibility).toBe("");
  });

  it("only animates elements that have a box on the side they are shown", () => {
    const layer = morphBetween(
      slide(
        <>
          <MorphElement id="grows">
            <p data-rect="0 0 0 40">{"Grows"}</p>
          </MorphElement>
          <MorphElement id="never">
            <p data-rect="0 0 10 0">{"Never"}</p>
          </MorphElement>
          <MorphElement id="gone">
            <p>{"Gone"}</p>
          </MorphElement>
          <MorphElement id="shrinks">
            <p data-rect="5 5 30 30">{"Shrinks"}</p>
          </MorphElement>
        </>,
      ),
      slide(
        <>
          <MorphElement id="grows">
            <p data-rect="10 10 80 40">{"Grows"}</p>
          </MorphElement>
          <MorphElement id="never">
            <p>{"Never"}</p>
          </MorphElement>
          <MorphElement id="shrinks">
            <p data-rect="5 5 0 30">{"Shrinks"}</p>
          </MorphElement>
          <MorphElement id="hidden-new">
            <p>{"Hidden new"}</p>
          </MorphElement>
        </>,
      ),
    );

    const clones = [...(layer.parts().overlay?.children ?? [])];
    expect(clones.map((el) => el.textContent)).toEqual(["Grows", "Shrinks"]);
    expect(frames(animationOn(clones[0])).map((f) => f.opacity)).toEqual(["0", "1"]);
    expect(frames(animationOn(clones[1])).map((f) => f.opacity)).toEqual(["1", "0"]);
  });

  it("ignores untagged and duplicate morph ids", () => {
    const layer = morphBetween(
      slide(
        <>
          <MorphElement id="">
            <p data-rect="0 0 10 10">{"Blank"}</p>
          </MorphElement>
          <MorphElement id="dup">
            <p data-rect="0 0 10 10">{"First copy"}</p>
          </MorphElement>
          <MorphElement id="dup">
            <p data-rect="0 0 10 10">{"Second copy"}</p>
          </MorphElement>
        </>,
      ),
      slide(<p>{"Plain"}</p>),
    );

    const clones = [...(layer.parts().overlay?.children ?? [])];
    expect(clones.map((el) => el.textContent)).toEqual(["First copy"]);
    expect(screen.getByText("Second copy").style.visibility).toBe("");
  });

  it("copies the source's computed look onto the clone and keeps children that inherit it bare", () => {
    addStyles(`
      .card { color: rgb(255, 0, 0); background-color: rgb(0, 0, 255); -webkit-text-fill-color: rgb(255, 0, 0); }
      .card .same { color: rgb(255, 0, 0); }
      .card .other { color: rgb(0, 128, 0); }
      .ink { color: rgb(0, 0, 0); -webkit-text-fill-color: rgb(9, 9, 9); }
    `);
    const layer = morphBetween(
      slide(
        <>
          <MorphElement id="card">
            <div className="card" data-rect="0 0 100 100">
              <span className="same">{"Same"}</span>
              <span className="other">{"Other"}</span>
            </div>
          </MorphElement>
          <MorphElement id="ink">
            <p className="ink" data-rect="0 0 40 20">
              {"Ink"}
            </p>
          </MorphElement>
        </>,
      ),
      slide(
        <>
          <MorphElement id="card">
            <div className="card" data-rect="0 0 100 100">
              <span className="same">{"Same"}</span>
              <span className="other">{"Other"}</span>
            </div>
          </MorphElement>
          <MorphElement id="ink">
            <p className="ink" data-rect="0 0 40 20">
              {"Ink"}
            </p>
          </MorphElement>
        </>,
      ),
    );

    const [card, ink] = [...(layer.parts().overlay?.children ?? [])] as HTMLElement[];
    expect(card.style.color).toBe("rgb(255, 0, 0)");
    expect(card.style.backgroundColor).toBe("rgb(0, 0, 255)");
    expect(card.style.getPropertyValue("-webkit-text-fill-color")).toBe("");
    expect(card.querySelector<HTMLElement>(".same")?.style.color).toBe("");
    expect(card.querySelector<HTMLElement>(".other")?.style.color).toBe("rgb(0, 128, 0)");
    expect(frames(animationOn(card))[0]).not.toHaveProperty("webkitTextFillColor");
    expect(frames(animationOn(card))[0]).toMatchObject({ color: "rgb(255, 0, 0)", backgroundColor: "rgb(0, 0, 255)" });
    expect(ink.style.getPropertyValue("-webkit-text-fill-color")).toBe("rgb(9, 9, 9)");
    expect(frames(animationOn(ink))[0]).toMatchObject({ webkitTextFillColor: "rgb(9, 9, 9)" });
  });

  it("draws a separate border frame when either side has a visible border", () => {
    const layer = morphBetween(
      slide(
        <>
          <MorphElement id="card">
            <div
              data-rect="0 0 100 100"
              style={{ borderTopWidth: "2px", borderTopStyle: "solid", borderTopColor: "rgb(0, 0, 255)" }}
            >
              {"Card"}
            </div>
          </MorphElement>
          <MorphElement id="badge">
            <div data-rect="0 0 20 20" style={{ borderTopLeftRadius: "50%" }}>
              {"Badge"}
            </div>
          </MorphElement>
          <MorphElement id="chip">
            <div
              data-rect="0 0 30 30"
              style={{
                borderTopWidth: "4px",
                borderTopStyle: "hidden",
                borderLeftStyle: "none",
                borderTopColor: "rgb(1, 2, 3)",
              }}
            >
              {"Chip"}
            </div>
          </MorphElement>
        </>,
      ),
      slide(
        <>
          <MorphElement id="card">
            <div data-rect="0 0 200 100">{"Card"}</div>
          </MorphElement>
          <MorphElement id="badge">
            <div data-rect="10 10 40 40" style={{ border: "3px dashed rgb(255, 0, 0)", borderTopLeftRadius: "4px 8px" }}>
              {"Badge"}
            </div>
          </MorphElement>
          <MorphElement id="chip">
            <div data-rect="0 0 30 30" style={{ borderTopColor: "rgb(4, 5, 6)" }}>
              {"Chip"}
            </div>
          </MorphElement>
        </>,
      ),
    );

    const [cardClone, cardFrame, badgeClone, badgeFrame, chipClone, extra] = [
      ...(layer.parts().overlay?.children ?? []),
    ] as HTMLElement[];
    expect(extra).toBeUndefined();
    expect(cardClone).toHaveTextContent("Card");
    expect(cardClone.style.borderTopColor).toBe("transparent");
    expect(cardClone.style.borderLeftColor).toBe("transparent");
    expect(cardFrame.textContent).toBe("");
    expect(cardFrame.style.borderTopStyle).toBe("solid");
    expect(cardFrame.style.borderTopWidth).toBe("2px");
    expect(cardFrame.style.borderTopColor).toBe("rgb(0, 0, 255)");
    expect(cardFrame.style.background).toBe("transparent");
    expect(frames(animationOn(cardFrame))[0]).toMatchObject({
      width: "100px",
      height: "100px",
      opacity: "1",
      transform: "translate(0px, 0px)",
      borderTopWidth: "2px",
      borderTopColor: "rgb(0, 0, 255)",
    });
    expect(frames(animationOn(cardFrame))[1]).toMatchObject({ width: "200px", height: "100px" });
    expect(frames(animationOn(cardClone))[0]).not.toHaveProperty("borderTopColor");

    expect(badgeClone).toHaveTextContent("Badge");
    expect(badgeFrame.style.borderTopStyle).toBe("dashed");
    expect(frames(animationOn(badgeFrame))[1]).toMatchObject({
      borderTopWidth: "3px",
      borderTopColor: "rgb(255, 0, 0)",
      transform: "translate(10px, 10px)",
      borderTopLeftRadius: "4px 8px",
    });
    expect(frames(animationOn(badgeClone))[0]).toMatchObject({ borderTopLeftRadius: "50%" });
    expect(frames(animationOn(badgeClone))[1]).toMatchObject({ borderTopLeftRadius: "2px 4px" });

    expect(chipClone).toHaveTextContent("Chip");
    expect(frames(animationOn(chipClone))[0]).toMatchObject({ borderTopColor: "rgb(1, 2, 3)" });
    expect(frames(animationOn(chipClone))[1]).toMatchObject({ borderTopColor: "rgb(4, 5, 6)" });
  });

  it("animates colour changes on the element's children", () => {
    const layer = morphBetween(
      slide(
        <MorphElement id="legend">
          <div data-rect="0 0 100 50">
            <span style={{ color: "rgb(255, 0, 0)" }}>{"Changes"}</span>
            <span style={{ color: "rgb(0, 0, 0)" }}>{"Stays"}</span>
            <span>{"Extra"}</span>
          </div>
        </MorphElement>,
      ),
      slide(
        <MorphElement id="legend">
          <div data-rect="0 0 100 50">
            <span style={{ color: "rgb(0, 0, 255)" }}>{"Changes"}</span>
            <span style={{ color: "rgb(0, 0, 0)" }}>{"Stays"}</span>
          </div>
        </MorphElement>,
      ),
    );

    const clone = layer.parts().overlay?.firstElementChild as HTMLElement;
    const [changes, stays, extra] = [...clone.children];
    expect(frames(animationOn(changes))).toEqual([
      expect.objectContaining({ color: "rgb(255, 0, 0)" }),
      expect.objectContaining({ color: "rgb(0, 0, 255)" }),
    ]);
    expect(animationOn(stays)).toBeUndefined();
    expect(animationOn(extra)).toBeUndefined();
  });

  it("measures elements with their own transform switched off and puts it back", () => {
    addStyles(".tilt { transform: rotate(5deg); }");
    const layer = morphBetween(
      slide(
        <MorphElement id="arrow">
          <div data-rect="10 20 100 50" data-rect-transformed="0 0 140 90" style={{ transform: "rotate(10deg)" }}>
            {"Arrow"}
          </div>
        </MorphElement>,
      ),
      slide(
        <MorphElement id="arrow">
          <div className="tilt" data-rect="30 40 100 50" data-rect-transformed="0 0 120 80">
            {"Arrow"}
          </div>
        </MorphElement>,
      ),
    );

    const { overlay, outgoing, incoming } = layer.parts();
    const fly = animationOn(overlay?.firstElementChild);
    expect(frames(fly)[0].transform).toBe("translate(10px, 20px) scale(1, 1) rotate(10deg)");
    expect(frames(fly)[1].transform).toBe("translate(30px, 40px) scale(1, 1) rotate(5deg)");
    expect(outgoing?.querySelector<HTMLElement>("[data-osd-morph]")?.style.transform).toBe("rotate(10deg)");
    expect(incoming?.querySelector<HTMLElement>("[data-osd-morph]")?.style.transform).toBe("");
  });

  it("takes its timing from the morph settings", () => {
    const timed: SlideTransition = {
      duration: 500,
      easing: "ease",
      morph: { duration: 900, easing: "ease-in", delay: 30 },
      exit: { keyframes: [{ opacity: 1 }, { opacity: 0 }] },
    };
    const layer = morphBetween(
      slide(
        <MorphElement id="dot">
          <i data-rect="0 0 10 10">{"Dot"}</i>
        </MorphElement>,
      ),
      slide(
        <MorphElement id="dot">
          <i data-rect="0 0 10 10">{"Dot"}</i>
        </MorphElement>,
      ),
      timed,
    );

    const { overlay, outgoing } = layer.parts();
    expect(animationOn(overlay?.firstElementChild)?.options).toEqual({
      duration: 900,
      easing: "ease-in",
      delay: 30,
      fill: "both",
    });
    expect(animationOn(outgoing)?.options).toEqual({ duration: 500, easing: "ease", delay: 0, fill: "both" });
    expect(outgoing?.style.visibility).toBe("");
  });

  it("falls back to the slide timing for an empty morph setting", () => {
    const layer = morphBetween(
      slide(
        <MorphElement id="dot">
          <i data-rect="0 0 10 10">{"Dot"}</i>
        </MorphElement>,
      ),
      slide(<p>{"No dot"}</p>),
      { duration: 250, morph: {} },
    );

    expect(animationOn(layer.parts().overlay?.firstElementChild)?.options).toEqual({
      duration: 250,
      easing: DEFAULT_EASING,
      delay: 0,
      fill: "both",
    });
  });

  it("adds no overlay when neither page tags anything", () => {
    const layer = morphBetween(slide(<p>{"Plain one"}</p>), slide(<p>{"Plain two"}</p>), {
      duration: 300,
      morph: true,
      enter: { keyframes: [{ opacity: 0 }, { opacity: 1 }] },
    });

    expect(layer.parts().overlay).toBeNull();
    expect(layer.parts().outgoing?.style.visibility).toBe("");
    expect(animations).toHaveLength(1);
  });

  it("leaves out colours the browser does not compute", () => {
    const real = globalThis.getComputedStyle;
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation((el, pseudo) => {
      const styles = real(el, pseudo);
      return new Proxy(styles, {
        get(target, prop) {
          if (prop === "getPropertyValue") {
            return (name: string) => (name === "-webkit-text-stroke-color" ? "" : target.getPropertyValue(name));
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    const layer = morphBetween(
      slide(
        <MorphElement id="word">
          <b data-rect="0 0 60 20">{"Word"}</b>
        </MorphElement>,
      ),
      slide(
        <MorphElement id="word">
          <b data-rect="0 0 60 20">{"Word"}</b>
        </MorphElement>,
      ),
    );

    const [from] = frames(animationOn(layer.parts().overlay?.firstElementChild));
    expect(from).toHaveProperty("color");
    expect(from).not.toHaveProperty("webkitTextStrokeColor");
  });

  it.each([
    ["no width", rectOf(0, 0, 0, 540)],
    ["no height", rectOf(0, 0, 960, 0)],
  ])("skips the morph while the stage has %s", (_label, rect) => {
    wrapperRect = rect;
    const layer = morphBetween(
      slide(
        <MorphElement id="dot">
          <i data-rect="0 0 10 10">{"Dot"}</i>
        </MorphElement>,
      ),
      slide(
        <MorphElement id="dot">
          <i data-rect="0 0 20 20">{"Dot"}</i>
        </MorphElement>,
      ),
    );

    expect(animations).toHaveLength(0);
    expect(layer.parts().overlay).toBeNull();
    expect(layer.parts().outgoing).toBeNull();
  });
});
