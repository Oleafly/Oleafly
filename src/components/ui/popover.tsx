import {
  type ComponentProps,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { useDismiss } from "@/components/ui/use-dismiss";
import { cn } from "@/lib/utils";

const POPOVER_CONTENT =
  "z-50 min-w-42 rounded-md border bg-card p-1 text-card-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";
const NESTED_POPUP = '[role="listbox"], [data-radix-popper-content-wrapper]';
const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 200;

interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  contentAriaLabel?: string;
  closeOnClick?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  openOnHover?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
}

export function Popover({
  trigger,
  children,
  align = "left",
  side = "bottom",
  className,
  triggerClassName,
  ariaLabel,
  contentAriaLabel,
  closeOnClick = true,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  disabled = false,
  openOnHover = false,
  onOpenAutoFocus,
}: Readonly<PopoverProps>) {
  const [openState, setOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const [pinned, setPinned] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHover = useRef(false);

  const clearHover = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  const settleClosed = () => {
    clearHover();
    setPinned(false);
    openedByHover.current = false;
    if (controlled && open) onOpenChangeProp?.(false);
    setOpen(false);
  };

  const change = (next: boolean) => {
    if (disabled && next) return;
    onOpenChangeProp?.(next);
    if (next) setOpen(true);
    else settleClosed();
  };

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    },
    [],
  );

  const hoverIn = (event: ReactPointerEvent) => {
    if (!openOnHover || disabled || event.pointerType === "touch") return;
    clearHover();
    if (open) return;
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      openedByHover.current = true;
      change(true);
    }, HOVER_OPEN_MS);
  };

  const hoverOut = (event: ReactPointerEvent) => {
    if (!openOnHover || event.pointerType === "touch") return;
    clearHover();
    if (!open || pinned) return;
    hoverTimer.current = setTimeout(() => change(false), HOVER_CLOSE_MS);
  };

  useEffect(() => {
    if (!disabled || !open) return;
    onOpenChangeProp?.(false);
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setPinned(false);
    openedByHover.current = false;
    setOpen(false);
  }, [disabled, onOpenChangeProp, open]);

  useDismiss(
    open && !closeOnClick,
    [triggerRef, contentRef],
    () => {
      onOpenChangeProp?.(false);
      settleClosed();
    },
    { ignore: NESTED_POPUP },
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={change}>
      <PopoverPrimitive.Trigger
        asChild
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        onClick={(event) => {
          if (!openOnHover) return;
          clearHover();
          if (open && !pinned) event.preventDefault();
          if (!pinned) setPinned(true);
          openedByHover.current = false;
        }}
      >
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size={triggerClassName ? "sm" : "icon"}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            triggerClassName ? "text-foreground" : "size-7 text-muted-foreground",
            open && "bg-accent text-foreground",
            triggerClassName,
          )}
        >
          {trigger}
        </Button>
      </PopoverPrimitive.Trigger>
      {!disabled && (
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            ref={contentRef}
            aria-label={contentAriaLabel}
            side={side}
            align={align === "right" ? "end" : "start"}
            sideOffset={4}
            collisionPadding={12}
            onClick={closeOnClick ? settleClosed : undefined}
            onPointerEnter={openOnHover ? clearHover : undefined}
            onPointerLeave={openOnHover ? hoverOut : undefined}
            onOpenAutoFocus={(event) => {
              if (openedByHover.current) event.preventDefault();
              else onOpenAutoFocus?.(event);
            }}
            onPointerDownOutside={(event) => {
              if (closeOnClick) return;
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest(NESTED_POPUP)
              ) {
                event.preventDefault();
              }
            }}
            onInteractOutside={(event) => {
              if (
                !closeOnClick &&
                event.target instanceof Element &&
                event.target.closest(NESTED_POPUP)
              ) {
                event.preventDefault();
              }
            }}
            onFocusOutside={(event) => {
              if (
                !closeOnClick &&
                event.target instanceof Element &&
                event.target.closest(NESTED_POPUP)
              ) {
                event.preventDefault();
              }
            }}
            className={cn(POPOVER_CONTENT, className)}
          >
            {children}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      )}
    </PopoverPrimitive.Root>
  );
}

export type PopoverAnchor = { getBoundingClientRect(): DOMRect } | (() => DOMRect);

interface AnchoredPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: PopoverAnchor;
  contextElement?: Element | null;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  hideWhenDetached?: boolean;
  className?: string;
  ariaLabel: string;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}

function measure(anchor: PopoverAnchor) {
  return typeof anchor === "function" ? anchor() : anchor.getBoundingClientRect();
}

export function AnchoredPopover({
  open,
  onOpenChange,
  anchor,
  contextElement,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  hideWhenDetached = false,
  className,
  ariaLabel,
  onOpenAutoFocus,
  onCloseAutoFocus,
  children,
}: Readonly<AnchoredPopoverProps>) {
  const latest = useRef(anchor);
  useLayoutEffect(() => {
    latest.current = anchor;
  }, [anchor]);
  const virtualRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => measure(latest.current),
        contextElement: contextElement ?? undefined,
      },
    }),
    [contextElement],
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor virtualRef={virtualRef} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          aria-label={ariaLabel}
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={12}
          hideWhenDetached={hideWhenDetached}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(POPOVER_CONTENT, className)}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function PopoverItem({
  onClick,
  children,
  className,
  ...props
}: Readonly<
  {
    onClick: () => void;
    children: ReactNode;
  } & Omit<ComponentProps<typeof Button>, "onClick" | "children" | "variant" | "type">
>) {
  return (
    <PopoverPrimitive.Close asChild>
      <Button
        {...props}
        type="button"
        variant="ghost"
        onClick={onClick}
        className={cn("h-auto w-full justify-start px-2 py-1.5 text-left font-normal", className)}
      >
        {children}
      </Button>
    </PopoverPrimitive.Close>
  );
}

export const PopoverClose = PopoverPrimitive.Close;
