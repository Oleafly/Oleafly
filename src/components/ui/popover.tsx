import { useState, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
  ariaLabel?: string;
}

export function Popover({
  trigger,
  children,
  align = "left",
  className,
  ariaLabel,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={ariaLabel}
          className={cn("size-7 text-muted-foreground", open && "bg-accent text-foreground")}
        >
          {trigger}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align === "right" ? "end" : "start"}
          sideOffset={4}
          onClick={() => setOpen(false)}
          className={cn(
            "z-50 min-w-42 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
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
