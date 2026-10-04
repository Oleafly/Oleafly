// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiagramEditContext,
  DiagramKitContext,
  ShapeNode,
  nodeTypes,
  type DiagramKit,
  type ShapeData,
} from "./index";
import type { DiagramEditApi } from "./edit-context";

const PRIMARY = "#336699";

const kit = {
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
  usePrimaryColor: () => PRIMARY,
} as unknown as DiagramKit;

function editApi(overrides: Partial<DiagramEditApi> = {}): DiagramEditApi {
  return { editingId: null, beginEdit: vi.fn(), commitLabel: vi.fn(), cancelEdit: vi.fn(), ...overrides };
}

function shapeProps(data: Partial<ShapeData>, selected = false): NodeProps {
  return { id: "n1", data: { shape: "rectangle", label: "Box", ...data }, selected } as unknown as NodeProps;
}

function tree(node: ReactNode, api: DiagramEditApi | null) {
  const inner = api ? <DiagramEditContext.Provider value={api}>{node}</DiagramEditContext.Provider> : node;
  return (
    <ReactFlowProvider>
      <DiagramKitContext.Provider value={kit}>{inner}</DiagramKitContext.Provider>
    </ReactFlowProvider>
  );
}

function renderShape(data: Partial<ShapeData> = {}, options: { selected?: boolean; api?: DiagramEditApi | null } = {}) {
  const api = options.api === undefined ? editApi() : options.api;
  const view = render(tree(<ShapeNode {...shapeProps(data, options.selected)} />, api));
  return { api, ...view };
}

const labelBox = (label = "Box") => screen.getByText(label).parentElement as HTMLElement;
const handles = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".react-flow__handle")];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ShapeNode box styling", () => {
  it("is registered as the canvas shape node type", () => {
    expect(nodeTypes.shape).toBe(ShapeNode);
  });

  it.each<[string, Partial<ShapeData>, string]>([
    ["a plain rectangle", { shape: "rectangle" }, "0"],
    ["a rectangle with a radius", { shape: "rectangle", radius: 4 }, "4px"],
    ["a rounded box", { shape: "roundrect" }, "6px"],
    ["a rounded box with its own radius", { shape: "roundrect", radius: 12 }, "12px"],
    ["a circle", { shape: "circle", radius: 3 }, "50%"],
    ["an ellipse", { shape: "ellipse" }, "50%"],
  ])("rounds %s to %s", (_name, data, radius) => {
    renderShape(data);
    expect(labelBox()).toHaveStyle({ borderRadius: radius });
  });

  it("draws the stroke with its width and style", () => {
    renderShape({ stroke: "#112233", strokeWidth: 2, strokeStyle: "dashed", fill: "#ffeedd" });
    expect(labelBox()).toHaveStyle({ border: "2px dashed #112233", background: "#ffeedd" });
  });

  it("defaults a stroke to one solid pixel", () => {
    renderShape({ stroke: "#112233" });
    expect(labelBox()).toHaveStyle({ border: "1px solid #112233" });
  });

  it("draws no border and a transparent background without stroke or fill", () => {
    renderShape({});
    expect(labelBox().style.borderStyle).toBe("none");
    expect(labelBox().style.background).toBe("transparent");
  });

  it.each<[string, Partial<ShapeData>, string]>([
    ["free text in the default colour", { shape: "text" }, "inherit"],
    ["free text in the old default slate", { shape: "text", textColor: "#0f172a" }, "inherit"],
    ["filled text in slate", { shape: "text", fill: "#ffffff", textColor: "#0f172a" }, "rgb(15, 23, 42)"],
    ["free text in red", { shape: "text", textColor: "#ff0000" }, "rgb(255, 0, 0)"],
    ["a shape with a text colour", { shape: "rectangle", textColor: "#00ff00" }, "rgb(0, 255, 0)"],
    ["a shape without a text colour", { shape: "rectangle" }, "inherit"],
  ])("colours %s as %s", (_name, data, color) => {
    renderShape(data);
    expect(labelBox().style.color).toBe(color);
  });

  it.each<[ShapeData["fontFamily"], string]>([
    ["sans", "Latin Modern Sans"],
    ["mono", "Latin Modern Mono"],
    ["serif", "Latin Modern Roman"],
    [undefined, "Latin Modern Roman"],
  ])("sets the %s font", (fontFamily, family) => {
    renderShape({ fontFamily });
    expect(labelBox().style.fontFamily).toContain(family);
  });

  it("sizes the label in points", () => {
    renderShape({ fontSize: 14 });
    expect(labelBox()).toHaveStyle({ fontSize: "14pt" });
    cleanup();
    renderShape({});
    expect(labelBox()).toHaveStyle({ fontSize: "10pt" });
  });
});

describe("ShapeNode polygons", () => {
  it.each<[ShapeData["shape"], string]>([
    ["diamond", "50,0 100,50 50,100 0,50"],
    ["parallelogram", "22,0 100,0 78,100 0,100"],
  ])("draws a %s as an SVG polygon", (shape, points) => {
    const { container } = renderShape({ shape, fill: "#abcdef", stroke: "#123456", strokeWidth: 3, strokeStyle: "dotted" });
    const polygon = container.querySelector("polygon") as SVGPolygonElement;
    expect(polygon.getAttribute("points")).toBe(points);
    expect(polygon.getAttribute("fill")).toBe("#abcdef");
    expect(polygon.getAttribute("stroke")).toBe("#123456");
    expect(polygon.getAttribute("stroke-width")).toBe("3");
    expect(polygon.getAttribute("stroke-dasharray")).toBe("1.5,4");
    expect(labelBox().style.borderStyle).toBe("none");
    expect(labelBox().style.background).toBe("transparent");
    expect(labelBox()).toHaveStyle({ borderRadius: "0" });
  });

  it("dashes a polygon border and defaults its width", () => {
    const { container } = renderShape({ shape: "diamond", stroke: "#123456", strokeStyle: "dashed" });
    const polygon = container.querySelector("polygon") as SVGPolygonElement;
    expect(polygon.getAttribute("stroke-dasharray")).toBe("6,4");
    expect(polygon.getAttribute("stroke-width")).toBe("1");
  });

  it("leaves an unstroked, unfilled polygon open", () => {
    const { container } = renderShape({ shape: "diamond", strokeStyle: "solid" });
    const polygon = container.querySelector("polygon") as SVGPolygonElement;
    expect(polygon.getAttribute("fill")).toBe("transparent");
    expect(polygon.getAttribute("stroke")).toBe("none");
    expect(polygon.getAttribute("stroke-width")).toBe("0");
    expect(polygon.hasAttribute("stroke-dasharray")).toBe(false);
  });

  it("does not draw a polygon for box shapes", () => {
    const { container } = renderShape({ shape: "ellipse" });
    expect(container.querySelector("polygon")).toBeNull();
  });
});

describe("ShapeNode handles", () => {
  it("shows its four connection handles only while hovered", () => {
    const { container } = renderShape();
    const all = handles(container);
    expect(all.map((handle) => handle.dataset.handleid)).toEqual(["t", "r", "b", "l"]);
    expect(all.every((handle) => handle.style.opacity === "0")).toBe(true);
    expect(all[0]).toHaveStyle({ border: `1px solid ${PRIMARY}` });
    fireEvent.mouseEnter(labelBox().parentElement as HTMLElement);
    expect(handles(container).every((handle) => handle.style.opacity === "1")).toBe(true);
    fireEvent.mouseLeave(labelBox().parentElement as HTMLElement);
    expect(handles(container).every((handle) => handle.style.opacity === "0")).toBe(true);
  });

  it("keeps handles and resize controls visible while selected", () => {
    const { container } = renderShape({}, { selected: true });
    expect(handles(container).every((handle) => handle.style.opacity === "1")).toBe(true);
    expect(container.querySelectorAll(".react-flow__resize-control")).toHaveLength(8);
    expect(container.querySelectorAll(".diagram-resize-nwse")).toHaveLength(2);
    expect(container.querySelector('[data-tour="diagram-handles"]')).not.toBeNull();
  });

  it("has no resize controls while unselected", () => {
    const { container } = renderShape();
    expect(container.querySelectorAll(".react-flow__resize-control")).toHaveLength(0);
    expect(container.querySelector('[data-tour="diagram-handles"]')).toBeNull();
  });

  it("moves parallelogram handles onto its slanted edges", () => {
    const { container } = renderShape({ shape: "parallelogram" });
    expect(handles(container).map((handle) => handle.style.left)).toEqual(["61%", "89%", "39%", "11%"]);
  });
});

describe("ShapeNode label editing", () => {
  it("starts editing on double click", () => {
    const api = editApi();
    renderShape({}, { api });
    fireEvent.doubleClick(screen.getByText("Box"));
    expect(api.beginEdit).toHaveBeenCalledWith("n1");
  });

  it("selects the current label once the editor opens", () => {
    renderShape({ label: "Draft me" }, { api: editApi({ editingId: "n1" }) });
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(editor).toHaveValue("Draft me");
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, "Draft me".length]);
  });

  it("commits the typed label on Enter but not on Shift+Enter", () => {
    const api = editApi({ editingId: "n1" });
    renderShape({}, { api });
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "Renamed" } });
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(api.commitLabel).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(api.commitLabel).toHaveBeenCalledWith("n1", "Renamed");
  });

  it("commits on blur and cancels on Escape", () => {
    const api = editApi({ editingId: "n1" });
    renderShape({}, { api });
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "Blurred" } });
    fireEvent.blur(editor);
    expect(api.commitLabel).toHaveBeenCalledWith("n1", "Blurred");
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(api.cancelEdit).toHaveBeenCalledTimes(1);
  });

  it("keeps editor keystrokes away from canvas shortcuts", () => {
    const shortcut = vi.fn();
    window.addEventListener("keydown", shortcut);
    renderShape({}, { api: editApi({ editingId: "n1" }) });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "z", ctrlKey: true });
    window.removeEventListener("keydown", shortcut);
    expect(shortcut).not.toHaveBeenCalled();
  });

  it("resets the draft when the label changes while editing", () => {
    const api = editApi({ editingId: "n1" });
    const view = render(tree(<ShapeNode {...shapeProps({ label: "First" })} />, api));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Typing" } });
    view.rerender(tree(<ShapeNode {...shapeProps({ label: "Second" })} />, api));
    expect(screen.getByRole("textbox")).toHaveValue("Second");
  });

  it("shows the plain label for nodes other than the one being edited", () => {
    renderShape({}, { api: editApi({ editingId: "other" }) });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Box")).toBeInTheDocument();
  });

  it("stays read-only outside an edit provider", () => {
    renderShape({}, { api: null });
    fireEvent.doubleClick(screen.getByText("Box"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("needs the host kit to render", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ReactFlowProvider><ShapeNode {...shapeProps({})} /></ReactFlowProvider>)).toThrow(
      "DiagramKitContext is missing. Wrap the diagram UI in a provider.",
    );
  });
});
