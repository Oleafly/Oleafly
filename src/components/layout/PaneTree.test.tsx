// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { DEFAULT_PANE_LAYOUT, movePane, type PaneId, type PaneShown, type PaneSplit } from "@/store/pane-layout";
import { PaneTreeGroup, PaneTreeProvider, type PaneTreeConfig } from "./PaneTree";

vi.mock("react-resizable-panels", () => ({
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: () => undefined }),
  Group: ({ children, id, orientation, defaultLayout }: { children?: ReactNode; id?: string; orientation: string; defaultLayout?: object }) => (
    <div data-group="" data-dom-id={id ?? ""} data-orientation={orientation} data-default={JSON.stringify(defaultLayout ?? null)}>
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
  Separator: ({ id, disabled, className }: { id: string; disabled?: boolean; className?: string }) => (
    <div data-separator="" id={id} data-disabled={disabled === undefined ? "unset" : String(disabled)} data-class={className} />
  ),
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
    terminalOpen: true,
    workspaceHidden: false,
    showTree: true,
    documentDefaultSize: 50,
    sidebarDefaultSize: 20,
    sidebarMinSize: 15,
    assistantMinSize: 22,
    assistantDefaultSize: 28,
    hosts: hosts(),
    panelRefs: {
      sidebar: createRef<PanelImperativeHandle>(),
      editor: createRef<PanelImperativeHandle>(),
      pdf: createRef<PanelImperativeHandle>(),
      terminal: createRef<PanelImperativeHandle>(),
      assistant: createRef<PanelImperativeHandle>(),
    },
    separatorHitArea: { coarse: 36, fine: 16 },
    rootRef: createRef<HTMLDivElement>(),
    onAssistantDismiss: () => undefined,
    onTerminalCollapse: () => undefined,
    onTerminalExpand: () => undefined,
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

describe("PaneTreeGroup", () => {
  it("needs a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<PaneTreeGroup node={DEFAULT_PANE_LAYOUT} root />)).toThrow();
  });

  it("gives the default panels their fixed sizes and limits", () => {
    renderTree(DEFAULT_PANE_LAYOUT);
    expect(panel("sidebar").dataset).toMatchObject({ min: "250px", max: "65%", size: "20%", behavior: "preserve-pixel-size" });
    expect(panel("assistant").dataset).toMatchObject({ min: "22%", max: "55%", collapsible: "true", size: "28%" });
    expect(panel("editorpdf").dataset).toMatchObject({ size: "85%", behavior: "" });
    expect(panel("editor").dataset).toMatchObject({ min: "15%", size: "50%" });
    expect(panel("content-band").dataset).toMatchObject({ min: "25%", size: "72%" });
    expect(panel("terminal").dataset).toMatchObject({ min: "10%", collapsible: "true", size: "28%" });
    expect(panel("h-tree").dataset.disabled).toBe("unset");
    expect(panel("v-terminal").dataset.disabled).toBe("false");
    const root = panel("content-band").parentElement as HTMLElement;
    expect(root.dataset).toMatchObject({ domId: "", orientation: "vertical" });
    expect(JSON.parse(root.dataset.default ?? "null")).toEqual({ "content-band": 72, terminal: 28 });
  });

  it("collapses the terminal separator and lets the band fill the window while the terminal is closed", () => {
    renderTree(DEFAULT_PANE_LAYOUT, { terminalOpen: false, shown: { ...ALL, terminal: false } });
    expect(panel("v-terminal").dataset.disabled).toBe("true");
    expect(panel("v-terminal").dataset.class).toContain("invisible");
    const root = panel("content-band").parentElement as HTMLElement;
    expect(JSON.parse(root.dataset.default ?? "null")).toEqual({ "content-band": 100, terminal: 0 });
  });

  it("keeps the sidebar's pixel width in a row and when it is stacked with another pane", () => {
    const stacked = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "pane", pane: "sidebar", side: "bottom" });
    renderTree(stacked);
    expect(panel("panes-sidebar-terminal").dataset.behavior).toBe("preserve-pixel-size");
    expect(panel("sidebar").dataset).toMatchObject({ min: "10%", behavior: "" });
    expect(panel("sep-sidebar-terminal").dataset.class).toContain("resize-handle-row");
  });

  it("lets the assistant collapse in a stack and shares a new group by the tree's sizes", () => {
    const stacked = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "pdf", side: "bottom" });
    renderTree(stacked);
    expect(panel("assistant").dataset).toMatchObject({ min: "15%", max: "85%", collapsible: "true", size: "50%" });
    expect(panel("assistant").dataset.class).toContain("border-t");
    const group = panel("pdf").parentElement as HTMLElement;
    expect(group.dataset.orientation).toBe("vertical");
    expect(group.dataset.domId).toBe("oleafly-panes-split-assistant-pdf-pdf-assistant");
    expect(JSON.parse(group.dataset.default ?? "null")).toEqual({ pdf: 50, assistant: 50 });
  });

  it("lets a pane that is alone in its group take the whole group", () => {
    const paired = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "terminal", side: "right" });
    renderTree(paired, { terminalOpen: false, shown: { ...ALL, terminal: false } });
    expect(panel("assistant").dataset).toMatchObject({ max: "100%", size: "100%" });
    expect(panel("terminal").dataset.size).toBe("0%");
    expect(panel("sep-assistant-terminal").dataset).toMatchObject({ disabled: "true" });
    expect(panel("sep-assistant-terminal").dataset.class).toContain("w-0");
  });

  it("borders the assistant on the side that faces its neighbours", () => {
    const first = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "sidebar", side: "left" });
    const view = renderTree(first);
    expect(panel("assistant").dataset.class).toContain("border-r");
    view.unmount();
    const middle = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "sidebar", side: "right" });
    renderTree(middle);
    expect(panel("assistant").dataset.class).toContain("border-x");
  });

  it("borders a stacked assistant above and below", () => {
    const top = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "pdf", side: "top" });
    const view = renderTree(top);
    expect(panel("assistant").dataset.class).toContain("border-b");
    view.unmount();
    const between = movePane(top, "terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    const second = renderTree(between);
    expect(panel("assistant").dataset.class).toContain("border-b");
    second.unmount();
    const middle = movePane(
      movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "pdf", side: "bottom" }),
      "terminal",
      { kind: "pane", pane: "assistant", side: "bottom" },
    );
    renderTree(middle);
    expect(panel("assistant").dataset.class).toContain("border-y");
  });
});
