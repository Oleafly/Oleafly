// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { MarkerType, Position, type EdgeProps, type ReactFlowProps } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagEdge, DiagNode, DiagramModel } from "@oleafly/latex";
import { useDiagramEdit } from "./edit-context";
import type { Inspector as InspectorComponent } from "./Inspector";

const flow = vi.hoisted(() => ({ props: {} as ReactFlowProps }));
const inspector = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
const theme = vi.hoisted(() => ({ mode: "light" as "light" | "dark" }));
const PROBE = vi.hoisted(() => ({
  inspector: "Style inspector",
  editingNode: "Editing node",
  beginEdit: "Start label edit",
  commitLabel: "Commit label",
  cancelEdit: "Cancel label edit",
  pane: "Canvas pane",
  node: "Existing node",
}));
vi.mock("@xyflow/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...original,
    ReactFlow: (props: ReactFlowProps) => {
      flow.props = props;
      return (
        <div className="react-flow__pane" aria-label={PROBE.pane}>
          <EditProbe />
          <div className="react-flow__node" aria-label={PROBE.node} />
        </div>
      );
    },
  };
});
vi.mock("./kit", () => {
  const kit = {
    Tooltip: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
      <>
        {children}
        <span role="tooltip">{label}</span>
      </>
    ),
    useThemeMode: () => theme.mode,
    t: (key: string) => key,
  };
  return { useDiagramKit: () => kit };
});
vi.mock("./ShapeNode", () => ({ nodeTypes: {} }));
vi.mock("./Inspector", () => ({
  Inspector: (props: Record<string, unknown>) => {
    inspector.props = props;
    return <div>{PROBE.inspector}</div>;
  },
}));
import { DiagramCanvas } from "./DiagramCanvas";

type InspectorProps = ComponentProps<typeof InspectorComponent>;

function EditProbe() {
  const edit = useDiagramEdit();
  return <>
    <output aria-label={PROBE.editingNode}>{edit.editingId ?? "none"}</output>
    <button type="button" onClick={() => edit.beginEdit("one")}>{PROBE.beginEdit}</button>
    <button type="button" onClick={() => edit.commitLabel("one", "Changed")}>{PROBE.commitLabel}</button>
    <button type="button" onClick={() => edit.cancelEdit()}>{PROBE.cancelEdit}</button>
  </>;
}

const model: DiagramModel = {
  version: 1,
  nodes: [{ id: "one", shape: "rectangle", x: 0, y: 0, w: 120, h: 56, label: "Original", fill: "#ffffff", stroke: "#000000", strokeWidth: 1, strokeStyle: "solid", textColor: "#000000", fontSize: 11, fontFamily: "serif", radius: 0 }],
  edges: [],
};

function shape(id: string, overrides: Partial<DiagNode> = {}): DiagNode {
  return { id, shape: "rectangle", x: 0, y: 0, w: 120, h: 56, label: id.toUpperCase(), ...overrides };
}

function link(id: string, source: string, target: string, overrides: Partial<DiagEdge> = {}): DiagEdge {
  return { id, source, target, routing: "straight", arrow: "forward", style: "solid", ...overrides };
}

function diagram(nodes: DiagNode[], edges: DiagEdge[] = []): DiagramModel {
  return { version: 1, nodes, edges };
}

const EMPTY = diagram([]);

function lastModel(changed: ReturnType<typeof vi.fn>): DiagramModel {
  return changed.mock.lastCall?.[0] as DiagramModel;
}

function inspectorProps(): InspectorProps {
  return inspector.props as unknown as InspectorProps;
}

function pane() {
  return screen.getByLabelText(PROBE.pane);
}

function canvasRegion(container: HTMLElement) {
  return container.querySelector('[data-tour="diagram-canvas"]') as HTMLElement;
}

function arm(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function drag(from: [number, number], to: [number, number], pointerId = 1) {
  fireEvent.pointerDown(pane(), { button: 0, pointerId, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(pane(), { pointerId, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(pane(), { pointerId, clientX: to[0], clientY: to[1] });
}

function selectNode(id: string) {
  act(() => {
    flow.props.onSelectionChange?.({ nodes: flow.props.nodes!.filter((node) => node.id === id), edges: [] });
  });
}

function selectEdge(id: string) {
  act(() => {
    flow.props.onSelectionChange?.({ nodes: [], edges: flow.props.edges!.filter((edge) => edge.id === id) });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  theme.mode = "light";
  inspector.props = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("keeps imported previews read-only even when canvas events or label callbacks arrive", () => {
  const changed = vi.fn();
  render(<DiagramCanvas model={model} onChange={changed} readOnly />);
  expect(screen.queryByRole("toolbar", { name: "canvas.shapeTools" })).not.toBeInTheDocument();
  expect(screen.getByText("canvas.hintReadOnly")).toBeInTheDocument();
  expect(flow.props).toMatchObject({ nodesDraggable: false, nodesConnectable: false, elementsSelectable: false, edgesReconnectable: false, panOnDrag: true, deleteKeyCode: null });
  expect(flow.props.onConnect).toBeUndefined();
  expect(flow.props.onReconnect).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Start label edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Commit label" }));
  expect(screen.getByLabelText("Editing node")).toHaveTextContent("none");
  act(() => {
    flow.props.onSelectionChange?.({ nodes: flow.props.nodes!, edges: [] });
    flow.props.onNodesChange?.([{ type: "position", id: "one", position: { x: 50, y: 50 } }]);
    vi.advanceTimersByTime(500);
  });
  expect(screen.queryByText("Style inspector")).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  expect(model.nodes[0].label).toBe("Original");
});

it("restores editing for an editable source and blocks undo after it becomes read-only", () => {
  const changed = vi.fn();
  const view = render(<DiagramCanvas model={model} onChange={changed} />);
  expect(screen.getByRole("toolbar", { name: "canvas.shapeTools" })).toBeInTheDocument();
  expect(flow.props.onConnect).toEqual(expect.any(Function));
  fireEvent.click(screen.getByRole("button", { name: "Start label edit" }));
  expect(screen.getByLabelText("Editing node")).toHaveTextContent("one");
  fireEvent.click(screen.getByRole("button", { name: "Commit label" }));
  expect(changed.mock.lastCall?.[0].nodes[0].label).toBe("Changed");
  act(() => vi.advanceTimersByTime(500));
  view.rerender(<DiagramCanvas model={model} onChange={changed} readOnly />);
  changed.mockClear();
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
  expect(changed).not.toHaveBeenCalled();
  const replacement = { ...model, nodes: [{ ...model.nodes[0], label: "External edit" }] };
  view.rerender(<DiagramCanvas model={replacement} onChange={changed} />);
  expect(flow.props.nodes?.[0].data.label).toBe("External edit");
  fireEvent.click(screen.getByRole("button", { name: "Commit label" }));
  expect(changed.mock.lastCall?.[0].nodes[0].label).toBe("Changed");
});

it("leaves the label unchanged when an edit is cancelled", () => {
  const changed = vi.fn();
  render(<DiagramCanvas model={model} onChange={changed} />);
  fireEvent.click(screen.getByRole("button", { name: PROBE.beginEdit }));
  expect(screen.getByLabelText(PROBE.editingNode)).toHaveTextContent("one");
  fireEvent.click(screen.getByRole("button", { name: PROBE.cancelEdit }));
  expect(screen.getByLabelText(PROBE.editingNode)).toHaveTextContent("none");
  expect(changed).not.toHaveBeenCalled();
});

describe("drawing shapes", () => {
  it("draws a dragged rectangle with the armed tool and selects it", () => {
    const changed = vi.fn();
    const { container } = render(<DiagramCanvas model={EMPTY} onChange={changed} />);
    const tool = screen.getByRole("button", { name: "palette.rectangle" });
    expect(tool).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("canvas.hintDefault")).toBeInTheDocument();
    fireEvent.click(tool);
    expect(tool).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("canvas.hintDrawing")).toBeInTheDocument();
    expect(canvasRegion(container).className).toContain("cursor-crosshair");
    fireEvent.pointerDown(pane(), { button: 0, pointerId: 1, clientX: 100, clientY: 80 });
    expect(lastModel(changed).nodes).toEqual([expect.objectContaining({ x: 100, y: 80, w: 1, h: 1 })]);
    fireEvent.pointerMove(pane(), { pointerId: 2, clientX: 900, clientY: 900 });
    fireEvent.pointerMove(pane(), { pointerId: 1, clientX: 300, clientY: 200 });
    expect(lastModel(changed).nodes[0]).toMatchObject({ x: 100, y: 80, w: 200, h: 120 });
    fireEvent.pointerUp(pane(), { pointerId: 2, clientX: 900, clientY: 900 });
    expect(tool).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerUp(pane(), { pointerId: 1, clientX: 300, clientY: 200 });
    expect(lastModel(changed).nodes).toEqual([
      {
        id: expect.any(String),
        shape: "rectangle",
        x: 100,
        y: 80,
        w: 200,
        h: 120,
        label: "Label",
        fill: "#ffffff",
        stroke: "#6b7280",
        strokeStyle: "solid",
        strokeWidth: 1,
        textColor: "#000000",
        fontSize: 11,
        fontFamily: "serif",
        radius: 0,
      },
    ]);
    expect(tool).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("canvas.hintDefault")).toBeInTheDocument();
    expect(screen.getByText(PROBE.inspector)).toBeInTheDocument();
    expect(canvasRegion(container)).toHaveAttribute("data-tour-selection", "true");
  });

  it.each<[string, Partial<DiagNode>]>([
    ["palette.rectangle", { shape: "rectangle", w: 120, h: 56, label: "Label", radius: 0 }],
    ["palette.roundedBox", { shape: "roundrect", w: 120, h: 56, label: "Label", radius: 6 }],
    ["palette.circle", { shape: "circle", w: 72, h: 72, label: "" }],
    ["palette.ellipse", { shape: "ellipse", w: 110, h: 64, label: "Label" }],
    ["palette.diamond", { shape: "diamond", w: 92, h: 92, label: "" }],
    ["palette.parallelogram", { shape: "parallelogram", w: 140, h: 60, label: "Label" }],
    ["palette.text", { shape: "text", w: 90, h: 32, label: "Text", fill: "", stroke: "", textColor: "#000000" }],
    ["palette.math", { shape: "text", w: 90, h: 32, label: "$E = mc^2$" }],
    ["palette.code", { shape: "text", w: 90, h: 32, label: String.raw`\texttt{print(x)}` }],
  ])("places a default %s centred on a click", (tool, expected) => {
    const changed = vi.fn();
    render(<DiagramCanvas model={EMPTY} onChange={changed} />);
    arm(tool);
    drag([400, 300], [403, 305]);
    const placed = lastModel(changed).nodes[0];
    expect(placed).toMatchObject(expected);
    expect(placed.x).toBe(Math.round(400 - (expected.w as number) / 2));
    expect(placed.y).toBe(Math.round(300 - (expected.h as number) / 2));
  });

  it("seeds math and code tools with the language's own snippets", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={EMPTY} onChange={changed} seeds={{ math: "$$x^2$$", code: "print(x)" }} />);
    arm("palette.math");
    drag([10, 10], [10, 10]);
    arm("palette.code");
    drag([200, 10], [200, 10]);
    expect(lastModel(changed).nodes.map((node) => node.label)).toEqual(["$$x^2$$", "print(x)"]);
  });

  it("gives a thin drag the minimum shape size", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={EMPTY} onChange={changed} />);
    arm("palette.ellipse");
    drag([100, 100], [104, 160]);
    expect(lastModel(changed).nodes[0]).toMatchObject({ x: 100, y: 100, w: 24, h: 60 });
  });

  it("keeps a dragged circle round", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={EMPTY} onChange={changed} />);
    arm("palette.circle");
    drag([100, 100], [160, 200]);
    expect(lastModel(changed).nodes[0]).toMatchObject({ x: 100, y: 100, w: 100, h: 100 });
  });

  it("grows a circle up and left from where the drag started", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={EMPTY} onChange={changed} />);
    arm("palette.circle");
    fireEvent.pointerDown(pane(), { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(pane(), { pointerId: 1, clientX: 200, clientY: 250 });
    expect(lastModel(changed).nodes[0]).toMatchObject({ x: 200, y: 200, w: 100, h: 100 });
    fireEvent.pointerUp(pane(), { pointerId: 1, clientX: 200, clientY: 200 });
    expect(lastModel(changed).nodes[0]).toMatchObject({ x: 200, y: 200, w: 100, h: 100 });
  });

  it("finishes the drawing when the pointer capture was already released", () => {
    const changed = vi.fn();
    const { container } = render(<DiagramCanvas model={EMPTY} onChange={changed} />);
    const release = vi.fn(() => {
      throw new DOMException("No active pointer", "NotFoundError");
    });
    canvasRegion(container).releasePointerCapture = release;
    arm("palette.rectangle");
    drag([0, 0], [50, 40]);
    expect(release).toHaveBeenCalledWith(1);
    expect(lastModel(changed).nodes[0]).toMatchObject({ x: 0, y: 0, w: 50, h: 40 });
    expect(screen.getByRole("button", { name: "palette.rectangle" })).toHaveAttribute("aria-pressed", "false");
  });

  it("only starts drawing on empty canvas with the primary button", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={EMPTY} onChange={changed} />);
    fireEvent.pointerDown(pane(), { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    arm("palette.rectangle");
    fireEvent.pointerDown(pane(), { button: 2, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerDown(screen.getByLabelText(PROBE.node), { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "palette.circle" }), { button: 0, pointerId: 1 });
    fireEvent.pointerMove(pane(), { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(pane(), { pointerId: 1, clientX: 50, clientY: 50 });
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "palette.rectangle" })).toHaveAttribute("aria-pressed", "true");
  });

  it("disarms a tool clicked twice", () => {
    render(<DiagramCanvas model={EMPTY} onChange={vi.fn()} />);
    arm("palette.diamond");
    arm("palette.diamond");
    expect(screen.getByRole("button", { name: "palette.diamond" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("canvas.hintDefault")).toBeInTheDocument();
  });

  it("cancels the shape being drawn and the armed tool on Escape", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={model} onChange={changed} />);
    arm("palette.rectangle");
    fireEvent.pointerDown(pane(), { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    expect(lastModel(changed).nodes).toHaveLength(2);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(lastModel(changed).nodes.map((node) => node.id)).toEqual(["one"]);
    expect(screen.getByRole("button", { name: "palette.rectangle" })).toHaveAttribute("aria-pressed", "false");
    changed.mockClear();
    fireEvent.pointerUp(pane(), { pointerId: 1, clientX: 400, clientY: 400 });
    expect(changed).not.toHaveBeenCalled();
  });

  it("disarms an idle tool on Escape", () => {
    render(<DiagramCanvas model={EMPTY} onChange={vi.fn()} />);
    arm("palette.text");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("button", { name: "palette.text" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("panning", () => {
  it("pans with Space held and shows a grab cursor while moving", () => {
    const changed = vi.fn();
    const { container } = render(<DiagramCanvas model={EMPTY} onChange={changed} />);
    expect(flow.props.panOnDrag).toBe(false);
    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    expect(screen.getByText("canvas.hintPanning")).toBeInTheDocument();
    expect(flow.props.panOnDrag).toBe(true);
    expect(canvasRegion(container).className).toContain("cursor-grab");
    act(() => flow.props.onMoveStart?.(null, { x: 0, y: 0, zoom: 1 }));
    expect(canvasRegion(container).className).toContain("cursor-grabbing");
    act(() => flow.props.onMoveEnd?.(null, { x: 0, y: 0, zoom: 1 }));
    expect(canvasRegion(container).className).not.toContain("cursor-grabbing");
    arm("palette.rectangle");
    expect(screen.getByText("canvas.hintDrawing")).toBeInTheDocument();
    expect(canvasRegion(container).className).not.toContain("cursor-crosshair");
    fireEvent.pointerDown(pane(), { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.keyUp(document.body, { code: "Space", key: " " });
    expect(flow.props.panOnDrag).toBe(false);
  });

  it("keeps Space from scrolling the canvas but not from typing", () => {
    render(<DiagramCanvas model={EMPTY} onChange={vi.fn()} />);
    const field = document.createElement("input");
    document.body.appendChild(field);
    expect(fireEvent.keyDown(field, { code: "Space", key: " " })).toBe(true);
    expect(fireEvent.keyDown(document.body, { code: "Space", key: " " })).toBe(false);
    field.remove();
  });

  it("blocks the context menu on the canvas", () => {
    const { container } = render(<DiagramCanvas model={EMPTY} onChange={vi.fn()} />);
    expect(fireEvent.contextMenu(canvasRegion(container))).toBe(false);
    const preventDefault = vi.fn();
    flow.props.onPaneContextMenu?.({ preventDefault } as never);
    expect(preventDefault).toHaveBeenCalled();
  });
});

describe("undo and redo", () => {
  it("steps back and forward through settled edits", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={diagram([...model.nodes, shape("two")])} onChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: PROBE.commitLabel }));
    expect(lastModel(changed).nodes.map((node) => node.label)).toEqual(["Changed", "TWO"]);
    act(() => vi.advanceTimersByTime(400));
    changed.mockClear();
    fireEvent.keyDown(document.body, { key: "z" });
    expect(changed).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(document.body, { key: "z", ctrlKey: true })).toBe(false);
    expect(lastModel(changed).nodes[0].label).toBe("Original");
    expect(flow.props.nodes?.[0].data.label).toBe("Original");
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(changed).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "Z", metaKey: true, shiftKey: true });
    expect(lastModel(changed).nodes[0].label).toBe("Changed");
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("folds quick successive edits into one undo step", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={model} onChange={changed} />);
    act(() => flow.props.onNodesChange?.([{ type: "position", id: "one", position: { x: 10, y: 0 } }]));
    act(() => vi.advanceTimersByTime(100));
    act(() => flow.props.onNodesChange?.([{ type: "position", id: "one", position: { x: 20, y: 0 } }]));
    act(() => vi.advanceTimersByTime(400));
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(lastModel(changed).nodes[0].x).toBe(0);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
    expect(lastModel(changed).nodes[0].x).toBe(20);
  });

  it("leaves undo to text fields", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={model} onChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: PROBE.commitLabel }));
    act(() => vi.advanceTimersByTime(400));
    changed.mockClear();
    const field = document.createElement("textarea");
    document.body.appendChild(field);
    expect(fireEvent.keyDown(field, { key: "z", ctrlKey: true })).toBe(true);
    field.remove();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("connectors", () => {
  it("renders each routing, dash and arrow choice", () => {
    render(
      <DiagramCanvas
        model={diagram(
          [shape("a"), shape("b")],
          [
            link("ortho", "a", "b", { routing: "orthogonal", style: "dashed", arrow: "both", label: "yes", sourceHandle: "r", targetHandle: "l" }),
            link("curve", "a", "b", { routing: "curved", style: "dotted", arrow: "none" }),
            link("line", "a", "b"),
          ],
        )}
        onChange={vi.fn()}
      />,
    );
    const marker = { type: MarkerType.ArrowClosed };
    expect(flow.props.edges).toEqual([
      expect.objectContaining({ id: "ortho", type: "diagramOrthogonal", label: "yes", sourceHandle: "r", targetHandle: "l", style: { strokeDasharray: "6 4" }, markerStart: marker, markerEnd: marker, reconnectable: true }),
      expect.objectContaining({ id: "curve", type: "default", style: { strokeDasharray: "1.5 4", strokeLinecap: "round" }, markerStart: undefined, markerEnd: undefined }),
      expect.objectContaining({ id: "line", type: "straight", sourceHandle: "b", targetHandle: "t", style: undefined, markerStart: undefined, markerEnd: marker }),
    ]);
  });

  it("adds a forward arrow when two shapes are connected", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={diagram([shape("a"), shape("b")])} onChange={changed} />);
    act(() => flow.props.onConnect?.({ source: "a", target: "b", sourceHandle: "r", targetHandle: null }));
    expect(lastModel(changed).edges).toEqual([
      { id: expect.any(String), source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid", label: undefined, sourceHandle: "r", targetHandle: "t" },
    ]);
    act(() => flow.props.onConnect?.({ source: "b", target: "a", sourceHandle: null, targetHandle: "l" }));
    expect(lastModel(changed).edges[1]).toMatchObject({ source: "b", target: "a", sourceHandle: "b", targetHandle: "l" });
  });

  it("moves a connector end onto another shape", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={diagram([shape("a"), shape("b"), shape("c")], [link("e1", "a", "b")])} onChange={changed} />);
    act(() => flow.props.onReconnect?.(flow.props.edges![0], { source: "a", target: "c", sourceHandle: "b", targetHandle: "t" }));
    expect(lastModel(changed).edges).toEqual([expect.objectContaining({ source: "a", target: "c" })]);
  });

  it("drops connectors attached to deleted shapes", () => {
    const changed = vi.fn();
    render(
      <DiagramCanvas
        model={diagram([shape("a"), shape("b"), shape("c")], [link("ab", "a", "b"), link("bc", "b", "c"), link("ac", "a", "c")])}
        onChange={changed}
      />,
    );
    act(() => flow.props.onNodesDelete?.(flow.props.nodes!.filter((node) => node.id === "b")));
    expect(lastModel(changed).edges.map((edge) => edge.id)).toEqual(["ac"]);
  });

  it("fills in defaults for shapes and connectors React Flow adds on its own", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={diagram([shape("a"), shape("b")])} onChange={changed} />);
    act(() => flow.props.onNodesChange?.([{ type: "add", item: { id: "bare", position: { x: 10.4, y: 20.6 }, data: {} } }]));
    expect(lastModel(changed).nodes.at(-1)).toMatchObject({ id: "bare", shape: "rectangle", x: 10, y: 21, w: 120, h: 56, label: "" });
    act(() =>
      flow.props.onNodesChange?.([
        { type: "add", item: { id: "measured", position: { x: 0, y: 0 }, measured: { width: 80.6, height: 30.2 }, data: { shape: "ellipse", label: "M" } } },
      ]),
    );
    expect(lastModel(changed).nodes.at(-1)).toMatchObject({ id: "measured", shape: "ellipse", w: 81, h: 30, label: "M" });
    act(() => flow.props.onEdgesChange?.([{ type: "add", item: { id: "plain", source: "a", target: "b" } }]));
    expect(lastModel(changed).edges).toEqual([
      { id: "plain", source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid", label: undefined, sourceHandle: undefined, targetHandle: undefined },
    ]);
  });
});

describe("orthogonal connector path", () => {
  function pathFor(sourceX: number, sourceY: number, sourcePosition: Position, targetX: number, targetY: number, targetPosition: Position) {
    render(<DiagramCanvas model={EMPTY} onChange={vi.fn()} />);
    const Orthogonal = flow.props.edgeTypes!.diagramOrthogonal as ComponentType<EdgeProps>;
    const edgeProps = { id: "e", source: "a", target: "b", sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd: "url(#arrow)" } as unknown as EdgeProps;
    const { container } = render(<svg><Orthogonal {...edgeProps} /></svg>);
    const path = container.querySelector(".react-flow__edge-path") as SVGPathElement;
    return { d: path.getAttribute("d"), path, container };
  }

  it("rounds each bend of a step route clear of both shapes", () => {
    const { d, path, container } = pathFor(0, 0, Position.Bottom, 100, 200, Position.Top);
    expect(d).toBe("M0 6L0 26L0,95Q0,100 5,100L95,100Q100,100 100,105L100 174L100 194");
    expect(path).toHaveAttribute("marker-end", "url(#arrow)");
    expect(container.querySelector(".react-flow__edge-interaction")).toHaveAttribute("d", d);
  });

  it("bends the other way for a route heading left", () => {
    expect(pathFor(100, 0, Position.Bottom, 0, 200, Position.Top).d).toBe(
      "M100 6L100 26L100,95Q100,100 95,100L5,100Q0,100 0,105L0 174L0 194",
    );
  });

  it("bends the other way for a route heading up", () => {
    expect(pathFor(0, 200, Position.Top, 100, 0, Position.Bottom).d).toBe(
      "M0 194L0 174L0,105Q0,100 5,100L95,100Q100,100 100,95L100 26L100 6",
    );
  });

  it("draws a straight run without bends", () => {
    expect(pathFor(0, 0, Position.Right, 200, 0, Position.Left).d).toBe("M6 0L26 0L100 0L174 0L194 0");
  });
});

describe("style inspector", () => {
  it("opens for the selected shape and closes when the selection clears", () => {
    const { container } = render(<DiagramCanvas model={diagram([shape("a"), shape("b")])} onChange={vi.fn()} labelKey="inspector.nodeLabel" />);
    expect(screen.queryByText(PROBE.inspector)).not.toBeInTheDocument();
    expect(canvasRegion(container)).toHaveAttribute("data-tour-selection", "false");
    selectNode("b");
    expect(screen.getByRole("complementary", { name: "canvas.shapeStyle" })).toHaveTextContent(PROBE.inspector);
    expect(inspectorProps()).toMatchObject({ node: { id: "b", label: "B" }, edge: null, labelKey: "inspector.nodeLabel" });
    act(() => flow.props.onSelectionChange?.({ nodes: [], edges: [] }));
    expect(screen.queryByText(PROBE.inspector)).not.toBeInTheDocument();
  });

  it("closes when the selected shape disappears", () => {
    render(<DiagramCanvas model={diagram([shape("a"), shape("b")])} onChange={vi.fn()} />);
    selectNode("b");
    act(() => flow.props.onNodesChange?.([{ type: "remove", id: "b" }]));
    expect(screen.queryByText(PROBE.inspector)).not.toBeInTheDocument();
  });

  it("restyles the selected shape and uses that style for the next shape", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={diagram([shape("a"), shape("b")])} onChange={changed} />);
    selectNode("a");
    const patch = { fill: "#ff0000", stroke: "#00ff00", strokeStyle: "dashed", strokeWidth: 3, fontSize: 14, fontFamily: "mono", radius: 8, textColor: "#123456" } as const;
    act(() => inspectorProps().onNodeChange(patch));
    expect(lastModel(changed).nodes[0]).toMatchObject(patch);
    expect(lastModel(changed).nodes[1]).toEqual(expect.objectContaining({ id: "b", fill: undefined }));
    changed.mockClear();
    act(() => inspectorProps().onEdgeChange({ arrow: "none" }));
    expect(changed).not.toHaveBeenCalled();
    arm("palette.roundedBox");
    drag([500, 500], [500, 500]);
    expect(lastModel(changed).nodes.at(-1)).toMatchObject({ shape: "roundrect", ...patch });
    arm("palette.text");
    drag([700, 500], [700, 500]);
    expect(lastModel(changed).nodes.at(-1)).toMatchObject({ shape: "text", fill: "", stroke: "", textColor: "#000000", fontFamily: "mono" });
  });

  it("keeps the rounded-box radius until a radius is chosen", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={diagram([shape("a")])} onChange={changed} />);
    selectNode("a");
    act(() => inspectorProps().onNodeChange({ label: "Renamed" }));
    expect(lastModel(changed).nodes[0].label).toBe("Renamed");
    arm("palette.roundedBox");
    drag([500, 500], [500, 500]);
    expect(lastModel(changed).nodes.at(-1)).toMatchObject({ radius: 6, textColor: "#000000" });
  });

  it("remembers free text colours separately for light and dark canvases", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={diagram([shape("t", { shape: "text" })])} onChange={changed} />);
    selectNode("t");
    act(() => inspectorProps().onNodeChange({ textColor: "#aa0000" }));
    fireEvent.click(screen.getByRole("button", { name: "canvas.toggleTheme" }));
    arm("palette.text");
    drag([300, 300], [300, 300]);
    expect(lastModel(changed).nodes.at(-1)?.textColor).toBe("#ffffff");
    selectNode("t");
    act(() => inspectorProps().onNodeChange({ textColor: "#00aa00" }));
    arm("palette.text");
    drag([300, 400], [300, 400]);
    expect(lastModel(changed).nodes.at(-1)?.textColor).toBe("#00aa00");
    fireEvent.click(screen.getByRole("button", { name: "canvas.toggleTheme" }));
    arm("palette.text");
    drag([300, 500], [300, 500]);
    expect(lastModel(changed).nodes.at(-1)?.textColor).toBe("#aa0000");
    arm("palette.rectangle");
    drag([300, 600], [300, 600]);
    expect(lastModel(changed).nodes.at(-1)?.textColor).toBe("#000000");
  });

  it("restyles the selected connector and keeps it selected", () => {
    const changed = vi.fn();
    render(<DiagramCanvas model={diagram([shape("a"), shape("b")], [link("e1", "a", "b"), link("e2", "b", "a")])} onChange={changed} />);
    act(() => flow.props.onEdgesChange?.([{ type: "select", id: "e1", selected: true }]));
    selectEdge("e1");
    expect(inspectorProps()).toMatchObject({ node: null, edge: { id: "e1", source: "a", target: "b" } });
    act(() => inspectorProps().onEdgeChange({ routing: "orthogonal", arrow: "both", style: "dotted", label: "yes" }));
    expect(lastModel(changed).edges).toEqual([
      expect.objectContaining({ id: "e1", routing: "orthogonal", arrow: "both", style: "dotted", label: "yes" }),
      expect.objectContaining({ id: "e2", routing: "straight", label: undefined }),
    ]);
    expect(flow.props.edges?.[0]).toMatchObject({ type: "diagramOrthogonal", label: "yes", selected: true });
    changed.mockClear();
    act(() => inspectorProps().onNodeChange({ fill: "#000000" }));
    act(() => inspectorProps().onReorder?.("front"));
    expect(changed).not.toHaveBeenCalled();
  });

  it.each<[string, "front" | "back" | "forward" | "backward", string[]]>([
    ["b", "front", ["a", "c", "b"]],
    ["b", "back", ["b", "a", "c"]],
    ["a", "forward", ["b", "a", "c"]],
    ["c", "forward", ["a", "b", "c"]],
    ["c", "backward", ["a", "c", "b"]],
    ["a", "backward", ["a", "b", "c"]],
  ])("moves %s to the %s", (id, direction, order) => {
    const changed = vi.fn();
    render(<DiagramCanvas model={diagram([shape("a"), shape("b"), shape("c")])} onChange={changed} />);
    selectNode(id);
    act(() => inspectorProps().onReorder?.(direction));
    expect(lastModel(changed).nodes.map((node) => node.id)).toEqual(order);
    expect(flow.props.nodes?.map((node) => node.zIndex)).toEqual([0, 1, 2]);
  });
});

describe("canvas chrome", () => {
  it("switches the canvas between light and dark", () => {
    const { container } = render(<DiagramCanvas model={EMPTY} onChange={vi.fn()} />);
    expect(flow.props.colorMode).toBe("light");
    expect(canvasRegion(container)).toHaveStyle({ background: "#ffffff" });
    expect(screen.getByText("canvas.darkCanvas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "canvas.toggleTheme" }));
    expect(flow.props.colorMode).toBe("dark");
    expect(canvasRegion(container)).toHaveStyle({ background: "#121212" });
    expect(canvasRegion(container)).toHaveClass("dark");
    expect(screen.getByText("canvas.lightCanvas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "canvas.toggleTheme" }));
    expect(flow.props.colorMode).toBe("light");
  });

  it("starts on the app theme", () => {
    theme.mode = "dark";
    render(<DiagramCanvas model={EMPTY} onChange={vi.fn()} />);
    expect(flow.props.colorMode).toBe("dark");
    expect(screen.getByText("canvas.lightCanvas")).toBeInTheDocument();
  });

  it("toggles the minimap", () => {
    render(<DiagramCanvas model={EMPTY} onChange={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: "canvas.toggleMinimap" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("canvas.hideMinimap")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("canvas.showMinimap")).toBeInTheDocument();
  });

  it("offers the preview button only with a handler", () => {
    const show = vi.fn();
    const view = render(<DiagramCanvas model={EMPTY} onChange={vi.fn()} showPreviewAction onShowPreview={show} />);
    fireEvent.click(screen.getByRole("button", { name: "preview.showLabel" }));
    expect(show).toHaveBeenCalledTimes(1);
    view.rerender(<DiagramCanvas model={EMPTY} onChange={vi.fn()} showPreviewAction />);
    expect(screen.queryByRole("button", { name: "preview.showLabel" })).not.toBeInTheDocument();
  });
});
