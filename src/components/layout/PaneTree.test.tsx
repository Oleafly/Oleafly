// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PANE_LAYOUT, movePane, type PaneId, type PaneShown, type PaneSplit } from "@/store/pane-layout";
import { PaneTreeGroup, PaneTreeProvider, type PaneTreeConfig } from "./PaneTree";

vi.mock("react-resizable-panels", () => ({
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: () => undefined }),
  Group: ({
    children,
    orientation,
    elementRef,
  }: {
    children?: ReactNode;
    orientation: string;
    elementRef?: (element: HTMLDivElement | null) => void;
  }) => (
    <div ref={elementRef} data-group="" data-orientation={orientation}>
      {children}
    </div>
  ),
  Panel: ({
    children,
    id,
    minSize,
    maxSize,
    collapsible,
    defaultSize,
    groupResizeBehavior,
    className,
  }: {
    children?: ReactNode;
    id: string;
    minSize?: string;
    maxSize?: string;
    collapsible?: boolean;
    defaultSize?: string;
    groupResizeBehavior?: string;
    className?: string;
  }) => (
    <div
      data-panel=""
      id={id}
      data-min={minSize}
      data-max={maxSize}
      data-collapsible={String(collapsible)}
      data-size={defaultSize ?? ""}
      data-behavior={groupResizeBehavior ?? ""}
      data-class={className}
    >
      {children}
    </div>
  ),
  Separator: ({ id }: { id: string }) => <div data-separator="" id={id} />,
}));

const ALL: PaneShown = { sidebar: true, editor: true, pdf: true, terminal: true, assistant: true };

function hosts(): Record<PaneId, HTMLElement> {
  return {
    sidebar: document.createElement("div"),
    editor: document.createElement("div"),
    pdf: document.createElement("div"),
    terminal: document.createElement("div"),
    assistant: document.createElement("div"),
  };
}

function config(overrides: Partial<PaneTreeConfig> = {}): PaneTreeConfig {
  return {
    projectId: "p1",
    shown: ALL,
    workspaceHidden: false,
    appFontSize: 16,
    hosts: hosts(),
    separatorHitArea: { coarse: 36, fine: 16 },
    rootRef: createRef<HTMLDivElement>(),
    onAssistantDismiss: () => undefined,
    onTerminalDismiss: () => undefined,
    ...overrides,
  };
}

function renderTree(layout: PaneSplit, overrides: Partial<PaneTreeConfig> = {}) {
  return render(
    <PaneTreeProvider value={config(overrides)}>
      <PaneTreeGroup node={layout} root />
    </PaneTreeProvider>,
  );
}

function panel(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`${id} is not rendered`);
  return element;
}

function separators(): string[] {
  return [...document.querySelectorAll("[data-separator]")].map((element) => element.id);
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("PaneTreeGroup", () => {
  it("needs a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<PaneTreeGroup node={DEFAULT_PANE_LAYOUT} root />)).toThrow();
  });

  it("gives the default panels their sizes and limits and lets the document take the rest", () => {
    renderTree(DEFAULT_PANE_LAYOUT);
    expect(panel("sidebar").dataset).toMatchObject({ min: "250px", max: "65%", size: "15%", behavior: "preserve-pixel-size" });
    expect(panel("assistant").dataset).toMatchObject({ min: "22%", max: "55%", collapsible: "true", size: "28%" });
    expect(panel("editorpdf").dataset).toMatchObject({ size: "", behavior: "" });
    expect(panel("editor").dataset).toMatchObject({ min: "15%", size: "" });
    expect(panel("pdf").dataset).toMatchObject({ min: "15%", size: "50%" });
    expect(panel("content-band").dataset).toMatchObject({ min: "25%", size: "" });
    expect(panel("terminal").dataset).toMatchObject({ min: "10%", collapsible: "true", size: "28%" });
    expect(separators()).toEqual(["h-tree", "h-mid", "h-assistant", "v-terminal"]);
    expect(panel("content-band").parentElement?.dataset.orientation).toBe("vertical");
  });

  it("opens the terminal at the height the project remembers", () => {
    localStorage.setItem("oleafly.panel-expand-sizes.oleafly.workspace.p1.vertical", JSON.stringify({ terminal: 40 }));
    renderTree(DEFAULT_PANE_LAYOUT);
    expect(panel("terminal").dataset.size).toBe("40%");
  });

  it("leaves the closed terminal and its separator out", () => {
    renderTree(DEFAULT_PANE_LAYOUT, { shown: { ...ALL, terminal: false } });
    expect(document.getElementById("terminal")).toBeNull();
    expect(separators()).toEqual(["h-tree", "h-mid", "h-assistant"]);
  });

  it("keeps the sidebar's pixel width in a row and when it is stacked with another pane", () => {
    const stacked = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "pane", pane: "sidebar", side: "bottom" });
    renderTree(stacked);
    expect(panel("s1").dataset.behavior).toBe("preserve-pixel-size");
    expect(panel("sidebar").dataset).toMatchObject({ min: "10%", behavior: "" });
    expect(separators()).toContain("sep-sidebar-terminal");
  });

  it("lets the assistant collapse in a stack and starts it from the tree's share", () => {
    const stacked = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "pdf", side: "bottom" });
    renderTree(stacked);
    expect(panel("assistant").dataset).toMatchObject({ min: "15%", max: "85%", collapsible: "true", size: "50%" });
    expect(panel("pdf").parentElement?.dataset.orientation).toBe("vertical");
  });

  it("keeps the assistant's pixel minimum in a nested row", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
          this.callback([{ target, contentRect: { width: 1200, height: 800 } } as unknown as ResizeObserverEntry], this as never);
        }
        disconnect() {}
      },
    );
    const nested = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "pdf", side: "right" });
    renderTree(nested);
    expect(Number.parseFloat(panel("assistant").dataset.min ?? "")).toBeCloseTo((480 / 1188) * 100, 3);
    expect(Number.parseFloat(panel("sidebar").dataset.size ?? "")).toBeCloseTo((340 / 1188) * 100, 3);
  });

  it("lets a pane that is alone in its group take the whole group", () => {
    const paired = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "terminal", side: "right" });
    renderTree(paired, { shown: { ...ALL, terminal: false } });
    expect(panel("assistant").dataset).toMatchObject({ max: "100%", size: "" });
    expect(document.getElementById("terminal")).toBeNull();
  });
});
