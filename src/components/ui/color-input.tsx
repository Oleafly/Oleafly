import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ColorInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<typeof Input>, "type">
>(({ className, ...props }, ref) => (
  <Input
    ref={ref}
    type="color"
    className={cn(
      "size-7 cursor-pointer overflow-hidden rounded-full border bg-background p-0 shadow-none [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0",
      className,
    )}
    {...props}
  />
));
ColorInput.displayName = "ColorInput";

export { ColorInput };
