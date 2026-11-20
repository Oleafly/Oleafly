import * as React from "react";
import { cn } from "@/lib/utils";

export const INPUT_CLASS_NAME =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground placeholder-shown:text-ellipsis focus-visible:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50";

export const LITERAL_INPUT = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const;

export const SEARCH_INPUT = { ...LITERAL_INPUT, autoComplete: "off" } as const;

function literalProps(type: string | undefined) {
  if (type === "search") return SEARCH_INPUT;
  if (type === "url" || type === "email") return LITERAL_INPUT;
  return null;
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(INPUT_CLASS_NAME, className)}
      {...literalProps(type)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
