// @vitest-environment jsdom
import { useEffect, useMemo, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import {
  afterPanelLayout,
  collapsePanel,
  expandPanel,
  hasStoredPanelLayout,
  keyboardResizeLayout,
  migrateLegacyPanelLayout,
  panelExpandSizesKey,
  panelLayoutKey,
  panelLimitProps,
  percent,
  reevaluateLayout,
  useCollapseTransitions,
  useDismissiblePanelLayout,
  usePersistentPanelLayout,
  useSeparatorKeyboard,
  useSteadyPanelWidth,
  type PanelLimits,
} from "./panel-layout";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-panel") || this.hasAttribute("data-separator") ? 100 : 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function panelSize(id: string): number {
  const size = document.getElementById(id)?.style.flexGrow;
  return size ? Number(size) : -1;
}

describe("legacy layout migration", () => {
  it("rewrites every saved panel combination in panel order and keeps expand sizes", () => {
    localStorage.setItem(
      "react-resizable-panels:legacy-order",
      JSON.stringify({
        "assistant,editorpdf,sidebar": {
          expandToSizes: { assistant: 33 },
          layout: [20, 45, 35],
        },
        "editorpdf,sidebar": { expandToSizes: {}, layout: [25, 75] },
      }),
    );

    migrateLegacyPanelLayout("legacy-order", ["sidebar", "editorpdf", "assistant"]);

    expect(localStorage.getItem("react-resizable-panels:legacy-order")).toBeNull();
    expect(
      JSON.parse(
        localStorage.getItem(
          panelLayoutKey("legacy-order", ["sidebar", "editorpdf", "assistant"]),
        ) ?? "null",
      ),
    ).toEqual({ sidebar: 20, editorpdf: 45, assistant: 35 });
    expect(
      JSON.parse(
        localStorage.getItem(panelLayoutKey("legacy-order", ["sidebar", "editorpdf"])) ?? "null",
      ),
    ).toEqual({ sidebar: 25, editorpdf: 75 });
    expect(
      JSON.parse(localStorage.getItem(panelExpandSizesKey("legacy-order")) ?? "null"),
    ).toEqual({ assistant: 33 });
  });

  it("keeps a layout the new format already saved", () => {
    localStorage.setItem(
      panelLayoutKey("legacy-kept", ["a", "b"]),
      JSON.stringify({ a: 60, b: 40 }),
    );
    localStorage.setItem(
      "react-resizable-panels:legacy-kept",
      JSON.stringify({ "a,b": { expandToSizes: {}, layout: [10, 90] } }),
    );

    migrateLegacyPanelLayout("legacy-kept", ["a", "b"]);

    expect(
      JSON.parse(localStorage.getItem(panelLayoutKey("legacy-kept", ["a", "b"])) ?? "null"),
    ).toEqual({ a: 60, b: 40 });
  });

  it("leaves values it does not recognise untouched", () => {
    localStorage.setItem("react-resizable-panels:legacy-unknown", "{\"a\":40,\"b\":60}");
    migrateLegacyPanelLayout("legacy-unknown", ["a", "b"]);
    expect(localStorage.getItem("react-resizable-panels:legacy-unknown")).toBe(
      "{\"a\":40,\"b\":60}",
    );
  });

  it("reports a stored layout in either format", () => {
    expect(hasStoredPanelLayout("stored-probe")).toBe(false);
    localStorage.setItem(panelLayoutKey("stored-probe", ["a"]), "{\"a\":100}");
    expect(hasStoredPanelLayout("stored-probe")).toBe(true);
    localStorage.clear();
    localStorage.setItem("react-resizable-panels:stored-probe", "{}");
    expect(hasStoredPanelLayout("stored-probe")).toBe(true);
  });
});

const PERSISTENT_PANELS = ["b-first", "a-second"];
const PERSISTENT_LIMITS = { "b-first": {}, "a-second": {} } satisfies Record<string, PanelLimits>;

function PersistentHarness({ groupId }: Readonly<{ groupId: string }>) {
  const groupRef = useRef<GroupImperativeHandle>(null);
  const onKeyDown = useSeparatorKeyboard(groupRef, PERSISTENT_LIMITS);
  const { defaultLayout, onLayoutChanged } = usePersistentPanelLayout(
    groupId,
    PERSISTENT_PANELS,
    PERSISTENT_PANELS,
  );
  return (
    <Group groupRef={groupRef} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <Panel id="b-first" defaultSize={percent(50)} />
      <Separator id="persistent-handle" onKeyDownCapture={onKeyDown} />
      <Panel id="a-second" defaultSize={percent(50)} />
    </Group>
  );
}

function pressArrowRight() {
  const separator = screen.getByRole("separator");
  act(() => separator.focus());
  fireEvent.keyDown(separator, { key: "ArrowRight" });
}

describe("persistent panel layout", () => {
  it("opens with a layout saved by the previous library version", () => {
    localStorage.setItem(
      "react-resizable-panels:persisted-legacy",
      JSON.stringify({ "a-second,b-first": { expandToSizes: {}, layout: [30, 70] } }),
    );

    render(<PersistentHarness groupId="persisted-legacy" />);

    expect(panelSize("b-first")).toBe(30);
    expect(panelSize("a-second")).toBe(70);
  });

  it("migrates a saved layout once and then keeps the sizes chosen after it", () => {
    localStorage.setItem(
      "react-resizable-panels:persisted-once",
      JSON.stringify({ "a-second,b-first": { expandToSizes: {}, layout: [30, 70] } }),
    );
    const first = render(<PersistentHarness groupId="persisted-once" />);
    expect(localStorage.getItem("react-resizable-panels:persisted-once")).toBeNull();
    pressArrowRight();
    expect(panelSize("b-first")).toBe(40);
    first.unmount();

    render(<PersistentHarness groupId="persisted-once" />);

    expect(panelSize("b-first")).toBe(40);
    expect(panelSize("a-second")).toBe(60);
  });

  it("saves each change under the panel combination", () => {
    render(<PersistentHarness groupId="persisted-save" />);
    pressArrowRight();

    expect(
      JSON.parse(
        localStorage.getItem(panelLayoutKey("persisted-save", PERSISTENT_PANELS)) ?? "null",
      ),
    ).toEqual({ "b-first": 60, "a-second": 40 });
  });

  it("falls back to the default sizes when the saved layout is unreadable", () => {
    localStorage.setItem(panelLayoutKey("persisted-corrupt", PERSISTENT_PANELS), "{not json");

    render(<PersistentHarness groupId="persisted-corrupt" />);

    expect(panelSize("b-first")).toBe(50);
    expect(panelSize("a-second")).toBe(50);
  });
});

describe("collapse transitions", () => {
  it("reports the first layout and then only real transitions", () => {
    let track: ReturnType<typeof useCollapseTransitions> | undefined;
    function Probe() {
      track = useCollapseTransitions();
      return null;
    }
    render(<Probe />);
    const onCollapse = vi.fn();
    const onExpand = vi.fn();
    const watch = { terminal: { collapsedSize: 0, onCollapse, onExpand } };
    const notify = (layout: Layout) => track?.(layout, watch);

    notify({ content: 100, terminal: 0 });
    expect(onCollapse).toHaveBeenCalledTimes(1);
    notify({ content: 90, terminal: 0 });
    expect(onCollapse).toHaveBeenCalledTimes(1);
    notify({ content: 70, terminal: 30 });
    expect(onExpand).toHaveBeenCalledTimes(1);
    notify({ content: 60, terminal: 40 });
    expect(onExpand).toHaveBeenCalledTimes(1);
    notify({ content: 100 });
    notify({ content: 70, terminal: 30 });
    expect(onExpand).toHaveBeenCalledTimes(2);
  });
});

describe("imperative collapse and expand", () => {
  function fakePanel(initial: number) {
    let size = initial;
    const resize = vi.fn((next: number | string) => {
      size = Number.parseFloat(String(next));
    });
    const panel: PanelImperativeHandle = {
      collapse: () => {
        size = 0;
      },
      expand: () => undefined,
      getSize: () => ({ asPercentage: size, inPixels: 0 }),
      isCollapsed: () => size === 0,
      resize,
    };
    return { panel, resize };
  }

  it("reopens a panel at the size it had before the app collapsed it", () => {
    const { panel, resize } = fakePanel(45);
    collapsePanel("expand-memory", "terminal", panel);
    expect(panel.isCollapsed()).toBe(true);
    expandPanel("expand-memory", "terminal", panel, 30);
    expect(resize).toHaveBeenLastCalledWith("45%");
  });

  it("opens at the minimum when the remembered size is smaller", () => {
    const { panel, resize } = fakePanel(12);
    collapsePanel("expand-minimum", "terminal", panel);
    expandPanel("expand-minimum", "terminal", panel, 30);
    expect(resize).toHaveBeenLastCalledWith("30%");
  });

  it("leaves an open panel alone", () => {
    const { panel, resize } = fakePanel(40);
    expandPanel("expand-open", "terminal", panel, 30);
    expect(resize).not.toHaveBeenCalled();
  });
});

const KEYBOARD_LIMITS = {
  left: { minSize: 20 },
  right: { minSize: 10 },
} satisfies Record<string, PanelLimits>;

function KeyboardHarness({
  limits = KEYBOARD_LIMITS,
  defaultLayout,
  orientation = "horizontal",
}: Readonly<{
  limits?: Readonly<Record<"left" | "right", PanelLimits>>;
  defaultLayout?: Layout;
  orientation?: "horizontal" | "vertical";
}>) {
  const groupRef = useRef<GroupImperativeHandle>(null);
  const onKeyDown = useSeparatorKeyboard(groupRef, limits);
  return (
    <Group groupRef={groupRef} defaultLayout={defaultLayout} orientation={orientation}>
      <Panel id="left" defaultSize={percent(30)} {...panelLimitProps(limits.left)} />
      <Separator id="keyboard-handle" onKeyDownCapture={onKeyDown} />
      <Panel id="right" defaultSize={percent(70)} {...panelLimitProps(limits.right)} />
    </Group>
  );
}

describe("separator keyboard steps", () => {
  const press = (key: string, init: Record<string, unknown> = {}) => {
    const separator = screen.getByRole("separator");
    act(() => separator.focus());
    fireEvent.keyDown(separator, { key, ...init });
  };

  it("moves ten percent per arrow key", () => {
    render(<KeyboardHarness />);
    press("ArrowRight");
    expect(panelSize("left")).toBe(40);
    press("ArrowLeft");
    press("ArrowLeft");
    expect(panelSize("left")).toBe(20);
  });

  it("uses the up and down arrows in a vertical group", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-panel") || this.hasAttribute("data-separator") ? 100 : 0;
    });
    render(<KeyboardHarness orientation="vertical" />);
    press("ArrowRight");
    expect(panelSize("left")).toBe(30);
    press("ArrowDown");
    expect(panelSize("left")).toBe(40);
    press("ArrowUp");
    expect(panelSize("left")).toBe(30);
  });

  it("moves to the limit with Shift", () => {
    render(<KeyboardHarness />);
    press("ArrowRight", { shiftKey: true });
    expect(panelSize("left")).toBe(90);
    press("ArrowLeft", { shiftKey: true });
    expect(panelSize("left")).toBe(20);
  });

  it("opens a collapsed panel to its minimum in one step", () => {
    render(
      <KeyboardHarness
        limits={{ left: { minSize: 20, collapsible: true, collapsedSize: 5 }, right: { minSize: 10 } }}
        defaultLayout={{ left: 5, right: 95 }}
      />,
    );
    press("ArrowRight");
    expect(panelSize("left")).toBe(20);
  });

  it("takes a full step when the minimum is closer than a step", () => {
    render(
      <KeyboardHarness
        limits={{ left: { minSize: 8, collapsible: true, collapsedSize: 0 }, right: { minSize: 10 } }}
        defaultLayout={{ left: 0, right: 100 }}
      />,
    );
    press("ArrowRight");
    expect(panelSize("left")).toBe(10);
  });

  it("stops a collapsible panel at its minimum before it closes", () => {
    render(
      <KeyboardHarness
        limits={{ left: { minSize: 20 }, right: { minSize: 40, collapsible: true, collapsedSize: 0 } }}
        defaultLayout={{ left: 57, right: 43 }}
      />,
    );
    press("ArrowRight");
    expect(panelSize("right")).toBe(40);
    press("ArrowRight");
    expect(panelSize("right")).toBe(0);
    expect(panelSize("left")).toBe(100);
  });

  it("toggles the panel before the separator with Enter and reopens it at its minimum", () => {
    render(
      <KeyboardHarness
        limits={{ left: { minSize: 20, collapsible: true, collapsedSize: 5 }, right: { minSize: 10 } }}
        defaultLayout={{ left: 45, right: 55 }}
      />,
    );
    press("Enter");
    expect(panelSize("left")).toBe(5);
    press("Enter");
    expect(panelSize("left")).toBe(20);
  });

  it("ignores Enter when the panel before the separator cannot collapse", () => {
    render(<KeyboardHarness />);
    press("Enter");
    expect(panelSize("left")).toBe(30);
  });

  it("saves keyboard changes as the layout", () => {
    function SavedHarness() {
      const groupRef = useRef<GroupImperativeHandle>(null);
      const onKeyDown = useSeparatorKeyboard(groupRef, KEYBOARD_LIMITS);
      const panels = ["left", "right"];
      const { defaultLayout, onLayoutChanged } = usePersistentPanelLayout("keyboard-save", panels, panels);
      return (
        <Group groupRef={groupRef} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
          <Panel id="left" defaultSize={percent(30)} {...panelLimitProps(KEYBOARD_LIMITS.left)} />
          <Separator id="saved-handle" onKeyDownCapture={onKeyDown} />
          <Panel id="right" defaultSize={percent(70)} {...panelLimitProps(KEYBOARD_LIMITS.right)} />
        </Group>
      );
    }
    render(<SavedHarness />);
    press("ArrowRight");
    expect(
      JSON.parse(localStorage.getItem(panelLayoutKey("keyboard-save", ["left", "right"])) ?? "null"),
    ).toEqual({ left: 40, right: 60 });
  });
});

describe("squeezed panels", () => {
  function Squeeze({ assistant }: Readonly<{ assistant: boolean }>) {
    return (
      <Group>
        <Panel id="side" defaultSize={percent(40)} {...panelLimitProps({ minSize: 20, maxSize: 65 })} />
        <Separator id="side-handle" />
        <Panel id="main" defaultSize={percent(60)} />
        {assistant && (
          <>
            <Separator id="assist-handle" />
            <Panel
              id="assist"
              defaultSize={percent(60)}
              {...panelLimitProps({ minSize: 60, maxSize: 70, collapsible: true, collapsedSize: 0 })}
            />
          </>
        )}
      </Group>
    );
  }

  it("holds a panel that cannot collapse at its minimum when a large sibling opens", () => {
    const view = render(<Squeeze assistant={false} />);
    view.rerender(<Squeeze assistant />);
    expect(panelSize("side")).toBe(20);
    expect(panelSize("assist")).toBe(60);
  });
});

describe("keyboard resize layout", () => {
  it("spills a step into the panels beyond a panel at its minimum", () => {
    expect(
      keyboardResizeLayout(
        [30, 22, 48],
        [{ minSize: 10 }, { minSize: 20 }, { minSize: 10 }],
        [0, 1],
        10,
      ),
    ).toEqual([40, 20, 40]);
  });

  it("returns the same layout when nothing can move", () => {
    const layout = [20, 80];
    expect(keyboardResizeLayout(layout, [{ minSize: 20 }, {}], [0, 1], -10)).toBe(layout);
  });
});

describe("layout reevaluation", () => {
  it("gives a panel its new minimum from the panel beside it", () => {
    const limits = {
      sidebar: { minSize: 15, maxSize: 65 },
      editorpdf: {},
      assistant: { minSize: 20, maxSize: 55, collapsible: true },
    } satisfies Record<string, PanelLimits>;
    expect(
      reevaluateLayout({ sidebar: 20, editorpdf: 60, assistant: 20 }, limits, {
        ...limits,
        assistant: { ...limits.assistant, minSize: 46 },
      }),
    ).toEqual({ sidebar: 20, editorpdf: 34, assistant: 46 });
  });

  it("keeps a collapsed panel collapsed at its new collapsed size", () => {
    const section = { minSize: 16, collapsible: true, collapsedSize: 6 };
    expect(
      reevaluateLayout({ top: 6, bottom: 94 }, { top: section, bottom: {} }, {
        top: { ...section, collapsedSize: 8 },
        bottom: {},
      }),
    ).toEqual({ top: 8, bottom: 92 });
  });

  it("leaves a layout that already fits", () => {
    const limits = { left: { minSize: 10 }, right: { minSize: 10 } };
    expect(reevaluateLayout({ left: 30, right: 70 }, limits, limits)).toEqual({ left: 30, right: 70 });
  });
});

const WORKSPACE_GROUP = "workspace";
const WORKSPACE_PANELS = ["sidebar", "editorpdf", "assistant"];
const WORKSPACE_KEY = panelLayoutKey(WORKSPACE_GROUP, WORKSPACE_PANELS);

let workspace: Readonly<{
  setAssistantOpen: (open: boolean) => void;
  setAssistantMin: (size: number) => void;
  setShowSidebar: (show: boolean) => void;
}>;

function WorkspaceHarness({ initiallyOpen = true }: Readonly<{ initiallyOpen?: boolean }>) {
  const [assistantOpen, setAssistantOpen] = useState(initiallyOpen);
  const [assistantMin, setAssistantMin] = useState(22);
  const [showSidebar, setShowSidebar] = useState(true);
  workspace = { setAssistantOpen, setAssistantMin, setShowSidebar };
  const groupRef = useRef<GroupImperativeHandle>(null);
  const limits = useMemo(
    () =>
      ({
        sidebar: { minSize: 15, maxSize: 65 },
        editorpdf: {},
        assistant: { minSize: assistantMin, maxSize: 55, collapsible: true, collapsedSize: 0 },
      }) satisfies Record<string, PanelLimits>,
    [assistantMin],
  );
  const assistantDefaultSize = Math.max(28, assistantMin);
  const onKeyDown = useSeparatorKeyboard(groupRef, limits);
  const layout = useDismissiblePanelLayout(
    groupRef,
    WORKSPACE_GROUP,
    WORKSPACE_PANELS,
    WORKSPACE_PANELS.filter(
      (id) => (id !== "sidebar" || showSidebar) && (id !== "assistant" || assistantOpen),
    ),
    limits,
    {
      id: "assistant",
      defaultSize: assistantDefaultSize,
      onDismiss: () => setAssistantOpen(false),
    },
  );
  return (
    <>
      <output data-testid="assistant-open">{String(assistantOpen)}</output>
      <Group
        groupRef={groupRef}
        defaultLayout={layout.defaultLayout}
        onLayoutChange={layout.onLayoutChange}
        onLayoutChanged={layout.onLayoutChanged}
      >
        {showSidebar && (
          <>
            <Panel id="sidebar" defaultSize={percent(20)} {...panelLimitProps(limits.sidebar)} />
            <Separator id="h-tree" onKeyDownCapture={onKeyDown} />
          </>
        )}
        <Panel id="editorpdf" defaultSize={percent(52)} {...panelLimitProps(limits.editorpdf)} />
        {assistantOpen && (
          <>
            <Separator id="h-assistant" onKeyDownCapture={onKeyDown} />
            <Panel
              id="assistant"
              defaultSize={percent(assistantDefaultSize)}
              {...panelLimitProps(limits.assistant)}
            />
          </>
        )}
      </Group>
    </>
  );
}

function assistantOpen(): boolean {
  return screen.getByTestId("assistant-open").textContent === "true";
}

function workspaceSizes(): number[] {
  return WORKSPACE_PANELS.map(panelSize);
}

function pressOnAssistantHandle(key: string) {
  const handle = document.getElementById("h-assistant");
  if (!handle) throw new Error("the assistant handle is not rendered");
  act(() => handle.focus());
  fireEvent.keyDown(handle, { key });
}

async function settle(update: () => void = () => undefined) {
  await act(async () => {
    update();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function storedAssistantSizes(): number[] {
  const sizes: number[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(`react-resizable-panels:${WORKSPACE_GROUP}:`)) continue;
    const size = (JSON.parse(localStorage.getItem(key) ?? "{}") as Layout).assistant;
    if (size !== undefined) sizes.push(size);
  }
  return sizes;
}

describe("dismissible assistant panel", () => {
  it("closes when the keyboard collapses it and reopens at its last size", async () => {
    render(<WorkspaceHarness />);
    expect(workspaceSizes()).toEqual([20, 52, 28]);

    pressOnAssistantHandle("ArrowRight");
    expect(workspaceSizes()).toEqual([20, 58, 22]);
    pressOnAssistantHandle("ArrowRight");
    expect(assistantOpen()).toBe(false);
    expect(JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? "null")).toEqual({
      sidebar: 20,
      editorpdf: 58,
      assistant: 22,
    });

    await settle(() => workspace.setAssistantOpen(true));
    expect(assistantOpen()).toBe(true);
    expect(workspaceSizes()).toEqual([20, 58, 22]);
    expect(storedAssistantSizes()).not.toContain(0);

    pressOnAssistantHandle("ArrowRight");
    expect(assistantOpen()).toBe(false);
  });

  it("reopens after End closes it", async () => {
    render(<WorkspaceHarness />);
    pressOnAssistantHandle("End");
    expect(assistantOpen()).toBe(false);

    await settle(() => workspace.setAssistantOpen(true));
    expect(assistantOpen()).toBe(true);
    expect(workspaceSizes()).toEqual([20, 52, 28]);
    expect(storedAssistantSizes()).not.toContain(0);
  });

  it("reopens after a drag closes it", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.id === "h-assistant" ? new DOMRect(500, 0, 6, 100) : new DOMRect(-999, -999, 0, 0);
    });
    render(<WorkspaceHarness />);
    const handle = document.getElementById("h-assistant");
    if (!handle) throw new Error("the assistant handle is not rendered");
    const pointer = { clientY: 50, pointerType: "mouse", button: 0, buttons: 1 };

    fireEvent.pointerDown(handle, { ...pointer, clientX: 503 });
    fireEvent.pointerMove(handle, { ...pointer, clientX: 521 });
    expect(workspaceSizes()).toEqual([20, 58, 22]);
    fireEvent.pointerMove(handle, { ...pointer, clientX: 563 });
    expect(assistantOpen()).toBe(false);
    fireEvent.pointerUp(document, { ...pointer, clientX: 563, buttons: 0 });

    await settle(() => workspace.setAssistantOpen(true));
    expect(assistantOpen()).toBe(true);
    expect(workspaceSizes()).toEqual([20, 52, 28]);
    expect(storedAssistantSizes()).not.toContain(0);
  });

  it("opens in a new session after the keyboard closed it", async () => {
    const first = render(<WorkspaceHarness />);
    pressOnAssistantHandle("ArrowRight");
    pressOnAssistantHandle("ArrowRight");
    expect(assistantOpen()).toBe(false);
    first.unmount();

    render(<WorkspaceHarness initiallyOpen={false} />);
    await settle(() => workspace.setAssistantOpen(true));
    expect(assistantOpen()).toBe(true);
    expect(workspaceSizes()).toEqual([20, 58, 22]);
  });

  it("stays open at a larger minimum that is more than twice its size", async () => {
    render(<WorkspaceHarness />);
    pressOnAssistantHandle("ArrowRight");
    expect(workspaceSizes()).toEqual([20, 58, 22]);

    await settle(() => workspace.setAssistantMin(46));
    expect(assistantOpen()).toBe(true);
    expect(workspaceSizes()).toEqual([20, 34, 46]);
  });

  it("takes the room for a larger minimum from the panel beside it", async () => {
    render(<WorkspaceHarness />);
    pressOnAssistantHandle("ArrowRight");

    await settle(() => workspace.setAssistantMin(30));
    expect(workspaceSizes()).toEqual([20, 50, 30]);
  });

  it("opens at a minimum that grew while it was closed", async () => {
    render(<WorkspaceHarness />);
    pressOnAssistantHandle("ArrowRight");
    await settle(() => workspace.setAssistantOpen(false));
    await settle(() => workspace.setAssistantMin(46));

    await settle(() => workspace.setAssistantOpen(true));
    expect(assistantOpen()).toBe(true);
    expect(workspaceSizes()).toEqual([20, 34, 46]);
  });

  it("stays open when the panels beside it change after it closed in that arrangement", async () => {
    render(<WorkspaceHarness />);
    await settle(() => workspace.setShowSidebar(false));
    expect(assistantOpen()).toBe(true);
    pressOnAssistantHandle("End");
    expect(assistantOpen()).toBe(false);

    await settle(() => workspace.setShowSidebar(true));
    await settle(() => workspace.setAssistantOpen(true));
    expect(assistantOpen()).toBe(true);
    await settle(() => workspace.setShowSidebar(false));

    expect(assistantOpen()).toBe(true);
    expect(panelSize("assistant")).toBeGreaterThan(0);
    expect(storedAssistantSizes()).not.toContain(0);
  });

  it("reopens at the size it had when it was closed without collapsing", async () => {
    render(<WorkspaceHarness />);
    pressOnAssistantHandle("ArrowLeft");
    expect(workspaceSizes()).toEqual([20, 42, 38]);

    await settle(() => workspace.setAssistantOpen(false));
    await settle(() => workspace.setAssistantOpen(true));
    expect(workspaceSizes()).toEqual([20, 42, 38]);
  });
});

const SHOW_LABEL = "show";
const NARROW_LABEL = "narrow";

describe("panels that mount after their group", () => {
  function LateSidebar({ onSize }: Readonly<{ onSize: (size: number) => void }>) {
    const [shown, setShown] = useState(false);
    const panelRef = useRef<PanelImperativeHandle>(null);
    useEffect(() => {
      if (!shown) return;
      return afterPanelLayout(
        () => panelRef.current,
        (_panel, size) => onSize(size),
      );
    }, [shown, onSize]);
    return (
      <>
        <button type="button" onClick={() => setShown(true)}>
          {SHOW_LABEL}
        </button>
        <Group orientation="horizontal" id="late">
          {shown && <Panel id="sidebar" panelRef={panelRef} defaultSize="20%" minSize="5%" />}
          {shown && <Separator />}
          <Panel id="main" minSize="10%" />
        </Group>
      </>
    );
  }

  it("waits for the group to lay out a panel that mounted in the same commit", async () => {
    const sizes: number[] = [];
    render(<LateSidebar onSize={(size) => sizes.push(size)} />);
    act(() => screen.getByRole("button", { name: SHOW_LABEL }).click());
    await waitFor(() => expect(sizes).toHaveLength(1));
    expect(sizes[0]).toBeCloseTo(20, 1);
  });

  function SteadySidebar({ panelRef }: Readonly<{ panelRef: React.RefObject<PanelImperativeHandle | null> }>) {
    const [shown, setShown] = useState(false);
    const [width, setWidth] = useState(1000);
    useSteadyPanelWidth({
      panelRef,
      active: shown,
      groupWidth: width,
      minSize: 5,
      maxSize: 65,
      defaultSize: 20,
      applyDefault: false,
    });
    return (
      <>
        <button type="button" onClick={() => setShown(true)}>
          {SHOW_LABEL}
        </button>
        <button type="button" onClick={() => setWidth(500)}>
          {NARROW_LABEL}
        </button>
        <Group orientation="horizontal" id="steady">
          {shown && <Panel id="sidebar" panelRef={panelRef} defaultSize="20%" minSize="5%" />}
          {shown && <Separator />}
          <Panel id="main" minSize="10%" />
        </Group>
      </>
    );
  }

  it("keeps a sidebar shown after the width is known at its pixel width", async () => {
    const panelRef = { current: null as PanelImperativeHandle | null };
    render(<SteadySidebar panelRef={panelRef} />);
    act(() => screen.getByRole("button", { name: SHOW_LABEL }).click());
    await waitFor(() => expect(panelRef.current?.getSize().asPercentage).toBeCloseTo(20, 1));
    act(() => screen.getByRole("button", { name: NARROW_LABEL }).click());
    await waitFor(() => expect(panelRef.current?.getSize().asPercentage).toBeCloseTo(40, 1));
  });

  it("gives up after its attempts and cancels a pending retry on cleanup", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const run = vi.fn();
    const stop = afterPanelLayout(() => null, run, 3);
    for (let index = 0; index < frames.length; index++) frames[index](0);
    expect(frames).toHaveLength(3);
    expect(run).not.toHaveBeenCalled();
    stop();
    expect(cancel).toHaveBeenCalledWith(3);
  });
});
