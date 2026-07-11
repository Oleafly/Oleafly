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

  const isDiamond = d.shape === "diamond";
  const round =
    d.shape === "circle" || d.shape === "ellipse"
      ? "50%"
      : d.radius != null
        ? `${d.radius}px`
        : d.shape === "roundrect"
          ? "8px"
          : "0";

  const hasBorder = !!d.stroke;
  const style: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 4,
    boxSizing: "border-box",
    fontSize: d.fontSize ? d.fontSize * 1.6 : 12,
    color: d.textColor || "inherit",
    background: d.fill || "transparent",
    border: hasBorder ? `${d.strokeWidth ?? 1}px ${d.strokeStyle || "solid"} ${d.stroke}` : "none",
    borderRadius: round,
    transform: isDiamond ? "rotate(45deg)" : undefined,
    overflow: "hidden",
  };
  const labelStyle: CSSProperties = isDiamond ? { transform: "rotate(-45deg)" } : {};
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
          type="source"
          position={h.pos}
          style={{
            width: 8,
            height: 8,
            background: "var(--primary)",
            border: "1px solid var(--background)",
            opacity: handlesVisible ? 1 : 0,
            transition: "opacity 120ms",
          }}
        />
      ))}
    </div>
  );
}

export const nodeTypes = { shape: ShapeNode };
