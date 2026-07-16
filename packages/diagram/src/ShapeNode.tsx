import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import type { NodeShape, StrokeStyle } from "@openleaf/latex";
import { useDiagramEdit } from "./edit-context";

export interface ShapeData {
  shape: NodeShape;
  label: string;
  fill?: string;
  stroke?: string;
  strokeStyle?: StrokeStyle;
  strokeWidth?: number;
  textColor?: string;
  fontSize?: number;
  radius?: number;
  [key: string]: unknown;
}

const HANDLES = [
  { id: "t", pos: Position.Top },
  { id: "r", pos: Position.Right },
  { id: "b", pos: Position.Bottom },
  { id: "l", pos: Position.Left },
];

export function ShapeNode({ id, data, selected }: NodeProps) {
  const d = data as ShapeData;
  const edit = useDiagramEdit();
  const editing = edit.editingId === id;
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState(d.label);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(d.label);
      // Focus + select on the next tick so the textarea is mounted.
      requestAnimationFrame(() => taRef.current?.select());
    }
  }, [editing, d.label]);

  const hasBorder = !!d.stroke;
  // Diamond and parallelogram render as SVG polygons so their borders and
  // proportions match the compiled TikZ output at any width/height. (A CSS
  // rotate(45deg) box only looks like a rhombus while it stays square.)
  const polygon =
    d.shape === "diamond"
      ? "50,0 100,50 50,100 0,50"
      : d.shape === "parallelogram"
        ? "22,0 100,0 78,100 0,100"
        : null;
  const round =
    d.shape === "circle" || d.shape === "ellipse"
      ? "50%"
      : d.radius != null
        ? `${d.radius}px`
        : d.shape === "roundrect"
          ? "8px"
          : "0";
  const dashArray =
    d.strokeStyle === "dashed" ? "6,4" : d.strokeStyle === "dotted" ? "1.5,4" : undefined;

  const style: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 4,
    boxSizing: "border-box",
    fontSize: d.fontSize ? d.fontSize * 1.6 : 12,
    // Match the compiled LaTeX default (Computer Modern) so the canvas preview
    // reflects the rendered serif type rather than the app's sans-serif UI font.
    fontFamily: "'Latin Modern Roman', 'CMU Serif', Georgia, 'Times New Roman', serif",
    color: d.textColor || "inherit",
    background: polygon ? "transparent" : d.fill || "transparent",
    border:
      polygon || !hasBorder
        ? "none"
        : `${d.strokeWidth ?? 1}px ${d.strokeStyle || "solid"} ${d.stroke}`,
    borderRadius: polygon ? "0" : round,
    overflow: "hidden",
  };
  // Keep the label above the SVG fill (positioned children paint over in-flow).
  const labelStyle: CSSProperties = { position: "relative", zIndex: 1 };
  const handlesVisible = hover || selected;

  const commit = () => edit.commitLabel(id, draft);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        edit.beginEdit(id);
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={30}
        minHeight={24}
        lineClassName="!border-primary"
        handleClassName="!bg-background !border-primary"
      />
      <div style={style}>
        {polygon && (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          >
            <polygon
              points={polygon}
              fill={d.fill || "transparent"}
              stroke={hasBorder ? d.stroke : "none"}
              strokeWidth={hasBorder ? d.strokeWidth ?? 1 : 0}
              strokeDasharray={dashArray}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        {editing ? (
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                edit.cancelEdit();
              }
              e.stopPropagation();
            }}
            className="nodrag h-full w-full resize-none bg-transparent text-center outline-none"
            style={{ ...labelStyle, fontSize: "inherit", color: "inherit" }}
          />
        ) : (
          <span style={labelStyle}>{d.label}</span>
        )}
      </div>
      {HANDLES.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          // source + Loose connection mode: drag out to create, or accept
          // reconnected arrow heads/tails from other shapes.
          type="source"
          position={h.pos}
          isConnectable
          style={{
            width: 10,
            height: 10,
            background: "var(--background)",
            border: "2px solid var(--primary)",
            opacity: handlesVisible ? 1 : 0,
            // Keep hit-testing available while hidden so edge reconnect still snaps.
            pointerEvents: "all",
            transition: "opacity 120ms",
          }}
        />
      ))}
    </div>
  );
}

export const nodeTypes = { shape: ShapeNode };
