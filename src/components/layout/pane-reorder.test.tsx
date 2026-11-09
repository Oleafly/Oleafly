// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PANE_LAYOUT, layoutKey, usePaneLayoutStore, type PaneId } from "@/store/pane-layout";
import { PANE_BAR_CLASS, PaneReorderProvider, emptyBarTarget, paneOfElement, usePaneBar } from "./pane-reorder";

const clicked = vi.fn();

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

let terminalHeight = 150;

function rectOf(element: HTMLElement): DOMRect {
  if (element.dataset.testid === "root") return box(0, 40, 1000, 600);
  switch (element.id) {
    case "content-band":
      return box(0, 40, 1000, 450);
    case "sidebar":
      return box(0, 40, 250, 450);
    case "editorpdf":
      return box(250, 40, 500, 450);
    case "editor":
      return box(250, 40, 250, 450);
    case "pdf":
      return box(500, 40, 250, 450);
    case "assistant":
      return box(750, 40, 250, 450);
    case "terminal":
      return box(0, 490, 1000, terminalHeight);
    default:
      return box(0, 0, 0, 0);
  }
}

function Bar({ name, testId }: Readonly<{ name: string; testId?: string }>) {
  const bar = usePaneBar();
  return (
    <div {...bar} data-testid={testId ?? name} className={PANE_BAR_CLASS}>
      <button type="button">{`${name} button`}</button>
      <span data-testid={`${name} spacer`} />
      <div role="tab" tabIndex={-1} aria-selected={false} data-testid={`${name} tab`} />
      <input aria-label={`${name} input`} />
      <div data-state="closed" data-testid={`${name} trigger`}>
        <span data-testid={`${name} trigger label`} />
      </div>
    </div>
  );
}

const ALL: readonly PaneId[] = ["sidebar", "editor", "pdf", "terminal", "assistant"];

function Workspace({
  visible = ALL,
  attachRoot = true,
}: Readonly<{ visible?: readonly PaneId[]; attachRoot?: boolean }>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shows = (pane: PaneId) => visible.includes(pane);
  return (
    <PaneReorderProvider rootRef={rootRef} visiblePanes={visible}>
      <div ref={attachRoot ? rootRef : undefined} data-testid="root" data-group="">
        <div id="content-band" data-panel="">
          <div data-group="">
            {shows("sidebar") && (
              <div id="sidebar" data-panel="">
                <div id="files-panel">
                  <Bar name="sidebar" testId="project-sidebar-bar" />
                </div>
              </div>
            )}
            <div id="editorpdf" data-panel="">
              <div data-group="">
                {shows("editor") && (
                  <div id="editor" data-panel="">
                    <Bar name="editor" />
                  </div>
                )}
                {shows("pdf") && (
                  <div id="pdf" data-panel="">
                    <Bar name="pdf" />
                  </div>
                )}
              </div>
            </div>
            {shows("assistant") && (
              <div id="assistant" data-panel="">
                <div id="chat-split" data-panel="" data-testid="chat-surface">
                  <Bar name="assistant" testId="ai-assistant-header" />
                </div>
              </div>
            )}
          </div>
        </div>
        <div id="terminal" data-panel="">
          <Bar name="terminal" testId="terminal-tabs" />
        </div>
      </div>
      <button type="button" onClick={clicked}>
        {"after"}
      </button>
    </PaneReorderProvider>
  );
}

function drop(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-pane-drop]");
}

function overlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-pane-reorder='dragging']");
}

function press(target: HTMLElement, clientX: number, clientY = 60, init: PointerEventInit = {}) {
  return fireEvent.pointerDown(target, { button: 0, clientX, clientY, ...init });
}

function moveTo(clientX: number, clientY: number) {
  fireEvent.pointerMove(window, { clientX, clientY, buttons: 1 });
}

function drag(target: HTMLElement, from: readonly [number, number], ...path: (readonly [number, number])[]) {
  press(target, from[0], from[1]);
  for (const [x, y] of path) moveTo(x, y);
}

function layout(): string {
  return layoutKey(usePaneLayoutStore.getState().layout);
}

function nextTick() {
  return act(() => new Promise((resolve) => window.setTimeout(resolve, 0)));
}

beforeEach(() => {
  terminalHeight = 150;
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  localStorage.clear();
  clicked.mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return rectOf(this);
  });
});

afterEach(async () => {
  await nextTick();
  vi.restoreAllMocks();
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
});

describe("finding the pane of a bar", () => {
  it("walks up to the pane panel even when the bar and inner panels use their own ids", () => {
    render(<Workspace />);
    expect(paneOfElement(screen.getByTestId("ai-assistant-header"))).toBe("assistant");
    expect(paneOfElement(screen.getByTestId("project-sidebar-bar"))).toBe("sidebar");
    expect(paneOfElement(screen.getByTestId("editor"))).toBe("editor");
    expect(paneOfElement(screen.getByTestId("pdf"))).toBe("pdf");
    expect(paneOfElement(screen.getByTestId("terminal-tabs"))).toBe("terminal");
    expect(paneOfElement(screen.getByRole("button", { name: "after" }))).toBeNull();
    expect(paneOfElement(null)).toBeNull();
  });

  it("only counts the bar itself and plain spacers as empty", () => {
    render(<Workspace />);
    const bar = screen.getByTestId("project-sidebar-bar");
    expect(emptyBarTarget(bar, bar)).toBe(true);
    expect(emptyBarTarget(screen.getByTestId("sidebar spacer"), bar)).toBe(true);
    for (const target of [
      screen.getByRole("button", { name: "sidebar button" }),
      screen.getByTestId("sidebar tab"),
      screen.getByRole("textbox", { name: "sidebar input" }),
      screen.getByTestId("sidebar trigger"),
      screen.getByTestId("sidebar trigger label"),
      screen.getByTestId("assistant spacer"),
    ]) {
      expect(emptyBarTarget(target, bar)).toBe(false);
    }
    expect(emptyBarTarget(null, bar)).toBe(false);
    expect(emptyBarTarget(window, bar)).toBe(false);
  });

  it("treats a focusable bar as its own empty space", () => {
    const bar = document.createElement("div");
    bar.tabIndex = 0;
    const spacer = document.createElement("span");
    bar.append(spacer);
    expect(emptyBarTarget(spacer, bar)).toBe(true);
  });
});

describe("pane bars", () => {
  it("are plain outside the project workspace", () => {
    render(<Bar name="lonely" />);
    expect(screen.getByTestId("lonely")).not.toHaveAttribute("data-pane-bar");
  });

  it("show the grab cursor only over empty space of a pane that can move", () => {
    render(<Workspace />);
    const bar = screen.getByTestId("project-sidebar-bar");
    expect(bar).toHaveAttribute("data-pane-bar", "");
    fireEvent.pointerMove(bar);
    expect(bar).toHaveAttribute("data-pane-grab", "true");
    fireEvent.pointerMove(screen.getByRole("button", { name: "sidebar button" }));
    expect(bar).not.toHaveAttribute("data-pane-grab");
    fireEvent.pointerMove(screen.getByTestId("sidebar spacer"));
    expect(bar).toHaveAttribute("data-pane-grab", "true");
    fireEvent.pointerLeave(bar);
    expect(bar).not.toHaveAttribute("data-pane-grab");
    fireEvent.pointerMove(bar, { buttons: 1 });
    expect(bar).not.toHaveAttribute("data-pane-grab");
  });

  it("stay still while something is in full screen", () => {
    render(<Workspace />);
    const bar = screen.getByTestId("project-sidebar-bar");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => bar });
    try {
      fireEvent.pointerMove(bar);
      expect(bar).not.toHaveAttribute("data-pane-grab");
      drag(bar, [100, 60], [720, 260]);
      expect(overlay()).toBeNull();
    } finally {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
  });

  it("do not offer the only pane on screen or a hidden one", () => {
    render(<Workspace visible={["editor"]} />);
    const bar = screen.getByTestId("editor");
    fireEvent.pointerMove(bar);
    expect(bar).not.toHaveAttribute("data-pane-grab");
    drag(bar, [300, 60], [720, 260]);
    expect(overlay()).toBeNull();
    const terminal = screen.getByTestId("terminal-tabs");
    fireEvent.pointerMove(terminal);
    expect(terminal).not.toHaveAttribute("data-pane-grab");
  });
});

describe("dropping a pane", () => {
  it("shows a tinted box on the half of the pane it would take and moves it there", () => {
    render(<Workspace />);
    const bar = screen.getByTestId("project-sidebar-bar");
    expect(press(bar, 100, 60)).toBe(false);
    moveTo(720, 260);
    expect(drop()).toHaveAttribute("data-pane-drop", "pdf-right");
    expect(drop()).toHaveClass("rounded-md", "border-primary/60", "bg-primary/10", "pointer-events-none");
    expect(drop()?.style).toMatchObject({ left: "629px", top: "44px", width: "117px", height: "442px" });
    expect(overlay()).toHaveClass("cursor-grabbing");
    expect(bar).toHaveAttribute("data-pane-dragging", "true");

    moveTo(375, 70);
    expect(drop()).toHaveAttribute("data-pane-drop", "editor-top");
    expect(drop()?.style).toMatchObject({ left: "254px", top: "44px", width: "242px", height: "217px" });

    moveTo(720, 260);
    fireEvent.pointerUp(window);
    expect(overlay()).toBeNull();
    expect(bar).not.toHaveAttribute("data-pane-dragging");
    expect(layout()).toBe("column(row(row(editor,pdf,sidebar),assistant),terminal)");
  });

  it("offers a strip along each window edge for a new outer split", () => {
    render(<Workspace />);
    drag(screen.getByTestId("ai-assistant-header"), [900, 60], [10, 300]);
    expect(drop()).toHaveAttribute("data-pane-drop", "edge-left");
    expect(drop()?.style).toMatchObject({ left: "4px", top: "44px", width: "242px", height: "592px" });
    moveTo(500, 630);
    expect(drop()).toHaveAttribute("data-pane-drop", "edge-bottom");
    expect(drop()?.style).toMatchObject({ left: "4px", top: "494px", width: "992px", height: "142px" });
    fireEvent.pointerUp(window);
    expect(layout()).toBe("column(row(sidebar,row(editor,pdf)),terminal,assistant)");
  });

  it("stacks a pane under another from its bottom zone", () => {
    render(<Workspace />);
    drag(screen.getByTestId("terminal-tabs"), [500, 500], [625, 470]);
    expect(drop()).toHaveAttribute("data-pane-drop", "pdf-bottom");
    fireEvent.pointerUp(window);
    expect(layout()).toBe("row(sidebar,row(editor,column(pdf,terminal)),assistant)");
  });

  it("has no target in the middle of a pane, over the dragged pane, or outside the window", () => {
    render(<Workspace />);
    drag(screen.getByTestId("project-sidebar-bar"), [100, 60], [625, 265]);
    expect(overlay()).not.toBeNull();
    expect(drop()).toBeNull();
    moveTo(240, 260);
    expect(drop()).toBeNull();
    moveTo(1100, 300);
    expect(drop()).toBeNull();
    fireEvent.pointerUp(window);
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
    fireEvent.click(screen.getByRole("button", { name: "after" }));
    expect(clicked).not.toHaveBeenCalled();
  });

  it("skips a pane that takes no space", () => {
    terminalHeight = 0;
    render(<Workspace />);
    drag(screen.getByTestId("project-sidebar-bar"), [100, 60], [500, 560]);
    expect(drop()).toBeNull();
    fireEvent.pointerUp(window);
  });

  it("never starts from a control inside the bar", () => {
    render(<Workspace />);
    for (const target of [
      screen.getByRole("button", { name: "sidebar button" }),
      screen.getByTestId("sidebar tab"),
      screen.getByRole("textbox", { name: "sidebar input" }),
      screen.getByTestId("sidebar trigger label"),
    ]) {
      expect(press(target, 100)).toBe(true);
      moveTo(720, 260);
      expect(overlay()).toBeNull();
      fireEvent.pointerUp(window);
    }
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
  });

  it("leaves a press that something else already handled", () => {
    render(<Workspace />);
    const claim = (event: Event) => event.preventDefault();
    document.addEventListener("pointerdown", claim, true);
    try {
      drag(screen.getByTestId("project-sidebar-bar"), [100, 60], [720, 260]);
      expect(overlay()).toBeNull();
    } finally {
      document.removeEventListener("pointerdown", claim, true);
    }
  });

  it("ignores buttons other than the primary one", () => {
    render(<Workspace />);
    press(screen.getByTestId("ai-assistant-header"), 900, 60, { button: 2 });
    moveTo(100, 300);
    expect(overlay()).toBeNull();
  });

  it("does nothing without the project area on screen", () => {
    render(<Workspace attachRoot={false} />);
    drag(screen.getByTestId("project-sidebar-bar"), [100, 60], [720, 260]);
    expect(overlay()).toBeNull();
  });

  it("starts only after the pointer travels past the threshold in any direction", () => {
    render(<Workspace />);
    drag(screen.getByTestId("ai-assistant-header"), [900, 60], [903, 63], [896, 57]);
    expect(overlay()).toBeNull();
    moveTo(900, 70);
    expect(overlay()).not.toBeNull();
    fireEvent.pointerUp(window);
  });

  it("lets the click through after a press that never became a drag", () => {
    render(<Workspace />);
    drag(screen.getByTestId("ai-assistant-header"), [900, 60], [902, 61]);
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole("button", { name: "after" }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("swallows the click that ends a drag and lets the next one through", async () => {
    render(<Workspace />);
    drag(screen.getByTestId("ai-assistant-header"), [900, 60], [10, 300]);
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole("button", { name: "after" }));
    expect(clicked).not.toHaveBeenCalled();
    await nextTick();
    fireEvent.click(screen.getByRole("button", { name: "after" }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape and leaves the layout alone", () => {
    render(<Workspace />);
    const bar = screen.getByTestId("ai-assistant-header");
    drag(bar, [900, 60], [10, 300]);
    const escapeKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(escapeKey);
    });
    expect(escapeKey.defaultPrevented).toBe(true);
    expect(overlay()).toBeNull();
    expect(bar).not.toHaveAttribute("data-pane-dragging");
    fireEvent.pointerUp(window);
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
  });

  it("lets Escape and other keys through before the drag has started", () => {
    render(<Workspace />);
    press(screen.getByTestId("ai-assistant-header"), 900);
    const escapeKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const other = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(escapeKey);
      window.dispatchEvent(other);
    });
    expect(escapeKey.defaultPrevented).toBe(false);
    expect(other.defaultPrevented).toBe(false);
    fireEvent.pointerUp(window);
  });

  it("cancels when the window loses focus or the pointer is cancelled", async () => {
    render(<Workspace />);
    drag(screen.getByTestId("ai-assistant-header"), [900, 60], [10, 300]);
    fireEvent.blur(window);
    expect(overlay()).toBeNull();
    fireEvent.pointerUp(window);
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
    await nextTick();

    press(screen.getByTestId("project-sidebar-bar"), 100);
    fireEvent.pointerCancel(window);
    fireEvent.click(screen.getByRole("button", { name: "after" }));
    expect(clicked).toHaveBeenCalledTimes(1);

    drag(screen.getByTestId("project-sidebar-bar"), [100, 60], [720, 260]);
    fireEvent.pointerCancel(window);
    fireEvent.pointerUp(window);
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
  });

  it("restarts cleanly when a second drag begins and stops listening after unmount", () => {
    const view = render(<Workspace />);
    const assistant = screen.getByTestId("ai-assistant-header");
    const sidebar = screen.getByTestId("project-sidebar-bar");
    drag(assistant, [900, 60], [10, 300]);
    drag(sidebar, [100, 60], [720, 260]);
    expect(sidebar).toHaveAttribute("data-pane-dragging", "true");
    expect(assistant).not.toHaveAttribute("data-pane-dragging");
    view.unmount();
    fireEvent.pointerUp(window);
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
  });
});
