import { ChevronDown, type LucideIcon, MoreHorizontal } from "lucide-react";
import {
  type ComponentProps,
  type FocusEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverItem } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, shortcut } from "@/lib/utils";

export interface ToolbarControl {
  id: string;
  width: number;
  tools?: number;
  render: () => ReactNode;
  renderMenu: () => ReactNode;
  active?: boolean;
  collapsed?: { width: number; tools?: number; render: () => ReactNode };
}

export interface ToolbarFitItem {
  readonly width: number;
  readonly tools?: number;
  readonly collapsed?: { readonly width: number; readonly tools?: number };
}

export interface ToolbarFit {
  readonly visible: number;
  readonly collapsed: boolean;
}

export const ICON_BUTTON_WIDTH = 28;
export const DROPDOWN_TRIGGER_WIDTH = 42;
export const DIVIDER_WIDTH = 9;
export const MORE_BUTTON_WIDTH = 28;
export const CONTROL_GAP = 2;

export const TOOLBAR_TRIGGER_CLASS =
  "flex h-7 w-auto shrink-0 items-center justify-center gap-0.5 rounded px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent data-[state=open]:bg-accent";
export const MENU_ICON = "size-4 text-muted-foreground";
export const MENU_ACTIVE = "bg-primary/10 text-foreground";

export function ToolbarMenuKeys({ keys }: Readonly<{ keys: string }>) {
  return <span className="ml-auto pl-4 text-xs tabular-nums text-muted-foreground">{shortcut(keys)}</span>;
}
const MENU_SCROLL = "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto";

export function useAvailableWidth() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [availableWidth, setAvailableWidth] = useState(
    Number.POSITIVE_INFINITY,
  );

  const containerRef = useCallback((container: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!container) return;

    const recompute = () => setAvailableWidth(container.clientWidth);
    recompute();
    // Non-browser runtimes (jsdom under test) have no ResizeObserver. The
    // measurement above still ran, so the toolbar lays out rather than throwing.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    observerRef.current = observer;
  }, []);

  return { containerRef, availableWidth };
}

function shownForm(item: ToolbarFitItem, step: ToolbarFit): { readonly width: number; readonly tools?: number } {
  return step.collapsed && item.collapsed ? item.collapsed : item;
}

export function fitTools(items: readonly ToolbarFitItem[], step: ToolbarFit): number {
  let tools = 0;
  for (let index = 0; index < step.visible; index++) tools += shownForm(items[index], step).tools ?? 1;
  return tools;
}

function keepsShown(items: readonly ToolbarFitItem[], wide: ToolbarFit, narrow: ToolbarFit): boolean {
  if (wide.visible < narrow.visible) return false;
  return !wide.collapsed || narrow.collapsed || !items.slice(0, narrow.visible).some((item) => item.collapsed);
}

function fitSteps(items: readonly ToolbarFitItem[]): ToolbarFit[] {
  const steps: ToolbarFit[] = [];
  let folds = false;
  for (let visible = 0; visible <= items.length; visible++) {
    folds ||= visible > 0 && items[visible - 1].collapsed !== undefined;
    steps.push({ visible, collapsed: false });
    if (folds) steps.push({ visible, collapsed: true });
  }
  steps.sort(
    (left, right) =>
      fitTools(items, right) - fitTools(items, left) || Number(left.collapsed) - Number(right.collapsed) || right.visible - left.visible,
  );
  const widths = steps.map((step) => fitWidth(items, step));
  const nested = steps.filter((step) => step.visible === 0);
  for (const width of [...widths].sort((left, right) => left - right)) {
    const best = steps[widths.findIndex((used) => used <= width)];
    const held = nested[nested.length - 1];
    if (best !== held && keepsShown(items, best, held)) nested.push(best);
  }
  return nested.reverse();
}

export function fitWidth(items: readonly ToolbarFitItem[], step: ToolbarFit): number {
  let used = 0;
  for (let index = 0; index < step.visible; index++) used += shownForm(items[index], step).width + (index > 0 ? CONTROL_GAP : 0);
  if (step.visible < items.length) used += (step.visible > 0 ? CONTROL_GAP : 0) + MORE_BUTTON_WIDTH;
  return used;
}

function fitIndex(items: readonly ToolbarFitItem[], steps: readonly ToolbarFit[], availableWidth: number): number {
  const index = steps.findIndex((step) => fitWidth(items, step) <= availableWidth);
  return index === -1 ? steps.length - 1 : index;
}

export function fitToolbar(items: readonly ToolbarFitItem[], availableWidth: number): ToolbarFit {
  const steps = fitSteps(items);
  return steps[fitIndex(items, steps, availableWidth)];
}

export function fitCount(controls: readonly ToolbarFitItem[], availableWidth: number): number {
  return fitToolbar(controls, availableWidth).visible;
}

function rootFontSize(): number {
  if (typeof document === "undefined") return 16;
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function scaledWidth(width: number): number {
  return (width * 16) / rootFontSize();
}

function fitKey(items: readonly ToolbarFitItem[]): string {
  return items
    .map((item) => `${item.width}/${item.tools ?? 1}/${item.collapsed ? `${item.collapsed.width}/${item.collapsed.tools ?? 1}` : "-"}`)
    .join(" ");
}

export function useFittedCount(controls: readonly ToolbarControl[], showAllUntilMeasured = false) {
  const [availableWidth, setAvailableWidth] = useState(Number.POSITIVE_INFINITY);
  const observerRef = useRef<ResizeObserver | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const key = fitKey(controls);
  const ladder = useRef<{ key: string; steps: ToolbarFit[] } | null>(null);
  if (ladder.current?.key !== key) ladder.current = { key, steps: fitSteps(controls) };
  const steps = ladder.current.steps;
  const fitted = useRef({ controls, steps, availableWidth, trimmed: 0 });
  const ref = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    elementRef.current = element;
    if (!element) return;
    const recompute = () => {
      const width = showAllUntilMeasured && element.clientWidth === 0 ? Number.POSITIVE_INFINITY : element.clientWidth;
      const current = fitted.current;
      const unchanged =
        current.trimmed === 0 &&
        Number.isFinite(current.availableWidth) &&
        fitIndex(current.controls, current.steps, scaledWidth(width)) ===
          fitIndex(current.controls, current.steps, scaledWidth(current.availableWidth)) &&
        element.scrollWidth <= width + 1;
      if (!unchanged) setAvailableWidth(width);
    };
    recompute();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recompute);
    observer.observe(element);
    observerRef.current = observer;
  }, [showAllUntilMeasured]);
  const signature = `${availableWidth}|${controls.map((control) => control.id).join(" ")}`;
  const [trim, setTrim] = useState({ signature, count: 0 });
  const trimmed = trim.signature === signature ? trim.count : 0;
  const index = Math.min(steps.length - 1, fitIndex(controls, steps, scaledWidth(availableWidth)) + trimmed);
  const { visible, collapsed } = steps[index];
  fitted.current = { controls, steps, availableWidth, trimmed };

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || index === steps.length - 1) return;
    if (showAllUntilMeasured && element.clientWidth === 0) return;
    if (element.scrollWidth > element.clientWidth + 1) {
      setTrim({ signature, count: trimmed + 1 });
    }
  });

  return { containerRef: ref, visibleCount: visible, collapsed };
}

type ContentFocus = (content: HTMLElement) => void;

function entryFocus(focus: ContentFocus | undefined): ((event: FocusEvent<HTMLDivElement>) => void) | undefined {
  if (!focus) return undefined;
  return (event) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    focus(event.currentTarget);
  };
}

export function ToolbarMenuButton({
  label,
  icon,
  active,
  chevron = true,
  align = "start",
  open,
  onOpenChange,
  onCloseAutoFocus,
  onContentFocus,
  className,
  contentClassName,
  badge,
  children,
}: Readonly<{
  label: string;
  icon: ReactNode;
  badge?: ReactNode;
  active?: boolean;
  chevron?: boolean;
  align?: "start" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onContentFocus?: ContentFocus;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}>) {
  const [ownOpen, setOwnOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dismissed = useRef(false);
  const shown = open ?? ownOpen;
  const change = (next: boolean) => {
    if (next) dismissed.current = false;
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const dismiss = () => {
    dismissed.current = true;
  };
  const closeFocus = (event: Event) => {
    onCloseAutoFocus?.(event);
    if (event.defaultPrevented || dismissed.current) return;
    event.preventDefault();
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) trigger.current?.focus();
    });
  };
  return (
    <DropdownMenu open={shown} onOpenChange={change} modal={false}>
      <Tooltip label={label} side="bottom" className={cn("shrink-0", className)}>
        <DropdownMenuTrigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label={label}
            onClick={(event) => {
              if (event.detail === 0) change(!shown);
            }}
            className={cn(TOOLBAR_TRIGGER_CLASS, !chevron && "w-7 px-0", active && MENU_ACTIVE, badge !== undefined && "relative")}
          >
            {icon}
            {chevron && <ChevronDown aria-hidden className="size-3" />}
            {badge}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align={align}
        onCloseAutoFocus={closeFocus}
        onEscapeKeyDown={dismiss}
        onInteractOutside={dismiss}
        onFocus={entryFocus(onContentFocus)}
        className={cn(MENU_SCROLL, contentClassName)}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ToolbarMenuItem({
  icon: Icon,
  label,
  keys,
  checked,
  inset,
  disabled,
  onSelect,
}: Readonly<{ icon: LucideIcon; label: string; keys?: string; checked?: boolean; inset?: boolean; disabled?: boolean; onSelect: () => void }>) {
  const body = (
    <>
      <Icon aria-hidden className={MENU_ICON} />
      {label}
      {keys && <ToolbarMenuKeys keys={keys} />}
    </>
  );
  return (
    <ToolbarMenuRow checked={checked} inset={inset} disabled={disabled} onSelect={onSelect}>
      {body}
    </ToolbarMenuRow>
  );
}

function ToolbarMenuRow({
  checked,
  inset,
  disabled,
  onSelect,
  children,
}: Readonly<{ checked?: boolean; inset?: boolean; disabled?: boolean; onSelect: () => void; children: ReactNode }>) {
  if (checked !== undefined) {
    return (
      <DropdownMenuCheckboxItem checked={checked} disabled={disabled} onSelect={onSelect} className={cn("gap-2", checked && MENU_ACTIVE)}>
        {children}
      </DropdownMenuCheckboxItem>
    );
  }
  return (
    <DropdownMenuItem inset={inset} disabled={disabled} onSelect={onSelect}>
      {children}
    </DropdownMenuItem>
  );
}

export function ToolbarSubMenu({
  icon: Icon,
  label,
  ariaLabel,
  inset,
  active,
  onContentFocus,
  children,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  ariaLabel?: string;
  inset?: boolean;
  active?: boolean;
  onContentFocus?: ContentFocus;
  children: ReactNode;
}>) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger inset={inset} aria-label={ariaLabel} className={cn(active && MENU_ACTIVE)}>
        <Icon aria-hidden className={MENU_ICON} />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={MENU_SCROLL} onFocus={entryFocus(onContentFocus)}>
          {children}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function stopKeys(event: KeyboardEvent) {
  event.stopPropagation();
}

export function ToolbarMenuHost({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <DropdownMenuItem
      className="p-0 focus:bg-accent"
      onSelect={(event) => event.preventDefault()}
      onPointerMove={(event) => event.preventDefault()}
      onPointerLeave={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.querySelector("button")?.click();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps keys typed inside the hosted picker away from the menu's typeahead; the picker's own controls stay keyboard reachable */}
      <div className="w-full [&>*]:w-full" onKeyDown={stopKeys}>
        {children}
      </div>
    </DropdownMenuItem>
  );
}

export interface ToolbarDropdownItem {
  key: string;
  content: ReactNode;
  onSelect: () => void;
  checked?: boolean;
}

const DROPDOWN_HEADING = "px-2 py-1 text-[0.625rem] uppercase tracking-wide text-muted-foreground";

export function ToolbarDropdown({
  variant,
  icon: Icon,
  label,
  ariaLabel,
  chevron = true,
  heading,
  className,
  items,
  active,
}: Readonly<{
  variant: "bar" | "menu";
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
  chevron?: boolean;
  heading?: string;
  className?: string;
  items: readonly ToolbarDropdownItem[];
  active?: boolean;
}>) {
  const rows = () =>
    items.map((item) => (
      <ToolbarMenuRow key={item.key} checked={item.checked} onSelect={item.onSelect}>
        {item.content}
      </ToolbarMenuRow>
    ));
  if (variant === "menu") {
    return (
      <ToolbarSubMenu icon={Icon} label={label} ariaLabel={ariaLabel} active={active}>
        {rows()}
      </ToolbarSubMenu>
    );
  }
  if (items.some((item) => item.checked !== undefined)) {
    return (
      <ToolbarMenuButton label={ariaLabel} icon={<Icon aria-hidden className="size-4" />} chevron={chevron} active={active} contentClassName={className}>
        {heading && <div className={DROPDOWN_HEADING}>{heading}</div>}
        {rows()}
      </ToolbarMenuButton>
    );
  }
  return (
    <Popover
      ariaLabel={ariaLabel}
      className={className}
      triggerClassName={cn(TOOLBAR_TRIGGER_CLASS, chevron ? "[&>svg+svg]:size-3" : "w-7 px-0", active && MENU_ACTIVE)}
      trigger={
        <>
          <Icon className="size-4" />
          {chevron && <ChevronDown className="size-3" />}
        </>
      }
    >
      {heading && <div className={DROPDOWN_HEADING}>{heading}</div>}
      {items.map((item) => (
        <PopoverItem key={item.key} onClick={item.onSelect}>
          {item.content}
        </PopoverItem>
      ))}
    </Popover>
  );
}

export function toolbarPicker(id: string, width: number, render: (menuRow: boolean) => ReactNode): ToolbarControl {
  return {
    id,
    width,
    render: () => render(false),
    renderMenu: () => <ToolbarMenuHost key={id}>{render(true)}</ToolbarMenuHost>,
  };
}

export function ToolbarOverflow({
  controls,
  label,
  separated,
  open,
  onOpenChange,
  onCloseAutoFocus,
  pushMenu,
  moreBadge,
  showAllUntilMeasured,
  className,
  ...rest
}: Readonly<
  {
    controls: readonly ToolbarControl[];
    label: string;
    moreBadge?: (hidden: readonly ToolbarControl[]) => ReactNode;
    separated?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onCloseAutoFocus?: (event: Event) => void;
    pushMenu?: (shown: readonly ToolbarControl[]) => boolean;
    showAllUntilMeasured?: boolean;
  } & Omit<ComponentProps<"div">, "ref" | "children">
>) {
  const { containerRef, visibleCount, collapsed } = useFittedCount(controls, showAllUntilMeasured);
  const shown = controls.slice(0, visibleCount);
  const hidden = controls.slice(visibleCount);
  return (
    <div ref={containerRef} {...rest} className={cn("flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-hidden", className)}>
      {shown.map((control) => (
        <Fragment key={control.id}>
          {collapsed && control.collapsed ? control.collapsed.render() : control.render()}
        </Fragment>
      ))}
      {hidden.length > 0 && (
        <ToolbarMenuButton
          label={label}
          icon={<MoreHorizontal aria-hidden className="size-4" />}
          chevron={false}
          align="end"
          active={hidden.some((control) => control.active)}
          badge={moreBadge?.(hidden)}
          open={open}
          onOpenChange={onOpenChange}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(pushMenu?.(shown) && "ml-auto")}
          contentClassName="min-w-56"
        >
          {hidden.map((control, index) => (
            <Fragment key={control.id}>
              {separated && index > 0 && <DropdownMenuSeparator />}
              {control.renderMenu()}
            </Fragment>
          ))}
        </ToolbarMenuButton>
      )}
    </div>
  );
}
