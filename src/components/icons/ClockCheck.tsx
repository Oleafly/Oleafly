import type { SVGProps } from "react";

export function ClockCheck({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path d="M10.44 20.86A9 9 0 1 1 20.86 13.56" />
      <path d="M12 7v5l3 2" />
      <path d="m15.5 19.5 2 2 4-4" />
    </svg>
  );
}
