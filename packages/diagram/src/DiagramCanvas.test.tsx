// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ReactFlowProps } from "@xyflow/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DiagramModel } from "@oleafly/latex";
import { useDiagramEdit } from "./edit-context";

const flow = vi.hoisted(() => ({ props: {} as ReactFlowProps }));
vi.mock("@xyflow/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...original,
    ReactFlow: (props: ReactFlowProps) => { flow.props = props; return <EditProbe />; },
  };
});
vi.mock("./kit", () => ({
  useDiagramKit: () => ({
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    useThemeMode: () => "light",
  }),
}));
vi.mock("./ShapeNode", () => ({ nodeTypes: {} }));
vi.mock("./Inspector", () => ({ Inspector: () => <div>Style inspector</div> }));
import { DiagramCanvas } from "./DiagramCanvas";

function EditProbe() {
  const edit = useDiagramEdit();
  return <>
    <output aria-label="Editing node">{edit.editingId ?? "none"}</output>
    <button type="button" onClick={() => edit.beginEdit("one")}>Start label edit</button>
    <button type="button" onClick={() => edit.commitLabel("one", "Changed")}>Commit label</button>
  </>;
}

const model: DiagramModel = {
  version: 1,
  nodes: [{ id: "one", shape: "rectangle", x: 0, y: 0, w: 120, h: 56, label: "Original", fill: "#ffffff", stroke: "#000000", strokeWidth: 1, strokeStyle: "solid", textColor: "#000000", fontSize: 11, fontFamily: "serif", radius: 0 }],
  edges: [],
};
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps imported previews read-only even when canvas events or label callbacks arrive", () => {
  const changed = vi.fn();
  render(<DiagramCanvas model={model} onChange={changed} readOnly />);
  expect(screen.queryByRole("toolbar", { name: "Shape tools" })).not.toBeInTheDocument();
  expect(screen.getByText("Read-only preview · Drag to pan")).toBeInTheDocument();
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
  expect(screen.getByRole("toolbar", { name: "Shape tools" })).toBeInTheDocument();
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
