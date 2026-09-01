import { useEffect, useRef, useState, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!disabled || !open) return;
    onOpenChangeProp?.(false);
    setOpen(false);
  }, [disabled, onOpenChangeProp, open]);

  useEffect(() => {
    if (!open || closeOnClick) return;

    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        contentRef.current?.contains(target)
      ) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest('[role="listbox"], [data-radix-popper-content-wrapper]')
      ) {
        return;
      }
      onOpenChangeProp?.(false);
      setOpen(false);
    };

    document.addEventListener("pointerdown", dismissOnOutsidePointer, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer, true);
    };
  }, [closeOnClick, onOpenChangeProp, open]);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (disabled && next) return;
        onOpenChangeProp?.(next);
        setOpen(next);
      }}
    >
      <PopoverPrimitive.Trigger asChild>
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
            onClick={closeOnClick ? () => setOpen(false) : undefined}
            onPointerDownOutside={(event) => {
              if (closeOnClick) return;
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest('[role="listbox"], [data-radix-popper-content-wrapper]')
              ) {
                event.preventDefault();
              }
            }}
            onInteractOutside={(event) => {
              if (
                !closeOnClick &&
                event.target instanceof Element &&
                event.target.closest('[role="listbox"], [data-radix-popper-content-wrapper]')
              ) {
                event.preventDefault();
              }
            }}
            onFocusOutside={(event) => {
              if (
                !closeOnClick &&
                event.target instanceof Element &&
                event.target.closest('[role="listbox"], [data-radix-popper-content-wrapper]')
              ) {
                event.preventDefault();
              }
            }}
            className={cn(
              "z-50 min-w-42 rounded-md border bg-card p-1 text-card-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
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
}: {
  onClick: () => void;
  children: ReactNode;
}) {
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
