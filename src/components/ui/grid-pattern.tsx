import { useId } from "react";
import { cn } from "@/lib/utils";

// Render inside a `relative` parent; mask via className for a gradient fade.
export function GridPattern({
  width = 20,
  height = 20,
  x = -1,
  y = -1,
  strokeDasharray = "0",
  className,
}: {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  strokeDasharray?: string;
  className?: string;
}) {
  const id = useId().replace(/[:]/g, "");
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full fill-gray-400/30 stroke-gray-400/30",
        className
      )}
    >
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path d={`M.5 ${height}V.5H${width}`} fill="none" strokeDasharray={strokeDasharray} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
    </svg>
  );
}
