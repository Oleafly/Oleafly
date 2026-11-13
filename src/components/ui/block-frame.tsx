import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const BLOCK_ROOT = "group/block relative min-w-0";
export const BLOCK_SURFACE = "rounded-md border border-border";
export const BLOCK_FRAME = `${BLOCK_ROOT} ${BLOCK_SURFACE} px-4 pb-4 pt-8`;
export const BLOCK_LABEL =
  "pointer-events-none absolute left-3 top-3 select-none text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground";
export const BLOCK_ACTIONS = "absolute right-1.5 top-1.5 z-10 flex items-center gap-1";
export const BLOCK_REVEAL =
  "opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/block:opacity-100 group-hover/block:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:opacity-100";
export const BLOCK_MESSAGE = "py-4 text-xs text-muted-foreground";
export const BLOCK_CARD = "w-full rounded-md bg-muted/60 p-3 text-left";

export function BlockFrame({
  label,
  actions,
  message,
  framed = true,
  className,
  children,
  ...rest
}: Readonly<
  {
    label?: ReactNode;
    actions?: ReactNode;
    message?: ReactNode;
    framed?: boolean;
    children?: ReactNode;
  } & HTMLAttributes<HTMLDivElement>
>) {
  return (
    <div {...rest} className={cn(framed ? BLOCK_FRAME : BLOCK_ROOT, className)}>
      {label ? <span className={BLOCK_LABEL}>{label}</span> : null}
      {message ? <p className={BLOCK_MESSAGE}>{message}</p> : children}
      {actions ? <div className={BLOCK_ACTIONS}>{actions}</div> : null}
    </div>
  );
}
