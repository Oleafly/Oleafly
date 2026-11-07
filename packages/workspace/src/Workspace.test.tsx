// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activate,
  createLayout,
  group,
  groupOfView,
  MIN_WEIGHT,
  moveView,
  openView,
  split,
  toggleMaximize,
  type DropTarget,
  type GroupNode,
  type SplitNode,
  type ViewState,
  type WorkspaceLayout,
} from "./layout";
import { Workspace, zoneAt, zoneRect, type WorkspaceProps } from "./Workspace";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const labels = {
  closeTab: (title: string) => `Close ${title}`,
  closePanel: "Close panel",
  newTab: "New tab",
  maximize: "Maximize group",
  restore: "Restore group",
  resize: "Resize panes",
};

let geometry: Record<string, Box> = {};
let frames = new Map<number, FrameRequestCallback>();
let frameCount = 0;
const mounts = new Map<string, number>();
const unmounts = new Map<string, number>();

function Probe({ id }: Readonly<{ id: string }>) {
  useEffect(() => {
    mounts.set(id, (mounts.get(id) ?? 0) + 1);
    return () => {
      unmounts.set(id, (unmounts.get(id) ?? 0) + 1);
    };
  }, [id]);
  return (
    <div data-testid={`content-${id}`}>
      <input aria-label={`Field ${id}`} />
    </div>
  );
}

const renderView = vi.fn((id: string, _view: ViewState): ReactNode => <Probe id={id} />);

function describeView(id: string, view: ViewState) {
  return {
    title: `Title ${id}`,
    closable: view.params?.locked !== true,
    icon: <span data-testid={`icon-${id}`} />,
  };
}

function views(...ids: string[]): Record<string, ViewState> {
  return Object.fromEntries(ids.map((id) => [id, { type: "note", params: { id } }]));
}

function twoGroups(): WorkspaceLayout {
  return createLayout(split("s1", "row", [group("g1", ["a", "b"]), group("g2", ["c"])]), views("a", "b", "c"));
}

function domRect(box: Box | undefined): DOMRect {
  const value = box ?? { left: 0, top: 0, width: 0, height: 0 };
  return {
    ...value,
    x: value.left,
    y: value.top,
    right: value.left + value.width,
    bottom: value.top + value.height,
    toJSON: () => value,
  } as DOMRect;
}

function geometryKey(element: Element): string | null {
  if (element.classList.contains("ws-root")) return "root";
  const slot = element.getAttribute("data-slot");
  if (slot) return `slot:${slot}`;
  const tab = element.getAttribute("data-tab-view");
  if (tab) return `tab:${tab}`;
  const splitId = element.getAttribute("data-split");
  if (splitId) return `split:${splitId}`;
  const stripId = element.getAttribute("data-strip");
  if (stripId) return `strip:${stripId}`;
  return null;
}

function twoGroupGeometry() {
  geometry = {
    root: { left: 100, top: 50, width: 800, height: 600 },
    "split:s1": { left: 100, top: 50, width: 800, height: 600 },
    "strip:g1": { left: 100, top: 50, width: 400, height: 36 },
    "tab:a": { left: 100, top: 50, width: 80, height: 36 },
    "tab:b": { left: 180, top: 50, width: 80, height: 36 },
    "slot:g1": { left: 100, top: 86, width: 400, height: 564 },
    "strip:g2": { left: 500, top: 50, width: 400, height: 36 },
    "tab:c": { left: 500, top: 50, width: 80, height: 36 },
    "slot:g2": { left: 500, top: 86, width: 400, height: 564 },
  };
}

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of pending) callback(0);
  });
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  static live(): FakeResizeObserver {
    const live = FakeResizeObserver.instances.filter((instance) => !instance.disconnected);
    expect(live).toHaveLength(1);
    return live[0];
  }
}

beforeEach(() => {
  geometry = {};
  frames = new Map();
  frameCount = 0;
  mounts.clear();
  unmounts.clear();
  renderView.mockClear();
  FakeResizeObserver.instances = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const key = geometryKey(this);
    return domRect(key ? geometry[key] : undefined);
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCount += 1;
    frames.set(frameCount, callback);
    return frameCount;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type HarnessProps = Omit<Partial<WorkspaceProps>, "layout" | "onLayoutChange"> & {
  initial: WorkspaceLayout;
  onChange?: (layout: WorkspaceLayout) => void;
};

function Harness({ initial, onChange, ...rest }: Readonly<HarnessProps>) {
  const [layout, setLayout] = useState(initial);
  return (
    <Workspace
      className="ws-root"
      layout={layout}
      onLayoutChange={(next) => {
        onChange?.(next);
        setLayout(next);
      }}
      renderView={renderView}
      describeView={describeView}
      labels={labels}
      {...rest}
    />
  );
}

function renderHarness(initial: WorkspaceLayout, props: Omit<HarnessProps, "initial"> = {}) {
  const onChange = vi.fn();
  const utils = render(<Harness initial={initial} onChange={onChange} {...props} />);
  const latest = () => onChange.mock.lastCall?.[0] as WorkspaceLayout;
  return { ...utils, onChange, latest };
}

function renderStatic(layout: WorkspaceLayout, props: Partial<WorkspaceProps> = {}) {
  const onLayoutChange = vi.fn();
  const element = (next: WorkspaceLayout, more: Partial<WorkspaceProps> = {}) => (
    <Workspace
      className="ws-root"
      layout={next}
      onLayoutChange={onLayoutChange}
      renderView={renderView}
      describeView={describeView}
      labels={labels}
      {...props}
      {...more}
    />
  );
  const utils = render(element(layout));
  return { ...utils, onLayoutChange, update: (next: WorkspaceLayout, more?: Partial<WorkspaceProps>) => utils.rerender(element(next, more)) };
}

function tab(id: string): HTMLElement {
  return screen.getByRole("tab", { name: `Title ${id}` });
}

function panel(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[role="tabpanel"][data-view="${id}"]`);
  if (!found) throw new Error(`no panel for ${id}`);
  return found;
}

function strip(groupId: string): HTMLElement {
  return within(groupElement(groupId)).getByRole("tablist");
}

function groupElement(groupId: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-group="${groupId}"]`);
  if (!found) throw new Error(`no group ${groupId}`);
  return found;
}

function separators(): HTMLElement[] {
  return screen.queryAllByRole("separator");
}

function pointer(type: string, clientX: number, clientY: number) {
  act(() => {
    window.dispatchEvent(new PointerEvent(type, { clientX, clientY, bubbles: true }));
  });
}

async function release(clientX: number, clientY: number) {
  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerup", { clientX, clientY, bubbles: true }));
  });
}

function indicator(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-drop-indicator]");
}

function ghost(): HTMLElement | null {
  return screen.queryByText((_content, element) => element?.getAttribute("aria-hidden") === "true" && element.textContent?.startsWith("Title ") === true);
}

function auxClick(element: HTMLElement, button: number) {
  act(() => {
    element.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button }));
  });
}

describe("zoneAt", () => {
  const rect = { left: 100, top: 100, width: 200, height: 100 };

  it("finds the edge zone within a quarter of each side", () => {
    expect(zoneAt(rect, 110, 150)).toBe("left");
    expect(zoneAt(rect, 290, 150)).toBe("right");
    expect(zoneAt(rect, 200, 110)).toBe("top");
    expect(zoneAt(rect, 200, 190)).toBe("bottom");
  });

  it("returns center away from the edges and on the quarter line", () => {
    expect(zoneAt(rect, 200, 150)).toBe("center");
    expect(zoneAt(rect, 150, 150)).toBe("center");
  });

  it("picks the closest edge in a corner and the first one on a tie", () => {
    expect(zoneAt(rect, 104, 120)).toBe("left");
    expect(zoneAt(rect, 140, 102)).toBe("top");
    expect(zoneAt(rect, 120, 110)).toBe("left");
  });
});

describe("zoneRect", () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };

  it("returns the half of the rect each edge zone covers", () => {
    expect(zoneRect(rect, "left")).toEqual({ left: 10, top: 20, width: 100, height: 100 });
    expect(zoneRect(rect, "right")).toEqual({ left: 110, top: 20, width: 100, height: 100 });
    expect(zoneRect(rect, "top")).toEqual({ left: 10, top: 20, width: 200, height: 50 });
    expect(zoneRect(rect, "bottom")).toEqual({ left: 10, top: 70, width: 200, height: 50 });
    expect(zoneRect(rect, "center")).toBe(rect);
  });
});

describe("Workspace rendering", () => {
  it("renders a tab list per group with linked tabs and panels", () => {
    twoGroupGeometry();
    renderHarness(twoGroups());
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    expect(within(strip("g1")).getAllByRole("tab").map((node) => node.textContent)).toEqual(["Title a", "Title b"]);
    expect(within(strip("g2")).getAllByRole("tab").map((node) => node.textContent)).toEqual(["Title c"]);
    const tabA = tab("a");
    expect(tabA).toHaveAttribute("aria-selected", "true");
    expect(tabA).toHaveAttribute("tabindex", "0");
    expect(tabA).not.toHaveAttribute("title");
    expect(screen.getByRole("tab", { name: "Title a" })).toBe(tabA);
    expect(tab("b")).toHaveAttribute("aria-selected", "false");
    expect(tab("b")).toHaveAttribute("tabindex", "-1");
    expect(tabA.getAttribute("aria-controls")).toBe(panel("a").id);
    expect(panel("a").getAttribute("aria-labelledby")).toBe(tabA.id);
    expect(screen.getByTestId("icon-a")).toBeInTheDocument();
  });

  it("renders every view once, in a panel placed over its group", () => {
    twoGroupGeometry();
    renderHarness(twoGroups());
    for (const id of ["a", "b", "c"]) {
      expect(document.querySelectorAll(`[data-view="${id}"]`)).toHaveLength(1);
      expect(screen.getAllByTestId(`content-${id}`)).toHaveLength(1);
    }
    expect(renderView).toHaveBeenCalledTimes(3);
    expect(panel("a")).toHaveAttribute("data-shown", "true");
    expect(panel("b")).toHaveAttribute("data-shown", "false");
    expect(panel("c")).toHaveAttribute("data-shown", "true");
    expect(panel("a").style).toMatchObject({ left: "0px", top: "36px", width: "400px", height: "564px" });
    expect(panel("c").style).toMatchObject({ left: "400px", top: "36px", width: "400px", height: "564px" });
  });

  it("hides the panel of a view that no group shows", () => {
    const raw: WorkspaceLayout = { schema: 1, root: group("g1", ["a"]), views: views("a", "loose"), maximized: null };
    renderStatic(raw);
    expect(panel("loose")).toHaveAttribute("data-shown", "false");
    expect(panel("loose").getAttribute("style")).toBeNull();
    expect(panel("a")).toHaveAttribute("data-shown", "true");
  });

  it("applies the class name and renders group actions for each group", () => {
    const groupActions = vi.fn((node: GroupNode) => <button type="button" aria-label={`Action ${node.id}`} />);
    const { container } = renderHarness(twoGroups(), { groupActions });
    expect(container.firstElementChild).toHaveClass("ws-root");
    expect(screen.getByRole("button", { name: "Action g1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Action g2" })).toBeInTheDocument();
  });

  it("works without a class name", () => {
    const { container } = render(
      <Workspace layout={twoGroups()} onLayoutChange={vi.fn()} renderView={renderView} describeView={describeView} labels={labels} />,
    );
    expect(container.firstElementChild?.getAttribute("class")).not.toContain("undefined");
  });

  it("shows the empty content only in an empty group", () => {
    const empty = <p>{"Nothing open"}</p>;
    const { update } = renderStatic(createLayout(group("g1", []), {}), { empty });
    expect(screen.getByText("Nothing open")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    update(createLayout(group("g1", ["a"]), views("a")));
    expect(screen.queryByText("Nothing open")).toBeNull();
  });

  it("shows a close button only for closable views", () => {
    const layout = createLayout(group("g1", ["a", "b"]), { a: { type: "note" }, b: { type: "note", params: { locked: true } } });
    renderHarness(layout);
    expect(screen.getByRole("button", { name: "Close Title a" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close Title b" })).toBeNull();
  });
});

describe("Workspace tabs", () => {
  it("selects a clicked tab and reports focus", () => {
    const onFocusView = vi.fn();
    const { onChange, latest } = renderHarness(twoGroups(), { onFocusView });
    fireEvent.click(tab("b"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(groupOfView(latest(), "b")?.active).toBe("b");
    expect(onFocusView).toHaveBeenCalledWith("b");
    expect(tab("b")).toHaveAttribute("aria-selected", "true");
    expect(panel("b")).toHaveAttribute("data-shown", "true");
    expect(panel("a")).toHaveAttribute("data-shown", "false");
  });

  it("does not report a layout change when the selected tab is clicked again", () => {
    const onFocusView = vi.fn();
    const { onChange } = renderHarness(twoGroups(), { onFocusView });
    fireEvent.click(tab("a"));
    expect(onChange).not.toHaveBeenCalled();
    expect(onFocusView).toHaveBeenCalledWith("a");
  });

  it("closes a tab from its close button", () => {
    const { latest } = renderHarness(twoGroups());
    fireEvent.click(screen.getByRole("button", { name: "Close Title a" }));
    expect(Object.keys(latest().views)).toEqual(["b", "c"]);
    expect(screen.queryByRole("tab", { name: "Title a" })).toBeNull();
    expect(document.querySelector('[data-view="a"]')).toBeNull();
    expect(unmounts.get("a")).toBe(1);
  });

  it("closes a closable tab on middle click only", () => {
    const layout = createLayout(group("g1", ["a", "b"]), { a: { type: "note" }, b: { type: "note", params: { locked: true } } });
    const { onChange } = renderHarness(layout);
    auxClick(tab("a"), 2);
    auxClick(tab("b"), 1);
    expect(onChange).not.toHaveBeenCalled();
    auxClick(tab("a"), 1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tab", { name: "Title a" })).toBeNull();
  });

  it("moves between tabs with the arrow keys, Home and End, wrapping around", () => {
    const layout = createLayout(group("g1", ["a", "b", "c"]), views("a", "b", "c"));
    const onFocusView = vi.fn();
    renderHarness(layout, { onFocusView });
    tab("a").focus();
    fireEvent.keyDown(tab("a"), { key: "ArrowLeft" });
    expect(tab("c")).toHaveAttribute("aria-selected", "true");
    expect(tab("c")).toHaveFocus();
    fireEvent.keyDown(tab("c"), { key: "ArrowRight" });
    expect(tab("a")).toHaveAttribute("aria-selected", "true");
    expect(tab("a")).toHaveFocus();
    fireEvent.keyDown(tab("a"), { key: "ArrowRight" });
    expect(tab("b")).toHaveFocus();
    fireEvent.keyDown(tab("b"), { key: "End" });
    expect(tab("c")).toHaveFocus();
    fireEvent.keyDown(tab("c"), { key: "Home" });
    expect(tab("a")).toHaveFocus();
    expect(tab("a")).toHaveAttribute("tabindex", "0");
    expect(onFocusView.mock.calls.map(([id]) => id)).toEqual(["c", "a", "b", "c", "a"]);
  });

  it("ignores other keys and keeps the default action", () => {
    const { onChange } = renderHarness(twoGroups());
    const event = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    act(() => {
      tab("a").dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes a closable tab with Delete and leaves a locked one", () => {
    const layout = createLayout(group("g1", ["a", "b"]), { a: { type: "note" }, b: { type: "note", params: { locked: true } } });
    const { onChange } = renderHarness(layout);
    fireEvent.keyDown(tab("b"), { key: "Delete" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(tab("a"), { key: "Delete" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tab", { name: "Title a" })).toBeNull();
    expect(tab("b")).toHaveAttribute("aria-selected", "true");
  });

  it("moves focus to the tab that takes the closed tab's place", () => {
    const layout = createLayout(group("g1", ["a", "b"]), views("a", "b"));
    renderHarness(layout);
    tab("a").focus();
    fireEvent.keyDown(tab("a"), { key: "Delete" });
    flushFrames();
    expect(tab("b")).toHaveFocus();
  });
});

describe("Workspace maximize", () => {
  it("offers maximize only when there is more than one group", () => {
    renderStatic(createLayout(group("g1", ["a", "b"]), views("a", "b")));
    expect(screen.queryByRole("button", { name: "Maximize group" })).toBeNull();
  });

  it("maximizes a group, hides the others, and restores", () => {
    twoGroupGeometry();
    const { latest } = renderHarness(twoGroups());
    expect(screen.getAllByRole("button", { name: "Maximize group" })).toHaveLength(2);
    const maximize = within(groupElement("g2")).getByRole("button", { name: "Maximize group" });
    expect(maximize).toHaveAttribute("aria-pressed", "false");
    expect(maximize).toHaveAttribute("title", "Maximize group");
    fireEvent.click(maximize);
    expect(latest().maximized).toBe("g2");
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Title a" })).toBeNull();
    expect(panel("c")).toHaveAttribute("data-shown", "true");
    expect(panel("a")).toHaveAttribute("data-shown", "false");
    expect(separators()).toHaveLength(0);
    const restore = screen.getByRole("button", { name: "Restore group" });
    expect(restore).toHaveAttribute("aria-pressed", "true");
    expect(restore).toHaveAttribute("title", "Restore group");
    fireEvent.click(restore);
    expect(latest().maximized).toBeNull();
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    expect(panel("a")).toHaveAttribute("data-shown", "true");
  });

  it("toggles maximize on a double click of the empty tab strip only", () => {
    const { onChange, latest } = renderHarness(twoGroups());
    fireEvent.doubleClick(tab("a"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.doubleClick(strip("g1"));
    expect(latest().maximized).toBe("g1");
    fireEvent.doubleClick(strip("g1"));
    expect(latest().maximized).toBeNull();
  });

  it("ignores a double-click on the only group's tab strip so later groups stay visible", () => {
    const view: ViewState = { type: "note" };
    const { onLayoutChange, update } = renderStatic(createLayout(group("g1", ["a"]), views("a")));
    fireEvent.doubleClick(strip("g1"));
    const after: WorkspaceLayout = onLayoutChange.mock.lastCall?.[0] ?? createLayout(group("g1", ["a"]), views("a"));
    update(openView(after, "d", view, { groupId: "g1", zone: "right" }));
    expect(panel("d")).toHaveAttribute("data-shown", "true");
  });
});

describe("Workspace chrome", () => {
  const chromeAttributes = { "data-chrome": "drag" };

  function wideTop(): WorkspaceLayout {
    return createLayout(
      split("s1", "column", [split("s2", "row", [group("g1", ["a"]), group("g2", ["b"])]), group("g3", ["c"])]),
      views("a", "b", "c"),
    );
  }

  it("puts leading content in the top-left group and trailing content in the top-right group", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), split("s2", "column", [group("g2", ["b"]), group("g3", ["c"])])]), views("a", "b", "c"));
    const back = "Back";
    const menu = "Menu";
    renderHarness(layout, { leading: <button type="button" aria-label={back} />, trailing: <button type="button" aria-label={menu} /> });
    expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Menu" })).toHaveLength(1);
    expect(within(groupElement("g1")).getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(within(groupElement("g2")).getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });

  it("marks the root and the top row of tab strips with the chrome attributes", () => {
    const { container } = renderHarness(wideTop(), { chromeAttributes, leading: <span>{"Lead"}</span>, trailing: <span>{"Trail"}</span> });
    expect(container.firstElementChild).toHaveAttribute("data-chrome", "drag");
    expect(strip("g1")).toHaveAttribute("data-chrome", "drag");
    expect(strip("g2")).toHaveAttribute("data-chrome", "drag");
    expect(strip("g3")).not.toHaveAttribute("data-chrome");
    expect(groupElement("g3").querySelector("[data-chrome]")).toBeNull();
    expect(within(groupElement("g1")).getByText("Lead")).toBeInTheDocument();
    expect(within(groupElement("g2")).getByText("Trail")).toBeInTheDocument();
  });

  it("moves leading, trailing and chrome to the maximized group", () => {
    renderHarness(toggleMaximize(wideTop(), "g3"), { chromeAttributes, leading: <span>{"Lead"}</span>, trailing: <span>{"Trail"}</span> });
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(strip("g3")).toHaveAttribute("data-chrome", "drag");
    expect(within(groupElement("g3")).getByText("Lead")).toBeInTheDocument();
    expect(within(groupElement("g3")).getByText("Trail")).toBeInTheDocument();
  });

  it("leaves the tab strips unmarked without chrome attributes", () => {
    renderHarness(wideTop());
    expect(document.querySelector("[data-chrome]")).toBeNull();
    expect(strip("g1").getAttribute("data-chrome")).toBeNull();
  });

  it("shows the whole tree when the maximized id is not in it", () => {
    const raw: WorkspaceLayout = { ...twoGroups(), maximized: "gone" };
    renderStatic(raw);
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    expect(panel("a")).toHaveAttribute("data-shown", "true");
    expect(panel("c")).toHaveAttribute("data-shown", "true");
  });
});

describe("Workspace views stay mounted", () => {
  it("keeps every view mounted across tab switches, moves and maximize", () => {
    twoGroupGeometry();
    const { update } = renderStatic(twoGroups());
    let layout = twoGroups();
    layout = activate(layout, "b");
    update(layout);
    layout = moveView(layout, "a", { groupId: "g2", zone: "center" });
    update(layout);
    layout = moveView(layout, "c", { groupId: "g1", zone: "bottom" });
    update(layout);
    layout = toggleMaximize(layout, "g2");
    expect(layout.maximized).toBe("g2");
    update(layout);
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    layout = toggleMaximize(layout, "g2");
    update(layout);
    expect(screen.getAllByRole("tablist")).toHaveLength(3);
    expect(Object.fromEntries(mounts)).toEqual({ a: 1, b: 1, c: 1 });
    expect(unmounts.size).toBe(0);
  });

  it("keeps the content of a view across a drag into another group", async () => {
    twoGroupGeometry();
    renderHarness(twoGroups());
    fireEvent.change(screen.getByLabelText("Field a"), { target: { value: "draft" } });
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 700, 368);
    await release(700, 368);
    expect(within(strip("g2")).getByRole("tab", { name: "Title a" })).toBeInTheDocument();
    expect(screen.getByLabelText("Field a")).toHaveValue("draft");
    expect(mounts.get("a")).toBe(1);
  });

  it("calls renderView again only for a view whose state changed", () => {
    const layout = twoGroups();
    const { update } = renderStatic(layout);
    expect(renderView).toHaveBeenCalledTimes(3);
    update(activate(layout, "b"), { className: "ws-root other" });
    expect(renderView).toHaveBeenCalledTimes(3);
    const changed = { ...layout, views: { ...layout.views, b: { type: "note", params: { id: "b", page: 2 } } } };
    update(changed);
    expect(renderView).toHaveBeenCalledTimes(4);
    expect(renderView).toHaveBeenLastCalledWith("b", { type: "note", params: { id: "b", page: 2 } });
    expect(mounts.get("b")).toBe(1);
  });

  it("reports focus from pointer and keyboard focus inside a view", () => {
    const onFocusView = vi.fn();
    renderHarness(twoGroups(), { onFocusView });
    fireEvent.pointerDown(screen.getByTestId("content-c"));
    expect(onFocusView).toHaveBeenLastCalledWith("c");
    act(() => {
      screen.getByLabelText("Field a").focus();
    });
    expect(onFocusView).toHaveBeenLastCalledWith("a");
  });

  it("does not need a focus callback", () => {
    renderHarness(twoGroups());
    expect(() => fireEvent.pointerDown(screen.getByTestId("content-c"))).not.toThrow();
  });

  it("joins the selected tab to its panel with no accent bar, focused or not", () => {
    renderHarness(twoGroups());
    const classes = (id: string) => tab(id).parentElement?.className.split(" ") ?? [];
    fireEvent.pointerDown(screen.getByTestId("content-a"));
    expect(classes("a")).toEqual(expect.arrayContaining(["border-border", "bg-background", "border-b-0"]));
    expect(classes("b")).toContain("border-transparent");
    const accents = [...document.querySelectorAll("[data-group] *")].filter((element) =>
      /primary|before:|data-\[focused/u.test(element.getAttribute("class") ?? ""),
    );
    expect(accents).toEqual([]);
    expect(document.querySelector("[data-focused]")).toBeNull();
  });
});

describe("Workspace new tabs", () => {
  function newTabButton(groupId: string): HTMLElement {
    return within(groupElement(groupId)).getByRole("button", { name: "New tab" });
  }

  it("offers a new tab button right after the last tab of every strip", () => {
    const onNewTab = vi.fn();
    renderHarness(twoGroups(), { onNewTab });
    expect(screen.getAllByRole("button", { name: "New tab" })).toHaveLength(2);
    const button = newTabButton("g1");
    expect(strip("g1").contains(button)).toBe(false);
    expect(strip("g1").nextElementSibling).toContainElement(button);
    expect(tab("b").compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(newTabButton("g2"));
    expect(onNewTab).toHaveBeenCalledWith("g2");
  });

  it("offers a new tab in an empty group too", () => {
    const onNewTab = vi.fn();
    renderStatic(createLayout(group("g1", []), {}), { onNewTab });
    fireEvent.click(newTabButton("g1"));
    expect(onNewTab).toHaveBeenCalledWith("g1");
  });

  it("offers no new tab button without a handler", () => {
    renderHarness(twoGroups());
    expect(screen.queryByRole("button", { name: "New tab" })).toBeNull();
  });

  it("marks the new tab area with the chrome attributes of its strip", () => {
    renderHarness(twoGroups(), { onNewTab: vi.fn(), chromeAttributes: { "data-chrome": "drag" } });
    expect(newTabButton("g1").parentElement).toHaveAttribute("data-chrome", "drag");
    expect(strip("g1").parentElement).toHaveAttribute("data-chrome", "drag");
  });

  it("toggles maximize on a double click of blank strip space only", () => {
    const { onChange, latest } = renderHarness(twoGroups(), { onNewTab: vi.fn() });
    fireEvent.doubleClick(newTabButton("g1"));
    fireEvent.doubleClick(tab("a").parentElement as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.doubleClick(strip("g1").parentElement as HTMLElement);
    expect(latest().maximized).toBe("g1");
  });

  it("drops a dragged tab into the blank strip space after the new tab button", async () => {
    twoGroupGeometry();
    const { latest } = renderHarness(twoGroups(), { onNewTab: vi.fn() });
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 850, 60);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    await release(850, 60);
    expect(groupOfView(latest(), "a")?.views).toEqual(["c", "a"]);
  });
});

describe("Workspace empty panels", () => {
  function emptyStage(): WorkspaceLayout {
    return createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", [])]), views("a"), "g2");
  }

  it("offers to close an empty group when there is another group", () => {
    const { latest } = renderHarness(emptyStage());
    expect(screen.getAllByRole("button", { name: "Close panel" })).toHaveLength(1);
    const close = within(groupElement("g2")).getByRole("button", { name: "Close panel" });
    fireEvent.click(close);
    expect(latest().root).toEqual({ kind: "group", id: "g1", views: ["a"], active: "a" });
    expect(latest().stage).toBe("g1");
    expect(screen.queryByRole("button", { name: "Close panel" })).toBeNull();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("offers no close button for a group with tabs or for the only group", () => {
    renderStatic(twoGroups());
    expect(screen.queryByRole("button", { name: "Close panel" })).toBeNull();
    cleanup();
    renderStatic(createLayout(group("g1", []), {}, "g1"));
    expect(screen.queryByRole("button", { name: "Close panel" })).toBeNull();
  });

  it("hands the stage to the group the stage candidate picks", () => {
    const layout = createLayout(
      split("s1", "row", [group("g1", ["a"]), group("g2", []), group("g3", ["b"])]),
      views("a", "b"),
      "g2",
    );
    const stageCandidate = vi.fn((candidate: GroupNode) => candidate.views.includes("b"));
    const { latest } = renderHarness(layout, { stageCandidate });
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(latest().stage).toBe("g3");
    expect(stageCandidate).toHaveBeenCalled();
  });

  it("builds the empty content for the group it fills", () => {
    const empty = vi.fn((node: GroupNode) => <p>{`Empty ${node.id}`}</p>);
    renderStatic(emptyStage(), { empty });
    expect(within(groupElement("g2")).getByText("Empty g2")).toBeInTheDocument();
    expect(screen.queryByText("Empty g1")).toBeNull();
    expect(empty).toHaveBeenCalledWith(expect.objectContaining({ id: "g2" }));
  });
});

describe("Workspace measuring", () => {
  it("re-measures the slots when the resize observer fires, once per frame", () => {
    twoGroupGeometry();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    renderHarness(twoGroups());
    const observer = FakeResizeObserver.live();
    expect(observer.observed.map(geometryKey).sort()).toEqual(["root", "slot:g1", "slot:g2"]);
    geometry["slot:g1"] = { left: 100, top: 86, width: 300, height: 564 };
    geometry["slot:g2"] = { left: 400, top: 86, width: 500, height: 564 };
    observer.callback([], observer as unknown as ResizeObserver);
    observer.callback([], observer as unknown as ResizeObserver);
    expect(frames.size).toBe(1);
    flushFrames();
    expect(panel("a").style.width).toBe("300px");
    expect(panel("c").style).toMatchObject({ left: "300px", width: "500px" });
  });

  it("disconnects the observer and drops a pending frame on unmount", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { unmount } = renderHarness(twoGroups());
    const observer = FakeResizeObserver.live();
    observer.callback([], observer as unknown as ResizeObserver);
    const pending = [...frames.values()];
    unmount();
    expect(observer.disconnected).toBe(true);
    expect(frames.size).toBe(0);
    expect(() => pending[0](0)).not.toThrow();
  });

  it("measures without a resize observer", () => {
    twoGroupGeometry();
    vi.stubGlobal("ResizeObserver", undefined);
    renderHarness(twoGroups());
    expect(panel("a").style.width).toBe("400px");
    expect(frames.size).toBe(0);
  });

  it("follows a group that is replaced by another with a new id", () => {
    geometry = { root: { left: 0, top: 0, width: 500, height: 400 }, "slot:g1": { left: 0, top: 36, width: 500, height: 364 }, "slot:g9": { left: 0, top: 40, width: 500, height: 360 } };
    const { update } = renderStatic(createLayout(group("g1", ["a"]), views("a")));
    expect(panel("a").style.top).toBe("36px");
    update(createLayout(group("g9", ["a"]), views("a")));
    expect(panel("a").style.top).toBe("40px");
    expect(panel("a")).toHaveAttribute("data-shown", "true");
  });

  it("keeps a view at its last known place when its slot leaves the document", () => {
    twoGroupGeometry();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    renderHarness(twoGroups());
    const slot = document.querySelector('[data-slot="g2"]');
    slot?.remove();
    const observer = FakeResizeObserver.live();
    observer.callback([], observer as unknown as ResizeObserver);
    flushFrames();
    expect(panel("c")).toHaveAttribute("data-shown", "true");
    expect(panel("c").style.width).not.toBe("");
    expect(panel("a")).toHaveAttribute("data-shown", "true");
  });
});

describe("Workspace splitters", () => {
  function threeColumns(): WorkspaceLayout {
    return createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"]), group("g3", ["c"])], [0.3, 0.3, 0.4]), views("a", "b", "c"));
  }

  function weightsOf(layout: WorkspaceLayout, id = "s1"): number[] {
    const node = layout.root.kind === "split" && layout.root.id === id ? layout.root : null;
    return (node as SplitNode).weights.map((weight) => Number(weight.toFixed(4)));
  }

  it("renders one labelled separator between each pair of panes", () => {
    renderHarness(threeColumns());
    const found = separators();
    expect(found).toHaveLength(2);
    expect(found[0]).toHaveAttribute("aria-label", "Resize panes");
    expect(found[0]).toHaveAttribute("aria-orientation", "vertical");
    expect(found[0]).toHaveAttribute("aria-valuenow", "50");
    expect(found[1]).toHaveAttribute("aria-valuenow", "43");
    expect(found[0]).toHaveAttribute("aria-valuemin", "0");
    expect(found[0]).toHaveAttribute("aria-valuemax", "100");
    expect(found[0]).toHaveAttribute("tabindex", "0");
  });

  it("resizes a row with the left and right arrows", () => {
    const { latest } = renderHarness(threeColumns());
    fireEvent.keyDown(separators()[1], { key: "ArrowRight" });
    expect(weightsOf(latest())).toEqual([0.3, 0.32, 0.38]);
    fireEvent.keyDown(separators()[1], { key: "ArrowLeft" });
    fireEvent.keyDown(separators()[1], { key: "ArrowLeft" });
    expect(weightsOf(latest())).toEqual([0.3, 0.28, 0.42]);
    expect(separators()[1]).toHaveAttribute("aria-valuenow", "40");
  });

  it("resizes a column with the up and down arrows and ignores the other axis", () => {
    const layout = createLayout(split("s1", "column", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    const { onChange, latest } = renderHarness(layout);
    const separator = separators()[0];
    expect(separator).toHaveAttribute("aria-orientation", "horizontal");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(weightsOf(latest())).toEqual([0.52, 0.48]);
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(weightsOf(latest())).toEqual([0.5, 0.5]);
  });

  it("stops at the minimum pane size", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])], [0.09, 0.91]), views("a", "b"));
    const { latest } = renderHarness(layout);
    fireEvent.keyDown(separators()[0], { key: "ArrowLeft" });
    expect(weightsOf(latest())).toEqual([MIN_WEIGHT, 1 - MIN_WEIGHT]);
  });

  it("takes 10% steps with Shift", () => {
    const { latest } = renderHarness(threeColumns());
    fireEvent.keyDown(separators()[1], { key: "ArrowRight", shiftKey: true });
    expect(weightsOf(latest())).toEqual([0.3, 0.4, 0.3]);
  });

  it("keeps a pane at least 160px wide in a row", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 800, height: 600 } };
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])], [0.3, 0.7]), views("a", "b"));
    const { latest } = renderHarness(layout);
    fireEvent.keyDown(separators()[0], { key: "ArrowLeft", shiftKey: true });
    expect(weightsOf(latest())).toEqual([0.2, 0.8]);
  });

  it("keeps a pane at least 120px tall in a column", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 800, height: 600 } };
    const layout = createLayout(split("s1", "column", [group("g1", ["a"]), group("g2", ["b"])], [0.75, 0.25]), views("a", "b"));
    const { latest } = renderHarness(layout);
    fireEvent.keyDown(separators()[0], { key: "ArrowDown", shiftKey: true });
    expect(weightsOf(latest())).toEqual([0.8, 0.2]);
  });

  it("leaves a pair alone when it can't hold two minimum panes", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 200, height: 600 } };
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    const { onChange } = renderHarness(layout);
    fireEvent.keyDown(separators()[0], { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("evens out a pair on double-click", () => {
    const { onChange, latest } = renderHarness(threeColumns());
    fireEvent.doubleClick(separators()[1]);
    expect(weightsOf(latest())).toEqual([0.3, 0.35, 0.35]);
    fireEvent.doubleClick(separators()[1]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops views from taking pointer input while a divider moves", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 800, height: 600 } };
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    renderHarness(layout);
    fireEvent.pointerDown(separators()[0], { button: 0, clientX: 400, clientY: 10 });
    expect(panel("a")).toHaveClass("pointer-events-none");
    pointer("pointerup", 400, 10);
    expect(panel("a")).not.toHaveClass("pointer-events-none");
  });

  it("ends a divider drag when the window loses focus", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 800, height: 600 } };
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    const { onChange } = renderHarness(layout);
    fireEvent.pointerDown(separators()[0], { button: 0, clientX: 400, clientY: 10 });
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(panel("a")).not.toHaveClass("pointer-events-none");
    pointer("pointermove", 600, 10);
    flushFrames();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resizes by pointer drag, one update per frame and the rest on release", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 800, height: 600 } };
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    const { onChange, latest } = renderHarness(layout);
    fireEvent.pointerDown(separators()[0], { button: 0, clientX: 400, clientY: 10 });
    pointer("pointermove", 480, 300);
    pointer("pointermove", 500, 300);
    expect(onChange).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    flushFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(weightsOf(latest())).toEqual([0.625, 0.375]);
    pointer("pointermove", 520, 300);
    pointer("pointerup", 520, 300);
    expect(frames.size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(weightsOf(latest())).toEqual([0.65, 0.35]);
    pointer("pointermove", 700, 300);
    flushFrames();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("resizes a column by pointer drag and ends on pointer cancel", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 800, height: 400 } };
    const layout = createLayout(split("s1", "column", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    const { onChange, latest } = renderHarness(layout);
    fireEvent.pointerDown(separators()[0], { button: 0, clientX: 5, clientY: 200 });
    pointer("pointermove", 300, 160);
    flushFrames();
    expect(weightsOf(latest())).toEqual([0.4, 0.6]);
    pointer("pointercancel", 300, 160);
    expect(onChange).toHaveBeenCalledTimes(1);
    pointer("pointermove", 300, 100);
    flushFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores a secondary button and a container with no size", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    const { onChange } = renderHarness(layout);
    fireEvent.pointerDown(separators()[0], { button: 0, clientX: 400, clientY: 10 });
    pointer("pointermove", 500, 10);
    flushFrames();
    geometry = { "split:s1": { left: 0, top: 0, width: 800, height: 600 } };
    fireEvent.pointerDown(separators()[0], { button: 2, clientX: 400, clientY: 10 });
    pointer("pointermove", 500, 10);
    flushFrames();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops a drag once its split is gone from the layout", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 800, height: 600 } };
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    const { onLayoutChange, update } = renderStatic(layout);
    fireEvent.pointerDown(separators()[0], { button: 0, clientX: 400, clientY: 10 });
    update(createLayout(group("s1", ["a"]), views("a")));
    pointer("pointermove", 500, 10);
    flushFrames();
    update(createLayout(group("g1", ["a"]), views("a")));
    pointer("pointermove", 600, 10);
    flushFrames();
    pointer("pointerup", 600, 10);
    expect(onLayoutChange).not.toHaveBeenCalled();
  });
});

describe("Workspace tab drag", () => {
  it("does not start a drag for a small movement, and the click still selects", () => {
    twoGroupGeometry();
    const { onChange, latest } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("b"), { button: 0, clientX: 200, clientY: 60 });
    pointer("pointermove", 202, 61);
    expect(ghost()).toBeNull();
    pointer("pointerup", 202, 61);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(tab("b"));
    expect(groupOfView(latest(), "b")?.active).toBe("b");
  });

  it("moves a tab into the center of another group", async () => {
    twoGroupGeometry();
    const { onChange, latest } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 700, 368);
    expect(ghost()).toHaveTextContent("Title a");
    expect(ghost()?.style).toMatchObject({ left: "712px", top: "376px" });
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    expect(indicator()?.style).toMatchObject({ left: "400px", top: "36px", width: "400px", height: "564px" });
    await release(700, 368);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(groupOfView(latest(), "a")).toMatchObject({ id: "g2", views: ["c", "a"], active: "a" });
    expect(indicator()).toBeNull();
    expect(ghost()).toBeNull();
    expect(panel("a")).toHaveAttribute("data-shown", "true");
  });

  it("splits a group when a tab drops on its edge", async () => {
    twoGroupGeometry();
    const { latest } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 880, 300);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "right");
    expect(indicator()?.style).toMatchObject({ left: "600px", width: "200px" });
    pointer("pointermove", 700, 620);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "bottom");
    expect(indicator()?.style).toMatchObject({ top: "318px", height: "282px" });
    await release(700, 620);
    const owner = groupOfView(latest(), "a");
    expect(owner?.views).toEqual(["a"]);
    expect(owner?.id).not.toBe("g1");
    expect(screen.getAllByRole("tablist")).toHaveLength(3);
  });

  it("reorders tabs by dropping on the tab strip at the tab midpoint", async () => {
    twoGroupGeometry();
    const { latest } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 250, 60);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    expect(indicator()?.style).toMatchObject({ left: "0px", top: "0px", width: "400px", height: "36px" });
    await release(250, 60);
    expect(groupOfView(latest(), "a")).toMatchObject({ id: "g1", views: ["b", "a"], active: "a" });
    expect(within(strip("g1")).getAllByRole("tab").map((node) => node.textContent)).toEqual(["Title b", "Title a"]);
  });

  it("drops onto another strip before the tab under the pointer's left half", async () => {
    twoGroupGeometry();
    const { latest } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("b"), { button: 0, clientX: 200, clientY: 60 });
    pointer("pointermove", 510, 60);
    await release(510, 60);
    expect(groupOfView(latest(), "b")?.views).toEqual(["b", "c"]);
  });

  it("does not offer the edges of a group to its only tab", async () => {
    twoGroupGeometry();
    const { onChange } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("c"), { button: 0, clientX: 520, clientY: 60 });
    pointer("pointermove", 880, 300);
    expect(ghost()).toHaveTextContent("Title c");
    expect(indicator()).toBeNull();
    await release(880, 300);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does nothing when the tab drops outside every group", async () => {
    twoGroupGeometry();
    const { onChange } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 40, 20);
    expect(ghost()).toBeInTheDocument();
    expect(indicator()).toBeNull();
    await release(40, 20);
    expect(onChange).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();
  });

  it("asks canDrop and refuses a target it rejects", async () => {
    twoGroupGeometry();
    const canDrop = vi.fn((_id: string, target: DropTarget) => target.groupId !== "g2");
    const { onChange } = renderHarness(twoGroups(), { canDrop });
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 700, 368);
    expect(canDrop).toHaveBeenLastCalledWith("a", { groupId: "g2", zone: "center" });
    expect(indicator()).toBeNull();
    pointer("pointermove", 300, 368);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    pointer("pointermove", 700, 368);
    await release(700, 368);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancels on Escape and leaves other keys alone", async () => {
    twoGroupGeometry();
    const { onChange } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 700, 368);
    const other = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(other);
    });
    expect(other.defaultPrevented).toBe(false);
    expect(indicator()).not.toBeNull();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(indicator()).toBeNull();
    expect(ghost()).toBeNull();
    pointer("pointermove", 700, 368);
    await release(700, 368);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancels on pointer cancel", async () => {
    twoGroupGeometry();
    const { onChange } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 700, 368);
    pointer("pointercancel", 700, 368);
    expect(ghost()).toBeNull();
    await release(700, 368);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a drag with a secondary button", () => {
    twoGroupGeometry();
    renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 2, clientX: 120, clientY: 60 });
    pointer("pointermove", 700, 368);
    expect(ghost()).toBeNull();
  });

  it("swallows the click that ends a drag on the dragged tab, then clicks work again", async () => {
    geometry = {
      root: { left: 100, top: 50, width: 800, height: 600 },
      "strip:g1": { left: 100, top: 50, width: 800, height: 36 },
      "tab:a": { left: 100, top: 50, width: 80, height: 36 },
      "tab:b": { left: 180, top: 50, width: 80, height: 36 },
      "slot:g1": { left: 100, top: 86, width: 800, height: 564 },
    };
    const onFocusView = vi.fn();
    const { onChange, latest } = renderHarness(createLayout(group("g1", ["a", "b"]), views("a", "b")), { onFocusView });
    fireEvent.pointerDown(tab("b"), { button: 0, clientX: 200, clientY: 60 });
    pointer("pointermove", 210, 60);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 210, clientY: 60, bubbles: true }));
      fireEvent.click(tab("b"));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(groupOfView(latest(), "b")).toMatchObject({ views: ["a", "b"], active: "b" });
    expect(onFocusView).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(tab("a"));
    expect(onFocusView).toHaveBeenCalledWith("a");
    expect(groupOfView(latest(), "a")?.active).toBe("a");
  });

  it("survives the workspace unmounting mid-drag", async () => {
    twoGroupGeometry();
    const { unmount } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 700, 368);
    unmount();
    expect(() => pointer("pointermove", 710, 368)).not.toThrow();
    await expect(release(710, 368)).resolves.toBeUndefined();
  });

  it("selects a tab clicked after a drag that ended over another group", async () => {
    twoGroupGeometry();
    const { latest } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 700, 368);
    await release(700, 368);
    expect(groupOfView(latest(), "c")?.active).toBe("a");
    fireEvent.click(tab("c"));
    expect(groupOfView(latest(), "c")?.active).toBe("c");
  });

  it("keeps a tab visible after dragging it to an edge of the maximized group", async () => {
    geometry = {
      root: { left: 100, top: 50, width: 800, height: 600 },
      "strip:g1": { left: 100, top: 50, width: 800, height: 36 },
      "tab:a": { left: 100, top: 50, width: 80, height: 36 },
      "tab:b": { left: 180, top: 50, width: 80, height: 36 },
      "slot:g1": { left: 100, top: 86, width: 800, height: 564 },
    };
    const { latest } = renderHarness(toggleMaximize(twoGroups(), "g1"));
    fireEvent.pointerDown(tab("b"), { button: 0, clientX: 200, clientY: 60 });
    pointer("pointermove", 880, 368);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "right");
    await release(880, 368);
    expect(groupOfView(latest(), "b")?.id).not.toBe("g1");
    expect(panel("b")).toHaveAttribute("data-shown", "true");
  });
});

describe("Workspace panel cycling", () => {
  it("moves focus to the next panel's tab with F6 and back with Shift+F6", () => {
    renderHarness(twoGroups());
    tab("a").focus();
    fireEvent.keyDown(tab("a"), { key: "F6" });
    expect(tab("c")).toHaveFocus();
    fireEvent.keyDown(tab("c"), { key: "F6" });
    expect(tab("a")).toHaveFocus();
    fireEvent.keyDown(tab("a"), { key: "F6", shiftKey: true });
    expect(tab("c")).toHaveFocus();
  });

  it("starts at the first panel when nothing in the workspace has focus, and ignores other keys", () => {
    renderHarness(twoGroups());
    fireEvent.keyDown(panel("c"), { key: "F5" });
    expect(document.body).toHaveFocus();
    fireEvent.keyDown(panel("c"), { key: "F6" });
    expect(tab("a")).toHaveFocus();
  });

  it("does nothing in an empty workspace", () => {
    const { container } = renderHarness(createLayout(group("g1", []), {}));
    const root = container.querySelector(".ws-root") ?? container.firstElementChild;
    if (!root) throw new Error("no root");
    expect(() => fireEvent.keyDown(root, { key: "F6" })).not.toThrow();
    expect(document.body).toHaveFocus();
  });
});

describe("Workspace tab drag cancel", () => {
  it("cancels a tab drag when the window loses focus", () => {
    twoGroupGeometry();
    const { onChange } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 700, 300);
    expect(indicator()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(indicator()).toBeNull();
    pointer("pointerup", 700, 300);
    expect(onChange).not.toHaveBeenCalled();
  });
});
