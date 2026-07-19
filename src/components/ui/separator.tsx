import { cn } from "@/lib/utils";

export function Separator({
  className,
  ...props
}: React.ComponentProps<"hr">) {
  return (
    <hr
      className={cn("h-px w-full shrink-0 border-0 bg-border", className)}
      {...props}
    />
  );
}
