// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useLayoutEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installScrollGeometry, type ScrollGeometry } from "@/lib/test-scroll-geometry";
import {
  readSidebarView,
  resetSidebarViewState,
  writeSidebarView,
  type SidebarScrollSlot,
} from "@/store/sidebar-view-state";
import {
  type ScrollMemory,
  useScrollMemory,
  useScrollMemoryLayout,
} from "./use-scroll-memory";

let geometry: ScrollGeometry;

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

function Host({
  projectId = "alpha",
  slot = "files",
  ready = true,
  rows = 100,
  present = true,
}: Readonly<{
  projectId?: string | null;
  slot?: SidebarScrollSlot;
  ready?: boolean;
  rows?: number;
  present?: boolean;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollMemory({ scrollRef: ref, projectId, slot, ready });
  return present ? (
    <div ref={ref} data-testid="scroller">
      {range(rows).map((row) => (
        <p key={row} />
      ))}
    </div>
  ) : null;
}

const scroller = () => {
  const element = document.querySelector<HTMLElement>('[data-testid="scroller"]');
  if (!element) throw new Error("missing scroller");
  return element;
};

beforeEach(() => {
  resetSidebarViewState();
  geometry = installScrollGeometry({
    isScroller: (element) => element.getAttribute("data-testid") === "scroller",
    contentHeight: (element) => element.children.length * 10,
    viewportHeight: 100,
  });
});

afterEach(() => {
  geometry.restore();
});

describe("useScrollMemory", () => {
  it("scrolls to the remembered offset as soon as the list can hold it", () => {
    writeSidebarView("alpha", "scroll.files", 400);

    render(<Host />);

    expect(scroller().scrollTop).toBe(400);
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("leaves a list without a remembered offset alone", () => {
    render(<Host />);
    expect(scroller().scrollTop).toBe(0);
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("remembers where the list was left, even when the last scroll event never fired", () => {
    const view = render(<Host />);
    scroller().scrollTop = 250;

    view.unmount();

    expect(readSidebarView("alpha", "scroll.files")).toBe(250);
  });

  it("keeps the remembered offset when the list is left before it could be restored", () => {
    writeSidebarView("alpha", "scroll.files", 400);
    const view = render(<Host ready={false} />);

    view.unmount();

    expect(readSidebarView("alpha", "scroll.files")).toBe(400);
  });

  it("waits for the data before restoring", () => {
    writeSidebarView("alpha", "scroll.files", 400);
    const view = render(<Host ready={false} />);
    expect(scroller().scrollTop).toBe(0);
    geometry.flushFrames();
    expect(scroller().scrollTop).toBe(0);

    view.rerender(<Host ready />);

    expect(scroller().scrollTop).toBe(400);
  });

  it("waits for the list to grow tall enough instead of settling for the clamped offset", () => {
    writeSidebarView("alpha", "scroll.files", 400);
    const view = render(<Host rows={20} />);
    expect(scroller().scrollTop).toBe(0);
    expect(geometry.pendingFrames()).toBe(1);

    view.rerender(<Host rows={100} />);

    expect(scroller().scrollTop).toBe(400);
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("settles for the end of a list that shrank below the remembered offset", () => {
    writeSidebarView("alpha", "scroll.files", 400);
    render(<Host rows={30} />);
    expect(scroller().scrollTop).toBe(0);

    geometry.flushFrames();

    expect(scroller().scrollTop).toBe(200);
  });

  it("does nothing on a frame that arrives after the restore was no longer needed", () => {
    writeSidebarView("alpha", "scroll.files", 400);
    const view = render(<Host rows={30} />);
    view.rerender(<Host rows={100} />);
    scroller().scrollTop = 120;

    geometry.flushFrames();

    expect(scroller().scrollTop).toBe(120);
  });

  it("follows the user once restored and remembers the last offset", () => {
    writeSidebarView("alpha", "scroll.files", 400);
    const view = render(<Host />);

    geometry.scrollTo(scroller(), 150);
    view.unmount();

    expect(readSidebarView("alpha", "scroll.files")).toBe(150);
  });

  it("ignores scrolling that happens before the remembered offset is restored", () => {
    writeSidebarView("alpha", "scroll.files", 400);
    const view = render(<Host ready={false} />);

    geometry.scrollTo(scroller(), 30);
    view.unmount();

    expect(readSidebarView("alpha", "scroll.files")).toBe(400);
  });

  it("files the offset under the old project and restores the new project's when it changes", () => {
    writeSidebarView("beta", "scroll.files", 300);
    const view = render(<Host projectId="alpha" />);
    geometry.scrollTo(scroller(), 200);

    view.rerender(<Host projectId="beta" />);

    expect(readSidebarView("alpha", "scroll.files")).toBe(200);
    expect(scroller().scrollTop).toBe(300);
  });

  it("returns to the top for a project that has no remembered offset", () => {
    const view = render(<Host projectId="alpha" />);
    geometry.scrollTo(scroller(), 200);

    view.rerender(<Host projectId="beta" />);

    expect(scroller().scrollTop).toBe(0);
  });

  it("keeps a separate offset for each slot of the same project", () => {
    writeSidebarView("alpha", "scroll.references.symbols", 120);
    const view = render(<Host slot="references.citations" />);
    geometry.scrollTo(scroller(), 350);

    view.rerender(<Host slot="references.symbols" />);
    expect(scroller().scrollTop).toBe(120);

    view.rerender(<Host slot="references.citations" />);
    expect(scroller().scrollTop).toBe(350);
  });

  it("restores the last offset again when the scroller is replaced", () => {
    const view = render(<Host />);
    geometry.scrollTo(scroller(), 300);

    view.rerender(<Host present={false} />);
    view.rerender(<Host />);

    expect(scroller().scrollTop).toBe(300);
  });

  it("stops listening to a scroller that went away", () => {
    const view = render(<Host />);
    const first = scroller();
    geometry.scrollTo(first, 300);
    view.rerender(<Host present={false} />);

    first.scrollTop = 20;
    act(() => {
      first.dispatchEvent(new Event("scroll"));
    });
    view.rerender(<Host />);

    expect(scroller().scrollTop).toBe(300);
  });

  it("remembers nothing and restores nothing without a project", () => {
    const view = render(<Host projectId={null} />);
    geometry.scrollTo(scroller(), 200);
    view.unmount();

    expect(readSidebarView(null, "scroll.files")).toBeUndefined();
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("drops a scheduled frame when it is unmounted", () => {
    writeSidebarView("alpha", "scroll.files", 400);
    const view = render(<Host rows={20} />);
    expect(geometry.pendingFrames()).toBe(1);

    view.unmount();

    expect(geometry.pendingFrames()).toBe(0);
  });
});

describe("useScrollMemoryLayout", () => {
  let renders = 0;

  function Rows({ memory }: Readonly<{ memory: ScrollMemory | undefined }>) {
    renders += 1;
    useScrollMemoryLayout(memory);
    return null;
  }

  function Pair({ rows }: Readonly<{ rows: number }>) {
    const ref = useRef<HTMLDivElement>(null);
    const memory = useScrollMemory({ scrollRef: ref, projectId: "alpha", slot: "files" });
    return (
      <div ref={ref} data-testid="scroller">
        {range(rows).map((row) => (
          <p key={row} />
        ))}
        <Rows memory={memory} />
      </div>
    );
  }

  beforeEach(() => {
    renders = 0;
  });

  it("re-renders the list once the host restored the offset so it can measure again", () => {
    writeSidebarView("alpha", "scroll.files", 400);

    render(<Pair rows={100} />);

    expect(scroller().scrollTop).toBe(400);
    expect(renders).toBe(2);
  });

  it("restores from the list itself when only the list grows and the host does not render again", () => {
    writeSidebarView("alpha", "scroll.files", 400);
    let hostRenders = 0;
    function Growing({ memory }: Readonly<{ memory: ScrollMemory }>) {
      const [rows, setRows] = useState(5);
      useLayoutEffect(() => {
        setRows(100);
      }, []);
      useScrollMemoryLayout(memory);
      return (
        <>
          {range(rows).map((row) => (
            <p key={row} />
          ))}
        </>
      );
    }
    function Standalone() {
      hostRenders += 1;
      const ref = useRef<HTMLDivElement>(null);
      const memory = useScrollMemory({ scrollRef: ref, projectId: "alpha", slot: "files" });
      return (
        <div ref={ref} data-testid="scroller">
          <Growing memory={memory} />
        </div>
      );
    }

    render(<Standalone />);

    expect(scroller().scrollTop).toBe(400);
    expect(hostRenders).toBe(1);
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("does nothing without a memory", () => {
    render(<Rows memory={undefined} />);
    expect(renders).toBe(1);
  });
});
