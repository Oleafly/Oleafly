// @vitest-environment jsdom
import { useMemo, useRef, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Group, Panel, Separator, type GroupImperativeHandle, type Layout } from "react-resizable-panels";
import { groupDomIdOf, separatorIdOf, type PaneNode, type PaneSplit } from "@/store/pane-layout";
import {
  inPanelOrder,
  panelLayoutKey,
  panelLimitProps,
  percent,
  useDismissiblePanelLayout,
  useSeparatorKeyboard,
  type PanelLimits,
} from "./panel-layout";

const GROUP = "oleafly.workspace.order-test.horizontal";
type OuterPane = "sidebar" | "editorpdf" | "assistant";
const PANELS: OuterPane[] = ["sidebar", "editorpdf", "assistant"];

function rowOf(order: readonly OuterPane[]): PaneSplit {
  const children: PaneNode[] = order.map((pane) =>
    pane === "editorpdf"
      ? { direction: "row", children: [{ pane: "editor" }, { pane: "pdf" }], sizes: [50, 50] }
      : { pane },
  );
  return { direction: "row", children, sizes: order.map(() => 100 / order.length) };
}
const KEY = panelLayoutKey(GROUP, PANELS);
const DEFAULT_SIZES: Record<OuterPane, number> = { sidebar: 20, editorpdf: 52, assistant: 28 };

let harness: {
  setOrder: (order: OuterPane[]) => void;
  setAssistantOpen: (open: boolean) => void;
  group: () => GroupImperativeHandle | null;
};

function OrderHarness({ initialOrder }: Readonly<{ initialOrder: OuterPane[] }>) {
  const [order, setOrder] = useState(initialOrder);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const groupRef = useRef<GroupImperativeHandle>(null);
  harness = { setOrder, setAssistantOpen, group: () => groupRef.current };
  const limits = useMemo(
    () =>
      ({
        sidebar: { minSize: 15, maxSize: 65 },
        editorpdf: {},
        assistant: { minSize: 22, maxSize: 55, collapsible: true, collapsedSize: 0 },
      }) satisfies Record<string, PanelLimits>,
    [],
  );
  const onKeyDown = useSeparatorKeyboard(groupRef, limits);
  const layout = useDismissiblePanelLayout(
    groupRef,
    GROUP,
    PANELS,
    PANELS.filter((id) => id !== "assistant" || assistantOpen),
    limits,
    { id: "assistant", defaultSize: 28, onDismiss: () => setAssistantOpen(false) },
  );
  const visible = order.filter((id) => id !== "assistant" || assistantOpen);
  return (
    <>
      <output data-testid="assistant-open">{String(assistantOpen)}</output>
      <Group
        id={groupDomIdOf(rowOf(order))}
        groupRef={groupRef}
        defaultLayout={layout.defaultLayout}
        onLayoutChange={layout.onLayoutChange}
        onLayoutChanged={layout.onLayoutChanged}
      >
        {visible.flatMap((pane, index) => {
          const panel = (
            <Panel key={pane} id={pane} defaultSize={percent(DEFAULT_SIZES[pane])} {...panelLimitProps(limits[pane])} />
          );
          const previous = visible[index - 1];
          if (!previous) return [panel];
          const id = separatorIdOf(rowOf(order), visible, previous, pane);
          return [<Separator key={id} id={id} onKeyDownCapture={onKeyDown} />, panel];
        })}
      </Group>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-panel") || this.hasAttribute("data-separator") ? 100 : 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function size(id: string): number {
  const value = document.getElementById(id)?.style.flexGrow;
  return value ? Number(value) : -1;
}

function press(separatorId: string, key: string) {
  const handle = document.getElementById(separatorId);
  if (!handle) throw new Error(`${separatorId} is not rendered`);
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

function stored(): Layout | null {
  return JSON.parse(localStorage.getItem(KEY) ?? "null") as Layout | null;
}

describe("panel layout in a moved pane order", () => {
  it("orders the library's layout like the panes on screen", async () => {
    render(<OrderHarness initialOrder={["assistant", "editorpdf", "sidebar"]} />);
    expect(Object.keys(harness.group()?.getLayout() ?? {})).toEqual(["assistant", "editorpdf", "sidebar"]);

    await settle(() => harness.setOrder(["sidebar", "assistant", "editorpdf"]));
    expect(Object.keys(harness.group()?.getLayout() ?? {})).toEqual(["sidebar", "assistant", "editorpdf"]);
    expect([size("sidebar"), size("assistant"), size("editorpdf")]).toEqual([20, 28, 52]);

    await settle(() => harness.setOrder([...PANELS]));
    expect(Object.keys(harness.group()?.getLayout() ?? {})).toEqual(PANELS);
  });

  it("closes the assistant when its separator is pushed to the left window edge", async () => {
    render(<OrderHarness initialOrder={["assistant", "editorpdf", "sidebar"]} />);
    press("h-assistant", "ArrowLeft");
    expect([size("assistant"), size("editorpdf"), size("sidebar")]).toEqual([22, 58, 20]);
    press("h-assistant", "ArrowLeft");
    expect(screen.getByTestId("assistant-open")).toHaveTextContent("false");
  });

  it("saves the sizes under the default key and reopens the assistant from them", async () => {
    render(<OrderHarness initialOrder={["assistant", "editorpdf", "sidebar"]} />);
    press("h-assistant", "ArrowLeft");
    expect(stored()).toEqual({ sidebar: 20, editorpdf: 58, assistant: 22 });
    expect(Object.keys(stored() ?? {})).toEqual(PANELS);

    press("h-assistant", "ArrowLeft");
    expect(screen.getByTestId("assistant-open")).toHaveTextContent("false");

    await settle(() => harness.setAssistantOpen(true));
    expect(screen.getByTestId("assistant-open")).toHaveTextContent("true");
    expect([size("assistant"), size("editorpdf"), size("sidebar")]).toEqual([22, 58, 20]);
  });

  it("resizes the sidebar and the assistant across their shared separator", async () => {
    render(<OrderHarness initialOrder={["sidebar", "assistant", "editorpdf"]} />);
    const separators = [...document.querySelectorAll("[data-separator]")].map((element) => element.id);
    expect(separators).toEqual(["h-side-assistant", "h-assistant"]);
    press("h-side-assistant", "ArrowRight");
    expect([size("sidebar"), size("assistant"), size("editorpdf")]).toEqual([30, 22, 48]);
  });
});

describe("inPanelOrder", () => {
  it("lists the known panels in their default order and keeps unknown ones after them", () => {
    const layout = inPanelOrder({ assistant: 30, extra: 5, sidebar: 20, editorpdf: 45 }, PANELS);
    expect(Object.keys(layout)).toEqual(["sidebar", "editorpdf", "assistant", "extra"]);
    expect(layout).toEqual({ sidebar: 20, editorpdf: 45, assistant: 30, extra: 5 });
  });
});
