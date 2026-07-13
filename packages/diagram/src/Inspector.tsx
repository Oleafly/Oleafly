import type {
  DiagNode,
  DiagEdge,
  StrokeStyle,
  EdgeRouting,
  EdgeArrow,
  EdgeStyle,
} from "@openleaf/latex";
import { BringToFront, ChevronsDown, ChevronsUp, SendToBack } from "lucide-react";
import { useDiagramKit } from "./kit";

export type ReorderDir = "front" | "back" | "forward" | "backward";

const ROUNDABLE = new Set(["rectangle", "roundrect", "text"]);
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28];
const RADII = [0, 2, 4, 6, 8, 12, 16, 24];
const WIDTHS = [0.5, 1, 1.5, 2, 3];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function ColorInput({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      value={value || "#ffffff"}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 w-10 cursor-pointer rounded border bg-background"
    />
  );
}

/** A shadcn Select bound to a string value. */
function Pick({
  value,
  onChange,
  options,
  width = "w-28",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: string;
}) {
  const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = useDiagramKit();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-7 ${width} text-xs`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-[100]">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Style controls for the currently selected node or edge. */
export function Inspector({
  node,
  edge,
  onNodeChange,
  onEdgeChange,
  onReorder,
}: {
  node: DiagNode | null;
  edge: DiagEdge | null;
  onNodeChange: (patch: Partial<DiagNode>) => void;
  onEdgeChange: (patch: Partial<DiagEdge>) => void;
  onReorder?: (dir: ReorderDir) => void;
}) {
  const { Tooltip } = useDiagramKit();
  if (!node && !edge) return null;

  if (node) {
    return (
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Shape</span>
          {onReorder && (
            <div className="flex items-center gap-0.5">
              {(
                [
                  { dir: "front", label: "Bring to front", icon: <BringToFront className="size-3.5" /> },
                  { dir: "forward", label: "Forward", icon: <ChevronsUp className="size-3.5" /> },
                  { dir: "backward", label: "Backward", icon: <ChevronsDown className="size-3.5" /> },
                  { dir: "back", label: "Send to back", icon: <SendToBack className="size-3.5" /> },
                ] as { dir: ReorderDir; label: string; icon: React.ReactNode }[]
              ).map((b) => (
                <Tooltip key={b.dir} label={b.label} side="bottom">
                  <button
                    type="button"
                    aria-label={b.label}
                    onClick={() => onReorder(b.dir)}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {b.icon}
                  </button>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Label (LaTeX)</span>
          <input
            value={node.label}
            onChange={(e) => onNodeChange({ label: e.target.value })}
            className="rounded border border-input bg-background px-1.5 py-1 text-xs outline-none focus:border-primary"
          />
        </label>
        <Field label="Fill">
          <ColorInput value={node.fill} onChange={(v) => onNodeChange({ fill: v })} />
        </Field>
        <Field label="Border">
          <ColorInput value={node.stroke} onChange={(v) => onNodeChange({ stroke: v })} />
        </Field>
        <Field label="Border style">
          <Pick
            value={node.strokeStyle || "solid"}
            onChange={(v) => onNodeChange({ strokeStyle: v as StrokeStyle })}
            options={[
              { value: "solid", label: "Solid" },
              { value: "dashed", label: "Dashed" },
              { value: "dotted", label: "Dotted" },
            ]}
          />
        </Field>
        <Field label="Border width">
          <Pick
            value={String(node.strokeWidth ?? 1)}
            onChange={(v) => onNodeChange({ strokeWidth: Number(v) })}
            options={WIDTHS.map((w) => ({ value: String(w), label: `${w}px` }))}
            width="w-20"
          />
        </Field>
        {ROUNDABLE.has(node.shape) && (
          <Field label="Corner radius">
            <Pick
              value={String(node.radius ?? (node.shape === "roundrect" ? 6 : 0))}
              onChange={(v) => onNodeChange({ radius: Number(v) })}
              options={RADII.map((r) => ({ value: String(r), label: `${r}px` }))}
              width="w-20"
            />
          </Field>
        )}
        <Field label="Font size">
          <Pick
            value={String(node.fontSize ?? 11)}
            onChange={(v) => onNodeChange({ fontSize: Number(v) })}
            options={FONT_SIZES.map((s) => ({ value: String(s), label: `${s}pt` }))}
            width="w-20"
          />
        </Field>
        <Field label="Text color">
          <ColorInput value={node.textColor} onChange={(v) => onNodeChange({ textColor: v })} />
        </Field>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Arrow</div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Label</span>
        <input
          value={edge!.label || ""}
          onChange={(e) => onEdgeChange({ label: e.target.value })}
          className="rounded border border-input bg-background px-1.5 py-1 text-xs outline-none focus:border-primary"
        />
      </label>
      <Field label="Arrowhead">
        <Pick
          value={edge!.arrow}
          onChange={(v) => onEdgeChange({ arrow: v as EdgeArrow })}
          options={[
            { value: "forward", label: "End" },
            { value: "both", label: "Both" },
            { value: "none", label: "None" },
          ]}
        />
      </Field>
      <Field label="Routing">
        <Pick
          value={edge!.routing}
          onChange={(v) => onEdgeChange({ routing: v as EdgeRouting })}
          options={[
            { value: "straight", label: "Straight" },
            { value: "orthogonal", label: "Orthogonal" },
            { value: "curved", label: "Curved" },
          ]}
        />
      </Field>
      <Field label="Line">
        <Pick
          value={edge!.style}
          onChange={(v) => onEdgeChange({ style: v as EdgeStyle })}
          options={[
            { value: "solid", label: "Solid" },
            { value: "dashed", label: "Dashed" },
          ]}
        />
      </Field>
    </div>
  );
}
