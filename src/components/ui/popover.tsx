import { useRef, useState, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
  ariaLabel?: string;
  closeOnClick?: boolean;
}

export function Popover({
  trigger,
  children,
  align = "left",
  className,
  ariaLabel,
  closeOnClick = true,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const interactionInsideRef = useRef(false);
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !closeOnClick && interactionInsideRef.current) return;
        setOpen(next);
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={ariaLabel}
          className={cn("size-7 text-muted-foreground", open && "bg-accent text-foreground")}
          onPointerDown={() => {
            interactionInsideRef.current = false;
          }}
        >
          {trigger}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align === "right" ? "end" : "start"}
          sideOffset={4}
          onClick={closeOnClick ? () => setOpen(false) : undefined}
          onPointerDownCapture={() => {
            if (!closeOnClick) interactionInsideRef.current = true;
          }}
          onPointerDownOutside={(event) => {
            if (closeOnClick) return;
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest('[role="listbox"]')
            ) {
              interactionInsideRef.current = true;
              event.preventDefault();
              return;
            }
            interactionInsideRef.current = false;
          }}
          onInteractOutside={(event) => {
            if (
              !closeOnClick &&
              event.target instanceof Element &&
              event.target.closest('[role="listbox"]')
            ) {
              interactionInsideRef.current = true;
              event.preventDefault();
              return;
            }
            interactionInsideRef.current = false;
          }}
          onFocusOutside={(event) => {
            if (
              !closeOnClick &&
              event.target instanceof Element &&
              event.target.closest('[role="listbox"]')
            ) {
              interactionInsideRef.current = true;
              event.preventDefault();
            }
          }}
          onEscapeKeyDown={() => {
            interactionInsideRef.current = false;
          }}
          className={cn(
            "z-50 min-w-42 rounded-md border bg-card p-1 text-card-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            className,
          )}
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
