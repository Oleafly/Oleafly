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
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Circle,
  Diamond,
  Egg,
  RectangleHorizontal,
  Square,
  Type as TypeIcon,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { nodeTypes } from "@/components/diagram/nodes/ShapeNode";
import { Inspector } from "@/components/diagram/Inspector";
import {
  type DiagramModel,
  type DiagNode,
  type DiagEdge,
  type NodeShape,
  newId,
} from "@/components/diagram/model";

const DEFAULTS: Record<NodeShape, { w: number; h: number; label: string }> = {
  rectangle: { w: 120, h: 56, label: "Label" },
  roundrect: { w: 120, h: 56, label: "Label" },
  circle: { w: 72, h: 72, label: "" },
  ellipse: { w: 110, h: 64, label: "Label" },
  diamond: { w: 92, h: 92, label: "" },
  text: { w: 90, h: 32, label: "Text" },
};

const PALETTE: { shape: NodeShape; label: string; icon: React.ReactNode }[] = [
  { shape: "rectangle", label: "Rectangle", icon: <Square className="size-4" /> },
  { shape: "roundrect", label: "Rounded box", icon: <RectangleHorizontal className="size-4" /> },
  { shape: "circle", label: "Circle", icon: <Circle className="size-4" /> },
  { shape: "ellipse", label: "Ellipse", icon: <Egg className="size-4" /> },
  { shape: "diamond", label: "Diamond", icon: <Diamond className="size-4" /> },
  { shape: "text", label: "Text", icon: <TypeIcon className="size-4" /> },
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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(model.nodes.map(modelNodeToRf));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(model.edges.map(modelEdgeToRf));
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmittedRef = useRef<DiagramModel | null>(model);
  const hydratingRef = useRef(false);
  const firstRunRef = useRef(true);
  const cascadeRef = useRef(0);
  // Undo/redo history of models (coalesced).
  const historyRef = useRef<DiagramModel[]>([model]);
  const historyIdxRef = useRef(0);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-hydrate the canvas when the parent replaces the model (e.g. opening an
  // embedded diagram). Skips our own echoes via reference check.
  useEffect(() => {
    if (model === lastEmittedRef.current) return;
    hydratingRef.current = true;
    setNodes(model.nodes.map(modelNodeToRf));
    setEdges(model.edges.map(modelEdgeToRf));
    historyRef.current = [model];
    historyIdxRef.current = 0;
  }, [model, setNodes, setEdges]);

  // Emit the derived model on any canvas change (except right after hydration).
  useEffect(() => {
    // Skip the mount run (and hydration echoes) so merely opening the canvas
    // does not regenerate code and clobber hand edits; only real edits emit.
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
    // Coalesce history snapshots so a drag does not flood undo.
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
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const addNode = useCallback(
    (shape: NodeShape) => {
      const def = DEFAULTS[shape];
      const k = cascadeRef.current++ % 6;
      const n: DiagNode = {
        id: newId(),
        shape,
        x: 120 + k * 28,
        y: 100 + k * 28,
        w: def.w,
        h: def.h,
        label: def.label,
        fill: shape === "text" ? "" : "#eef2ff",
        stroke: shape === "text" ? "" : "#1e293b",
        strokeStyle: "solid",
        strokeWidth: 1,
        textColor: "#0f172a",
      };
      setNodes((ns) => [...ns, modelNodeToRf(n)]);
    },
    [setNodes],
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
      setNodes((ns) =>
        ns.map((n) => (n.id === selNode ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
    },
    [selNode, setNodes],
  );
  const patchEdge = useCallback(
    (patch: Partial<DiagEdge>) => {
      if (!selEdge) return;
      setEdges((es) =>
        es.map((e) => (e.id === selEdge ? modelEdgeToRf({ ...rfEdgeToModel(e), ...patch }) : e)),
      );
    },
    [selEdge, setEdges],
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
          <Tooltip key={p.shape} label={p.label} side="right">
            <button
              type="button"
              aria-label={p.label}
              onClick={() => addNode(p.shape)}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {p.icon}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Canvas */}
      <div className="min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
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
          <MiniMap pannable zoomable className="!bg-sidebar" />
        </ReactFlow>
      </div>

      {/* Inspector */}
      <div className="w-52 shrink-0 overflow-y-auto border-l bg-sidebar">
        <Inspector
          node={selectedNode ? rfNodeToModel(selectedNode) : null}
          edge={selectedEdge ? rfEdgeToModel(selectedEdge) : null}
          onNodeChange={patchNode}
          onEdgeChange={patchEdge}
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
