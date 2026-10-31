import type * as React from "react";

import { cn } from "@/lib/utils";

export function ButtonGroup({
  className,
  ...props
}: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      className={cn(
        "m-0 flex min-w-0 items-center border-0 p-0",
        "[&>button:not(:first-child)]:rounded-l-none [&>button:not(:last-child)]:rounded-r-none",
        "[&>button:focus-visible]:relative [&>button:focus-visible]:z-10",
        className,
      )}
      {...props}
    />
  );
}
