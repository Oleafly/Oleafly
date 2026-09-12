// @vitest-environment jsdom

import type { ChangeEvent, ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagEdge, DiagNode } from "@oleafly/latex";

vi.mock("./kit", () => ({
  useDiagramKit: () => ({
    Input: (props: Record<string, unknown>) => <input {...props} />,
    ColorInput: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    }) => <input type="color" value={value} onChange={onChange} />,
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (next: string) => void;
      children?: ReactNode;
    }) => (
      <select value={value} onChange={(event) => onValueChange(event.target.value)}>
        {children}
      </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
    t: (key: string) => key,
  }),
}));

import { Inspector } from "./Inspector";

function node(overrides: Partial<DiagNode> = {}): DiagNode {
  return {
    id: "one",
    shape: "rectangle",
    x: 0,
    y: 0,
    w: 120,
    h: 56,
    label: "Box",
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidth: 1,
    strokeStyle: "solid",
    textColor: "#000000",
    fontSize: 11,
    fontFamily: "serif",
    radius: 0,
    ...overrides,
  } as DiagNode;
}

function edge(overrides: Partial<DiagEdge> = {}): DiagEdge {
  return {
    id: "e1",
    from: "one",
    to: "two",
    label: "flows",
    arrow: "forward",
    routing: "straight",
    style: "solid",
    ...overrides,
  } as DiagEdge;
}

describe("Inspector", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing without a selection", () => {
    const { container } = render(
      <Inspector node={null} edge={null} onNodeChange={vi.fn()} onEdgeChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("edits every shape property and reorders the selection", () => {
    const onNodeChange = vi.fn();
    const onReorder = vi.fn();
    render(
      <Inspector
        node={node()}
        edge={null}
        onNodeChange={onNodeChange}
        onEdgeChange={vi.fn()}
        onReorder={onReorder}
      />,
    );

    expect(screen.getByText("inspector.shape")).toBeInTheDocument();
    for (const label of [
      "inspector.nodeLabel",
      "inspector.fill",
      "inspector.border",
      "inspector.borderStyle",
      "inspector.borderWidth",
      "inspector.cornerRadius",
      "inspector.fontSize",
      "inspector.font",
      "inspector.fontColor",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("inspector.strokeDashed")).toBeInTheDocument();
    expect(screen.getByText("inspector.fontMono")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Box"), { target: { value: "Renamed" } });
    expect(onNodeChange).toHaveBeenCalledWith({ label: "Renamed" });

    const colors = screen.getAllByDisplayValue("#ffffff");
    fireEvent.change(colors[0], { target: { value: "#ff0000" } });
    expect(onNodeChange).toHaveBeenLastCalledWith({ fill: "#ff0000" });

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "dotted" } });
    expect(onNodeChange).toHaveBeenLastCalledWith({ strokeStyle: "dotted" });
    fireEvent.change(selects[1], { target: { value: "2" } });
    expect(onNodeChange).toHaveBeenLastCalledWith({ strokeWidth: 2 });
    fireEvent.change(selects[2], { target: { value: "8" } });
    expect(onNodeChange).toHaveBeenLastCalledWith({ radius: 8 });
    fireEvent.change(selects[3], { target: { value: "14" } });
    expect(onNodeChange).toHaveBeenLastCalledWith({ fontSize: 14 });
    fireEvent.change(selects[4], { target: { value: "mono" } });
    expect(onNodeChange).toHaveBeenLastCalledWith({ fontFamily: "mono" });

    for (const label of [
      "inspector.bringToFront",
      "inspector.forward",
      "inspector.backward",
      "inspector.sendToBack",
    ]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    expect(onReorder.mock.calls.map(([dir]) => dir)).toEqual([
      "front",
      "forward",
      "backward",
      "back",
    ]);
  });

  it("hides the corner radius for a shape that cannot round and the reorder row without a handler", () => {
    render(
      <Inspector
        node={node({ shape: "ellipse", strokeWidth: undefined, fontSize: undefined })}
        edge={null}
        onNodeChange={vi.fn()}
        onEdgeChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("inspector.cornerRadius")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("inspector.bringToFront")).not.toBeInTheDocument();
  });

  it("edits an arrow", () => {
    const onEdgeChange = vi.fn();
    render(
      <Inspector
        node={null}
        edge={edge()}
        onNodeChange={vi.fn()}
        onEdgeChange={onEdgeChange}
      />,
    );

    expect(screen.getByText("inspector.arrow")).toBeInTheDocument();
    expect(screen.getByText("inspector.edgeLabel")).toBeInTheDocument();
    expect(screen.getByText("inspector.arrowBoth")).toBeInTheDocument();
    expect(screen.getByText("inspector.routingCurved")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("flows"), { target: { value: "carries" } });
    expect(onEdgeChange).toHaveBeenCalledWith({ label: "carries" });

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "none" } });
    expect(onEdgeChange).toHaveBeenLastCalledWith({ arrow: "none" });
    fireEvent.change(selects[1], { target: { value: "orthogonal" } });
    expect(onEdgeChange).toHaveBeenLastCalledWith({ routing: "orthogonal" });
    fireEvent.change(selects[2], { target: { value: "dashed" } });
    expect(onEdgeChange).toHaveBeenLastCalledWith({ style: "dashed" });
  });

  it("falls back to an empty label for an arrow that has none", () => {
    render(
      <Inspector
        node={null}
        edge={edge({ label: undefined })}
        onNodeChange={vi.fn()}
        onEdgeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
