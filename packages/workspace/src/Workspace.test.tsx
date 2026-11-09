// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  setGroupHidden,
  split,
  stack,
  stackOf,
  toggleMaximize,
  toggleSection,
  type MoveTarget,
  type StackState,
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
  const stackId = element.getAttribute("data-stack");
  if (stackId) return `stack:${stackId}`;
  const header = element.getAttribute("data-section-header");
  if (header) return `header:${header}`;
  const sectionSlot = element.getAttribute("data-section-slot");
  if (sectionSlot) return `sslot:${sectionSlot}`;
  const section = element.getAttribute("data-section");
  if (section) return `section:${section}`;
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
  unobserved: Element[] = [];
  disconnected = false;
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve(element: Element) {
    this.unobserved.push(element);
  }
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

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await new Promise((resolve) => setTimeout(resolve, 0));
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

function dragTo(clientX: number, clientY: number) {
  pointer("pointermove", clientX, clientY);
  flushFrames();
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

  it("gives every view a panel over its group and builds a hidden view only once it is first shown", () => {
    twoGroupGeometry();
    vi.stubGlobal("CSS", { supports: (property: string, value: string) => property === "content-visibility" && value === "hidden" });
    const { update } = renderStatic(twoGroups());
    for (const id of ["a", "b", "c"]) expect(document.querySelectorAll(`[data-view="${id}"]`)).toHaveLength(1);
    for (const id of ["a", "c"]) expect(screen.getAllByTestId(`content-${id}`)).toHaveLength(1);
    expect(screen.queryByTestId("content-b")).toBeNull();
    expect(renderView).toHaveBeenCalledTimes(2);
    expect(panel("a")).toHaveAttribute("data-shown", "true");
    expect(panel("b")).toHaveAttribute("data-shown", "false");
    expect(panel("b")).toHaveClass("invisible", "[content-visibility:hidden]");
    expect(panel("c")).toHaveAttribute("data-shown", "true");
    expect(panel("c")).not.toHaveClass("[content-visibility:hidden]");
    update(activate(twoGroups(), "b"));
    expect(screen.getByTestId("content-b")).toBeInTheDocument();
    expect(panel("a")).toHaveClass("[content-visibility:hidden]");
    update(twoGroups());
    expect(screen.getByTestId("content-b")).toBeInTheDocument();
    expect(panel("b")).toHaveClass("[content-visibility:hidden]");
    expect(panel("a").style).toMatchObject({ left: "0px", top: "36px", width: "400px", height: "564px" });
    expect(panel("c").style).toMatchObject({ left: "400px", top: "36px", width: "400px", height: "564px" });
  });

  it("hides a hidden view with display none where content-visibility is unsupported", () => {
    twoGroupGeometry();
    vi.stubGlobal("CSS", { supports: () => false });
    const { update } = renderStatic(twoGroups());
    update(activate(twoGroups(), "b"));
    expect(panel("a")).toHaveClass("hidden");
    expect(panel("a")).not.toHaveClass("flex", "invisible", "[content-visibility:hidden]");
    expect(panel("b")).toHaveClass("flex");
    expect(panel("b")).not.toHaveClass("hidden");
    expect(screen.getByTestId("content-a")).toBeInTheDocument();
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

  it("closes a tab with the Mac delete key, which arrives as Backspace", () => {
    const { onChange } = renderHarness(createLayout(group("g1", ["a", "b"]), views("a", "b")));
    fireEvent.keyDown(tab("a"), { key: "Backspace" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tab", { name: "Title a" })).toBeNull();
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
    expect(maximize).not.toHaveAttribute("title");
    fireEvent.click(maximize);
    expect(latest().maximized).toBe("g2");
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Title a" })).toBeNull();
    expect(panel("c")).toHaveAttribute("data-shown", "true");
    expect(panel("a")).toHaveAttribute("data-shown", "false");
    expect(separators()).toHaveLength(0);
    const restore = screen.getByRole("button", { name: "Restore group" });
    expect(restore).toHaveAttribute("aria-pressed", "true");
    expect(restore).not.toHaveAttribute("title");
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

  it("leaves a double-click on window chrome to the window instead of maximizing the group", () => {
    const layout = createLayout(split("s1", "column", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    const { onChange, latest } = renderHarness(layout, { chromeAttributes: { "data-chrome": "drag" } });
    fireEvent.doubleClick(strip("g1"));
    fireEvent.doubleClick(strip("g1").parentElement as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.doubleClick(strip("g2"));
    expect(latest().maximized).toBe("g2");
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
    dragTo(700, 368);
    await release(700, 368);
    expect(within(strip("g2")).getByRole("tab", { name: "Title a" })).toBeInTheDocument();
    expect(screen.getByLabelText("Field a")).toHaveValue("draft");
    expect(mounts.get("a")).toBe(1);
  });

  it("calls renderView again only for a view whose state changed", () => {
    const layout = twoGroups();
    const { update } = renderStatic(layout);
    expect(renderView).toHaveBeenCalledTimes(2);
    update(activate(layout, "b"), { className: "ws-root other" });
    expect(renderView).toHaveBeenCalledTimes(3);
    update(activate(layout, "b"), { className: "ws-root" });
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
    expect(classes("a")).toEqual(expect.arrayContaining(["border-border", "bg-background", "border-x", "border-t"]));
    expect(classes("a")).not.toContain("border");
    expect(classes("a")).not.toEqual(expect.arrayContaining(["border-b"]));
    expect(classes("a")).not.toEqual(expect.arrayContaining(["border-b-0"]));
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

  it("hides the tab strip's scrollbar on WebKit builds that ignore scrollbar-width", () => {
    renderStatic(twoGroups());
    expect(strip("g1")).toHaveClass("[scrollbar-width:none]", "[&::-webkit-scrollbar]:hidden");
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
    dragTo(850, 60);
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
  it("re-measures the slots inside the resize observer callback, before the frame paints", () => {
    twoGroupGeometry();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    renderHarness(twoGroups());
    const observer = FakeResizeObserver.live();
    expect(observer.observed.map(geometryKey).sort()).toEqual(["root", "slot:g1", "slot:g2"]);
    geometry["slot:g1"] = { left: 100, top: 86, width: 300, height: 564 };
    geometry["slot:g2"] = { left: 400, top: 86, width: 500, height: 564 };
    observer.callback([], observer as unknown as ResizeObserver);
    expect(frames.size).toBe(0);
    expect(panel("a").style.width).toBe("300px");
    expect(panel("c").style).toMatchObject({ left: "300px", width: "500px" });
  });

  it("leaves a weight change to the resize observer instead of measuring in the commit", () => {
    twoGroupGeometry();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const measured = () =>
      vi.mocked(Element.prototype.getBoundingClientRect).mock.contexts.filter((element) => geometryKey(element as Element) === "root").length;
    const layout = twoGroups();
    const { update } = renderStatic(layout);
    const observer = FakeResizeObserver.live();
    const first = measured();
    const root = layout.root as SplitNode;
    update({ ...layout, root: { ...root, weights: [0.3, 0.7] } });
    expect(measured()).toBe(first);
    geometry["slot:g1"] = { left: 100, top: 86, width: 240, height: 564 };
    geometry["slot:g2"] = { left: 340, top: 86, width: 560, height: 564 };
    observer.callback([], observer as unknown as ResizeObserver);
    expect(measured()).toBe(first + 1);
    expect(panel("c").style).toMatchObject({ left: "240px", width: "560px" });
    update(toggleMaximize(layout, "g1"));
    expect(measured()).toBe(first + 2);
  });

  it("keeps one observer across renders and observes slots as they appear and go", () => {
    twoGroupGeometry();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { update } = renderStatic(twoGroups());
    const observer = FakeResizeObserver.live();
    update(twoGroups(), { leading: <span>{"Lead"}</span> });
    expect(FakeResizeObserver.live()).toBe(observer);
    expect(observer.observed).toHaveLength(3);
    update(createLayout(split("s1", "row", [group("g1", ["a", "b"]), group("g2", ["c"]), group("g3", [])]), views("a", "b", "c"), "g3"));
    expect(FakeResizeObserver.live()).toBe(observer);
    expect(observer.observed.map(geometryKey)).toContain("slot:g3");
    update(twoGroups());
    expect(observer.unobserved.map(geometryKey)).toEqual(["slot:g3"]);
  });

  it("measures when the layout changes, not on every render", () => {
    twoGroupGeometry();
    const measured = () =>
      vi.mocked(Element.prototype.getBoundingClientRect).mock.contexts.filter((element) => geometryKey(element as Element) === "root").length;
    const layout = twoGroups();
    const { update } = renderStatic(layout);
    const first = measured();
    expect(first).toBeGreaterThan(0);
    update(layout, { leading: <span>{"Lead"}</span> });
    update(layout, { trailing: <span>{"Trail"}</span> });
    expect(measured()).toBe(first);
    geometry["slot:g1"] = { left: 100, top: 86, width: 250, height: 564 };
    update(toggleMaximize(layout, "g1"));
    expect(measured()).toBe(first + 1);
  });

  it("disconnects the observer on unmount", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { unmount } = renderHarness(twoGroups());
    const observer = FakeResizeObserver.live();
    unmount();
    expect(observer.disconnected).toBe(true);
    expect(frames.size).toBe(0);
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
    dragTo(202, 61);
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
    dragTo(700, 368);
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
    dragTo(880, 300);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "right");
    expect(indicator()?.style).toMatchObject({ left: "600px", width: "200px" });
    dragTo(700, 620);
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
    dragTo(250, 60);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    expect(indicator()?.style).toMatchObject({ left: "159px", top: "0px", width: "2px", height: "36px" });
    expect(indicator()).toHaveClass("bg-primary");
    await release(250, 60);
    expect(groupOfView(latest(), "a")).toMatchObject({ id: "g1", views: ["b", "a"], active: "a" });
    expect(within(strip("g1")).getAllByRole("tab").map((node) => node.textContent)).toEqual(["Title b", "Title a"]);
  });

  it("drops onto another strip before the tab under the pointer's left half", async () => {
    twoGroupGeometry();
    const { latest } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("b"), { button: 0, clientX: 200, clientY: 60 });
    dragTo(510, 60);
    await release(510, 60);
    expect(groupOfView(latest(), "b")?.views).toEqual(["b", "c"]);
  });

  it("does not offer the edges of a group to its only tab", async () => {
    twoGroupGeometry();
    const { onChange } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("c"), { button: 0, clientX: 520, clientY: 60 });
    dragTo(880, 300);
    expect(ghost()).toHaveTextContent("Title c");
    expect(indicator()).toBeNull();
    await release(880, 300);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does nothing when the tab drops outside every group", async () => {
    twoGroupGeometry();
    const { onChange } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    dragTo(40, 20);
    expect(ghost()).toBeInTheDocument();
    expect(indicator()).toBeNull();
    await release(40, 20);
    expect(onChange).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();
  });

  it("asks canDrop and refuses a target it rejects", async () => {
    twoGroupGeometry();
    const canDrop = vi.fn((_id: string, target: MoveTarget) => !("groupId" in target) || target.groupId !== "g2");
    const { onChange } = renderHarness(twoGroups(), { canDrop });
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    dragTo(700, 368);
    expect(canDrop).toHaveBeenLastCalledWith("a", { groupId: "g2", zone: "center" });
    expect(indicator()).toBeNull();
    dragTo(300, 368);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    dragTo(700, 368);
    await release(700, 368);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancels on Escape and leaves other keys alone", async () => {
    twoGroupGeometry();
    const { onChange } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    dragTo(700, 368);
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
    dragTo(700, 368);
    await release(700, 368);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancels on pointer cancel", async () => {
    twoGroupGeometry();
    const { onChange } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    dragTo(700, 368);
    pointer("pointercancel", 700, 368);
    expect(ghost()).toBeNull();
    await release(700, 368);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a drag with a secondary button", () => {
    twoGroupGeometry();
    renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 2, clientX: 120, clientY: 60 });
    dragTo(700, 368);
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
    dragTo(210, 60);
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
    dragTo(700, 368);
    unmount();
    expect(() => dragTo(710, 368)).not.toThrow();
    await expect(release(710, 368)).resolves.toBeUndefined();
  });

  it("selects a tab clicked after a drag that ended over another group", async () => {
    twoGroupGeometry();
    const { latest } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    dragTo(700, 368);
    await release(700, 368);
    expect(groupOfView(latest(), "c")?.active).toBe("a");
    fireEvent.pointerDown(tab("c"), { button: 0, clientX: 520, clientY: 60 });
    fireEvent.pointerUp(window);
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
    dragTo(880, 368);
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

  it("cycles panels with Control+Tab too, since F6 needs the fn key on a Mac", () => {
    renderHarness(twoGroups());
    tab("a").focus();
    fireEvent.keyDown(tab("a"), { key: "Tab", ctrlKey: true });
    expect(tab("c")).toHaveFocus();
    fireEvent.keyDown(tab("c"), { key: "Tab", ctrlKey: true, shiftKey: true });
    expect(tab("a")).toHaveFocus();
    fireEvent.keyDown(tab("a"), { key: "Tab", ctrlKey: true, metaKey: true });
    fireEvent.keyDown(tab("a"), { key: "Tab" });
    expect(tab("a")).toHaveFocus();
  });

  it("leaves a panel key that a view already handled", () => {
    renderHarness(twoGroups());
    tab("a").focus();
    const event = new KeyboardEvent("keydown", { key: "F6", bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => {
      tab("a").dispatchEvent(event);
    });
    expect(tab("a")).toHaveFocus();
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
    dragTo(700, 300);
    expect(indicator()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(indicator()).toBeNull();
    pointer("pointerup", 700, 300);
    expect(onChange).not.toHaveBeenCalled();
  });
});

function dockLayout(weights: number[] = [0.3, 0.7]): WorkspaceLayout {
  return createLayout(
    split("s1", "row", [group("g1", ["files", "search"], "files", { presentation: "icons" }), group("g2", ["editor", "preview"])], weights),
    views("explorer", "outline", "structure", "search", "editor", "preview"),
    null,
    { files: stack(["explorer", "outline", "structure"], { collapsed: ["structure"], weights: [2, 2, 1] }) },
  );
}

const REFRESH = "Refresh outline";
const NEW_FILE = "New file";

function dockDescribe(id: string, view: ViewState) {
  const base = describeView(id, view);
  if (id === "search") return { ...base, badge: 3, badgeLabel: "3 results" };
  if (id === "outline") return { ...base, badge: true, actions: <button type="button" aria-label={REFRESH} />, minHeight: 200 };
  if (id === "editor") return { ...base, minWidth: 480, badge: 120 };
  return base;
}

function describeStack(id: string, _stack: StackState) {
  return id === "files" ? { title: "Files", icon: <span data-testid="icon-files" /> } : null;
}

function dockGeometry() {
  geometry = {
    root: { left: 0, top: 0, width: 1000, height: 600 },
    "split:s1": { left: 0, top: 0, width: 1000, height: 600 },
    "strip:g1": { left: 0, top: 0, width: 300, height: 36 },
    "tab:files": { left: 4, top: 4, width: 28, height: 28 },
    "tab:search": { left: 34, top: 4, width: 28, height: 28 },
    "slot:g1": { left: 0, top: 36, width: 300, height: 564 },
    "stack:files": { left: 0, top: 36, width: 300, height: 564 },
    "section:explorer": { left: 0, top: 36, width: 300, height: 200 },
    "header:explorer": { left: 0, top: 36, width: 300, height: 32 },
    "sslot:explorer": { left: 0, top: 68, width: 300, height: 168 },
    "section:outline": { left: 0, top: 236, width: 300, height: 200 },
    "header:outline": { left: 0, top: 236, width: 300, height: 32 },
    "sslot:outline": { left: 0, top: 268, width: 300, height: 168 },
    "section:structure": { left: 0, top: 436, width: 300, height: 32 },
    "header:structure": { left: 0, top: 436, width: 300, height: 32 },
    "strip:g2": { left: 300, top: 0, width: 700, height: 36 },
    "tab:editor": { left: 300, top: 0, width: 100, height: 36 },
    "tab:preview": { left: 400, top: 0, width: 100, height: 36 },
    "slot:g2": { left: 300, top: 36, width: 700, height: 564 },
  };
}

function host(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-view="${id}"]`);
  if (!found) throw new Error(`no view ${id}`);
  return found;
}

function header(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-section-header="${id}"]`);
  if (!found) throw new Error(`no header ${id}`);
  return found;
}

function toggle(id: string): HTMLElement {
  return screen.getByRole("button", { name: `Title ${id}` });
}

function weightsOf(layout: WorkspaceLayout, stackId = "files"): number[] {
  return (stackOf(layout, stackId)?.weights ?? []).map((weight) => Number(weight.toFixed(4)));
}

const tooltip = vi.fn((label: string, trigger: ReactNode, options: { side: string; className?: string }) => (
  <span data-tooltip={label} data-side={options.side} className={options.className}>
    {trigger}
  </span>
));

describe("Workspace icon tabs", () => {
  it("draws icon-only tabs named by their title with tooltips and badges", () => {
    renderHarness(dockLayout(), { describeView: dockDescribe, describeStack, renderTooltip: tooltip });
    const files = screen.getByRole("tab", { name: "Files" });
    expect(files).toHaveAttribute("aria-selected", "true");
    expect(files).not.toHaveAttribute("title");
    expect(files.closest("[data-tooltip]")).toHaveAttribute("data-tooltip", "Files");
    expect(files.closest("[data-tooltip]")).toHaveAttribute("data-side", "bottom");
    expect(within(files).getByTestId("icon-files")).toBeInTheDocument();
    const search = screen.getByRole("tab", { name: "Title search" });
    expect(search).toHaveAttribute("aria-selected", "false");
    expect(search).toHaveAccessibleDescription("3 results");
    expect(within(search).getByText("3")).toHaveAttribute("aria-hidden", "true");
    expect(groupElement("g1")).toHaveAttribute("data-presentation", "icons");
    expect(groupElement("g2")).not.toHaveAttribute("data-presentation");
  });

  it("never falls back to a native title, and draws the title's first letter", () => {
    const plain = (id: string) => ({ title: id === "search" ? " search results" : `Title ${id}` });
    renderHarness(dockLayout(), { describeView: plain });
    const search = screen.getByRole("tab", { name: "search results" });
    expect(search).not.toHaveAttribute("title");
    expect(search).toHaveTextContent("S");
    expect(screen.getByRole("tab", { name: "Title explorer" })).toHaveTextContent("T");
  });

  it("caps large counts, describes them and draws a dot for a true badge", () => {
    renderHarness(dockLayout(), { describeView: dockDescribe, describeStack });
    const editor = tab("editor");
    expect(within(editor).getByText("99+")).toBeInTheDocument();
    expect(editor).toHaveAccessibleDescription("120");
    expect(header("outline").querySelector('[data-badge="dot"]')).not.toBeNull();
    expect(toggle("outline")).not.toHaveAccessibleDescription();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("closes a closable icon tab with a middle click and selects with the keyboard", () => {
    const { latest } = renderHarness(dockLayout());
    const search = screen.getByRole("tab", { name: "Title search" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Title explorer" }), { key: "ArrowRight" });
    expect(groupOfView(latest(), "search")?.active).toBe("search");
    auxClick(screen.getByRole("tab", { name: "Title explorer" }), 1);
    expect(stackOf(latest(), "files")).not.toBeNull();
    auxClick(search, 1);
    expect(latest().views).not.toHaveProperty("search");
  });
});

describe("Workspace stacks", () => {
  it("draws a header per section and places each expanded view over its section", () => {
    dockGeometry();
    renderHarness(dockLayout(), { describeView: dockDescribe, describeStack });
    expect(toggle("explorer")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("structure")).toHaveAttribute("aria-expanded", "false");
    expect(host("explorer")).toHaveAttribute("role", "region");
    expect(host("explorer")).toHaveAttribute("aria-labelledby", toggle("explorer").id);
    expect(toggle("explorer")).toHaveAttribute("aria-controls", host("explorer").id);
    expect(host("explorer")).toHaveAttribute("data-shown", "true");
    expect(host("explorer").style).toMatchObject({ left: "0px", top: "68px", width: "300px", height: "168px" });
    expect(host("outline").style).toMatchObject({ top: "268px", height: "168px" });
    expect(host("structure")).toHaveAttribute("data-shown", "false");
    expect(host("structure").style).toMatchObject({ top: "36px", height: "564px" });
    const stackPanel = screen.getByRole("tabpanel", { name: "Files" });
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-controls", stackPanel.id);
    expect(within(header("outline")).getByRole("button", { name: "Refresh outline" })).toBeInTheDocument();
    expect(screen.getAllByRole("separator", { name: "Resize panes" })).toHaveLength(2);
    expect(header("explorer").parentElement?.style.flex).toBe("0.4 1 0px");
    expect(header("structure").parentElement?.style.flex).toBe("0 0 auto");
  });

  it("hides the header of a stack with one section and fills the stack with its view", () => {
    geometry = { root: { left: 0, top: 0, width: 400, height: 400 }, "slot:g1": { left: 0, top: 36, width: 400, height: 364 } };
    const layout = createLayout(group("g1", ["k", "x"], "k", { presentation: "icons" }), views("only", "x"), null, { k: stack(["only"]) });
    renderHarness(layout);
    expect(document.querySelector("[data-section-header]")).toBeNull();
    expect(document.querySelector("[data-stack]")).toBeNull();
    const stackTab = screen.getByRole("tab", { name: "Title only" });
    expect(host("only")).toHaveAttribute("role", "tabpanel");
    expect(host("only")).toHaveAttribute("aria-labelledby", stackTab.id);
    expect(stackTab).toHaveAttribute("aria-controls", host("only").id);
    expect(host("only").style).toMatchObject({ top: "36px", height: "364px" });
    expect(host("only")).toHaveAttribute("data-shown", "true");
  });

  it("names a stack tab after the stack's title or its first section and closes it only when allowed", () => {
    const layout = createLayout(group("g1", ["files", "k"]), views("explorer", "outline", "a", "b"), null, {
      files: stack(["explorer", "outline"], { title: "Files" }),
      k: stack(["a", "b"]),
    });
    const { latest, unmount } = renderHarness(layout, { describeStack: () => null });
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Title a" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close Files" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Files" }), { key: "Delete" });
    expect(latest()).toBeUndefined();
    unmount();
    const closable = renderHarness(layout, { describeStack: (id) => (id === "files" ? { title: "Files", closable: true } : undefined) });
    fireEvent.click(screen.getByRole("button", { name: "Close Files" }));
    expect(stackOf(closable.latest(), "files")).toBeNull();
    expect(closable.latest().views).not.toHaveProperty("explorer");
  });

  it("collapses and expands a section with a click, Enter and Space", async () => {
    const user = userEvent.setup();
    const { latest } = renderHarness(dockLayout());
    await user.click(toggle("explorer"));
    expect(stackOf(latest(), "files")?.collapsed).toEqual(["explorer", "structure"]);
    expect(toggle("explorer")).toHaveAttribute("aria-expanded", "false");
    expect(host("explorer")).toHaveAttribute("data-shown", "false");
    expect(document.querySelector('[data-section-slot="explorer"]')).toBeNull();
    toggle("explorer").focus();
    await user.keyboard("{Enter}");
    expect(stackOf(latest(), "files")?.collapsed).toEqual(["structure"]);
    await user.keyboard(" ");
    expect(stackOf(latest(), "files")?.collapsed).toEqual(["explorer", "structure"]);
    expect(host("explorer")).toHaveAttribute("data-shown", "false");
  });

  it("moves a section with Alt and the arrow keys and keeps focus on its header", () => {
    const { onChange, latest } = renderHarness(dockLayout(), { labels: { ...labels, moveSection: (title) => `Press Alt and an arrow key to move ${title}` } });
    const explorer = toggle("explorer");
    expect(explorer).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    expect(explorer).toHaveAccessibleDescription("Press Alt and an arrow key to move Title explorer");
    explorer.focus();
    fireEvent.keyDown(explorer, { key: "ArrowDown", altKey: true });
    expect(stackOf(latest(), "files")?.sections).toEqual(["outline", "explorer", "structure"]);
    flushFrames();
    expect(toggle("explorer")).toHaveFocus();
    fireEvent.keyDown(toggle("explorer"), { key: "ArrowUp", altKey: true });
    expect(stackOf(latest(), "files")?.sections).toEqual(["explorer", "outline", "structure"]);
    expect(onChange).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(toggle("explorer"), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(toggle("structure"), { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(toggle("outline"), { key: "ArrowDown" });
    fireEvent.keyDown(toggle("outline"), { key: "Enter", altKey: true });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("shows collapse and expand hints in tooltips", () => {
    renderHarness(dockLayout(), {
      renderTooltip: tooltip,
      labels: { ...labels, collapseSection: (title) => `Collapse ${title}`, expandSection: (title) => `Expand ${title}` },
    });
    expect(toggle("explorer").closest("[data-tooltip]")).toHaveAttribute("data-tooltip", "Collapse Title explorer");
    expect(toggle("explorer").closest("[data-tooltip]")).toHaveClass("flex-1");
    expect(toggle("structure").closest("[data-tooltip]")).toHaveAttribute("data-tooltip", "Expand Title structure");
    cleanup();
    renderHarness(dockLayout(), { renderTooltip: tooltip });
    expect(toggle("structure").closest("[data-tooltip]")).toHaveAttribute("data-tooltip", "Title structure");
  });

  it("resizes sections with the keyboard and evens them on double-click", () => {
    dockGeometry();
    const { onChange, latest } = renderHarness(dockLayout(), { labels: { ...labels, resizeSections: "Resize sections" } });
    const separator = screen.getByRole("separator", { name: "Resize sections" });
    expect(separator).toHaveAttribute("aria-orientation", "horizontal");
    expect(separator).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(weightsOf(latest())).toEqual([0.416, 0.384, 0.2]);
    fireEvent.keyDown(separator, { key: "ArrowUp", shiftKey: true });
    expect(weightsOf(latest())).toEqual([0.336, 0.464, 0.2]);
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledTimes(2);
    fireEvent.doubleClick(separator);
    expect(weightsOf(latest())).toEqual([0.4, 0.4, 0.2]);
    fireEvent.doubleClick(separator);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("stops a section at its minimum height", () => {
    dockGeometry();
    const { latest } = renderHarness(dockLayout(), { describeView: dockDescribe });
    const sectionSeparator = document.querySelector<HTMLElement>("[data-section-splitter]");
    if (!sectionSeparator) throw new Error("no section separator");
    fireEvent.keyDown(sectionSeparator, { key: "ArrowDown", shiftKey: true });
    expect(weightsOf(latest())).toEqual([0.336, 0.464, 0.2]);
    fireEvent.keyDown(sectionSeparator, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(sectionSeparator, { key: "ArrowUp", shiftKey: true });
    expect(weightsOf(latest())).toEqual([0.24, 0.56, 0.2]);
  });

  it("resizes sections by pointer drag", () => {
    dockGeometry();
    const { latest } = renderHarness(dockLayout());
    const separator = document.querySelector<HTMLElement>("[data-section-splitter]");
    if (!separator) throw new Error("no section separator");
    fireEvent.pointerDown(separator, { button: 0, clientX: 150, clientY: 236 });
    expect(host("explorer")).toHaveClass("pointer-events-none");
    pointer("pointermove", 150, 276);
    flushFrames();
    expect(weightsOf(latest())).toEqual([0.48, 0.32, 0.2]);
    pointer("pointerup", 150, 276);
    expect(host("explorer")).not.toHaveClass("pointer-events-none");
  });

  it("ignores a section resize once the stack or its sections are gone", () => {
    dockGeometry();
    const { onLayoutChange, update } = renderStatic(dockLayout());
    const separator = document.querySelector<HTMLElement>("[data-section-splitter]");
    if (!separator) throw new Error("no section separator");
    fireEvent.pointerDown(separator, { button: 0, clientX: 150, clientY: 236 });
    update(moveView(dockLayout(), "outline", { groupId: "g2", zone: "center" }));
    pointer("pointermove", 150, 276);
    flushFrames();
    update(createLayout(group("g1", ["a"]), views("a")));
    pointer("pointermove", 150, 300);
    flushFrames();
    pointer("pointerup", 150, 300);
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("selects a stack tab and reports its first shown section as focused", () => {
    const onFocusView = vi.fn();
    const { latest } = renderHarness(activate(dockLayout(), "search"), { onFocusView });
    fireEvent.click(screen.getByRole("tab", { name: "Title explorer" }));
    expect(groupOfView(latest(), "explorer")?.active).toBe("files");
    expect(onFocusView).toHaveBeenLastCalledWith("explorer");
    cleanup();
    const folded = activate(toggleSection(toggleSection(dockLayout(), "files", "explorer"), "files", "outline"), "search");
    renderHarness(folded, { onFocusView });
    fireEvent.click(screen.getByRole("tab", { name: "Title explorer" }));
    expect(onFocusView).toHaveBeenLastCalledWith("explorer");
    cleanup();
    renderHarness(toggleSection(dockLayout(), "files", "explorer"), { onFocusView });
    fireEvent.click(screen.getByRole("tab", { name: "Title explorer" }));
    expect(onFocusView).toHaveBeenLastCalledWith("outline");
  });

  it("shows the selected view's actions in its tab bar", () => {
    const describe = (id: string) => ({ title: `Title ${id}`, actions: id === "a" ? <button type="button" aria-label={NEW_FILE} /> : undefined });
    renderHarness(createLayout(group("g1", ["a", "b"]), views("a", "b")), { describeView: describe });
    expect(screen.getByRole("button", { name: "New file" }).closest("[data-view-actions]")).toHaveAttribute("data-view-actions", "a");
    fireEvent.click(tab("b"));
    expect(screen.queryByRole("button", { name: "New file" })).toBeNull();
  });

  it("moves focus to the next panel with F6 from a section header", () => {
    renderHarness(dockLayout());
    toggle("outline").focus();
    fireEvent.keyDown(toggle("outline"), { key: "F6" });
    expect(tab("editor")).toHaveFocus();
  });
});

describe("Workspace section drag", () => {
  it("drags a section to another place in its stack", async () => {
    dockGeometry();
    const { latest } = renderHarness(dockLayout());
    fireEvent.pointerDown(header("outline"), { button: 0, clientX: 150, clientY: 250 });
    dragTo(150, 40);
    expect(ghost()).toHaveTextContent("Title outline");
    expect(header("outline")).toHaveClass("opacity-50");
    expect(indicator()).toHaveAttribute("data-drop-indicator", "stack");
    expect(indicator()?.style).toMatchObject({ left: "0px", top: "36px", width: "300px", height: "2px" });
    dragTo(150, 460);
    expect(indicator()?.style).toMatchObject({ top: "467px" });
    dragTo(150, 40);
    await release(150, 40);
    expect(stackOf(latest(), "files")?.sections).toEqual(["outline", "explorer", "structure"]);
    expect(mounts.get("outline")).toBe(1);
  });

  it("finds a gap near a section boundary outside the headers", async () => {
    dockGeometry();
    const { latest } = renderHarness(dockLayout());
    fireEvent.pointerDown(header("explorer"), { button: 0, clientX: 150, clientY: 50 });
    dragTo(150, 466);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "stack");
    dragTo(150, 150);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "top");
    dragTo(150, 470);
    expect(indicator()?.style).toMatchObject({ top: "467px" });
    await release(150, 470);
    expect(stackOf(latest(), "files")?.sections).toEqual(["outline", "structure", "explorer"]);
  });

  it("offers no target in the gaps beside a section's own place", () => {
    dockGeometry();
    const { onChange } = renderHarness(dockLayout());
    fireEvent.pointerDown(header("explorer"), { button: 0, clientX: 150, clientY: 50 });
    dragTo(150, 40);
    expect(ghost()).toHaveTextContent("Title explorer");
    expect(indicator()).toBeNull();
    dragTo(150, 240);
    expect(indicator()).toBeNull();
    pointer("pointerup", 150, 240);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drags a section onto a tab bar as a tab", async () => {
    dockGeometry();
    const { latest } = renderHarness(dockLayout());
    fireEvent.pointerDown(header("outline"), { button: 0, clientX: 150, clientY: 250 });
    dragTo(450, 10);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    expect(indicator()?.style).toMatchObject({ left: "499px", top: "0px", width: "2px", height: "36px" });
    await release(450, 10);
    expect(groupOfView(latest(), "outline")).toMatchObject({ id: "g2", views: ["editor", "preview", "outline"], active: "outline" });
    expect(host("outline")).toHaveAttribute("role", "tabpanel");
    expect(mounts.get("outline")).toBe(1);
  });

  it("drags a section to the edge of a group", async () => {
    dockGeometry();
    const { latest } = renderHarness(dockLayout());
    fireEvent.pointerDown(header("explorer"), { button: 0, clientX: 150, clientY: 50 });
    dragTo(980, 300);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "right");
    await release(980, 300);
    expect(groupOfView(latest(), "explorer")?.views).toEqual(["explorer"]);
    expect(stackOf(latest(), "files")?.sections).toEqual(["outline", "structure"]);
    expect(mounts.get("explorer")).toBe(1);
  });

  it("drags a section into a stack in another group", async () => {
    geometry = {
      root: { left: 0, top: 0, width: 1000, height: 600 },
      "split:s1": { left: 0, top: 0, width: 1000, height: 600 },
      "strip:g1": { left: 0, top: 0, width: 300, height: 36 },
      "slot:g1": { left: 0, top: 36, width: 300, height: 564 },
      "stack:files": { left: 0, top: 36, width: 300, height: 564 },
      "section:explorer": { left: 0, top: 36, width: 300, height: 282 },
      "header:explorer": { left: 0, top: 36, width: 300, height: 32 },
      "section:outline": { left: 0, top: 318, width: 300, height: 282 },
      "header:outline": { left: 0, top: 318, width: 300, height: 32 },
      "strip:g2": { left: 300, top: 0, width: 700, height: 36 },
      "slot:g2": { left: 300, top: 36, width: 700, height: 564 },
      "stack:refs": { left: 300, top: 36, width: 700, height: 564 },
      "section:citations": { left: 300, top: 36, width: 700, height: 282 },
      "header:citations": { left: 300, top: 36, width: 700, height: 32 },
      "section:bib": { left: 300, top: 318, width: 700, height: 282 },
      "header:bib": { left: 300, top: 318, width: 700, height: 32 },
    };
    const layout = createLayout(
      split("s1", "row", [group("g1", ["files"]), group("g2", ["refs"])]),
      views("explorer", "outline", "citations", "bib"),
      null,
      { files: stack(["explorer", "outline"]), refs: stack(["citations", "bib"]) },
    );
    const { latest } = renderHarness(layout);
    fireEvent.change(screen.getByLabelText("Field explorer"), { target: { value: "kept" } });
    fireEvent.pointerDown(header("explorer"), { button: 0, clientX: 150, clientY: 50 });
    dragTo(650, 330);
    expect(indicator()?.style).toMatchObject({ left: "300px", top: "317px", width: "700px" });
    await release(650, 330);
    expect(stackOf(latest(), "refs")?.sections).toEqual(["citations", "explorer", "bib"]);
    expect(host("explorer")).toHaveAttribute("data-shown", "true");
    expect(screen.getByLabelText("Field explorer")).toHaveValue("kept");
    expect(mounts.get("explorer")).toBe(1);
  });

  it("drags a tab into a stack as a section", async () => {
    dockGeometry();
    const { latest } = renderHarness(dockLayout());
    fireEvent.pointerDown(tab("preview"), { button: 0, clientX: 450, clientY: 18 });
    dragTo(150, 250);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "stack");
    await release(150, 250);
    expect(stackOf(latest(), "files")?.sections).toEqual(["explorer", "preview", "outline", "structure"]);
    expect(host("preview")).toHaveAttribute("role", "region");
    expect(mounts.get("preview")).toBe(1);
  });

  it("drops a tab on the icon bar as a new stack", async () => {
    dockGeometry();
    const { latest } = renderHarness(dockLayout());
    fireEvent.pointerDown(tab("preview"), { button: 0, clientX: 450, clientY: 18 });
    dragTo(200, 18);
    expect(indicator()?.style).toMatchObject({ left: "61px", width: "2px" });
    await release(200, 18);
    expect(groupOfView(latest(), "preview")).toMatchObject({ id: "g1", views: ["files", "search", "stack-1"], active: "stack-1" });
    expect(within(strip("g1")).getByRole("tab", { name: "Title preview" })).toBeInTheDocument();
  });

  it("adds a view to a lone section's stack at its top or bottom edge", async () => {
    geometry = {
      root: { left: 0, top: 0, width: 1000, height: 600 },
      "split:s1": { left: 0, top: 0, width: 1000, height: 600 },
      "strip:g1": { left: 0, top: 0, width: 300, height: 36 },
      "slot:g1": { left: 0, top: 36, width: 300, height: 564 },
      "strip:g2": { left: 300, top: 0, width: 700, height: 36 },
      "tab:editor": { left: 300, top: 0, width: 100, height: 36 },
      "tab:preview": { left: 400, top: 0, width: 100, height: 36 },
      "slot:g2": { left: 300, top: 36, width: 700, height: 564 },
    };
    const layout = createLayout(
      split("s1", "row", [group("g1", ["k"], "k", { presentation: "icons" }), group("g2", ["editor", "preview"])]),
      views("only", "editor", "preview"),
      null,
      { k: stack(["only"]) },
    );
    const { latest } = renderHarness(layout);
    fireEvent.pointerDown(tab("editor"), { button: 0, clientX: 350, clientY: 18 });
    dragTo(150, 40);
    expect(indicator()?.style).toMatchObject({ top: "36px", height: "2px" });
    dragTo(150, 300);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    dragTo(150, 596);
    expect(indicator()?.style).toMatchObject({ top: "598px" });
    await release(150, 596);
    expect(stackOf(latest(), "k")?.sections).toEqual(["only", "editor"]);
    fireEvent.pointerDown(tab("preview"), { button: 0, clientX: 450, clientY: 18 });
    dragTo(150, 300);
    await release(150, 300);
    expect(groupOfView(latest(), "preview")).toMatchObject({ id: "g1", views: ["k", "stack-1"] });
  });

  it("starts no drag from a section's actions and swallows the click that ends a drag", async () => {
    dockGeometry();
    const { onChange } = renderHarness(dockLayout(), { describeView: dockDescribe });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Refresh outline" }), { button: 0, clientX: 280, clientY: 250 });
    dragTo(150, 40);
    expect(ghost()).toBeNull();
    pointer("pointerup", 150, 40);
    fireEvent.pointerDown(header("outline"), { button: 0, clientX: 150, clientY: 250 });
    dragTo(1200, 700);
    expect(ghost()).toHaveTextContent("Title outline");
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 1200, clientY: 700, bubbles: true }));
      fireEvent.click(toggle("outline"));
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Workspace hidden groups", () => {
  it("lays out without a hidden group and keeps its views mounted out of sight", () => {
    dockGeometry();
    const { update } = renderStatic(dockLayout(), { leading: <span>{"Lead"}</span> });
    expect(host("explorer")).toHaveAttribute("data-shown", "true");
    update(setGroupHidden(dockLayout(), "g1", true));
    expect(document.querySelector('[data-group="g1"]')).toBeNull();
    expect(separators()).toHaveLength(0);
    expect(host("explorer")).toHaveAttribute("data-shown", "false");
    expect(host("explorer")).not.toHaveAttribute("hidden");
    expect(host("explorer").style.top).toBe("68px");
    expect(within(groupElement("g2")).getByText("Lead")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Maximize group" })).toBeNull();
    update(dockLayout());
    expect(host("explorer")).toHaveAttribute("data-shown", "true");
    expect(mounts.get("explorer")).toBe(1);
    expect([...mounts.values()].every((count) => count === 1)).toBe(true);
  });

  it("never measures a view whose group starts hidden", () => {
    renderStatic(setGroupHidden(dockLayout(), "g1", true));
    expect(host("explorer")).toHaveAttribute("hidden");
  });

  it("drops a split whose groups are all hidden and shows nothing for a hidden root", () => {
    const layout = createLayout(
      split("s1", "row", [group("g1", ["a"]), split("s2", "column", [group("g2", ["b"], "b", { hidden: true }), group("g3", ["c"], "c", { hidden: true })])]),
      views("a", "b", "c"),
    );
    renderStatic(layout, { trailing: <span>{"Trail"}</span> });
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(within(groupElement("g1")).getByText("Trail")).toBeInTheDocument();
    expect(separators()).toHaveLength(0);
    cleanup();
    renderStatic(createLayout(group("g1", ["a"], "a", { hidden: true }), views("a")));
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("puts a splitter between the panes on either side of a hidden one and evens them", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 1000, height: 600 } };
    const layout = createLayout(
      split("s1", "row", [group("g1", ["a"]), group("g2", ["b"], "b", { hidden: true }), group("g3", ["c"])], [0.3, 0.3, 0.4]),
      views("a", "b", "c"),
    );
    const { latest } = renderHarness(layout);
    expect(separators()).toHaveLength(1);
    expect(separators()[0]).toHaveAttribute("aria-valuenow", "43");
    fireEvent.keyDown(separators()[0], { key: "ArrowRight" });
    const weights = (latest().root as SplitNode).weights.map((weight) => Number(weight.toFixed(4)));
    expect(weights).toEqual([0.314, 0.3, 0.386]);
    fireEvent.doubleClick(separators()[0]);
    expect((latest().root as SplitNode).weights.map((weight) => Number(weight.toFixed(4)))).toEqual([0.35, 0.3, 0.35]);
  });

  it("gives the shown panes the whole split while a pane is hidden", () => {
    const layout = createLayout(
      split("s1", "row", [group("g1", ["a"]), group("g2", ["b"], "b", { hidden: true }), group("g3", ["c"])], [0.2, 0.5, 0.3]),
      views("a", "b", "c"),
    );
    renderStatic(layout);
    const panes = [...(document.querySelector('[data-split="s1"]')?.children ?? [])] as HTMLElement[];
    expect(panes.map((pane) => pane.style.flex)).toEqual(["0.4 1 0px", "0.6 1 0px"]);
  });

  it("shares a split evenly when every shown pane has no weight", () => {
    renderStatic(createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])], [0, 0]), views("a", "b")));
    const panes = [...(document.querySelector('[data-split="s1"]')?.children ?? [])] as HTMLElement[];
    expect(panes.map((pane) => pane.style.flex)).toEqual(["0.5 1 0px", "0.5 1 0px"]);
  });
});

describe("Workspace minimum sizes", () => {
  it("keeps a pane as wide as the widest view in it needs", () => {
    dockGeometry();
    const { latest } = renderHarness(dockLayout([0.45, 0.55]), { describeView: dockDescribe });
    const separator = document.querySelector<HTMLElement>('[data-splitter="s1"]');
    if (!separator) throw new Error("no separator");
    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true });
    expect((latest().root as SplitNode).weights.map((weight) => Number(weight.toFixed(4)))).toEqual([0.52, 0.48]);
  });

  it("keeps a pane as tall as its views need, counting expanded sections only", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 800, height: 600 } };
    const describe = (id: string) => ({ title: `Title ${id}`, minHeight: id === "a" || id === "b" ? 150 : id === "c" ? 300 : undefined });
    const layout = createLayout(
      split("s1", "column", [group("g1", ["k"]), group("g2", ["c"])], [0.5, 0.5]),
      views("a", "b", "c"),
      null,
      { k: stack(["a", "b"], { collapsed: ["b"] }) },
    );
    const { latest } = renderHarness(layout, { describeView: describe });
    fireEvent.keyDown(separators().find((element) => element.hasAttribute("data-splitter")) as HTMLElement, { key: "ArrowDown", shiftKey: true });
    expect((latest().root as SplitNode).weights.map((weight) => Number(weight.toFixed(4)))).toEqual([0.44, 0.56]);
    fireEvent.keyDown(separators().find((element) => element.hasAttribute("data-splitter")) as HTMLElement, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(separators().find((element) => element.hasAttribute("data-splitter")) as HTMLElement, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(separators().find((element) => element.hasAttribute("data-splitter")) as HTMLElement, { key: "ArrowUp", shiftKey: true });
    expect((latest().root as SplitNode).weights.map((weight) => Number(weight.toFixed(4)))).toEqual([0.31, 0.69]);
  });
});

describe("Workspace visible views", () => {
  it("reports the views on screen once at mount and whenever they change", () => {
    const onVisibleViewsChange = vi.fn();
    renderHarness(dockLayout(), { onVisibleViewsChange });
    expect(onVisibleViewsChange).toHaveBeenCalledTimes(1);
    expect(onVisibleViewsChange).toHaveBeenLastCalledWith(["explorer", "outline", "editor"]);
    fireEvent.click(tab("preview"));
    expect(onVisibleViewsChange).toHaveBeenLastCalledWith(["explorer", "outline", "preview"]);
    fireEvent.click(toggle("structure"));
    expect(onVisibleViewsChange).toHaveBeenLastCalledWith(["explorer", "outline", "structure", "preview"]);
    expect(onVisibleViewsChange).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(document.querySelector("[data-section-splitter]") as HTMLElement, { key: "ArrowDown" });
    expect(onVisibleViewsChange).toHaveBeenCalledTimes(3);
  });

  it("works without a visibility callback", () => {
    expect(() => renderHarness(dockLayout())).not.toThrow();
  });
});

describe("Workspace stacks keep views mounted", () => {
  it("keeps every view mounted while sections collapse, move, become tabs and hide", () => {
    dockGeometry();
    const { update } = renderStatic(dockLayout());
    let layout = dockLayout();
    const steps: ((current: WorkspaceLayout) => WorkspaceLayout)[] = [
      (current) => toggleSection(current, "files", "explorer"),
      (current) => moveView(current, "outline", { stackId: "files", index: 0 }),
      (current) => moveView(current, "outline", { groupId: "g2", zone: "center" }),
      (current) => moveView(current, "preview", { stackId: "files", index: 1 }),
      (current) => moveView(current, "editor", { groupId: "g1", zone: "center" }),
      (current) => moveView(current, "files", { groupId: "g2", zone: "right" }),
      (current) => setGroupHidden(current, "g1", true),
      (current) => toggleMaximize(current, groupOfView(current, "explorer")?.id ?? ""),
    ];
    const shownOnce = new Set<string>();
    const noteShown = () => {
      for (const element of document.querySelectorAll<HTMLElement>('[data-view][data-shown="true"]')) shownOnce.add(element.dataset.view ?? "");
    };
    noteShown();
    for (const step of steps) {
      layout = step(layout);
      update(layout);
      noteShown();
    }
    expect([...mounts.keys()].sort()).toEqual([...shownOnce].sort());
    expect([...mounts.values()].every((count) => count === 1)).toBe(true);
    expect(unmounts.size).toBe(0);
  });
});

describe("Workspace tooltips", () => {
  it("wraps the maximize button in the app's tooltip instead of a title", () => {
    renderHarness(twoGroups(), { renderTooltip: tooltip });
    const maximize = within(groupElement("g1")).getByRole("button", { name: "Maximize group" });
    expect(maximize).not.toHaveAttribute("title");
    expect(maximize.closest("[data-tooltip]")).toHaveAttribute("data-tooltip", "Maximize group");
  });

  it("gives every icon button and every tab title the app's tooltip, and no native titles", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["a", "b"]), group("g2", ["c"]), group("g3", [])]), views("a", "b", "c"), "g3");
    renderHarness(layout, { renderTooltip: tooltip, onNewTab: vi.fn() });
    const hint = (element: HTMLElement) => element.closest("[data-tooltip]")?.getAttribute("data-tooltip");
    expect(hint(within(groupElement("g1")).getByRole("button", { name: "New tab" }))).toBe("New tab");
    expect(hint(within(groupElement("g3")).getByRole("button", { name: "Close panel" }))).toBe("Close panel");
    expect(hint(tab("a"))).toBe("Title a");
    expect(hint(tab("b"))).toBe("Title b");
    expect(hint(screen.getByRole("button", { name: "Close Title a" }))).toBe("Close Title a");
    expect(tab("a").closest("[data-tooltip]")).toHaveClass("min-w-0");
    expect(document.querySelectorAll("[title]")).toHaveLength(0);
  });

  it("keeps tab titles and buttons plain without a tooltip renderer", () => {
    renderHarness(twoGroups(), { onNewTab: vi.fn() });
    expect(document.querySelectorAll("[data-tooltip]")).toHaveLength(0);
    expect(document.querySelectorAll("[title]")).toHaveLength(0);
    expect(tab("a").parentElement).toHaveAttribute("data-tab-view", "a");
  });
});

describe("Workspace trailing content", () => {
  it("keeps the trailing content out of the bar area that clips when the group gets narrow", () => {
    const chromeAttributes = { "data-chrome": "drag" };
    const windowMenu = "Window menu";
    renderHarness(twoGroups(), { chromeAttributes, trailing: <button type="button" aria-label={windowMenu} /> });
    const menu = within(groupElement("g2")).getByRole("button", { name: windowMenu });
    const holder = menu.closest("[data-trailing]");
    expect(holder).toHaveClass("shrink-0");
    expect(holder).toHaveAttribute("data-chrome", "drag");
    expect(menu.closest("[data-group-actions]")).toBeNull();
    const maximize = within(groupElement("g2")).getByRole("button", { name: "Maximize group" });
    expect(maximize.closest("[data-group-actions]")).toHaveClass("min-w-0", "overflow-hidden");
    expect(within(groupElement("g1")).queryByRole("button", { name: windowMenu })).toBeNull();
    expect(groupElement("g1").querySelector("[data-trailing]")).toBeNull();
  });

  it("draws no trailing holder for empty trailing content", () => {
    renderHarness(twoGroups(), { trailing: null });
    expect(document.querySelector("[data-trailing]")).toBeNull();
  });
});

describe("Workspace drag frames", () => {
  it("updates a tab drag once per animation frame and lands on the last position", async () => {
    twoGroupGeometry();
    const { latest } = renderHarness(twoGroups());
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    pointer("pointermove", 300, 368);
    pointer("pointermove", 700, 368);
    expect(ghost()).toBeNull();
    expect(frames.size).toBe(1);
    flushFrames();
    expect(ghost()?.style).toMatchObject({ left: "712px", top: "376px" });
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    pointer("pointermove", 880, 300);
    await release(880, 300);
    expect(groupOfView(latest(), "a")).toMatchObject({ views: ["a"] });
    expect(groupOfView(latest(), "a")?.id).not.toBe("g1");
  });

  it("reads the tab geometry once when the drag starts, not on every move", () => {
    twoGroupGeometry();
    renderHarness(twoGroups());
    const reads = () =>
      vi.mocked(Element.prototype.getBoundingClientRect).mock.contexts.filter((element) => (element as Element).hasAttribute("data-tab-view")).length;
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 120, clientY: 60 });
    const before = reads();
    dragTo(250, 60);
    const first = reads();
    expect(first).toBeGreaterThan(before);
    dragTo(300, 60);
    dragTo(700, 368);
    dragTo(260, 60);
    expect(reads()).toBe(first);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "center");
    pointer("pointerup", 260, 60);
  });
});

describe("Workspace hidden view retention", () => {
  function oneGroup(): WorkspaceLayout {
    return createLayout(group("g1", ["a", "b", "c", "d"]), views("a", "b", "c", "d"));
  }

  function showInTurn(update: (layout: WorkspaceLayout) => void, ...ids: string[]): WorkspaceLayout {
    let layout = oneGroup();
    for (const id of ids) {
      layout = activate(layout, id);
      update(layout);
    }
    return layout;
  }

  it("keeps only the most recently shown hidden views mounted and builds a released one again", () => {
    const { update } = renderStatic(oneGroup(), { keepHidden: 1 });
    showInTurn(update, "b", "c");
    expect(screen.queryByTestId("content-a")).toBeNull();
    expect(screen.getByTestId("content-b")).toBeInTheDocument();
    expect(screen.getByTestId("content-c")).toBeInTheDocument();
    expect(unmounts.get("a")).toBe(1);
    expect(panel("a")).toHaveAttribute("data-shown", "false");
    update(activate(oneGroup(), "a"));
    expect(screen.getByTestId("content-a")).toBeInTheDocument();
    expect(mounts.get("a")).toBe(2);
    expect(screen.getByTestId("content-c")).toBeInTheDocument();
    expect(screen.queryByTestId("content-b")).toBeNull();
    expect(screen.queryByTestId("content-d")).toBeNull();
  });

  it("keeps a hidden view mounted while the app cannot release it", () => {
    const busy = new Set(["a"]);
    const canRelease = (id: string) => !busy.has(id);
    const { update } = renderStatic(oneGroup(), { keepHidden: 0, canRelease });
    showInTurn(update, "b", "c");
    expect(screen.getByTestId("content-a")).toBeInTheDocument();
    expect(screen.queryByTestId("content-b")).toBeNull();
    busy.clear();
    update(activate(oneGroup(), "d"));
    expect(screen.queryByTestId("content-a")).toBeNull();
    expect(screen.queryByTestId("content-c")).toBeNull();
    expect(screen.getByTestId("content-d")).toBeInTheDocument();
  });

  it("forgets a closed view so it is not kept or counted", () => {
    const { update } = renderStatic(oneGroup(), { keepHidden: 1 });
    const layout = showInTurn(update, "b", "a");
    update(activate({ ...layout, root: group("g1", ["b", "c", "d"]), views: views("b", "c", "d") }, "c"));
    expect(screen.queryByTestId("content-a")).toBeNull();
    expect(screen.getByTestId("content-b")).toBeInTheDocument();
    expect(screen.getByTestId("content-c")).toBeInTheDocument();
  });
});

describe("Workspace dock edge cases", () => {
  it("measures the minimum of a nested split from the views inside it", () => {
    geometry = { "split:s1": { left: 0, top: 0, width: 1000, height: 600 } };
    const describe = (id: string) => ({ title: `Title ${id}`, minWidth: id === "b" || id === "c" ? 300 : id === "d" ? 400 : undefined });
    const nested = createLayout(split("s1", "row", [group("g1", ["a"]), split("s2", "column", [group("g2", ["d"]), group("g3", ["b"])])]), views("a", "b", "d"));
    const first = renderHarness(nested, { describeView: describe });
    const outer = () => document.querySelector<HTMLElement>('[data-splitter="s1"]') as HTMLElement;
    fireEvent.keyDown(outer(), { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(outer(), { key: "ArrowRight", shiftKey: true });
    expect((first.latest().root as SplitNode).weights.map((weight) => Number(weight.toFixed(4)))).toEqual([0.6, 0.4]);
    cleanup();
    const raw: WorkspaceLayout = {
      schema: 1,
      root: split("s1", "row", [group("g1", ["a"]), { kind: "split", id: "s2", direction: "row", children: [group("g2", ["b"]), group("g3", ["c"])], weights: [0.5, 0.5] }]),
      views: views("a", "b", "c"),
      maximized: null,
    };
    const second = renderHarness(raw, { describeView: describe });
    fireEvent.keyDown(outer(), { key: "ArrowRight" });
    expect((second.latest().root as SplitNode).weights.map((weight) => Number(weight.toFixed(4)))).toEqual([0.4, 0.6]);
  });

  it("ignores stacks in hidden, off-screen and other groups while dragging", async () => {
    geometry = {
      root: { left: 0, top: 0, width: 900, height: 600 },
      "strip:g1": { left: 300, top: 0, width: 600, height: 36 },
      "tab:a": { left: 300, top: 0, width: 80, height: 36 },
      "tab:b": { left: 380, top: 0, width: 80, height: 36 },
      "slot:g0": { left: 0, top: 36, width: 300, height: 564 },
      "slot:g1": { left: 300, top: 36, width: 600, height: 564 },
    };
    const layout = createLayout(
      split("s1", "row", [group("g0", ["k"]), group("g1", ["a", "b"]), group("g2", ["j"], "j", { hidden: true })]),
      views("only", "a", "b", "other"),
      null,
      { k: stack(["only"]), j: stack(["other"]) },
    );
    const { latest } = renderHarness(layout);
    fireEvent.pointerDown(tab("b"), { button: 0, clientX: 420, clientY: 18 });
    dragTo(880, 300);
    expect(indicator()).toHaveAttribute("data-drop-indicator", "right");
    await release(880, 300);
    expect(groupOfView(latest(), "b")?.views).toEqual(["b"]);
    cleanup();
    const { latest: after } = renderHarness(toggleMaximize(layout, "g1"));
    fireEvent.pointerDown(tab("b"), { button: 0, clientX: 420, clientY: 18 });
    dragTo(880, 300);
    await release(880, 300);
    expect(groupOfView(after(), "b")?.views).toEqual(["b"]);
  });

  it("drops a tab at the start of an empty tab strip", async () => {
    geometry = {
      root: { left: 0, top: 0, width: 900, height: 600 },
      "strip:g1": { left: 0, top: 0, width: 500, height: 36 },
      "tab:a": { left: 0, top: 0, width: 80, height: 36 },
      "tab:b": { left: 80, top: 0, width: 80, height: 36 },
      "strip:g2": { left: 500, top: 0, width: 400, height: 36 },
    };
    const { latest } = renderHarness(createLayout(split("s1", "row", [group("g1", ["a", "b"]), group("g2", [])]), views("a", "b"), "g2"));
    fireEvent.pointerDown(tab("a"), { button: 0, clientX: 20, clientY: 18 });
    dragTo(700, 18);
    expect(indicator()?.style).toMatchObject({ left: "500px", width: "2px" });
    await release(700, 18);
    expect(groupOfView(latest(), "a")?.id).toBe("g2");
  });

  it("dims an icon tab while it is dragged", () => {
    dockGeometry();
    renderHarness(dockLayout());
    fireEvent.pointerDown(screen.getByRole("tab", { name: "Title search" }), { button: 0, clientX: 48, clientY: 18 });
    dragTo(700, 300);
    expect(screen.getByRole("tab", { name: "Title search" })).toHaveClass("opacity-50");
  });

  it("describes a section's count badge and shows nothing for an empty title", () => {
    const describe = (id: string) => ({ title: id === "search" ? "  " : `Title ${id}`, badge: id === "outline" ? 4 : undefined, badgeLabel: id === "outline" ? "4 headings" : undefined });
    renderHarness(dockLayout(), { describeView: describe });
    expect(toggle("outline")).toHaveAccessibleDescription("4 headings");
    expect(within(header("outline")).getByText("4")).toBeInTheDocument();
    const blank = document.querySelector<HTMLElement>('[data-tab-view="search"] [role="tab"]');
    expect(blank?.textContent).toBe("");
  });

  it("renders nothing for a column whose groups are all hidden", () => {
    const layout = createLayout(
      split("s1", "column", [group("g1", ["a"], "a", { hidden: true }), group("g2", ["b"], "b", { hidden: true })]),
      views("a", "b"),
    );
    renderStatic(layout, { leading: <span>{"Lead"}</span>, chromeAttributes: { "data-chrome": "drag" } });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Lead")).toBeNull();
    expect(host("a")).toHaveAttribute("data-shown", "false");
  });
});
