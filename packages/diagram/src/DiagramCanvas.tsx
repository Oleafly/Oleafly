import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  reconnectEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useKeyPress,
  MarkerType,
  ConnectionMode,
  BaseEdge,
  Position,
  type Node,
  type Edge,
  type EdgeProps,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Circle,
  Code2,
  Diamond,
  Egg,
  Map as MapIcon,
  Moon,
  PanelRightOpen,
  RectangleHorizontal,
  Sigma,
  Square,
  Sun,
  Type as TypeIcon,
} from "lucide-react";
import { useDiagramKit } from "./kit";
import { nodeTypes } from "./ShapeNode";
import { DiagramEditContext } from "./edit-context";
import { Inspector } from "./Inspector";
import {
  type DiagramModel,
  type DiagNode,
  type DiagEdge,
  type NodeShape,
  type DiagramFontFamily,
  orthogonalRoute,
  type DiagramHandle,
  type DiagramPoint,
  newId,
} from "@openleaf/latex";
import { cn } from "./cn";

const FLOAT_CHROME = "!rounded-lg !border !shadow-md !backdrop-blur-sm";

const DEFAULTS: Record<NodeShape, { w: number; h: number; label: string }> = {
  rectangle: { w: 120, h: 56, label: "Label" },
  roundrect: { w: 120, h: 56, label: "Label" },
  circle: { w: 72, h: 72, label: "" },
  ellipse: { w: 110, h: 64, label: "Label" },
  diamond: { w: 92, h: 92, label: "" },
  parallelogram: { w: 140, h: 60, label: "Label" },
  text: { w: 90, h: 32, label: "Text" },
};

interface NodeStyleDefaults {
  fill: string;
  stroke: string;
  shapeTextColor: string;
  lightTextColor: string;
  darkTextColor: string;
  strokeStyle: DiagNode["strokeStyle"];
  strokeWidth: number;
  fontSize: number;
  fontFamily: DiagramFontFamily;
  radius: number;
  radiusCustomized: boolean;
}

const PALETTE: { shape: NodeShape; label: string; icon: React.ReactNode; seed?: string }[] = [
  { shape: "rectangle", label: "Rectangle", icon: <Square className="size-4" /> },
  { shape: "roundrect", label: "Rounded box", icon: <RectangleHorizontal className="size-4" /> },
  { shape: "circle", label: "Circle", icon: <Circle className="size-4" /> },
  { shape: "ellipse", label: "Ellipse", icon: <Egg className="size-4" /> },
  { shape: "diamond", label: "Diamond", icon: <Diamond className="size-4" /> },
  {
    shape: "parallelogram",
    label: "Parallelogram",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M7 5 H21 L17 19 H3 Z" />
      </svg>
    ),
  },
  { shape: "text", label: "Text", icon: <TypeIcon className="size-4" /> },
  { shape: "text", label: "Math", icon: <Sigma className="size-4" />, seed: "$E = mc^2$" },
  { shape: "text", label: "Code", icon: <Code2 className="size-4" />, seed: "\\texttt{print(x)}" },
];

const routingToType = (r: DiagEdge["routing"]) =>
  r === "orthogonal" ? "diagramOrthogonal" : r === "curved" ? "default" : "straight";

const positionHandle: Record<Position, DiagramHandle> = {
  [Position.Top]: "t",
  [Position.Right]: "r",
  [Position.Bottom]: "b",
  [Position.Left]: "l",
};

function pointDistance(a: DiagramPoint, b: DiagramPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function roundedBend(
  previous: DiagramPoint,
  point: DiagramPoint,
  next: DiagramPoint,
  radius: number,
) {
  const size = Math.min(
    pointDistance(previous, point) / 2,
    pointDistance(point, next) / 2,
    radius,
  );
  if (
    (previous.x === point.x && point.x === next.x) ||
    (previous.y === point.y && point.y === next.y)
  ) {
    return `L${point.x} ${point.y}`;
  }
  if (previous.y === point.y) {
    const xDirection = previous.x < next.x ? -1 : 1;
    const yDirection = previous.y < next.y ? 1 : -1;
    return `L${point.x + size * xDirection},${point.y}Q${point.x},${point.y} ${point.x},${point.y + size * yDirection}`;
  }
  const xDirection = previous.x < next.x ? 1 : -1;
  const yDirection = previous.y < next.y ? -1 : 1;
  return `L${point.x},${point.y + size * yDirection}Q${point.x},${point.y} ${point.x + size * xDirection},${point.y}`;
}

function DiagramOrthogonalEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerStart,
  markerEnd,
  style,
  label,
  interactionWidth,
}: EdgeProps) {
  const route = orthogonalRoute(
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
    positionHandle[sourcePosition],
    positionHandle[targetPosition],
  );
  let path = `M${route.points[0].x} ${route.points[0].y}`;
  for (let index = 1; index < route.points.length - 1; index += 1) {
    path += roundedBend(
      route.points[index - 1],
      route.points[index],
      route.points[index + 1],
      5,
    );
  }
  const last = route.points[route.points.length - 1];
  path += `L${last.x} ${last.y}`;
  return (
    <BaseEdge
      path={path}
      label={label}
      labelX={route.label.x}
      labelY={route.label.y}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth}
    />
  );
}

const edgeTypes = { diagramOrthogonal: DiagramOrthogonalEdge };

function modelNodeToRf(n: DiagNode): Node {
  return {
    id: n.id,
    type: "shape",
    position: { x: n.x, y: n.y },
    width: n.w,
    height: n.h,
    data: {
      shape: n.shape,
      label: n.label,
      fill: n.fill,
      stroke: n.stroke,
      strokeStyle: n.strokeStyle,
      strokeWidth: n.strokeWidth,
      textColor: n.textColor,
      fontSize: n.fontSize,
      fontFamily: n.fontFamily,
      radius: n.radius,
    },
  };
}

function modelEdgeToRf(e: DiagEdge): Edge {
  const marker = { type: MarkerType.ArrowClosed };
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    // Handles default to bottom -> top so programmatic (starter) edges render.
    sourceHandle: e.sourceHandle ?? "b",
    targetHandle: e.targetHandle ?? "t",
    type: routingToType(e.routing),
    label: e.label,
    markerEnd: e.arrow !== "none" ? marker : undefined,
    markerStart: e.arrow === "both" ? marker : undefined,
    style:
      e.style === "dashed"
        ? { strokeDasharray: "6 4" }
        : e.style === "dotted"
          ? { strokeDasharray: "1.5 4", strokeLinecap: "round" }
          : undefined,
    // Allow dragging either end onto a new shape handle.
    reconnectable: true,
    data: { routing: e.routing, arrow: e.arrow, style: e.style, label: e.label },
  };
}

function rfNodeToModel(n: Node): DiagNode {
  const d = n.data as Record<string, unknown>;
  return {
    id: n.id,
    shape: (d.shape as NodeShape) ?? "rectangle",
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    w: Math.round((n.width as number) ?? (n.measured?.width as number) ?? 120),
    h: Math.round((n.height as number) ?? (n.measured?.height as number) ?? 56),
    label: (d.label as string) ?? "",
    fill: d.fill as string | undefined,
    stroke: d.stroke as string | undefined,
    strokeStyle: d.strokeStyle as DiagNode["strokeStyle"],
    strokeWidth: d.strokeWidth as number | undefined,
    textColor: d.textColor as string | undefined,
    fontSize: d.fontSize as number | undefined,
    fontFamily: d.fontFamily as DiagramFontFamily | undefined,
    radius: d.radius as number | undefined,
  };
}

function rfEdgeToModel(e: Edge): DiagEdge {
  const d = (e.data ?? {}) as Record<string, unknown>;
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    routing: (d.routing as DiagEdge["routing"]) ?? "straight",
    arrow: (d.arrow as DiagEdge["arrow"]) ?? "forward",
    style: (d.style as DiagEdge["style"]) ?? "solid",
    label: (d.label as string | undefined) ?? undefined,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  };
}

function CanvasInner({
  model,
  onChange,
  showPreviewAction,
  onShowPreview,
}: {
  model: DiagramModel;
  onChange: (m: DiagramModel) => void;
  showPreviewAction?: boolean;
  onShowPreview?: () => void;
}) {
  const { Tooltip, useThemeMode } = useDiagramKit();
  const themeMode = useThemeMode();
  const { screenToFlowPosition } = useReactFlow();
  // Canvas theme is a per-diagram viewing preference (defaults to the app theme).
  // It only affects the editor surface; shapes keep their own colors and the
  // compiled figure is unaffected.
  const [canvasTheme, setCanvasTheme] = useState<"light" | "dark">(themeMode);
  const canvasDark = canvasTheme === "dark";
  const nodeStyleDefaultsRef = useRef<NodeStyleDefaults>({
    fill: "#ffffff",
    stroke: "#6b7280",
    shapeTextColor: "#000000",
    lightTextColor: "#000000",
    darkTextColor: "#ffffff",
    strokeStyle: "solid",
    strokeWidth: 1,
    fontSize: 11,
    fontFamily: "serif",
    radius: 0,
    radiusCustomized: false,
  });
  const chromeStyle = {
    background: "var(--card)",
    borderColor: "var(--border)",
    color: "var(--card-foreground)",
  };
  const chromeHover = canvasDark ? "hover:bg-white/10" : "hover:bg-black/5";
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(model.nodes.map(modelNodeToRf));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(model.edges.map(modelEdgeToRf));
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [pending, setPending] = useState<{ shape: NodeShape; seed?: string; key: string } | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Space+drag pans the viewport (grab cursor); plain drag never pans.
  const spacePressed = useKeyPress("Space");
  const [isPanning, setIsPanning] = useState(false);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmittedRef = useRef<DiagramModel | null>(model);
  const hydratingRef = useRef(false);
  const firstRunRef = useRef(true);
  const historyRef = useRef<DiagramModel[]>([model]);
  const historyIdxRef = useRef(0);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Click-drag to draw: start point + in-progress node id while the tool is armed.
  const drawRef = useRef<{
    id: string;
    shape: NodeShape;
    seed?: string;
    startX: number;
    startY: number;
    pointerId: number;
  } | null>(null);

  useEffect(() => {
    if (model === lastEmittedRef.current) return;
    hydratingRef.current = true;
    setNodes(model.nodes.map(modelNodeToRf));
    setEdges(model.edges.map(modelEdgeToRf));
    historyRef.current = [model];
    historyIdxRef.current = 0;
  }, [model, setNodes, setEdges]);

  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    const m: DiagramModel = {
      version: 1,
      nodes: nodes.map(rfNodeToModel),
      edges: edges.map(rfEdgeToModel),
    };
    lastEmittedRef.current = m;
    onChangeRef.current(m);
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      const hist = historyRef.current.slice(0, historyIdxRef.current + 1);
      hist.push(m);
      historyRef.current = hist;
      historyIdxRef.current = hist.length - 1;
    }, 400);
  }, [nodes, edges]);

  const restore = useCallback(
    (m: DiagramModel) => {
      hydratingRef.current = true;
      setNodes(m.nodes.map(modelNodeToRf));
      setEdges(m.edges.map(modelEdgeToRf));
      lastEmittedRef.current = m;
      onChangeRef.current(m);
    },
    [setNodes, setEdges],
  );
  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    restore(historyRef.current[historyIdxRef.current]);
  }, [restore]);
  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    restore(historyRef.current[historyIdxRef.current]);
  }, [restore]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drawRef.current) {
          const id = drawRef.current.id;
          drawRef.current = null;
          setNodes((ns) => ns.filter((n) => n.id !== id));
        }
        setPending(null);
        return;
      }
      // Keep Space from scrolling the page while panning the canvas.
      if (e.code === "Space") {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
        e.preventDefault();
      }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, setNodes]);

  const pendingRef = useRef<{ shape: NodeShape; seed?: string; key: string } | null>(null);
  pendingRef.current = pending;

  const makeDrawnNode = useCallback(
    (id: string, shape: NodeShape, x: number, y: number, w: number, h: number, label: string): Node => {
      const defaults = nodeStyleDefaultsRef.current;
      const standaloneText = shape === "text";
      const n: DiagNode = {
        id,
        shape,
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
        label,
        fill: standaloneText ? "" : defaults.fill,
        stroke: standaloneText ? "" : defaults.stroke,
        strokeStyle: defaults.strokeStyle,
        strokeWidth: defaults.strokeWidth,
        textColor: standaloneText
          ? canvasDark
            ? defaults.darkTextColor
            : defaults.lightTextColor
          : defaults.shapeTextColor,
        fontSize: defaults.fontSize,
        fontFamily: defaults.fontFamily,
        radius:
          shape === "roundrect" && !defaults.radiusCustomized
            ? 6
            : defaults.radius,
      };
      const rf = modelNodeToRf(n);
      // Keep style in sync so the rubber-band resize paints immediately.
      return { ...rf, style: { width: n.w, height: n.h } };
    },
    [canvasDark],
  );

  const finishDraw = useCallback(
    (clientX: number, clientY: number) => {
      const d = drawRef.current;
      if (!d) return;
      drawRef.current = null;
      const end = screenToFlowPosition({ x: clientX, y: clientY });
      let x = Math.min(d.startX, end.x);
      let y = Math.min(d.startY, end.y);
      let w = Math.abs(end.x - d.startX);
      let h = Math.abs(end.y - d.startY);
      const def = DEFAULTS[d.shape];
      // Click without a real drag → place the default-sized shape centered on the point.
      if (w < 8 && h < 8) {
        w = def.w;
        h = def.h;
        x = d.startX - w / 2;
        y = d.startY - h / 2;
      } else {
        w = Math.max(w, 24);
        h = Math.max(h, 24);
        // Circles stay circular from the bounding box's shorter side.
        if (d.shape === "circle") {
          const s = Math.max(w, h);
          w = s;
          h = s;
        }
      }
      const label = d.seed ?? def.label;
      setNodes((ns) =>
        ns.map((n) => (n.id === d.id ? makeDrawnNode(d.id, d.shape, x, y, w, h, label) : n)),
      );
      setPending(null);
      setSelNode(d.id);
    },
    [screenToFlowPosition, setNodes, makeDrawnNode],
  );

  const onFlowPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (spacePressed) return; // Space+drag is for panning
      const p = pendingRef.current;
      if (!p) return;
      const el = e.target as Element;
      // Only start a draw on empty canvas, not on nodes/handles/UI chrome.
      if (!el.closest?.(".react-flow__pane")) return;
      if (el.closest?.(".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap")) {
        return;
      }
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      const start = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = newId();
      const def = DEFAULTS[p.shape];
      drawRef.current = {
        id,
        shape: p.shape,
        seed: p.seed,
        startX: start.x,
        startY: start.y,
        pointerId: e.pointerId,
      };
      // Seed a 1×1 rubber-band; pointer-move grows it.
      setNodes((ns) => [
        ...ns,
        makeDrawnNode(id, p.shape, start.x, start.y, 1, 1, p.seed ?? def.label),
      ]);
      setSelNode(id);
    },
    [spacePressed, screenToFlowPosition, setNodes, makeDrawnNode],
  );

  const onFlowPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drawRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const cur = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let x = Math.min(d.startX, cur.x);
      let y = Math.min(d.startY, cur.y);
      let w = Math.max(Math.abs(cur.x - d.startX), 1);
      let h = Math.max(Math.abs(cur.y - d.startY), 1);
      if (d.shape === "circle") {
        const s = Math.max(w, h);
        // Grow from the start corner along the dominant axis.
        if (cur.x < d.startX) x = d.startX - s;
        if (cur.y < d.startY) y = d.startY - s;
        w = s;
        h = s;
      }
      const label = d.seed ?? DEFAULTS[d.shape].label;
      setNodes((ns) =>
        ns.map((n) => (n.id === d.id ? makeDrawnNode(d.id, d.shape, x, y, w, h, label) : n)),
      );
    },
    [screenToFlowPosition, setNodes, makeDrawnNode],
  );

  const onFlowPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drawRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        /* already released */
      }
      finishDraw(e.clientX, e.clientY);
    },
    [finishDraw],
  );

  // Z-order: the node array order is the draw order (later draws on top). Move
  // the selected node within it and reassign zIndex for the editing surface.
  const reorder = useCallback(
    (dir: "front" | "back" | "forward" | "backward") => {
      if (!selNode) return;
      setNodes((ns) => {
        const i = ns.findIndex((n) => n.id === selNode);
        if (i < 0) return ns;
        const arr = [...ns];
        const [item] = arr.splice(i, 1);
        if (dir === "front") arr.push(item);
        else if (dir === "back") arr.unshift(item);
        else if (dir === "forward") arr.splice(Math.min(i + 1, arr.length), 0, item);
        else arr.splice(Math.max(i - 1, 0), 0, item);
        return arr.map((n, idx) => ({ ...n, zIndex: idx }));
      });
    },
    [selNode, setNodes],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const e: DiagEdge = {
        id: newId("e"),
        source: c.source,
        target: c.target,
        routing: "straight",
        arrow: "forward",
        style: "solid",
        sourceHandle: c.sourceHandle ?? undefined,
        targetHandle: c.targetHandle ?? undefined,
      };
      setEdges((es) => addEdge(modelEdgeToRf(e), es));
    },
    [setEdges],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((es) => reconnectEdge(oldEdge, newConnection, es));
    },
    [setEdges],
  );

  const patchNode = useCallback(
    (patch: Partial<DiagNode>) => {
      if (!selNode) return;
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== selNode) return n;
          const defaults = nodeStyleDefaultsRef.current;
          const data = n.data as Record<string, unknown>;
          if (patch.fill !== undefined) defaults.fill = patch.fill;
          if (patch.stroke !== undefined) defaults.stroke = patch.stroke;
          if (patch.strokeStyle !== undefined) defaults.strokeStyle = patch.strokeStyle;
          if (patch.strokeWidth !== undefined) defaults.strokeWidth = patch.strokeWidth;
          if (patch.fontSize !== undefined) defaults.fontSize = patch.fontSize;
          if (patch.fontFamily !== undefined) defaults.fontFamily = patch.fontFamily;
          if (patch.radius !== undefined) {
            defaults.radius = patch.radius;
            defaults.radiusCustomized = true;
          }
          if (patch.textColor !== undefined) {
            if (data.shape === "text") {
              if (canvasDark) defaults.darkTextColor = patch.textColor;
              else defaults.lightTextColor = patch.textColor;
            } else {
              defaults.shapeTextColor = patch.textColor;
            }
          }
          return { ...n, data: { ...n.data, ...patch } };
        }),
      );
    },
    [canvasDark, selNode, setNodes],
  );
  const patchEdge = useCallback(
    (patch: Partial<DiagEdge>) => {
      if (!selEdge) return;
      setEdges((es) =>
        es.map((e) => {
          if (e.id !== selEdge) return e;
          // Rebuilding an edge is necessary to update its marker, route, and
          // dash rendering. Preserve React Flow's interaction state, otherwise
          // the edge becomes deselected and the inspector vanishes after every
          // value change.
          return { ...e, ...modelEdgeToRf({ ...rfEdgeToModel(e), ...patch }), selected: e.selected };
        }),
      );
    },
    [selEdge, setEdges],
  );

  const editApi = useMemo(
    () => ({
      editingId,
      beginEdit: (edId: string) => setEditingId(edId),
      cancelEdit: () => setEditingId(null),
      commitLabel: (edId: string, label: string) => {
        setNodes((ns) => ns.map((n) => (n.id === edId ? { ...n, data: { ...n.data, label } } : n)));
        setEditingId(null);
      },
    }),
    [editingId, setNodes],
  );

  const selectedNode = useMemo(
    () => (selNode ? (nodes.find((n) => n.id === selNode) ?? null) : null),
    [selNode, nodes],
  );
  const selectedEdge = useMemo(
    () => (selEdge ? (edges.find((e) => e.id === selEdge) ?? null) : null),
    [selEdge, edges],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex h-8 shrink-0 items-center gap-2 border-b bg-background px-2">
        <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground">
          {pending
            ? "Click and Drag on the Canvas to Draw the Shape (Esc to Cancel)"
            : spacePressed
              ? "Drag to Pan the Canvas"
              : "Drag Shapes to Move · Drag Handles to Connect · Space + Drag to Pan · Double-Click to Edit Text"}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {showPreviewAction && onShowPreview && (
            <Tooltip label="Show compiled preview">
              <button
                type="button"
                aria-label="Show preview"
                onClick={onShowPreview}
                className="mr-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <PanelRightOpen className="size-3.5" />
                Preview
              </button>
            </Tooltip>
          )}
          <Tooltip label={canvasTheme === "dark" ? "Light canvas" : "Dark canvas"}>
            <button
              type="button"
              aria-label="Toggle canvas theme"
              onClick={() => setCanvasTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {canvasTheme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
          </Tooltip>
          <Tooltip label={showMinimap ? "Hide minimap" : "Show minimap"}>
            <button
              type="button"
              aria-label="Toggle minimap"
              aria-pressed={showMinimap}
              onClick={() => setShowMinimap((v) => !v)}
              className={cn(
                "flex size-6 items-center justify-center rounded transition-colors",
                showMinimap ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <MapIcon className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div
        data-tour="diagram-canvas"
        data-tour-selection={selectedNode || selectedEdge ? "true" : "false"}
        className={cn(
          canvasDark ? "dark" : "light",
          "relative min-h-0 flex-1",
          pending && !spacePressed && "[&_.react-flow__pane]:cursor-crosshair",
          spacePressed && !isPanning && "[&_.react-flow__pane]:cursor-grab",
          spacePressed && isPanning && "[&_.react-flow__pane]:cursor-grabbing",
        )}
        style={{ background: canvasDark ? "#121212" : "#ffffff" }}
        // Block the app-wide dev context menu on the canvas.
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onFlowPointerDown}
        onPointerMove={onFlowPointerMove}
        onPointerUp={onFlowPointerUp}
        onPointerCancel={onFlowPointerUp}
      >
        <div
          data-tour="diagram-palette"
          role="toolbar"
          aria-label="Shape tools"
          style={chromeStyle}
          className="absolute left-2 top-2 z-10 flex flex-col gap-0.5 rounded-lg border p-1 shadow-md backdrop-blur-sm"
        >
          {PALETTE.map((p) => (
            <Tooltip key={p.label} label={`${p.label} (click and drag to draw)`} side="right">
              <button
                type="button"
                aria-label={p.label}
                aria-pressed={pending?.key === p.label}
                onClick={() =>
                  setPending((cur) =>
                    cur?.key === p.label ? null : { shape: p.shape, seed: p.seed, key: p.label },
                  )
                }
                className={cn(
                  "flex size-8 items-center justify-center rounded-md transition-colors",
                  pending?.key === p.label
                    ? "bg-primary text-primary-foreground"
                    : chromeHover,
                )}
              >
                {p.icon}
              </button>
            </Tooltip>
          ))}
        </div>

        {(selectedNode || selectedEdge) && (
          <div
            data-tour="diagram-inspector"
            role="complementary"
            aria-label="Shape style"
            style={chromeStyle}
            className="absolute right-2 top-2 z-10 max-h-[calc(100%-1rem)] w-56 overflow-y-auto rounded-lg border shadow-md backdrop-blur-sm"
          >
            <Inspector
              node={selectedNode ? rfNodeToModel(selectedNode) : null}
              edge={selectedEdge ? rfEdgeToModel(selectedEdge) : null}
              onNodeChange={patchNode}
              onEdgeChange={patchEdge}
              onReorder={reorder}
            />
          </div>
        )}

        <DiagramEditContext.Provider value={editApi}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode={canvasTheme}
            connectionMode={ConnectionMode.Loose}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            edgesReconnectable
            panOnDrag={spacePressed}
            panActivationKeyCode={null}
            onMoveStart={() => setIsPanning(true)}
            onMoveEnd={() => setIsPanning(false)}
            onNodesDelete={(deleted) => {
              // Remove edges attached to a deleted node so no orphan arrows
              // survive into the compiled figure.
              const ids = new Set(deleted.map((n) => n.id));
              setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
            }}
            onPaneContextMenu={(e) => e.preventDefault()}
            onSelectionChange={({ nodes: sn, edges: se }) => {
              setSelNode(sn[0]?.id ?? null);
              setSelEdge(se[0]?.id ?? null);
            }}
            snapToGrid
            snapGrid={[10, 10]}
            // Larger snap radius so arrow heads/tails stick to shape handles more easily.
            connectionRadius={28}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ reconnectable: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls
              showInteractive={false}
              style={chromeStyle}
              className={cn(FLOAT_CHROME, "!gap-0.5 !p-1 [&>button]:!rounded-md [&>button]:!border-0 [&>button]:!bg-transparent [&>button]:!text-current [&_svg]:!fill-current")}
            />
            {showMinimap && (
              <MiniMap
                pannable
                zoomable
                style={chromeStyle}
                bgColor="transparent"
                maskColor={canvasDark ? "rgba(18,18,18,0.6)" : "rgba(255,255,255,0.6)"}
                nodeColor={canvasDark ? "#3a3a3a" : "#d4d4d4"}
                nodeStrokeColor={canvasDark ? "#525252" : "#a3a3a3"}
                className={cn(FLOAT_CHROME, "!overflow-hidden")}
              />
            )}
          </ReactFlow>
        </DiagramEditContext.Provider>
      </div>
    </div>
  );
}

export function DiagramCanvas(props: {
  model: DiagramModel;
  onChange: (m: DiagramModel) => void;
  showPreviewAction?: boolean;
  onShowPreview?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
