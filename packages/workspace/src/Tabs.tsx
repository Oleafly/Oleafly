import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { X } from "lucide-react";
import { badgeShown } from "./geometry";
import type { Badge, RenderTooltip, ViewInfo } from "./types";

export function BadgeMark({ badge, corner }: Readonly<{ badge: Badge; corner: boolean }>) {
  const position = corner ? "absolute -right-0.5 -top-0.5" : "ml-1 shrink-0";
  if (badge === true) return <span aria-hidden data-badge="dot" className={`${position} size-2 rounded-full bg-primary`} />;
  const text = typeof badge === "number" && badge > 99 ? "99+" : String(badge);
  return (
    <span
      aria-hidden
      data-badge={text}
      className={`${position} flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[0.5625rem] font-bold leading-none text-primary-foreground`}
    >
      {text}
    </span>
  );
}

export function badgeDescription(info: ViewInfo): string | undefined {
  if (!badgeShown(info.badge)) return undefined;
  if (info.badgeLabel !== undefined) return info.badgeLabel;
  return info.badge === true ? undefined : String(info.badge);
}

export interface TabProps {
  id: string;
  info: ViewInfo;
  selected: boolean;
  closable: boolean;
  dragging: boolean;
  tabId: string;
  controls: string;
  describedBy: string;
  closeLabel: string;
  renderTooltip?: RenderTooltip;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
  onClose: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

function Description({ id, text }: Readonly<{ id: string; text: string | undefined }>) {
  return text === undefined ? null : (
    <span id={id} className="sr-only">
      {text}
    </span>
  );
}

export function Tab({
  id,
  info,
  selected,
  closable,
  dragging,
  tabId,
  controls,
  describedBy,
  closeLabel,
  onPointerDown,
  onClick,
  onClose,
  onKeyDown,
}: Readonly<TabProps>) {
  const description = badgeDescription(info);
  return (
    <div
      data-tab-view={id}
      className={[
        "group/tab relative flex h-full max-w-[14rem] shrink-0 items-center overflow-hidden rounded-t-md border-x border-t text-sm transition-colors",
        selected ? "border-border bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        dragging ? "opacity-50" : "",
      ].join(" ")}
    >
      <button
        type="button"
        role="tab"
        id={tabId}
        aria-selected={selected}
        aria-controls={controls}
        aria-describedby={description === undefined ? undefined : describedBy}
        tabIndex={selected ? 0 : -1}
        className="flex h-full min-w-0 items-center gap-1.5 pl-3 pr-1 focus-visible:bg-accent"
        onPointerDown={onPointerDown}
        onClick={onClick}
        onAuxClick={(event) => {
          if (event.button === 1 && closable) onClose();
        }}
        onKeyDown={onKeyDown}
      >
        {info.icon}
        <span className="truncate">{info.title}</span>
        {badgeShown(info.badge) && <BadgeMark badge={info.badge as Badge} corner={false} />}
      </button>
      <Description id={describedBy} text={description} />
      {closable ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={closeLabel}
          className={[
            "mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent",
            selected ? "" : "opacity-0 group-hover/tab:opacity-100",
          ].join(" ")}
          onClick={onClose}
        >
          <X className="size-3" />
        </button>
      ) : (
        <span className="w-2" />
      )}
    </div>
  );
}

function initial(title: string): string {
  return Array.from(title.trim())[0]?.toUpperCase() ?? "";
}

export function IconTab({
  id,
  info,
  selected,
  closable,
  dragging,
  tabId,
  controls,
  describedBy,
  renderTooltip,
  onPointerDown,
  onClick,
  onClose,
  onKeyDown,
}: Readonly<TabProps>) {
  const description = badgeDescription(info);
  const button: ReactNode = (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-label={info.title}
      aria-selected={selected}
      aria-controls={controls}
      aria-describedby={description === undefined ? undefined : describedBy}
      title={renderTooltip ? undefined : info.title}
      tabIndex={selected ? 0 : -1}
      className={[
        "relative flex size-7 items-center justify-center rounded-md transition-colors focus-visible:bg-accent motion-reduce:transition-none",
        selected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        dragging ? "opacity-50" : "",
      ].join(" ")}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onAuxClick={(event) => {
        if (event.button === 1 && closable) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      {info.icon ?? (
        <span aria-hidden className="text-xs font-semibold">
          {initial(info.title)}
        </span>
      )}
      {badgeShown(info.badge) && <BadgeMark badge={info.badge as Badge} corner />}
    </button>
  );
  return (
    <div data-tab-view={id} className="relative flex h-full shrink-0 items-center">
      {renderTooltip ? renderTooltip(info.title, button, { side: "bottom" }) : button}
      <Description id={describedBy} text={description} />
    </div>
  );
}
