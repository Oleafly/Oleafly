import type { ReactNode } from "react";
import { Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const AI_GRADIENT = "from-[#4285F4] via-[#9B72CB] to-[#D96570]";
export const AI_PROMPT_SURFACE = "ai-prompt-surface";

export function AiMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("flex size-7 shrink-0 items-center justify-center text-primary", className)}
      aria-hidden
    >
      <Wand2 className="size-5" />
    </span>
  );
}

export function AiChrome({
  children,
  className,
  contentClassName,
  borderVariant = "gradient",
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  borderVariant?: "gradient" | "primary" | "animated";
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-0.5 shadow-lg",
        borderVariant === "gradient" &&
          cn("bg-gradient-to-br shadow-[#9B72CB]/20", AI_GRADIENT),
        borderVariant === "primary" && "bg-primary shadow-primary/15",
        borderVariant === "animated" &&
          "ai-tool-approval-chrome shadow-[#9B72CB]/20",
        className,
      )}
    >
      <div
        className={cn(
          AI_PROMPT_SURFACE,
          "rounded-[10px] backdrop-blur-sm",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
