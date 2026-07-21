import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Handle,
  NodeResizeControl,
  Position,
  ResizeControlVariant,
  type ControlPosition,
  type NodeProps,
} from "@xyflow/react";
import type {
  DiagramFontFamily,
  NodeShape,
  StrokeStyle,
} from "@oleafly/latex";
import { useDiagramEdit } from "./edit-context";
import { useDiagramKit } from "./kit";

export interface ShapeData {
  shape: NodeShape;
  label: string;
  fill?: string;
  stroke?: string;
  strokeStyle?: StrokeStyle;
  strokeWidth?: number;
  textColor?: string;
  fontSize?: number;
  fontFamily?: DiagramFontFamily;
  radius?: number;
  [key: string]: unknown;
}

const HANDLES = [
  { id: "t", pos: Position.Top },
  { id: "r", pos: Position.Right },
  { id: "b", pos: Position.Bottom },
  { id: "l", pos: Position.Left },
];

const RESIZE_CONTROLS: Array<{
  position: ControlPosition;
  variant: ResizeControlVariant;
  cursor: CSSProperties["cursor"];
  cursorClass: string;
}> = [
  { position: "left", variant: ResizeControlVariant.Line, cursor: "ew-resize", cursorClass: "diagram-resize-ew" },
  { position: "right", variant: ResizeControlVariant.Line, cursor: "ew-resize", cursorClass: "diagram-resize-ew" },
  { position: "top", variant: ResizeControlVariant.Line, cursor: "ns-resize", cursorClass: "diagram-resize-ns" },
  { position: "bottom", variant: ResizeControlVariant.Line, cursor: "ns-resize", cursorClass: "diagram-resize-ns" },
  { position: "top-left", variant: ResizeControlVariant.Handle, cursor: "nwse-resize", cursorClass: "diagram-resize-nwse" },
  { position: "top-right", variant: ResizeControlVariant.Handle, cursor: "nesw-resize", cursorClass: "diagram-resize-nesw" },
  { position: "bottom-left", variant: ResizeControlVariant.Handle, cursor: "nesw-resize", cursorClass: "diagram-resize-nesw" },
  { position: "bottom-right", variant: ResizeControlVariant.Handle, cursor: "nwse-resize", cursorClass: "diagram-resize-nwse" },
];

export function ShapeNode({ id, data, selected }: NodeProps) {
  const d = data as ShapeData;
  const edit = useDiagramEdit();
  const { Textarea, usePrimaryColor } = useDiagramKit();
  const primaryColor = usePrimaryColor();
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
          ? "6px"
          : "0";
  const dashArray =
    d.strokeStyle === "dashed" ? "6,4" : d.strokeStyle === "dotted" ? "1.5,4" : undefined;
  const fontFamily =
    d.fontFamily === "sans"
      ? "'Latin Modern Sans', 'Helvetica Neue', Arial, sans-serif"
      : d.fontFamily === "mono"
        ? "'Latin Modern Mono', 'SFMono-Regular', Consolas, monospace"
        : "'Latin Modern Roman', 'CMU Serif', Georgia, 'Times New Roman', serif";

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
    fontSize: d.fontSize ? `${d.fontSize}pt` : "10pt",
    fontFamily,
    color: d.textColor || "inherit",
    background: polygon ? "transparent" : d.fill || "transparent",
    border:
      polygon || !hasBorder
        ? "none"
        : `${d.strokeWidth ?? 1}px ${d.strokeStyle || "solid"} ${d.stroke}`,
    borderRadius: polygon ? "0" : round,
    overflow: "hidden",
  };
  const labelStyle: CSSProperties = { position: "relative", zIndex: 1 };
  const handlesVisible = hover || selected;

  const commit = () => edit.commitLabel(id, draft);

  return (
    <div
      data-tour={selected ? "diagram-handles" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        edit.beginEdit(id);
      }}
      style={{
        width: "100%",
        height: "100%",
        "--diagram-primary": primaryColor,
      } as CSSProperties}
    >
      {!!selected &&
        RESIZE_CONTROLS.map((control) => (
          <NodeResizeControl
            key={control.position}
            position={control.position}
            variant={control.variant}
            minWidth={30}
            minHeight={24}
            color={primaryColor}
            className={`diagram-resize-control ${control.cursorClass} ${
              control.variant === ResizeControlVariant.Handle
                ? "!border-primary !bg-background"
                : "!border-primary"
            }`}
            style={{ cursor: control.cursor }}
          />
        ))}
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
          <Textarea
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
            className="nodrag h-full min-h-0 w-full resize-none border-0 bg-transparent p-0 text-center shadow-none focus-visible:ring-0"
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
            border: `1px solid ${primaryColor}`,
            opacity: handlesVisible ? 1 : 0,
            // Keep hit-testing available while hidden so edge reconnect still snaps.
            pointerEvents: "all",
            cursor: "crosshair",
            transition: "opacity 120ms",
          }}
        />
      ))}
    </div>
  );
}

export const nodeTypes = { shape: ShapeNode };
