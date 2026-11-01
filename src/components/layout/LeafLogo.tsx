import { useId } from "react";
import { cn } from "@/lib/utils";
import { appIconQuill, useSettingsStore } from "@/store/settings";

export function LeafLogo({ className }: Readonly<{ className?: string }>) {
  const colours = useSettingsStore((state) => appIconQuill(state.appIcon));
  const gradient = `leaf-${useId()}`;
  const blended = colours.length > 1;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={cn("block", className)}
      aria-hidden="true"
    >
      <path
        d="M21 2C6 2 4 16 3 22h1.998c.666-3.333 2.333-5.166 5.002-5.5 4-.5 7-4 8-7l-1.5-1 1-1c1-1 2.004-2.5 3.5-5.5z"
        fill={blended ? `url(#${gradient})` : colours[0]}
      />
      {blended ? (
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={gradient} x1="3" y1="22" x2="21" y2="2">
            {colours.map((colour, index) => (
              <stop key={colour} offset={index / (colours.length - 1)} stopColor={colour} />
            ))}
          </linearGradient>
        </defs>
      ) : null}
    </svg>
  );
}
