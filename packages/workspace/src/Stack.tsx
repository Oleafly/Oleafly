import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { badgeShown, childrenWith } from "./geometry";
import type { StackState } from "./layout";
import { Splitter } from "./Splitter";
import { BadgeMark, badgeDescription } from "./Tabs";
import type { Badge, RenderTooltip, ViewInfo, WorkspaceLabels } from "./types";

export interface StackBodyProps {
  stackId: string;
  stack: StackState;
  infos: ReadonlyMap<string, ViewInfo>;
  labels: WorkspaceLabels;
  renderTooltip?: RenderTooltip;
  draggingId: string | null;
  headerId: (viewId: string) => string;
  panelId: (id: string) => string;
  tabId: (id: string) => string;
  stackRef: (element: HTMLElement | null) => void;
  slotRef: (viewId: string) => (element: HTMLElement | null) => void;
  onToggle: (viewId: string) => void;
  onMove: (viewId: string, step: -1 | 1) => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>, viewId: string, title: string) => void;
  onResize: (first: string, second: string, delta: number, size: number) => void;
  onEven: (first: string, second: string) => void;
  onResizing: (active: boolean, cancelled?: boolean) => void;
}

function expandedExtent(element: HTMLElement): number {
  const host = element.closest("[data-stack]");
  if (!host) return 0;
  return childrenWith(host, "data-section")
    .filter((section) => section.dataset.expanded === "true")
    .reduce((sum, section) => sum + section.getBoundingClientRect().height, 0);
}

interface SectionHeaderProps {
  id: string;
  info: ViewInfo;
  open: boolean;
  dragging: boolean;
  headerId: string;
  controls: string;
  labels: WorkspaceLabels;
  renderTooltip?: RenderTooltip;
  onToggle: (viewId: string) => void;
  onMove: (viewId: string, step: -1 | 1) => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>, viewId: string, title: string) => void;
}

function SectionHeader({
  id,
  info,
  open,
  dragging,
  headerId,
  controls,
  labels,
  renderTooltip,
  onToggle,
  onMove,
  onStartDrag,
}: Readonly<SectionHeaderProps>) {
  const moveHint = labels.moveSection?.(info.title);
  const badgeHint = badgeDescription(info);
  const moveId = `${headerId}-move`;
  const badgeId = `${headerId}-badge`;
  const described = [moveHint === undefined ? null : moveId, badgeHint === undefined ? null : badgeId].filter((value) => value !== null);
  const hint = (open ? labels.collapseSection : labels.expandSection)?.(info.title) ?? info.title;
  const button: ReactNode = (
    <button
      type="button"
      id={headerId}
      aria-label={info.title}
      aria-expanded={open}
      aria-controls={controls}
      aria-describedby={described.length > 0 ? described.join(" ") : undefined}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      className="flex h-full w-full min-w-0 items-center gap-1.5 px-2 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground focus-visible:bg-accent"
      onClick={() => onToggle(id)}
      onKeyDown={(event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        onMove(id, event.key === "ArrowUp" ? -1 : 1);
      }}
    >
      <ChevronRight className={["size-3 shrink-0 transition-transform motion-reduce:transition-none", open ? "rotate-90" : ""].join(" ")} />
      {info.icon}
      <span className="truncate">{info.title}</span>
      {badgeShown(info.badge) && <BadgeMark badge={info.badge as Badge} corner={false} />}
    </button>
  );
  return (
    <div
      data-section-header={id}
      className={[
        "group/section relative flex h-8 shrink-0 select-none items-center gap-0.5 pr-1 transition-colors hover:bg-accent/60 focus-within:bg-accent/60 motion-reduce:transition-none",
        dragging ? "opacity-50" : "",
      ].join(" ")}
      onPointerDown={(event) => {
        if ((event.target as Element).closest("[data-section-actions]")) return;
        onStartDrag(event, id, info.title);
      }}
    >
      <div className="flex h-full min-w-0 flex-1">
        {renderTooltip ? renderTooltip(hint, button, { side: "bottom", className: "flex h-full min-w-0 flex-1" }) : button}
      </div>
      {info.actions !== undefined && (
        <div
          data-section-actions
          className="hidden shrink-0 items-center gap-0.5 text-muted-foreground group-hover/section:flex group-focus-within/section:flex"
        >
          {info.actions}
        </div>
      )}
      {moveHint !== undefined && (
        <span id={moveId} className="sr-only">
          {moveHint}
        </span>
      )}
      {badgeHint !== undefined && (
        <span id={badgeId} className="sr-only">
          {badgeHint}
        </span>
      )}
    </div>
  );
}

export function StackBody({
  stackId,
  stack,
  infos,
  labels,
  renderTooltip,
  draggingId,
  headerId,
  panelId,
  tabId,
  stackRef,
  slotRef,
  onToggle,
  onMove,
  onStartDrag,
  onResize,
  onEven,
  onResizing,
}: Readonly<StackBodyProps>) {
  const expanded = stack.sections.filter((id) => !stack.collapsed.includes(id));
  const weightOf = (id: string) => stack.weights[stack.sections.indexOf(id)] ?? 0;
  return (
    <div
      ref={stackRef}
      data-stack={stackId}
      role="tabpanel"
      id={panelId(stackId)}
      aria-labelledby={tabId(stackId)}
      className="absolute inset-0 flex flex-col overflow-hidden"
    >
      {stack.sections.map((id, index) => {
        const open = !stack.collapsed.includes(id);
        const next = open ? expanded[expanded.indexOf(id) + 1] : undefined;
        const info = infos.get(id) ?? { title: id };
        return (
          <div
            key={id}
            data-section={id}
            data-expanded={open}
            className={["relative flex flex-col", open ? "min-h-8" : "", index > 0 ? "border-t border-border" : ""].join(" ")}
            style={{ flex: open ? `${weightOf(id)} 1 0px` : "none" }}
          >
            <SectionHeader
              id={id}
              info={info}
              open={open}
              dragging={draggingId === id}
              headerId={headerId(id)}
              controls={panelId(id)}
              labels={labels}
              renderTooltip={renderTooltip}
              onToggle={onToggle}
              onMove={onMove}
              onStartDrag={onStartDrag}
            />
            {open && <div ref={slotRef(id)} data-section-slot={id} className="relative min-h-0 flex-1" />}
            {next !== undefined && (
              <Splitter
                vertical={false}
                label={labels.resizeSections ?? labels.resize}
                value={Math.round((weightOf(id) / (weightOf(id) + weightOf(next))) * 100)}
                attributes={{ "data-section-splitter": id }}
                size={expandedExtent}
                onShift={(delta, size) => onResize(id, next, delta, size)}
                onEven={() => onEven(id, next)}
                onResizing={onResizing}
                className="absolute inset-x-2 -bottom-0.5 z-20 h-1 cursor-row-resize rounded-full transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 motion-reduce:transition-none"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
