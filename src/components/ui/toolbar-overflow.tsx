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
  render: () => ReactNode;
  renderMenu: () => ReactNode;
  active?: boolean;
}

export const ICON_BUTTON_WIDTH = 28;
export const DROPDOWN_TRIGGER_WIDTH = 44;
export const DIVIDER_WIDTH = 9;
export const MORE_BUTTON_WIDTH = 32;
export const CONTROL_GAP = 2;

export const TOOLBAR_TRIGGER_CLASS =
  "flex h-7 w-auto shrink-0 items-center justify-center gap-0.5 rounded px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent data-[state=open]:bg-accent";
export const MENU_ICON = "size-4 text-muted-foreground";

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

export function fitCount(
  controls: readonly ToolbarControl[],
  availableWidth: number,
): number {
  const total = controls.reduce(
    (sum, control, index) =>
      sum + control.width + (index > 0 ? CONTROL_GAP : 0),
    0,
  );
  if (total <= availableWidth) return controls.length;

  let used = 0;
  for (let index = 0; index < controls.length; index++) {
    used += controls[index].width + (index > 0 ? CONTROL_GAP : 0);
    if (used + CONTROL_GAP + MORE_BUTTON_WIDTH > availableWidth) return index;
  }
  return controls.length;
}

function rootFontSize(): number {
  if (typeof document === "undefined") return 16;
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function scaledWidth(width: number): number {
  return (width * 16) / rootFontSize();
}

export function useFittedCount(controls: readonly ToolbarControl[]) {
  const [availableWidth, setAvailableWidth] = useState(
    Number.POSITIVE_INFINITY,
  );
  const observerRef = useRef<ResizeObserver | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const fitted = useRef({ controls, availableWidth, trimmed: 0 });
  const ref = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    elementRef.current = element;
    if (!element) return;
    const recompute = () => {
      const width = element.clientWidth;
      const current = fitted.current;
      const unchanged =
        current.trimmed === 0 &&
        Number.isFinite(current.availableWidth) &&
        fitCount(current.controls, scaledWidth(width)) ===
          fitCount(current.controls, scaledWidth(current.availableWidth)) &&
        element.scrollWidth <= width + 1;
      if (!unchanged) setAvailableWidth(width);
    };
    recompute();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recompute);
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  const signature = `${availableWidth}|${controls.map((control) => control.id).join(" ")}`;
  const [trim, setTrim] = useState({ signature, count: 0 });
  const trimmed = trim.signature === signature ? trim.count : 0;
  const estimate = fitCount(controls, scaledWidth(availableWidth));
  const visibleCount = Math.max(0, estimate - trimmed);
  fitted.current = { controls, availableWidth, trimmed };

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || visibleCount === 0) return;
    if (element.scrollWidth > element.clientWidth + 1) {
      setTrim({ signature, count: trimmed + 1 });
    }
  });

  return { containerRef: ref, visibleCount };
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
  children,
}: Readonly<{
  label: string;
  icon: ReactNode;
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
  const shown = open ?? ownOpen;
  const change = (next: boolean) => {
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  return (
    <DropdownMenu open={shown} onOpenChange={change} modal={false}>
      <Tooltip label={label} side="bottom" className={cn("shrink-0", className)}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={(event) => {
              if (event.detail === 0) change(!shown);
            }}
            className={cn(TOOLBAR_TRIGGER_CLASS, !chevron && "w-7 px-0", active && "bg-primary/10 text-foreground")}
          >
            {icon}
            {chevron && <ChevronDown aria-hidden className="size-3" />}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align={align}
        onCloseAutoFocus={onCloseAutoFocus}
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
  if (checked !== undefined) {
    return (
      <DropdownMenuCheckboxItem checked={checked} disabled={disabled} onSelect={onSelect} className="gap-2">
        {body}
      </DropdownMenuCheckboxItem>
    );
  }
  return (
    <DropdownMenuItem inset={inset} disabled={disabled} onSelect={onSelect}>
      {body}
    </DropdownMenuItem>
  );
}

export function ToolbarSubMenu({
  icon: Icon,
  label,
  ariaLabel,
  inset,
  onContentFocus,
  children,
}: Readonly<{ icon: LucideIcon; label: string; ariaLabel?: string; inset?: boolean; onContentFocus?: ContentFocus; children: ReactNode }>) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger inset={inset} aria-label={ariaLabel}>
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
}

export function ToolbarDropdown({
  variant,
  icon: Icon,
  label,
  ariaLabel,
  chevron = true,
  heading,
  className,
  items,
}: Readonly<{
  variant: "bar" | "menu";
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
  chevron?: boolean;
  heading?: string;
  className?: string;
  items: readonly ToolbarDropdownItem[];
}>) {
  if (variant === "menu") {
    return (
      <ToolbarSubMenu icon={Icon} label={label} ariaLabel={ariaLabel}>
        {items.map((item) => (
          <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
            {item.content}
          </DropdownMenuItem>
        ))}
      </ToolbarSubMenu>
    );
  }
  return (
    <Popover
      ariaLabel={ariaLabel}
      className={className}
      triggerClassName={chevron ? "gap-0.5 px-1.5" : undefined}
      trigger={
        <>
          <Icon className="size-4" />
          {chevron && <ChevronDown className="size-3" />}
        </>
      }
    >
      {heading && <div className="px-2 py-1 text-[0.625rem] uppercase tracking-wide text-muted-foreground">{heading}</div>}
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
  className,
  ...rest
}: Readonly<
  {
    controls: readonly ToolbarControl[];
    label: string;
    separated?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onCloseAutoFocus?: (event: Event) => void;
    pushMenu?: (shown: readonly ToolbarControl[]) => boolean;
  } & Omit<ComponentProps<"div">, "ref" | "children">
>) {
  const { containerRef, visibleCount } = useFittedCount(controls);
  const shown = controls.slice(0, visibleCount);
  const hidden = controls.slice(visibleCount);
  return (
    <div ref={containerRef} {...rest} className={cn("flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden", className)}>
      {shown.map((control) => (
        <Fragment key={control.id}>{control.render()}</Fragment>
      ))}
      {hidden.length > 0 && (
        <ToolbarMenuButton
          label={label}
          icon={<MoreHorizontal aria-hidden className="size-4" />}
          chevron={false}
          align="end"
          active={hidden.some((control) => control.active)}
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
