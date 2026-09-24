import { Children, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Group, Panel, Separator, type GroupImperativeHandle } from "react-resizable-panels";
import {
  PANEL_STYLE,
  panelLimitProps,
  percent,
  usePersistentPanelLayout,
  useSeparatorHitArea,
  useSeparatorKeyboard,
  type PanelLimits,
} from "@/lib/panel-layout";
import { cn } from "@/lib/utils";

function useDesktopSplit(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia("(min-width: 768px)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return desktop;
}

export function ToolSplitView({
  children,
  className,
  storageId,
}: {
  children: ReactNode;
  className?: string;
  storageId?: string;
}) {
  const panes = Children.toArray(children);
  const desktop = useDesktopSplit();

  if (!desktop || panes.length !== 2) {
    return (
      <div
        data-testid="tool-split-view"
        className={cn("grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-auto", className)}
      >
        {panes}
      </div>
    );
  }

  return (
    <ToolSplitGroup className={className} storageId={storageId} start={panes[0]} end={panes[1]} />
  );
}

const TOOL_PANE_LIMITS: PanelLimits = { minSize: 20 };

function ToolSplitGroup({
  className,
  storageId,
  start,
  end,
}: {
  className?: string;
  storageId?: string;
  start: ReactNode;
  end: ReactNode;
}) {
  const { t } = useTranslation(["researchTools"]);
  const groupRef = useRef<GroupImperativeHandle>(null);
  const generatedId = useId();
  const baseId = storageId ?? generatedId;
  const startId = `${baseId}-start`;
  const endId = `${baseId}-end`;
  const panelIds = storageId ? [startId, endId] : [];
  const { defaultLayout, onLayoutChanged } = usePersistentPanelLayout(storageId, panelIds, panelIds);
  const hitArea = useSeparatorHitArea(0.5);
  const limits = useMemo(
    () => ({ [startId]: TOOL_PANE_LIMITS, [endId]: TOOL_PANE_LIMITS }),
    [endId, startId],
  );
  const onSeparatorKeyDown = useSeparatorKeyboard(groupRef, limits);

  return (
    <Group
      orientation="horizontal"
      groupRef={groupRef}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      resizeTargetMinimumSize={hitArea}
      className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", className)}
    >
      <Panel
        id={startId}
        defaultSize={percent(50)}
        {...panelLimitProps(TOOL_PANE_LIMITS)}
        style={PANEL_STYLE}
        className="min-w-0"
      >
        {start}
      </Panel>
      <Separator
        id={storageId ? `${storageId}-handle` : undefined}
        disableDoubleClick
        aria-label={t(($) => $.researchTools.tools.resizePanels)}
        onKeyDownCapture={onSeparatorKeyDown}
        className="group relative flex w-2 shrink-0 cursor-col-resize select-none items-center justify-center border-x border-border/70 bg-background transition-colors hover:bg-accent/50"
      >
        <span className="pointer-events-none h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-ring group-data-[separator=active]:bg-ring" />
      </Separator>
      <Panel
        id={endId}
        defaultSize={percent(50)}
        {...panelLimitProps(TOOL_PANE_LIMITS)}
        style={PANEL_STYLE}
        className="min-w-0"
      >
        {end}
      </Panel>
    </Group>
  );
}

export function ToolPane({ title, badge, actions, footer, children, className }: {
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cn("flex h-full min-h-80 min-w-0 flex-col border-b last:border-0 md:min-h-0 md:border-b-0", className)}>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
          {badge && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{badge}</span>}
        </div>
        {actions}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
      {footer && <div className="shrink-0 border-t px-4 py-3">{footer}</div>}
    </section>
  );
}

export function ToolPreviewSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative m-4 flex min-h-64 flex-1 flex-col rounded-xl bg-muted/30 p-6 md:p-8", className)}>
      {children}
    </div>
  );
}

export function ToolStatus({ state, children }: { state: "ready" | "busy" | "error"; children: ReactNode }) {
  return (
    <span role="status" className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", state === "error" ? "bg-destructive" : state === "busy" ? "animate-pulse bg-amber-500 motion-reduce:animate-none" : "bg-emerald-500")} />
      {children}
    </span>
  );
}

export function ToolSegmentedControl<Value extends string>({ label, value, options, onChange }: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string; testId?: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <fieldset aria-label={label} className="flex min-w-0 max-w-full items-center overflow-x-auto rounded-full bg-muted p-0.5 text-xs font-medium">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          data-testid={option.testId}
          onClick={() => onChange(option.value)}
          className={cn("shrink-0 rounded-full px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value === option.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
