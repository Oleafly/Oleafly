import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Joins related buttons into one control, as in a primary action with an
 * adjacent menu trigger.
 *
 * The child selectors only reach buttons rendered as *direct* children. A
 * button wrapped in a tooltip or a menu trigger keeps its own corners, so pass
 * `rounded-r-none` / `rounded-l-none` on those buttons yourself.
 */
export function ButtonGroup({
  className,
  ...props
}: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      className={cn(
        "m-0 flex min-w-0 items-center border-0 p-0",
        "[&>button:not(:first-child)]:rounded-l-none [&>button:not(:last-child)]:rounded-r-none",
        // A focus ring must not be clipped by the neighbour that follows it.
        "[&>button:focus-visible]:relative [&>button:focus-visible]:z-10",
        className,
      )}
      {...props}
    />
  );
}
