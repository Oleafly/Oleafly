import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { useDismiss } from "@/components/ui/use-dismiss";
import { cn } from "@/lib/utils";

const NESTED_POPUP = '[role="listbox"], [data-radix-popper-content-wrapper]';
const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 200;

interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  contentAriaLabel?: string;
  closeOnClick?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  openOnHover?: boolean;
}

export function Popover({
  trigger,
  children,
  align = "left",
  className,
  triggerClassName,
  ariaLabel,
  contentAriaLabel,
  closeOnClick = true,
  onOpenChange: onOpenChangeProp,
  disabled = false,
  openOnHover = false,
}: Readonly<PopoverProps>) {
  const [open, setOpen] = useState(false);
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
            align={align === "right" ? "end" : "start"}
            sideOffset={4}
            collisionPadding={12}
            onClick={closeOnClick ? settleClosed : undefined}
            onPointerEnter={openOnHover ? clearHover : undefined}
            onPointerLeave={openOnHover ? hoverOut : undefined}
            onOpenAutoFocus={(event) => {
              if (openedByHover.current) event.preventDefault();
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
            className={cn(
              "z-50 min-w-42 rounded-md border bg-card p-1 text-card-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              className,
            )}
          >
            {children}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      )}
    </PopoverPrimitive.Root>
  );
}

export function PopoverItem({
  onClick,
  children,
}: Readonly<{
  onClick: () => void;
  children: ReactNode;
}>) {
  return (
    <PopoverPrimitive.Close asChild>
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        className="h-auto w-full justify-start px-2 py-1.5 text-left font-normal"
      >
        {children}
      </Button>
    </PopoverPrimitive.Close>
  );
}

export const PopoverClose = PopoverPrimitive.Close;
