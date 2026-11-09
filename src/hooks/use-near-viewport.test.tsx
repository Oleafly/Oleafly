// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installIntersectionObserverStub, type IntersectionObserverStub } from "@/components/ui/test-intersection-observer";
import { useNearViewport, watchVisibility, whenNearViewport } from "./use-near-viewport";

let stub: IntersectionObserverStub | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  vi.unstubAllGlobals();
});

function Probe({ id, margin }: Readonly<{ id: string; margin?: string }>) {
  const [gate, near] = useNearViewport<HTMLDivElement>(margin);
  return <div ref={gate} data-id={id} data-near={String(near)} />;
}

describe("whenNearViewport", () => {
  it("runs once when the element comes near and stops watching it", () => {
    stub = installIntersectionObserverStub(() => false);
    const element = document.createElement("div");
    const onNear = vi.fn();
    whenNearViewport(element, onNear);
    expect(onNear).not.toHaveBeenCalled();
    expect(stub.observed()).toEqual([element]);
    stub.setVisible(() => true);
    stub.setVisible(() => true);
    expect(onNear).toHaveBeenCalledTimes(1);
    expect(stub.observed()).toEqual([]);
  });

  it("runs at once when the element is already near, and without IntersectionObserver", () => {
    stub = installIntersectionObserverStub(() => true);
    const onNear = vi.fn();
    whenNearViewport(document.createElement("div"), onNear);
    expect(onNear).toHaveBeenCalledTimes(1);
    expect(stub.observed()).toEqual([]);
    stub.restore();
    stub = null;
    vi.stubGlobal("IntersectionObserver", undefined);
    const later = vi.fn();
    whenNearViewport(document.createElement("div"), later)();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("stops watching when cancelled", () => {
    stub = installIntersectionObserverStub(() => false);
    const onNear = vi.fn();
    const stop = whenNearViewport(document.createElement("div"), onNear);
    stop();
    stub.setVisible(() => true);
    expect(onNear).not.toHaveBeenCalled();
    expect(stub.observed()).toEqual([]);
  });
});

describe("watchVisibility", () => {
  it("reports every change until stopped", () => {
    stub = installIntersectionObserverStub(() => false);
    const element = document.createElement("div");
    const seen: boolean[] = [];
    const stop = watchVisibility(element, (visible) => seen.push(visible), "0px");
    stub.setVisible(() => true);
    stub.setVisible(() => false);
    stop();
    stub.setVisible(() => true);
    expect(seen).toEqual([false, true, false]);
  });
});

describe("useNearViewport", () => {
  it("shares one observer between elements with the same margin", () => {
    stub = installIntersectionObserverStub(() => false);
    const Stub = globalThis.IntersectionObserver;
    let made = 0;
    globalThis.IntersectionObserver = class extends Stub {
      constructor(...args: ConstructorParameters<typeof IntersectionObserver>) {
        super(...args);
        made += 1;
      }
    };
    const view = render(
      <>
        <Probe id="a" />
        <Probe id="b" />
        <Probe id="c" margin="400px 0px" />
      </>,
    );
    expect(made).toBe(2);
    expect(stub.observed()).toHaveLength(3);
    act(() => stub?.setVisible((target) => (target as HTMLElement).dataset.id === "a"));
    expect(document.querySelector('[data-id="a"]')?.getAttribute("data-near")).toBe("true");
    expect(document.querySelector('[data-id="b"]')?.getAttribute("data-near")).toBe("false");
    view.unmount();
    expect(stub.observed()).toHaveLength(0);
  });
});
