import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";

export function PathMessage({ paths, children }: Readonly<{ paths: readonly string[]; children: ReactNode }>) {
  return (
    <Tooltip
      wide
      className="min-w-0 flex-1"
      label={paths.map((path) => (
        <span key={path} className="block">
          {path}
        </span>
      ))}
    >
      <p className="min-w-0 flex-1 select-text">{children}</p>
    </Tooltip>
  );
}
