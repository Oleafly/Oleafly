import type {
  DiagNode,
  DiagEdge,
  StrokeStyle,
  EdgeRouting,
  EdgeArrow,
  EdgeStyle,
  DiagramFontFamily,
} from "@oleafly/latex";
import { BringToFront, ChevronsDown, ChevronsUp, SendToBack } from "lucide-react";
import { useDiagramKit } from "./kit";
import type { DiagramMessageKey } from "./messages";

export type ReorderDir = "front" | "back" | "forward" | "backward";

const ROUNDABLE = new Set(["rectangle", "roundrect", "text"]);
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28];
const RADII = [0, 2, 4, 6, 8, 12, 16, 24];
const WIDTHS = [0.5, 1, 1.5, 2, 3];
const FONTS: { value: string; key: DiagramMessageKey }[] = [
  { value: "serif", key: "inspector.fontSerif" },
  { value: "sans", key: "inspector.fontSans" },
  { value: "mono", key: "inspector.fontMono" },
];
const REORDER: { dir: ReorderDir; key: DiagramMessageKey; icon: React.ReactNode }[] = [
  { dir: "front", key: "inspector.bringToFront", icon: <BringToFront className="size-3.5" /> },
  { dir: "forward", key: "inspector.forward", icon: <ChevronsUp className="size-3.5" /> },
  { dir: "backward", key: "inspector.backward", icon: <ChevronsDown className="size-3.5" /> },
  { dir: "back", key: "inspector.sendToBack", icon: <SendToBack className="size-3.5" /> },
];
const LINE_STYLES: { value: string; key: DiagramMessageKey }[] = [
  { value: "solid", key: "inspector.strokeSolid" },
  { value: "dashed", key: "inspector.strokeDashed" },
  { value: "dotted", key: "inspector.strokeDotted" },
];
const ARROWHEADS: { value: string; key: DiagramMessageKey }[] = [
  { value: "forward", key: "inspector.arrowEnd" },
  { value: "both", key: "inspector.arrowBoth" },
  { value: "none", key: "inspector.arrowNone" },
];
const ROUTINGS: { value: string; key: DiagramMessageKey }[] = [
  { value: "straight", key: "inspector.routingStraight" },
  { value: "orthogonal", key: "inspector.routingOrthogonal" },
  { value: "curved", key: "inspector.routingCurved" },
];

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function ColorInput({
  value,
  onChange,
}: Readonly<{ value?: string; onChange: (v: string) => void }>) {
  const { ColorInput: ColorControl } = useDiagramKit();
  return (
    <ColorControl
      value={value || "#ffffff"}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Pick({
  value,
  onChange,
  options,
  width = "w-28",
}: Readonly<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: string;
}>) {
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

export function Inspector({
  node,
  edge,
  onNodeChange,
  onEdgeChange,
  onReorder,
}: Readonly<{
  node: DiagNode | null;
  edge: DiagEdge | null;
  onNodeChange: (patch: Partial<DiagNode>) => void;
  onEdgeChange: (patch: Partial<DiagEdge>) => void;
  onReorder?: (dir: ReorderDir) => void;
}>) {
  const { Input, Tooltip, t } = useDiagramKit();
  if (!node && !edge) return null;
  const labelled = (options: { value: string; key: DiagramMessageKey }[]) =>
    options.map((o) => ({ value: o.value, label: t(o.key) }));

  if (node) {
    return (
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("inspector.shape")}
          </span>
          {onReorder && (
            <div className="flex items-center gap-0.5">
              {REORDER.map((b) => (
                <Tooltip key={b.dir} label={t(b.key)} side="bottom">
                  <button
                    type="button"
                    aria-label={t(b.key)}
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
          <span className="text-muted-foreground">{t("inspector.nodeLabel")}</span>
          <Input
            value={node.label}
            onChange={(e) => onNodeChange({ label: e.target.value })}
            className="rounded border border-input bg-background px-1.5 py-1 text-xs outline-none focus:border-primary"
          />
        </label>
        <Field label={t("inspector.fill")}>
          <ColorInput value={node.fill} onChange={(v) => onNodeChange({ fill: v })} />
        </Field>
        <Field label={t("inspector.border")}>
          <ColorInput value={node.stroke} onChange={(v) => onNodeChange({ stroke: v })} />
        </Field>
        <Field label={t("inspector.borderStyle")}>
          <Pick
            value={node.strokeStyle || "solid"}
            onChange={(v) => onNodeChange({ strokeStyle: v as StrokeStyle })}
            options={labelled(LINE_STYLES)}
          />
        </Field>
        <Field label={t("inspector.borderWidth")}>
          <Pick
            value={String(node.strokeWidth ?? 1)}
            onChange={(v) => onNodeChange({ strokeWidth: Number(v) })}
            options={WIDTHS.map((w) => ({ value: String(w), label: `${w}px` }))}
            width="w-20"
          />
        </Field>
        {ROUNDABLE.has(node.shape) && (
          <Field label={t("inspector.cornerRadius")}>
            <Pick
              value={String(node.radius ?? (node.shape === "roundrect" ? 6 : 0))}
              onChange={(v) => onNodeChange({ radius: Number(v) })}
              options={RADII.map((r) => ({ value: String(r), label: `${r}px` }))}
              width="w-20"
            />
          </Field>
        )}
        <Field label={t("inspector.fontSize")}>
          <Pick
            value={String(node.fontSize ?? 11)}
            onChange={(v) => onNodeChange({ fontSize: Number(v) })}
            options={FONT_SIZES.map((s) => ({ value: String(s), label: `${s}pt` }))}
            width="w-20"
          />
        </Field>
        <Field label={t("inspector.font")}>
          <Pick
            value={node.fontFamily ?? "serif"}
            onChange={(v) =>
              onNodeChange({ fontFamily: v as DiagramFontFamily })
            }
            options={labelled(FONTS)}
          />
        </Field>
        <Field label={t("inspector.fontColor")}>
          <ColorInput value={node.textColor} onChange={(v) => onNodeChange({ textColor: v })} />
        </Field>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("inspector.arrow")}
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{t("inspector.edgeLabel")}</span>
        <Input
          value={edge!.label || ""}
          onChange={(e) => onEdgeChange({ label: e.target.value })}
          className="rounded border border-input bg-background px-1.5 py-1 text-xs outline-none focus:border-primary"
        />
      </label>
      <Field label={t("inspector.arrowhead")}>
        <Pick
          value={edge!.arrow}
          onChange={(v) => onEdgeChange({ arrow: v as EdgeArrow })}
          options={labelled(ARROWHEADS)}
        />
      </Field>
      <Field label={t("inspector.routing")}>
        <Pick
          value={edge!.routing}
          onChange={(v) => onEdgeChange({ routing: v as EdgeRouting })}
          options={labelled(ROUTINGS)}
        />
      </Field>
      <Field label={t("inspector.line")}>
        <Pick
          value={edge!.style}
          onChange={(v) => onEdgeChange({ style: v as EdgeStyle })}
          options={labelled(LINE_STYLES)}
        />
      </Field>
    </div>
  );
}
