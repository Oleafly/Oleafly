import { type ComponentProps, type CSSProperties, useRef } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "@/components/ui/use-dismiss";
import { cn } from "@/lib/utils";

type EditorPopoverProps = Readonly<
  { label: string; style: CSSProperties; onClose: () => void } & Omit<ComponentProps<"div">, "ref" | "role" | "aria-label" | "style">
>;

export function EditorPopover({ label, style, onClose, className, children, ...rest }: EditorPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, [ref], onClose, { closeOnEscape: true });
  return createPortal(
    <div
      {...rest}
      ref={ref}
      role="dialog"
      aria-label={label}
      style={style}
      className={cn("fixed z-50 rounded-lg border bg-popover text-popover-foreground shadow-xl", className)}
    >
      {children}
    </div>,
    document.body,
  );
}
