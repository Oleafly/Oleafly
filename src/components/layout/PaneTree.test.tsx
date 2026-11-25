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

const ALL: PaneShown = { sidebar: true, editor: true, pdf: true, terminal: true, };

function hosts(): Record<PaneId, HTMLElement> {
  return {
    sidebar: document.createElement("div"),
    editor: document.createElement("div"),
    pdf: document.createElement("div"),
    terminal: document.createElement("div"),
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

  it("opens the terminal at the height the project remembers", () => {
    localStorage.setItem("oleafly.panel-expand-sizes.oleafly.workspace.p1.vertical", JSON.stringify({ terminal: 40 }));
    renderTree(DEFAULT_PANE_LAYOUT);
    expect(panel("terminal").dataset.size).toBe("40%");
  });

  it("leaves the closed terminal and its separator out", () => {
    renderTree(DEFAULT_PANE_LAYOUT, { shown: { ...ALL, terminal: false } });
    expect(document.getElementById("terminal")).toBeNull();
    expect(separators()).toEqual(["h-tree", "h-mid"]);
  });

  it("keeps the sidebar's pixel width in a row and when it is stacked with another pane", () => {
    const stacked = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "pane", pane: "sidebar", side: "bottom" });
    renderTree(stacked);
    expect(panel("s1").dataset.behavior).toBe("preserve-pixel-size");
    expect(panel("sidebar").dataset).toMatchObject({ min: "10%", behavior: "" });
    expect(separators()).toContain("sep-sidebar-terminal");
  });
});
