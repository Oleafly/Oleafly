import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Circle,
  Code2,
  Diamond,
  Egg,
  Map as MapIcon,
  RectangleHorizontal,
  Sigma,
  Square,
  Type as TypeIcon,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useTheme } from "@/lib/theme";
import { nodeTypes } from "@/components/diagram/nodes/ShapeNode";
import { DiagramEditContext } from "@/components/diagram/nodes/edit-context";
import { Inspector } from "@/components/diagram/Inspector";
import {
  type DiagramModel,
  type DiagNode,
  type DiagEdge,
  type NodeShape,
  newId,
} from "@/components/diagram/model";
import { cn } from "@/lib/utils";

const DEFAULTS: Record<NodeShape, { w: number; h: number; label: string }> = {
  rectangle: { w: 120, h: 56, label: "Label" },
  roundrect: { w: 120, h: 56, label: "Label" },
  circle: { w: 72, h: 72, label: "" },
  ellipse: { w: 110, h: 64, label: "Label" },
  diamond: { w: 92, h: 92, label: "" },
  text: { w: 90, h: 32, label: "Text" },
};

const PALETTE: { shape: NodeShape; label: string; icon: React.ReactNode; seed?: string }[] = [
  { shape: "rectangle", label: "Rectangle", icon: <Square className="size-4" /> },
  { shape: "roundrect", label: "Rounded box", icon: <RectangleHorizontal className="size-4" /> },
  { shape: "circle", label: "Circle", icon: <Circle className="size-4" /> },
  { shape: "ellipse", label: "Ellipse", icon: <Egg className="size-4" /> },
  { shape: "diamond", label: "Diamond", icon: <Diamond className="size-4" /> },
  { shape: "text", label: "Text", icon: <TypeIcon className="size-4" /> },
  { shape: "text", label: "Math", icon: <Sigma className="size-4" />, seed: "$E = mc^2$" },
  { shape: "text", label: "Code", icon: <Code2 className="size-4" />, seed: "\\texttt{print(x)}" },
];

const routingToType = (r: DiagEdge["routing"]) =>
  r === "orthogonal" ? "smoothstep" : r === "curved" ? "default" : "straight";

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
    type: routingToType(e.routing),
    label: e.label,
    markerEnd: e.arrow !== "none" ? marker : undefined,
    markerStart: e.arrow === "both" ? marker : undefined,
    style: e.style === "dashed" ? { strokeDasharray: "6 4" } : undefined,
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
  };
}

function CanvasInner({
  model,
  onChange,
}: {
  model: DiagramModel;
  onChange: (m: DiagramModel) => void;
}) {
  const { theme } = useTheme();
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(model.nodes.map(modelNodeToRf));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(model.edges.map(modelEdgeToRf));
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [pending, setPending] = useState<{ shape: NodeShape; seed?: string; key: string } | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmittedRef = useRef<DiagramModel | null>(model);
  const hydratingRef = useRef(false);
  const firstRunRef = useRef(true);
  const historyRef = useRef<DiagramModel[]>([model]);
  const historyIdxRef = useRef(0);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (e.key === "Escape") setPending(null);
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const placeNode = useCallback(
    (shape: NodeShape, flowX: number, flowY: number, label?: string) => {
      const def = DEFAULTS[shape];
      const n: DiagNode = {
        id: newId(),
        shape,
        x: Math.round(flowX - def.w / 2),
        y: Math.round(flowY - def.h / 2),
        w: def.w,
        h: def.h,
        label: label ?? def.label,
        fill: shape === "text" ? "" : "#eef2ff",
        stroke: shape === "text" ? "" : "#1e293b",
        strokeStyle: "solid",
        strokeWidth: 1,
        textColor: "#0f172a",
        // Sharp edges by default; the rounded-box tool opts into a radius.
        radius: shape === "roundrect" ? 6 : 0,
      };
      setNodes((ns) => [...ns, modelNodeToRf(n)]);
    },
    [setNodes],
  );

  // Pending placement carries the palette entry's shape + optional seed label.
  const pendingRef = useRef<{ shape: NodeShape; seed?: string } | null>(null);
  pendingRef.current = pending;

  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      const p = pendingRef.current;
      if (!p) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      placeNode(p.shape, pos.x, pos.y, p.seed);
      setPending(null);
    },
    [placeNode, screenToFlowPosition],
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
      };
      setEdges((es) => addEdge(modelEdgeToRf(e), es));
    },
    [setEdges],
  );

  const patchNode = useCallback(
    (patch: Partial<DiagNode>) => {
      if (!selNode) return;
      setNodes((ns) => ns.map((n) => (n.id === selNode ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [selNode, setNodes],
  );
  const patchEdge = useCallback(
    (patch: Partial<DiagEdge>) => {
      if (!selEdge) return;
      setEdges((es) => es.map((e) => (e.id === selEdge ? modelEdgeToRf({ ...rfEdgeToModel(e), ...patch }) : e)));
    },
    [selEdge, setEdges],
  );

  // Inline label editing API for the shape nodes.
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
    <div className="flex h-full min-h-0">
      {/* Palette */}
      <div className="flex shrink-0 flex-col gap-1 border-r bg-sidebar p-1.5">
        {PALETTE.map((p) => (
          <Tooltip key={p.label} label={`${p.label} (click, then click canvas)`} side="right">
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
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {p.icon}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Canvas + top toolbar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-sidebar px-2">
          <span className="text-[11px] text-muted-foreground">
            {pending ? "Click on the canvas to place the shape (Esc to cancel)." : "Drag to move, double-click to edit text, drag a handle to connect."}
          </span>
          <div className="ml-auto">
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
        <div className={cn("min-h-0 flex-1", pending && "[&_.react-flow__pane]:cursor-crosshair")}>
          <DiagramEditContext.Provider value={editApi}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              colorMode={theme === "dark" ? "dark" : "light"}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onPaneClick={onPaneClick}
              onSelectionChange={({ nodes: sn, edges: se }) => {
                setSelNode(sn[0]?.id ?? null);
                setSelEdge(se[0]?.id ?? null);
              }}
              snapToGrid
              snapGrid={[10, 10]}
              fitView
              deleteKeyCode={["Backspace", "Delete"]}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
              <Controls showInteractive={false} />
              {showMinimap && <MiniMap pannable zoomable />}
            </ReactFlow>
          </DiagramEditContext.Provider>
        </div>
      </div>

      {/* Inspector */}
      <div className="w-56 shrink-0 overflow-y-auto border-l bg-sidebar">
        <Inspector
          node={selectedNode ? rfNodeToModel(selectedNode) : null}
          edge={selectedEdge ? rfEdgeToModel(selectedEdge) : null}
          onNodeChange={patchNode}
          onEdgeChange={patchEdge}
          onReorder={reorder}
        />
      </div>
    </div>
  );
}

/** Visual node/edge editor that generates TikZ. React Flow is the editing
 *  surface; the model is the source of truth (see tikz-serializer). */
export function DiagramCanvas(props: { model: DiagramModel; onChange: (m: DiagramModel) => void }) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
