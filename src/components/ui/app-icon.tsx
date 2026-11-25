import { AppWindow } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppIcon({ url, size = "default" }: Readonly<{ url: string | undefined; size?: "default" | "sm" }>) {
  const small = size === "sm";
  if (url) {
    return (
      <img src={url} alt="" draggable={false} className={cn("shrink-0 object-contain", small ? "size-5" : "size-8")} />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center text-muted-foreground",
        small ? "size-5" : "size-8 rounded-md bg-muted",
      )}
    >
      <AppWindow className="size-4" />
    </span>
  );
}
