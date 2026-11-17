// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CommentArrival, CommentScrollArea, newArrivals, useArrival } from "./comment-arrivals";
import { keepsThread } from "./comment-filter";

const NOW = 1_000_000;
const REPLY = "Reply";

function Row({ id }: Readonly<{ id: string }>) {
  const arrival = useArrival(id);
  return (
    <li ref={arrival.ref} data-comment-entry={id} data-fresh={arrival.fresh || undefined}>
      {id}
    </li>
  );
}

function List({ items, scope }: Readonly<{ items: readonly CommentArrival[]; scope?: string }>) {
  return (
    <CommentScrollArea items={items} ready scope={scope} label={(count) => `${count} new comments`}>
      <ol>
        {items.map((item) => (
          <Row key={item.id} id={item.id} />
        ))}
      </ol>
    </CommentScrollArea>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("new comment arrivals", () => {
  it("counts only other people's comments that appeared after the list loaded", () => {
    const known = new Set(["a"]);
    const items = [
      { id: "a", mine: false, at: NOW },
      { id: "b", mine: false, at: NOW },
      { id: "c", mine: true, at: NOW },
      { id: "d", mine: false, at: NOW - 3_600_000 },
    ];
    expect(newArrivals(known, items, NOW)).toEqual(["b"]);
  });

  it("marks a new comment New and offers a pill to scroll to it while it is out of view", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const first = [{ id: "a", mine: false, at: NOW }];
    const view = render(<List items={first} />);
    expect(document.querySelector("[data-fresh]")).toBeNull();
    const next = [...first, { id: "b", mine: false, at: NOW + 1 }];
    view.rerender(<List items={next} />);
    expect(document.querySelector('[data-comment-entry="b"]')).toHaveAttribute("data-fresh");
    const pill = screen.getByRole("button", { name: "1 new comments" });
    expect(pill).toHaveClass("h-7", "px-3", "text-[0.78125rem]", "font-medium", "[&_svg]:size-[0.8125rem]");
    expect(pill.parentElement).toHaveClass("top-2.5");
    const target = document.querySelector('[data-comment-entry="b"]') as HTMLElement;
    target.scrollIntoView = vi.fn();
    fireEvent.click(pill);
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it("still marks an arrival New under StrictMode", () => {
    const now = Date.now();
    const first = [{ id: "a", mine: false, at: now }];
    const view = render(
      <StrictMode>
        <List items={first} />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <List items={[...first, { id: "b", mine: false, at: now + 1 }]} />
      </StrictMode>,
    );
    expect(document.querySelector('[data-comment-entry="b"]')).toHaveAttribute("data-fresh");
    expect(document.querySelector('[data-comment-entry="a"]')).not.toHaveAttribute("data-fresh");
  });

  it("adds no pill or tint for your own comment", () => {
    const first = [{ id: "a", mine: false, at: Date.now() }];
    const view = render(<List items={first} />);
    view.rerender(<List items={[...first, { id: "mine", mine: true, at: Date.now() }]} />);
    expect(document.querySelector("[data-fresh]")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the reader's place when a comment lands above it", () => {
    const first = [{ id: "a", mine: false, at: Date.now() }];
    const view = render(<List items={first} />);
    const scroller = document.querySelector("[data-comment-entry]")?.closest(".overflow-y-auto") as HTMLElement;
    let top = 100;
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = value) });
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
    const anchor = document.querySelector('[data-comment-entry="a"]') as HTMLElement;
    let shift = 0;
    anchor.getBoundingClientRect = () => ({ top: 20 + shift, bottom: 80 + shift }) as DOMRect;
    act(() => {
      fireEvent.scroll(scroller);
    });
    shift = 60;
    view.rerender(<List items={[{ id: "z", mine: false, at: Date.now() }, ...first]} />);
    expect(top).toBe(160);
  });
});

describe("thread filter", () => {
  it.each([
    ["open", false, true],
    ["open", true, false],
    ["resolved", true, true],
    ["resolved", false, false],
    ["all", true, true],
    ["all", false, true],
  ] as const)("%s keeps a thread that is resolved=%s: %s", (filter, resolved, kept) => {
    expect(keepsThread(filter, resolved)).toBe(kept);
  });
});

describe("arrivals after review", () => {
  function scroller(): HTMLElement {
    return document.querySelector("[data-comment-entry]")?.closest(".overflow-y-auto") as HTMLElement;
  }

  function place(element: HTMLElement, top: number, bottom = top + 60) {
    element.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
  }

  it("treats what is already there as known when the scope changes", () => {
    const now = Date.now();
    const view = render(<List scope="paper:intro.tex" items={[{ id: "a", mine: false, at: now }]} />);
    view.rerender(<List scope="paper:methods.tex" items={[{ id: "b", mine: false, at: now + 5 }, { id: "c", mine: false, at: now + 6 }]} />);
    expect(document.querySelector("[data-fresh]")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("treats a group that loads later as known, not new", () => {
    const now = Date.now();
    const first = [{ id: "a", mine: false, at: now, group: "intro.tex" }];
    const view = render(<List items={first} />);
    view.rerender(<List items={[...first, { id: "b", mine: false, at: now + 5, group: "refs.tex" }]} />);
    expect(document.querySelector("[data-fresh]")).toBeNull();
    view.rerender(<List items={[...first, { id: "b", mine: false, at: now + 5, group: "refs.tex" }, { id: "c", mine: false, at: now + 9, group: "refs.tex" }]} />);
    expect(document.querySelector('[data-comment-entry="c"]')).toHaveAttribute("data-fresh");
  });

  it("treats a group collapsed and opened again as a fresh load", () => {
    const now = Date.now();
    const intro = [{ id: "a", mine: false, at: now, group: "intro.tex" }];
    const refs = { id: "b", mine: false, at: now + 5, group: "refs.tex" };
    const view = render(<List items={[...intro, refs]} />);
    view.rerender(<List items={intro} />);
    view.rerender(<List items={[...intro, refs, { id: "c", mine: false, at: now + 9, group: "refs.tex" }]} />);
    expect(document.querySelector('[data-comment-entry="c"]')).not.toHaveAttribute("data-fresh");
    expect(screen.queryByRole("button", { name: /new comments/u })).toBeNull();
  });

  it("keeps the place when something above the reader grows without a new item", () => {
    const callbacks: (() => void)[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      render(<List items={[{ id: "a", mine: false, at: Date.now() }, { id: "b", mine: false, at: Date.now() }]} />);
      const box = scroller();
      let top = 100;
      Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = value) });
      place(box, 0, 300);
      const b = document.querySelector('[data-comment-entry="b"]') as HTMLElement;
      place(document.querySelector('[data-comment-entry="a"]') as HTMLElement, -80, -20);
      place(b, 10);
      act(() => {
        fireEvent.scroll(box);
      });
      place(b, 40);
      act(() => {
        for (const callback of callbacks) callback();
      });
      expect(top).toBe(130);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  function withResizes(run: (resize: () => void) => void) {
    const callbacks: (() => void)[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      run(() =>
        act(() => {
          for (const callback of callbacks) callback();
        }),
      );
    } finally {
      globalThis.ResizeObserver = original;
    }
  }

  function scrolledList(): { box: HTMLElement; a: HTMLElement; b: HTMLElement; top: () => number; scrollTo: (value: number) => void } {
    render(<List items={[{ id: "a", mine: false, at: Date.now() }, { id: "b", mine: false, at: Date.now() }]} />);
    const box = scroller();
    let top = 100;
    Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = value) });
    place(box, 0, 300);
    const a = document.querySelector('[data-comment-entry="a"]') as HTMLElement;
    const b = document.querySelector('[data-comment-entry="b"]') as HTMLElement;
    place(a, -80, 40);
    place(b, 50);
    const scrollTo = (value: number) => {
      top = value;
      act(() => {
        fireEvent.scroll(box);
      });
    };
    scrollTo(100);
    return { box, a, b, top: () => top, scrollTo };
  }

  it("does not scroll when the box itself moves, only when something inside it does", () => {
    withResizes((resize) => {
      const { box, b, top } = scrolledList();
      place(box, 100, 400);
      place(b, 150);
      resize();
      expect(top()).toBe(100);
      place(b, 180);
      resize();
      expect(top()).toBe(130);
    });
  });

  it("lets what the reader just opened grow downward instead of pushing it above the top", () => {
    withResizes((resize) => {
      const { a, b, top } = scrolledList();
      fireEvent.pointerDown(a);
      fireEvent.click(a);
      place(a, -80, 160);
      place(b, 170);
      resize();
      expect(top()).toBe(100);
    });
  });

  it("still opens downward when the reader holds the press before letting go", () => {
    let now = 1_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      withResizes((resize) => {
        const { a, b, top } = scrolledList();
        fireEvent.pointerDown(a);
        now += 600;
        fireEvent.click(a);
        place(a, -80, 160);
        place(b, 170);
        resize();
        expect(top()).toBe(100);
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps the place when something above grows while the reader types in an item below", () => {
    withResizes((resize) => {
      const { a, b, top } = scrolledList();
      fireEvent.keyDown(b, { key: "x" });
      place(a, -80, 64);
      place(b, 74);
      resize();
      expect(top()).toBe(124);
    });
  });

  it("keeps the toggle in place when the reader hides replies in an item cut by the top edge", () => {
    withResizes((resize) => {
      const { a, b, top, scrollTo } = scrolledList();
      place(a, -300, 40);
      place(b, 50);
      scrollTo(400);
      fireEvent.pointerDown(a);
      fireEvent.click(a);
      place(a, -300, -250);
      place(b, -240);
      resize();
      expect(top()).toBe(110);
    });
  });

  it("lets a group the reader opened push nothing above the top when its items load", () => {
    function Groups({ open }: Readonly<{ open: boolean }>) {
      const items = [
        ...(open ? [{ id: "a", mine: false, at: 0, group: "g1" }] : []),
        { id: "b", mine: false, at: 0, group: "g2" },
      ];
      return (
        <CommentScrollArea items={items} ready label={(count) => `${count} new`}>
          <section data-testid="g1">
            <button type="button">{"intro.tex"}</button>
            {open ? <Row id="a" /> : null}
          </section>
          <section>
            <Row id="b" />
          </section>
        </CommentScrollArea>
      );
    }
    const view = render(<Groups open={false} />);
    const box = scroller();
    let top = 100;
    Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = value) });
    place(box, 0, 300);
    const group = screen.getByTestId("g1");
    place(group, -10, 20);
    const b = document.querySelector('[data-comment-entry="b"]') as HTMLElement;
    place(b, 30);
    act(() => {
      fireEvent.scroll(box);
    });
    const header = screen.getByRole("button", { name: "intro.tex" });
    place(header, -10, 20);
    fireEvent.pointerDown(header);
    fireEvent.click(header);
    place(group, -10, 140);
    place(b, 150);
    view.rerender(<Groups open />);
    expect(top).toBe(100);
  });

  it("keeps the place when a reply lands above the top inside the last thread", () => {
    function Last({ ids }: Readonly<{ ids: string[] }>) {
      return (
        <CommentScrollArea items={ids.map((id) => ({ id, mine: false, at: 0 }))} ready label={(count) => `${count} new`}>
          <article data-comment-thread="t1">
            {ids.map((id) => (
              <Row key={id} id={id} />
            ))}
            <p data-testid="tail" />
          </article>
        </CommentScrollArea>
      );
    }
    const view = render(<Last ids={["r1", "r2"]} />);
    const box = scroller();
    let top = 100;
    Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = value) });
    place(box, 0, 300);
    place(document.querySelector("article") as HTMLElement, -200, 40);
    place(document.querySelector('[data-comment-entry="r1"]') as HTMLElement, -190, -130);
    place(document.querySelector('[data-comment-entry="r2"]') as HTMLElement, -120, -60);
    const tail = screen.getByTestId("tail");
    place(tail, 0, 40);
    act(() => {
      fireEvent.scroll(box);
    });
    place(tail, 60, 100);
    view.rerender(<Last ids={["r1", "r1b", "r2"]} />);
    expect(top).toBe(160);
  });

  it("anchors to the first item that starts on screen, not the thread around it", () => {
    function Thread({ ids }: Readonly<{ ids: string[] }>) {
      return (
        <CommentScrollArea items={ids.map((id) => ({ id, mine: false, at: 0 }))} ready label={(count) => `${count} new`}>
          <article data-comment-thread="t1">
            {ids.map((id) => (
              <Row key={id} id={id} />
            ))}
          </article>
        </CommentScrollArea>
      );
    }
    const view = render(<Thread ids={["r1", "r3"]} />);
    const box = scroller();
    let top = 100;
    Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = value) });
    place(box, 0, 300);
    place(document.querySelector("article") as HTMLElement, -50, 200);
    place(document.querySelector('[data-comment-entry="r1"]') as HTMLElement, -40, 0);
    const r3 = document.querySelector('[data-comment-entry="r3"]') as HTMLElement;
    place(r3, 20);
    act(() => {
      fireEvent.scroll(box);
    });
    place(r3, 80);
    view.rerender(<Thread ids={["r1", "r2", "r3"]} />);
    expect(top).toBe(160);
  });
});

describe("arrivals after the second review", () => {
  function place(element: Element, top: number, bottom = top + 60) {
    (element as HTMLElement).getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
  }

  function at(selector: string): HTMLElement {
    return document.querySelector(selector) as HTMLElement;
  }

  function mount(node: ReactNode, start = 400) {
    const callbacks: (() => void)[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const view = render(node);
    globalThis.ResizeObserver = original;
    const box = document.querySelector(".overflow-y-auto") as HTMLElement;
    let top = start;
    Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = value) });
    place(box, 0, 300);
    return {
      view,
      box,
      top: () => top,
      settle: () =>
        act(() => {
          fireEvent.scroll(box);
        }),
      scrollTo: (value: number) => {
        top = value;
        act(() => {
          fireEvent.scroll(box);
        });
      },
      resize: () =>
        act(() => {
          for (const callback of callbacks) callback();
        }),
    };
  }

  const ONLY_U = [{ id: "u", mine: false, at: 0 }];

  function Folding({ replies }: Readonly<{ replies: readonly string[] }>) {
    const [open, setOpen] = useState(true);
    return (
      <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
        <div>
          <article data-comment-thread="t">
            <Row id="root" />
            {open ? (
              <ol>
                {replies.map((id) => (
                  <Row key={id} id={id} />
                ))}
              </ol>
            ) : null}
            <div data-testid="toggle-row">
              <button type="button" onClick={() => setOpen((value) => !value)}>
                {open ? "Hide replies" : "3 replies"}
              </button>
            </div>
          </article>
          <article data-comment-thread="u">
            <Row id="u" />
          </article>
        </div>
      </CommentScrollArea>
    );
  }

  it("keeps 'Hide replies' under the pointer when the last reply starts on screen", () => {
    const list = mount(<Folding replies={["r1", "r2", "r3"]} />);
    place(at('[data-comment-thread="t"]'), -500, 205);
    place(at('[data-comment-entry="root"]'), -500, -330);
    place(at('[data-comment-entry="r1"]'), -320, -170);
    place(at('[data-comment-entry="r2"]'), -160, 10);
    place(at('[data-comment-entry="r3"]'), 20, 160);
    const toggle = screen.getByRole("button", { name: "Hide replies" });
    place(toggle, 170, 190);
    place(at('[data-comment-thread="u"]'), 210, 300);
    place(at('[data-comment-entry="u"]'), 210, 300);
    list.settle();
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    place(at('[data-comment-thread="t"]'), -500, -275);
    place(toggle, -310, -290);
    place(at('[data-comment-thread="u"]'), -270, -180);
    place(at('[data-comment-entry="u"]'), -270, -180);
    list.resize();
    expect(list.top()).toBe(-80);
  });

  it("lets the reader's own reply box grow and shrink back without moving the view", () => {
    const list = mount(
      <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
        <div>
          <article data-comment-thread="t">
            <Row id="root" />
            <textarea aria-label={REPLY} />
          </article>
          <article data-comment-thread="u" />
        </div>
      </CommentScrollArea>,
    );
    const box = screen.getByRole("textbox", { name: "Reply" });
    const thread = at('[data-comment-thread="t"]');
    const next = at('[data-comment-thread="u"]');
    place(thread, -300, 100);
    place(at('[data-comment-entry="root"]'), -300, 30);
    place(box, 40, 100);
    place(next, 110);
    list.settle();
    fireEvent.keyDown(box, { key: "a" });
    place(box, 40, 160);
    place(thread, -300, 160);
    place(next, 170);
    list.resize();
    expect(list.top()).toBe(400);
    fireEvent.keyDown(box, { key: "Backspace" });
    place(box, 40, 100);
    place(thread, -300, 100);
    place(next, 110);
    list.resize();
    expect(list.top()).toBe(400);
  });

  it("keeps the reply box still while a co-author's 'is replying' line comes and goes above it", () => {
    function Typing({ line }: Readonly<{ line: boolean }>) {
      return (
        <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
          <div>
            <article data-comment-thread="t">
              <Row id="root" />
              {line ? <p data-testid="line">{"Bob is replying"}</p> : null}
              <textarea aria-label={REPLY} />
            </article>
            <article data-comment-thread="u" />
          </div>
        </CommentScrollArea>
      );
    }
    const list = mount(<Typing line={false} />);
    const box = screen.getByRole("textbox", { name: "Reply" });
    const thread = at('[data-comment-thread="t"]');
    const next = at('[data-comment-thread="u"]');
    place(thread, -300, 100);
    place(at('[data-comment-entry="root"]'), -300, 30);
    place(box, 40, 100);
    place(next, 110);
    list.settle();
    const seen: number[] = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      fireEvent.keyDown(box, { key: "a" });
      list.view.rerender(<Typing line />);
      place(box, 60, 120);
      place(thread, -300, 120);
      place(next, 130);
      list.resize();
      seen.push(list.top());
      fireEvent.keyDown(box, { key: "a" });
      list.view.rerender(<Typing line={false} />);
      place(box, 40, 100);
      place(thread, -300, 100);
      place(next, 110);
      list.resize();
      seen.push(list.top());
    }
    expect(seen).toEqual([420, 400, 420, 400, 420, 400]);
  });

  it("corrects a co-author's reaction above the top inside the thread the reader just touched", () => {
    const list = mount(
      <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
        <div>
          <article data-comment-thread="t">
            <Row id="root" />
            <Row id="r1" />
            <button type="button">{REPLY}</button>
          </article>
          <article data-comment-thread="u" />
        </div>
      </CommentScrollArea>,
    );
    const thread = at('[data-comment-thread="t"]');
    const reply = screen.getByRole("button", { name: "Reply" });
    place(thread, -300, 100);
    place(at('[data-comment-entry="root"]'), -300, -200);
    place(at('[data-comment-entry="r1"]'), -190, 50);
    place(reply, 60, 80);
    place(at('[data-comment-thread="u"]'), 110);
    list.settle();
    fireEvent.keyDown(reply, { key: "Tab" });
    place(thread, -300, 128);
    place(at('[data-comment-entry="root"]'), -300, -172);
    place(reply, 88, 108);
    place(at('[data-comment-thread="u"]'), 138);
    list.resize();
    expect(list.top()).toBe(428);
  });

  it("corrects growth elsewhere in the reader's file group while they type in its last thread", () => {
    const list = mount(
      <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
        <section data-testid="g1">
          <article data-comment-thread="s">
            <Row id="s" />
          </article>
          <article data-comment-thread="t">
            <Row id="t" />
            <textarea aria-label={REPLY} />
          </article>
        </section>
        <section>
          <article data-comment-thread="u">
            <Row id="u" />
          </article>
        </section>
      </CommentScrollArea>,
    );
    const box = screen.getByRole("textbox", { name: "Reply" });
    place(screen.getByTestId("g1"), -600, 100);
    place(at('[data-comment-thread="s"]'), -600, -400);
    place(at('[data-comment-entry="s"]'), -600, -400);
    place(at('[data-comment-thread="t"]'), -390, 100);
    place(at('[data-comment-entry="t"]'), -390, 30);
    place(box, 40, 100);
    place(at('[data-comment-thread="u"]'), 110);
    place(at('[data-comment-entry="u"]'), 110);
    list.settle();
    fireEvent.keyDown(box, { key: "a" });
    place(screen.getByTestId("g1"), -600, 280);
    place(at('[data-comment-thread="s"]'), -600, -220);
    place(at('[data-comment-entry="s"]'), -600, -220);
    place(at('[data-comment-thread="t"]'), -210, 280);
    place(at('[data-comment-entry="t"]'), -210, 210);
    place(box, 220, 280);
    place(at('[data-comment-thread="u"]'), 290);
    place(at('[data-comment-entry="u"]'), 290);
    list.resize();
    expect(list.top()).toBe(580);
  });

  it("corrects growth of another item above the anchor while the reader acts in a block above it", () => {
    const list = mount(
      <CommentScrollArea items={["x", "a", "b"].map((id) => ({ id, mine: false, at: 0 }))} ready label={(count) => `${count} new`}>
        <ol>
          <Row id="x" />
          <Row id="a" />
          <Row id="b" />
        </ol>
      </CommentScrollArea>,
    );
    place(at('[data-comment-entry="x"]'), -300, -100);
    place(at('[data-comment-entry="a"]'), -90, 40);
    place(at('[data-comment-entry="b"]'), 50);
    list.settle();
    fireEvent.pointerDown(at('[data-comment-entry="a"]'));
    fireEvent.click(at('[data-comment-entry="a"]'));
    place(at('[data-comment-entry="x"]'), -300, -60);
    place(at('[data-comment-entry="a"]'), -50, 80);
    place(at('[data-comment-entry="b"]'), 90);
    list.resize();
    expect(list.top()).toBe(440);
  });

  it("lets folded replies open downward when their toggle is the first thing on screen", () => {
    function Last() {
      const [open, setOpen] = useState(false);
      return (
        <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
          <article data-comment-thread="t">
            <ol>
              <Row id="root" />
            </ol>
            {open ? <ol id="t-replies" data-testid="replies" /> : null}
            <div data-testid="toggle-row">
              <button type="button" aria-controls="t-replies" onClick={() => setOpen(true)}>
                {"3 replies"}
              </button>
            </div>
          </article>
          <div data-testid="other-file">{"refs.bib"}</div>
        </CommentScrollArea>
      );
    }
    const list = mount(<Last />);
    const toggle = screen.getByRole("button", { name: "3 replies" });
    place(at('[data-comment-thread="t"]'), -300, 30);
    place(at("article > ol"), -300, -10);
    place(at('[data-comment-entry="root"]'), -300, -10);
    place(screen.getByTestId("toggle-row"), 10, 30);
    place(toggle, 10, 30);
    place(screen.getByTestId("other-file"), 40, 70);
    list.settle();
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    place(at('[data-comment-thread="t"]'), -300, 280);
    place(screen.getByTestId("replies"), -10, 250);
    place(screen.getByTestId("toggle-row"), 260, 280);
    place(toggle, 260, 280);
    list.resize();
    expect(list.top()).toBe(400);
  });

  it("lets a file group open downward even when its threads load more than a second after the click", () => {
    let now = 1_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      function Groups({ open }: Readonly<{ open: boolean }>) {
        const items = [...(open ? [{ id: "a", mine: false, at: 0, group: "g1" }] : []), { id: "b", mine: false, at: 0, group: "g2" }];
        return (
          <CommentScrollArea items={items} ready label={(count) => `${count} new`}>
            <section data-testid="g1">
              <button type="button">{"intro.tex"}</button>
              {open ? <Row id="a" /> : null}
            </section>
            <section>
              <Row id="b" />
            </section>
          </CommentScrollArea>
        );
      }
      const list = mount(<Groups open={false} />, 100);
      const header = screen.getByRole("button", { name: "intro.tex" });
      place(screen.getByTestId("g1"), -10, 20);
      place(header, -10, 20);
      place(at('[data-comment-entry="b"]'), 30);
      list.settle();
      fireEvent.pointerDown(header);
      fireEvent.click(header);
      now += 1_200;
      place(screen.getByTestId("g1"), -10, 140);
      place(at('[data-comment-entry="b"]'), 150);
      list.view.rerender(<Groups open />);
      expect(list.top()).toBe(100);
    } finally {
      clock.mockRestore();
    }
  });

  describe("after the third review", () => {
    function clock() {
      const state = { now: 1_000 };
      const spy = vi.spyOn(performance, "now").mockImplementation(() => state.now);
      return { later: (ms: number) => (state.now += ms), restore: () => spy.mockRestore() };
    }

    function Thread({ box, line = false, reply = true, children }: Readonly<{ box: boolean; line?: boolean; reply?: boolean; children?: ReactNode }>) {
      return (
        <article data-comment-thread="t">
          <Row id="root" />
          <Row id="r1" />
          {reply ? <button type="button">{REPLY}</button> : null}
          {line ? <p data-testid="line">{"Bob is replying"}</p> : null}
          {box ? (
            <div data-testid="box">
              <textarea aria-label={REPLY} />
              <button type="button">{"Cancel"}</button>
            </div>
          ) : null}
          {children}
        </article>
      );
    }

    function List({ box, line, reply }: Readonly<{ box: boolean; line?: boolean; reply?: boolean }>) {
      return (
        <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
          <div>
            <Thread box={box} line={line} reply={reply} />
            <article data-comment-thread="u">
              <Row id="u" />
            </article>
          </div>
        </CommentScrollArea>
      );
    }

    function shape(rootBottom: number, composer: number, line = 0) {
      place(at('[data-comment-entry="root"]'), -300, rootBottom);
      place(at('[data-comment-entry="r1"]'), rootBottom + 10, rootBottom + 70);
      const end = rootBottom + 80 + line + composer;
      place(at('[data-comment-thread="t"]'), -300, end);
      if (composer) place(screen.getByRole("textbox", { name: REPLY }), end - composer, end - 10);
      place(at('[data-comment-thread="u"]'), end + 10);
      place(at('[data-comment-entry="u"]'), end + 10);
    }

    it("lets go of the thread once the reply box closes, so a co-author's edit above the top is corrected", () => {
      const time = clock();
      try {
        const list = mount(<List box />);
        shape(-40, 60);
        list.settle();
        fireEvent.keyDown(screen.getByRole("textbox", { name: REPLY }), { key: "Escape" });
        list.view.rerender(<List box={false} />);
        shape(-40, 0);
        list.resize();
        expect(list.top()).toBe(400);
        time.later(500);
        shape(-12, 0);
        list.resize();
        expect(list.top()).toBe(428);
      } finally {
        time.restore();
      }
    });

    it("lets go of the thread after Cancel too", () => {
      const time = clock();
      try {
        const list = mount(<List box />);
        shape(-40, 60);
        list.settle();
        const cancel = screen.getByRole("button", { name: "Cancel" });
        fireEvent.pointerDown(cancel);
        fireEvent.click(cancel);
        list.view.rerender(<List box={false} />);
        shape(-40, 0);
        list.resize();
        time.later(600);
        shape(-12, 0);
        list.resize();
        expect(list.top()).toBe(428);
      } finally {
        time.restore();
      }
    });

    it("keeps a reply box just opened in place when a co-author's typing line comes and goes above it", () => {
      const time = clock();
      try {
        const list = mount(<List box={false} />);
        shape(-40, 0);
        list.settle();
        const reply = screen.getByRole("button", { name: REPLY });
        fireEvent.pointerDown(reply);
        fireEvent.click(reply);
        list.view.rerender(<List box reply={false} />);
        shape(-40, 60);
        list.resize();
        expect(list.top()).toBe(400);
        time.later(500);
        list.view.rerender(<List box reply={false} line />);
        shape(-40, 60, 20);
        list.resize();
        expect(list.top()).toBe(420);
        time.later(6_500);
        list.view.rerender(<List box reply={false} />);
        shape(-40, 60);
        list.resize();
        expect(list.top()).toBe(400);
      } finally {
        time.restore();
      }
    });

    it("corrects a co-author's reaction above the top within 300 ms of a click on a message's text", () => {
      const time = clock();
      try {
        const list = mount(<List box={false} />);
        shape(-40, 0);
        list.settle();
        const text = at('[data-comment-entry="r1"]');
        fireEvent.pointerDown(text);
        fireEvent.click(text);
        time.later(100);
        shape(-12, 0);
        list.resize();
        expect(list.top()).toBe(428);
      } finally {
        time.restore();
      }
    });

    it("corrects a co-author's reply landing above the reader's open box within 300 ms of a click in it", () => {
      const time = clock();
      try {
        const list = mount(<List box />);
        shape(-40, 60);
        list.settle();
        const field = screen.getByRole("textbox", { name: REPLY });
        fireEvent.pointerDown(field);
        fireEvent.click(field);
        time.later(100);
        shape(-40, 60, 120);
        list.resize();
        expect(list.top()).toBe(520);
      } finally {
        time.restore();
      }
    });

    it("corrects another thread growing in the reader's file group within 300 ms of their click", () => {
      const time = clock();
      try {
        const list = mount(
          <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
            <section data-testid="g1">
              <article data-comment-thread="s">
                <Row id="s" />
              </article>
              <article data-comment-thread="t">
                <Row id="t" />
              </article>
            </section>
            <section>
              <article data-comment-thread="u">
                <Row id="u" />
              </article>
            </section>
          </CommentScrollArea>,
          300,
        );
        place(screen.getByTestId("g1"), -600, 100);
        place(at('[data-comment-thread="s"]'), -600, -400);
        place(at('[data-comment-entry="s"]'), -600, -400);
        place(at('[data-comment-thread="t"]'), -390, 100);
        place(at('[data-comment-entry="t"]'), -390, 100);
        place(at('[data-comment-thread="u"]'), 110);
        place(at('[data-comment-entry="u"]'), 110);
        list.settle();
        fireEvent.pointerDown(at('[data-comment-entry="t"]'));
        fireEvent.click(at('[data-comment-entry="t"]'));
        time.later(100);
        place(screen.getByTestId("g1"), -600, 280);
        place(at('[data-comment-thread="s"]'), -600, -220);
        place(at('[data-comment-entry="s"]'), -600, -220);
        place(at('[data-comment-thread="t"]'), -210, 280);
        place(at('[data-comment-entry="t"]'), -210, 280);
        place(at('[data-comment-thread="u"]'), 290);
        place(at('[data-comment-entry="u"]'), 290);
        list.resize();
        expect(list.top()).toBe(480);
      } finally {
        time.restore();
      }
    });

    it("keeps the anchor entry still when a co-author reacts above it within 300 ms of a click inside it", () => {
      const time = clock();
      try {
        const list = mount(<List box={false} />);
        place(at('[data-comment-thread="t"]'), -300, 120);
        place(at('[data-comment-entry="root"]'), -300, -20);
        place(at('[data-comment-entry="r1"]'), 0, 60);
        place(screen.getByRole("button", { name: REPLY }), 70, 90);
        place(at('[data-comment-thread="u"]'), 130);
        place(at('[data-comment-entry="u"]'), 130);
        list.settle();
        fireEvent.pointerDown(at('[data-comment-entry="r1"]'));
        fireEvent.click(at('[data-comment-entry="r1"]'));
        time.later(100);
        place(at('[data-comment-thread="t"]'), -300, 148);
        place(at('[data-comment-entry="root"]'), -300, 8);
        place(at('[data-comment-entry="r1"]'), 28, 88);
        list.resize();
        expect(list.top()).toBe(428);
      } finally {
        time.restore();
      }
    });

    it("stops treating growth below a click as the reader's a second after the first change, even while co-authors keep changing the thread", () => {
      const time = clock();
      try {
        const list = mount(<List box={false} />);
        shape(-40, 0);
        list.settle();
        const text = at('[data-comment-entry="r1"]');
        fireEvent.pointerDown(text);
        fireEvent.click(text);
        let extra = 0;
        const seen: number[] = [];
        for (let step = 0; step < 12; step += 1) {
          time.later(800);
          extra += 4;
          place(at('[data-comment-entry="r1"]'), -30, 30 + extra);
          place(at('[data-comment-thread="t"]'), -300, 40 + extra);
          place(at('[data-comment-thread="u"]'), 50 + extra);
          place(at('[data-comment-entry="u"]'), 50 + extra);
          list.resize();
          seen.push(list.top());
        }
        expect(seen.slice(0, 2)).toEqual([400, 400]);
        expect(seen.at(-1)).toBe(440);
        time.later(800);
        place(at('[data-comment-thread="t"]'), -300, 120 + extra);
        place(at('[data-comment-thread="u"]'), 130 + extra);
        place(at('[data-comment-entry="u"]'), 130 + extra);
        list.resize();
        expect(list.top()).toBe(520);
      } finally {
        time.restore();
      }
    });

    it("lets a file group open downward when a spinner shows first and its threads load more than a second later", () => {
      const time = clock();
      try {
        function Groups({ phase }: Readonly<{ phase: "closed" | "loading" | "ready" }>) {
          const items = [...(phase === "ready" ? [{ id: "a", mine: false, at: 0, group: "g1" }] : []), { id: "b", mine: false, at: 0, group: "g2" }];
          return (
            <CommentScrollArea items={items} ready label={(count) => `${count} new`}>
              <section data-testid="g1">
                <button type="button">{"intro.tex"}</button>
                {phase === "loading" ? <div data-testid="spinner" aria-busy="true" /> : null}
                {phase === "ready" ? (
                  <li
                    data-comment-entry="a"
                    ref={(element) => {
                      if (element) place(element, 70, 140);
                    }}
                  >
                    {"a"}
                  </li>
                ) : null}
              </section>
              <section>
                <Row id="b" />
              </section>
            </CommentScrollArea>
          );
        }
        const list = mount(<Groups phase="closed" />, 100);
        const header = screen.getByRole("button", { name: "intro.tex" });
        place(screen.getByTestId("g1"), -10, 20);
        place(header, -10, 20);
        place(at('[data-comment-entry="b"]'), 30);
        list.settle();
        fireEvent.pointerDown(header);
        fireEvent.click(header);
        place(screen.getByTestId("g1"), -10, 60);
        place(at('[data-comment-entry="b"]'), 70);
        list.view.rerender(<Groups phase="loading" />);
        list.resize();
        expect(list.top()).toBe(100);
        time.later(1_200);
        place(screen.getByTestId("g1"), -10, 140);
        place(at('[data-comment-entry="b"]'), 150);
        list.view.rerender(<Groups phase="ready" />);
        list.resize();
        expect(list.top()).toBe(100);
      } finally {
        time.restore();
      }
    });

    it("keeps 'Hide replies' under the pointer in the last thread when only non-item rows follow it", () => {
      function Last() {
        const [open, setOpen] = useState(true);
        return (
          <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
            <article data-comment-thread="t">
              <Row id="root" />
              {open ? (
                <ol>
                  <Row id="r1" />
                  <Row id="r2" />
                  <Row id="r3" />
                </ol>
              ) : null}
              <button type="button" onClick={() => setOpen((value) => !value)}>
                {open ? "Hide replies" : "3 replies"}
              </button>
            </article>
            <div data-testid="refs">{"refs.bib"}</div>
            <div data-testid="figs">{"figures.tex"}</div>
          </CommentScrollArea>
        );
      }
      const list = mount(<Last />, 1_400);
      place(at('[data-comment-thread="t"]'), -500, 190);
      place(at('[data-comment-entry="root"]'), -500, -330);
      place(at('[data-comment-entry="r1"]'), -320, -170);
      place(at('[data-comment-entry="r2"]'), -160, 10);
      place(at('[data-comment-entry="r3"]'), 20, 160);
      const toggle = screen.getByRole("button", { name: "Hide replies" });
      place(toggle, 170, 190);
      place(screen.getByTestId("refs"), 200, 230);
      place(screen.getByTestId("figs"), 240, 270);
      list.settle();
      fireEvent.pointerDown(toggle);
      fireEvent.click(toggle);
      place(at('[data-comment-thread="t"]'), -500, -300);
      place(toggle, -320, -300);
      place(screen.getByTestId("refs"), -290, -260);
      place(screen.getByTestId("figs"), -250, -220);
      list.resize();
      expect(list.top()).toBe(910);
    });

    function Sorted({ order }: Readonly<{ order: readonly string[] }>) {
      return (
        <CommentScrollArea items={order.map((id) => ({ id, mine: false, at: 0 }))} ready label={(count) => `${count} new`}>
          <ol>
            {order.map((id) => (
              <article key={id} data-comment-thread={id}>
                {id === "t" ? <textarea aria-label={REPLY} /> : null}
              </article>
            ))}
          </ol>
        </CommentScrollArea>
      );
    }

    it("keeps what the reader was looking at when the first thread on screen is re-sorted to the end", () => {
      const list = mount(<Sorted order={["a", "b", "c", "d"]} />);
      place(at('[data-comment-thread="a"]'), -100, 40);
      place(at('[data-comment-thread="b"]'), 50, 190);
      place(at('[data-comment-thread="c"]'), 200, 340);
      place(at('[data-comment-thread="d"]'), 350, 490);
      list.settle();
      place(at('[data-comment-thread="c"]'), 50, 190);
      place(at('[data-comment-thread="d"]'), 200, 340);
      place(at('[data-comment-thread="b"]'), 350, 490);
      list.view.rerender(<Sorted order={["a", "c", "d", "b"]} />);
      list.resize();
      expect(list.top()).toBe(250);
    });

    it("keeps the reply box the reader is typing in still when its thread is re-sorted above the anchor", () => {
      const list = mount(<Sorted order={["u", "t", "v"]} />);
      place(at('[data-comment-thread="u"]'), 10, 150);
      place(at('[data-comment-thread="t"]'), 160, 410);
      const field = screen.getByRole("textbox", { name: REPLY });
      place(field, 210, 250);
      place(at('[data-comment-thread="v"]'), 420, 560);
      list.settle();
      fireEvent.keyDown(field, { key: "a" });
      place(at('[data-comment-thread="t"]'), 10, 260);
      place(field, 60, 100);
      place(at('[data-comment-thread="u"]'), 270, 410);
      list.view.rerender(<Sorted order={["t", "u", "v"]} />);
      list.resize();
      expect(list.top()).toBe(250);
    });

    describe("after the fourth review", () => {
      function lay(offset: number, grow = 0) {
        place(at('[data-comment-thread="t"]'), -300 + offset, 40 + offset);
        place(at('[data-comment-entry="root"]'), -300 + offset, -40 + offset);
        place(at('[data-comment-entry="r1"]'), -30 + offset, 30 + offset);
        place(at('[data-comment-thread="u"]'), 50 + offset, 110 + offset + grow);
        place(at('[data-comment-entry="u"]'), 50 + offset, 110 + offset + grow);
      }

      it("holds the top of the list when co-authors change things after the reader clicked a message and scrolled back up", () => {
        const list = mount(<List box={false} />);
        lay(0);
        list.settle();
        const text = at('[data-comment-entry="r1"]');
        fireEvent.pointerDown(text);
        fireEvent.click(text);
        lay(400);
        list.scrollTo(0);
        lay(400, 30);
        list.resize();
        expect(list.top()).toBe(0);
        lay(520, 30);
        list.resize();
        expect(list.top()).toBe(0);
        lay(120, 30);
        list.scrollTo(400);
        lay(-280, 30);
        list.scrollTo(800);
        lay(520, 30);
        list.scrollTo(0);
        lay(520, 60);
        list.resize();
        expect(list.top()).toBe(0);
      });

      it("keeps the first thread on screen still when one re-sorts after the reader scrolled away from what they clicked", () => {
        const list = mount(<Sorted order={["a", "b", "c", "d", "e", "f"]} />);
        const ids = ["a", "b", "c", "d", "e", "f"];
        const stack = (order: readonly string[], from: number) => {
          for (const [index, id] of order.entries()) place(at(`[data-comment-thread="${id}"]`), from + index * 100, from + index * 100 + 90);
        };
        stack(ids, 10);
        list.settle();
        fireEvent.pointerDown(at('[data-comment-thread="a"]'));
        fireEvent.click(at('[data-comment-thread="a"]'));
        stack(ids, -190);
        list.scrollTo(600);
        const sorted = ["a", "b", "d", "e", "f", "c"];
        stack(sorted, -190);
        list.view.rerender(<Sorted order={sorted} />);
        list.resize();
        expect(list.top()).toBe(500);
      });

      it("stays at the top of a chat when a message arrives after the reader clicked one and scrolled up", () => {
        function Chat({ ids }: Readonly<{ ids: readonly string[] }>) {
          return (
            <CommentScrollArea items={ids.map((id) => ({ id, mine: false, at: 0 }))} ready stickToBottom label={(count) => `${count} new`}>
              <ol>
                {ids.map((id) => (
                  <Row key={id} id={id} />
                ))}
              </ol>
            </CommentScrollArea>
          );
        }
        const list = mount(<Chat ids={["m1", "m2", "m3"]} />);
        let height = 1_000;
        Object.defineProperty(list.box, "scrollHeight", { configurable: true, get: () => height });
        Object.defineProperty(list.box, "clientHeight", { configurable: true, get: () => 300 });
        const rows = (offset: number) => {
          place(at('[data-comment-entry="m1"]'), -200 + offset, -100 + offset);
          place(at('[data-comment-entry="m2"]'), -90 + offset, 100 + offset);
          place(at('[data-comment-entry="m3"]'), 110 + offset, 300 + offset);
        };
        rows(0);
        list.settle();
        fireEvent.pointerDown(at('[data-comment-entry="m2"]'));
        fireEvent.click(at('[data-comment-entry="m2"]'));
        rows(400);
        list.scrollTo(0);
        height = 1_100;
        list.view.rerender(<Chat ids={["m1", "m2", "m3", "m4"]} />);
        place(at('[data-comment-entry="m4"]'), 710, 800);
        list.resize();
        expect(list.top()).toBe(0);
      });

      it("never anchors at the very top, not even to the box the reader is typing in", () => {
        const list = mount(<List box />, 0);
        const field = screen.getByRole("textbox", { name: REPLY });
        const rows = (offset: number) => {
          place(at('[data-comment-thread="t"]'), 10 + offset, 200 + offset);
          place(at('[data-comment-entry="root"]'), 10 + offset, 80 + offset);
          place(at('[data-comment-entry="r1"]'), 90 + offset, 150 + offset);
          place(field, 160 + offset, 190 + offset);
          place(at('[data-comment-thread="u"]'), 210 + offset, 270 + offset);
          place(at('[data-comment-entry="u"]'), 210 + offset, 270 + offset);
        };
        rows(0);
        list.settle();
        fireEvent.keyDown(field, { key: "a" });
        rows(100);
        list.resize();
        expect(list.top()).toBe(0);
      });

      it("keeps a reply box opened with Reply in place when its thread re-sorts above the anchor before the reader types", () => {
        function Replying({ order, open }: Readonly<{ order: readonly string[]; open: boolean }>) {
          return (
            <CommentScrollArea items={order.map((id) => ({ id, mine: false, at: 0 }))} ready label={(count) => `${count} new`}>
              <ol>
                {order.map((id) => (
                  <article key={id} data-comment-thread={id}>
                    {id === "t" && open ? <textarea aria-label={REPLY} ref={(field) => field?.focus()} /> : null}
                    {id === "t" && !open ? <button type="button">{REPLY}</button> : null}
                  </article>
                ))}
              </ol>
            </CommentScrollArea>
          );
        }
        const list = mount(<Replying order={["u", "t"]} open={false} />);
        place(at('[data-comment-thread="u"]'), 10, 150);
        place(at('[data-comment-thread="t"]'), 160, 290);
        const reply = screen.getByRole("button", { name: REPLY });
        place(reply, 200, 220);
        list.settle();
        fireEvent.pointerDown(reply);
        fireEvent.click(reply);
        list.view.rerender(<Replying order={["u", "t"]} open />);
        const field = screen.getByRole("textbox", { name: REPLY });
        expect(document.activeElement).toBe(field);
        place(field, 210, 250);
        place(at('[data-comment-thread="t"]'), 160, 410);
        list.resize();
        expect(list.top()).toBe(400);
        place(at('[data-comment-thread="t"]'), 10, 260);
        place(field, 60, 100);
        place(at('[data-comment-thread="u"]'), 270, 410);
        list.view.rerender(<Replying order={["t", "u"]} open />);
        list.resize();
        expect(list.top()).toBe(250);
      });

      it("counts the gap under folded replies the reader opened as their own, so the list opens below the top edge", () => {
        function Last() {
          const [open, setOpen] = useState(false);
          return (
            <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
              <article data-comment-thread="t">
                <ol>
                  <Row id="root" />
                </ol>
                {open ? <ol id="t-replies" data-testid="replies" style={{ marginBottom: "12px" }} /> : null}
                <div data-testid="toggle-row">
                  <button type="button" aria-controls="t-replies" onClick={() => setOpen(true)}>
                    {"3 replies"}
                  </button>
                </div>
              </article>
              <div data-testid="other-file">{"refs.bib"}</div>
            </CommentScrollArea>
          );
        }
        const list = mount(<Last />);
        const toggle = screen.getByRole("button", { name: "3 replies" });
        place(at('[data-comment-thread="t"]'), -300, 30);
        place(at("article > ol"), -300, -2);
        place(at('[data-comment-entry="root"]'), -300, -2);
        place(screen.getByTestId("toggle-row"), 10, 30);
        place(toggle, 10, 30);
        place(screen.getByTestId("other-file"), 40, 70);
        list.settle();
        fireEvent.pointerDown(toggle);
        fireEvent.click(toggle);
        place(at('[data-comment-thread="t"]'), -300, 292);
        place(screen.getByTestId("replies"), 10, 260);
        place(screen.getByTestId("toggle-row"), 272, 292);
        place(toggle, 272, 292);
        list.resize();
        expect(list.top()).toBe(400);
      });

      function Region({ grown, control }: Readonly<{ grown: boolean; control: "below" | "inside" }>) {
        const button = (
          <button type="button" aria-controls="region">
            {"Show more"}
          </button>
        );
        return (
          <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
            <div id="region" data-testid="region">
              {grown ? <Row id="r0" /> : null}
              <Row id="r1" />
              {control === "inside" ? button : null}
              {control === "inside" ? <Row id="r2" /> : null}
            </div>
            {control === "below" ? <Row id="a" /> : null}
            {control === "below" ? button : null}
          </CommentScrollArea>
        );
      }

      it("keeps the anchor still when a region above it grows after a click on a control below the anchor", () => {
        const time = clock();
        try {
          const list = mount(<Region grown={false} control="below" />);
          const button = screen.getByRole("button", { name: "Show more" });
          place(screen.getByTestId("region"), -100, -10);
          place(at('[data-comment-entry="r1"]'), -100, -10);
          place(at('[data-comment-entry="a"]'), 10, 100);
          place(button, 150, 170);
          list.settle();
          fireEvent.pointerDown(button);
          fireEvent.click(button);
          time.later(100);
          list.view.rerender(<Region grown control="below" />);
          place(screen.getByTestId("region"), -100, 40);
          place(at('[data-comment-entry="r1"]'), -50, 40);
          place(at('[data-comment-entry="a"]'), 60, 150);
          place(button, 200, 220);
          list.resize();
          expect(list.top()).toBe(450);
        } finally {
          time.restore();
        }
      });

      it("keeps the anchor still when growth lands above the click inside the region the clicked control names", () => {
        const time = clock();
        try {
          const list = mount(<Region grown={false} control="inside" />);
          const button = screen.getByRole("button", { name: "Show more" });
          place(screen.getByTestId("region"), -100, 90);
          place(at('[data-comment-entry="r1"]'), -100, -10);
          place(button, 0, 20);
          place(at('[data-comment-entry="r2"]'), 30, 90);
          list.settle();
          fireEvent.pointerDown(button);
          fireEvent.click(button);
          time.later(100);
          list.view.rerender(<Region grown control="inside" />);
          place(screen.getByTestId("region"), -100, 140);
          place(at('[data-comment-entry="r1"]'), -50, 40);
          place(button, 50, 70);
          place(at('[data-comment-entry="r2"]'), 80, 140);
          list.resize();
          expect(list.top()).toBe(450);
        } finally {
          time.restore();
        }
      });

      it("stops counting the opened region as the reader's own 300 ms after the click", () => {
        const time = clock();
        try {
          function Late({ open }: Readonly<{ open: boolean }>) {
            return (
              <CommentScrollArea items={ONLY_U} ready label={(count) => `${count} new`}>
                <article data-comment-thread="t">
                  <ol>
                    <Row id="root" />
                  </ol>
                  {open ? <ol id="t-replies" data-testid="replies" /> : null}
                  <div data-testid="toggle-row">
                    <button type="button" aria-controls="t-replies">
                      {"3 replies"}
                    </button>
                  </div>
                </article>
              </CommentScrollArea>
            );
          }
          const list = mount(<Late open={false} />);
          const toggle = screen.getByRole("button", { name: "3 replies" });
          place(at('[data-comment-thread="t"]'), -300, 30);
          place(at("article > ol"), -300, -10);
          place(at('[data-comment-entry="root"]'), -300, -10);
          place(screen.getByTestId("toggle-row"), 10, 30);
          place(toggle, 10, 30);
          list.settle();
          fireEvent.pointerDown(toggle);
          fireEvent.click(toggle);
          time.later(400);
          list.view.rerender(<Late open />);
          place(at('[data-comment-thread="t"]'), -300, 280);
          place(screen.getByTestId("replies"), -10, 250);
          place(screen.getByTestId("toggle-row"), 260, 280);
          place(toggle, 260, 280);
          list.resize();
          expect(list.top()).toBe(650);
        } finally {
          time.restore();
        }
      });

      it("keeps the thread below still when a thread with a reply on screen re-sorts to the end", () => {
        function Board({ order }: Readonly<{ order: readonly string[] }>) {
          const entries: Record<string, string[]> = { a: ["ma"], b: ["mb", "rb"], c: ["mc"], d: ["md"], e: ["me"] };
          return (
            <CommentScrollArea items={order.map((id) => ({ id, mine: false, at: 0 }))} ready label={(count) => `${count} new`}>
              <ol>
                {order.map((id) => (
                  <article key={id} data-comment-thread={id}>
                    {entries[id].map((entry) => (
                      <Row key={entry} id={entry} />
                    ))}
                  </article>
                ))}
              </ol>
            </CommentScrollArea>
          );
        }
        const list = mount(<Board order={["a", "b", "c", "d", "e"]} />);
        const thread = (id: string, top: number, bottom: number) => place(at(`[data-comment-thread="${id}"]`), top, bottom);
        const entry = (id: string, top: number, bottom: number) => place(at(`[data-comment-entry="${id}"]`), top, bottom);
        thread("a", -200, 0);
        entry("ma", -200, 0);
        thread("b", 10, 200);
        entry("mb", 10, 90);
        entry("rb", 110, 190);
        thread("c", 210, 290);
        entry("mc", 210, 290);
        thread("d", 300, 390);
        entry("md", 300, 390);
        thread("e", 400, 490);
        entry("me", 400, 490);
        list.settle();
        thread("c", 10, 90);
        entry("mc", 10, 90);
        thread("d", 100, 190);
        entry("md", 100, 190);
        thread("e", 200, 290);
        entry("me", 200, 290);
        thread("b", 300, 490);
        entry("mb", 300, 380);
        entry("rb", 400, 480);
        list.view.rerender(<Board order={["a", "c", "d", "e", "b"]} />);
        list.resize();
        expect(list.top()).toBe(200);
      });
    });
  });
});
