import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

export type ModalLayer = "dialog" | "raised" | "nested";
export type ModalAlign = "center" | "top";
export type ModalWidth = "sm" | "md" | "lg" | "2xl";

const LAYER_CLASS: Record<ModalLayer, string> = {
  dialog: "z-[80]",
  raised: "z-[90]",
  nested: "z-[120]",
};

const ALIGN_CLASS: Record<ModalAlign, string> = {
  center: "items-center p-4",
  top: "items-start pt-[15vh]",
};

const WIDTH_CLASS: Record<ModalWidth, string> = {
  sm: "w-full max-w-sm",
  md: "w-full max-w-md",
  lg: "w-full max-w-lg",
  "2xl": "w-full max-w-2xl",
};

const OVERLAY_ANIMATION = "animate-in fade-in duration-200 motion-reduce:animate-none";
const PANEL_ANIMATION = "animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none";

export const MODAL_PANEL_SURFACE =
  "rounded-xl border bg-background text-foreground shadow-2xl";

export function modalOverlayClassName(
  layer: ModalLayer = "dialog",
  align: ModalAlign = "center",
): string {
  return cn(
    "pointer-events-auto fixed inset-0 flex justify-center bg-black/50 backdrop-blur-sm",
    LAYER_CLASS[layer],
    ALIGN_CLASS[align],
  );
}

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
  layer?: ModalLayer;
  align?: ModalAlign;
  width?: ModalWidth;
  role?: "dialog" | "alertdialog";
  as?: "div" | "dialog";
  surface?: boolean;
  portal?: boolean;
  animated?: boolean;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  testId?: string;
  focusPanel?: boolean;
}

export function ModalShell({
  open,
  onClose,
  closeLabel,
  children,
  layer = "dialog",
  align = "center",
  width,
  role = "dialog",
  as = "div",
  surface = true,
  portal = false,
  animated = false,
  label,
  labelledBy,
  describedBy,
  className,
  testId,
  focusPanel = false,
}: Readonly<ModalShellProps>) {
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLElement>(open, onClose);

  if (!open) return null;

  const panelClassName = cn(
    "relative",
    surface && MODAL_PANEL_SURFACE,
    width && WIDTH_CLASS[width],
    animated && PANEL_ANIMATION,
    className,
  );
  const panelProps = {
    "aria-modal": true,
    "aria-label": label,
    "aria-labelledby": labelledBy,
    "aria-describedby": describedBy,
    "data-testid": testId,
    "data-modal-initial-focus": focusPanel || undefined,
    tabIndex: -1,
    className: panelClassName,
  };

  const panel =
    as === "dialog" ? (
      <dialog open ref={dialogRef as RefObject<HTMLDialogElement | null>} {...panelProps}>
        {children}
      </dialog>
    ) : (
      <div ref={dialogRef as RefObject<HTMLDivElement | null>} role={role} {...panelProps}>
        {children}
      </div>
    );

  const overlay = (
    <div className={cn(modalOverlayClassName(layer, align), animated && OVERLAY_ANIMATION)}>
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      {panel}
    </div>
  );

  return portal ? createPortal(overlay, document.body) : overlay;
}
