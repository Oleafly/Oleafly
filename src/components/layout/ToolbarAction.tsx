import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Hidden actions remain measurable but leave the keyboard and accessibility trees. */
export function ToolbarAction({ name, order, hidden = false, children }: Readonly<{
  name: string;
  order?: number;
  hidden?: boolean;
  children: ReactNode;
}>) {
  return <div data-toolbar-item={name} data-toolbar-icon data-overflow-order={order}
    aria-hidden={hidden || undefined} inert={hidden}
    className={cn("flex w-max shrink-0", hidden && "invisible absolute left-0 top-0")}>
    {children}
  </div>;
}
